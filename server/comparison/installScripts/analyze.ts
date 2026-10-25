import { Array, Effect, Order } from 'effect';

import type { InstallInspection, InstallAnalysis } from '../../../shared/comparison/evidence/installScripts.defs';
import type { PublishedFile } from '../../../shared/comparison/evidence/tarball.defs';
import { inspectJavaScript, type ScriptSyntax } from './javascript';
import { createImportResolver, type ImportResolver } from './resolve';
import { installCommands } from './shell';

const HOOKS = ['preinstall', 'install', 'postinstall'];

const MAX_FILES = 64;

type Trace = { name: string; command: string; origin: 'declared' | 'implicit'; files: string[] };

type State = {
  analysis: {
    status: InstallAnalysis['status'];
    reasons: string[];
    uninspectedPackages: string[];
    scripts: Trace[];
    findings: InstallAnalysis['findings'][number][];
  };
  files: Map<string, PublishedFile>;
  sources: ReadonlyMap<string, string>;
  reached: Map<string, string>;
  syntax: Map<string, ScriptSyntax>;
  scripts: Readonly<Record<string, string>>;
  resolveImport: ImportResolver;
  commandCount: number;
};

const gap = (state: State, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    state.analysis.status = 'partial';

    if (state.analysis.reasons.length < 32 && !Array.contains(state.analysis.reasons, message))
      state.analysis.reasons.push(message.slice(0, 4096));
  });

const fileSyntax = Effect.fnUntraced(function* (
  path: string,
  state: State,
): Effect.fn.Return<ScriptSyntax | undefined> {
  if (path.endsWith('.json')) return undefined;

  if (!/\.(?:[cm]?js)$/.test(path)) {
    yield* gap(state, `This file type was not inspected: ${path}`);

    return undefined;
  }

  const source = state.sources.get(path);

  if (source === undefined) {
    yield* gap(state, `Source text was unavailable or exceeded inspection limits: ${path}`);

    return undefined;
  }

  let syntax = state.syntax.get(path);

  if (!syntax) {
    syntax = yield* inspectJavaScript(source);
    state.syntax.set(path, syntax);
  }

  return syntax;
});

const recordPackage = Effect.fnUntraced(function* (name: string, state: State): Effect.fn.Return<void> {
  state.analysis.status = 'partial';

  if (state.analysis.uninspectedPackages.includes(name)) return;

  if (state.analysis.uninspectedPackages.length >= 64)
    return yield* gap(state, 'The 64-package display limit was reached');
  state.analysis.uninspectedPackages.push(name);
});

const recordFindings = Effect.fnUntraced(function* (
  path: string,
  trace: Trace,
  syntax: ScriptSyntax,
  state: State,
): Effect.fn.Return<void> {
  for (const reason of syntax.reasons) yield* gap(state, `${reason} (${path})`);

  for (const finding of syntax.findings) {
    if (state.analysis.findings.length >= 64) return yield* gap(state, 'The 64-operation display limit was reached');
    state.analysis.findings.push({ ...finding, script: trace.name, path });
  }
});

const visitImports = Effect.fnUntraced(function* (
  path: string,
  trace: Trace,
  syntax: ScriptSyntax,
  visited: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  for (const { specifier, mode } of syntax.imports) {
    const resolved = yield* state.resolveImport(specifier, path, mode);

    if (resolved.kind === 'local') yield* visitFile(resolved.path, trace, visited, state);
    else if (resolved.kind === 'external') yield* recordPackage(resolved.name, state);
    else if (resolved.kind === 'unresolved')
      yield* gap(state, `${resolved.reason}: ${specifier.slice(0, 200)} (${path})`);
  }
});

const visitFile = Effect.fnUntraced(function* (
  path: string,
  trace: Trace,
  visited: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  if (path.split('/').includes('node_modules')) return yield* gap(state, 'Dependency files were not inspected');

  if (visited.has(path)) return;
  visited.add(path);
  const file = state.files.get(path);

  if (!file || file.type !== 'file' || !file.sha256)
    return yield* gap(state, `File missing or not a regular file: ${path}`);

  if (!state.reached.has(path) && state.reached.size >= MAX_FILES)
    return yield* gap(state, 'The 64-file inspection limit was reached');
  trace.files.push(path);
  state.reached.set(path, file.sha256);
  const syntax = yield* fileSyntax(path, state);

  if (!syntax) return;
  yield* recordFindings(path, trace, syntax, state);

  yield* visitImports(path, trace, syntax, visited, state);
});

const nativeBuild = Effect.fnUntraced(function* (trace: Trace, state: State): Effect.fn.Return<void> {
  const file = state.files.get('binding.gyp');

  if (file?.type !== 'file' || !file.sha256) return yield* gap(state, 'Native build commands were not inspected');

  if (!state.reached.has(file.path) && state.reached.size >= MAX_FILES)
    return yield* gap(state, 'The 64-file inspection limit was reached');

  if (state.analysis.findings.length >= 64) return yield* gap(state, 'The 64-operation display limit was reached');

  if (!trace.files.includes(file.path)) trace.files.push(file.path);
  state.reached.set(file.path, file.sha256);
  state.analysis.findings.push({
    script: trace.name,
    kind: 'native-build',
    path: file.path,
    line: 1,
    endLine: 1,
    excerpt: '',
    detail: 'A binding.gyp file is present',
  });
  yield* gap(state, 'Native build tools and compiled code were not inspected');
});

const traceNode = Effect.fnUntraced(function* (
  words: string[],
  trace: Trace,
  visited: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  const target = words[1] === '--' ? words[2] : words[1];

  if (!target || /^[-/]/.test(target))
    return yield* gap(state, 'Node flags, inline code, or absolute entry paths were not inspected');
  const resolved = yield* state.resolveImport(`./${target}`, 'package.json', 'require');

  if (resolved.kind === 'local') yield* visitFile(resolved.path, trace, visited, state);
  else if (resolved.kind === 'unresolved') yield* gap(state, `${resolved.reason}: ${target.slice(0, 200)}`);
});

const traceNpm = Effect.fnUntraced(function* (
  name: string | undefined,
  trace: Trace,
  visited: Set<string>,
  stack: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  if (!name || name.startsWith('-')) return yield* gap(state, 'This npm command could not be followed');

  if (stack.has(name)) return yield* gap(state, `An npm script cycle could not be followed: ${name}`);

  if (stack.size >= 16) return yield* gap(state, 'The npm script nesting limit was reached');
  stack.add(name);

  for (const hook of [`pre${name}`, name, `post${name}`]) {
    const command = Object.hasOwn(state.scripts, hook) ? state.scripts[hook] : undefined;

    if (command !== undefined) yield* traceShell(command, trace, visited, stack, state);
    else if (hook === name) yield* gap(state, `Referenced npm script was not declared: ${name}`);
  }

  stack.delete(name);
});

const traceCommand = Effect.fnUntraced(function* (
  words: string[],
  trace: Trace,
  visited: Set<string>,
  stack: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  const program = words[0];

  if (!program) return;

  if (program === 'node' || program === 'nodejs') yield* traceNode(words, trace, visited, state);
  else if (program === 'npm' && /^(run|run-script)$/.test(words[1] ?? ''))
    yield* traceNpm(words[2], trace, visited, stack, state);
  else if (program === 'node-gyp' && /^(build|rebuild)$/.test(words[1] ?? '')) yield* nativeBuild(trace, state);
  else yield* gap(state, `External command not inspected: ${program.slice(0, 200)}`);
});

const traceShell = Effect.fnUntraced(function* (
  command: string,
  trace: Trace,
  visited: Set<string>,
  stack: Set<string>,
  state: State,
): Effect.fn.Return<void> {
  if (command.length > 4096) return yield* gap(state, 'An install command exceeded inspection limits');
  const parsed = yield* installCommands(command);

  if (!parsed) return yield* gap(state, 'Shell expansion, redirects, pipes, or unsupported syntax were not inspected');

  for (const words of parsed) {
    if (++state.commandCount > 128) return yield* gap(state, 'The 128-command inspection limit was reached');
    yield* traceCommand(words, trace, visited, stack, state);
  }
});

const finishInspection = (state: State): InstallInspection => {
  state.analysis.uninspectedPackages = Array.sort(state.analysis.uninspectedPackages, Order.String);

  for (const trace of state.analysis.scripts) trace.files = Array.sort(trace.files, Order.String);

  state.analysis.findings = Array.sort(
    state.analysis.findings,
    (a: InstallAnalysis['findings'][number], b: InstallAnalysis['findings'][number]) =>
      Order.Number(
        a.script.localeCompare(b.script) ||
          a.path.localeCompare(b.path) ||
          a.line - b.line ||
          a.kind.localeCompare(b.kind),
        0,
      ),
  );

  return {
    analysis: state.analysis,
    files: Array.map(
      Array.sort(state.reached, ([a]: [string, string], [b]: [string, string]) => Order.Number(a.localeCompare(b), 0)),
      ([path, sha256]) => ({ path, sha256 }),
    ),
  };
};

export const analyzeInstallScripts = Effect.fnUntraced(function* (
  scripts: Readonly<Record<string, string>>,
  files: readonly PublishedFile[],
  sources: ReadonlyMap<string, string>,
): Effect.fn.Return<InstallInspection> {
  const inventory = new Map(Array.map(files, (file) => [file.path, file]));

  const state: State = {
    analysis: { status: 'available', reasons: [], uninspectedPackages: [], scripts: [], findings: [] },
    files: inventory,
    sources,
    reached: new Map(),
    syntax: new Map(),
    resolveImport: yield* createImportResolver(inventory, sources),
    scripts,
    commandCount: 0,
  };

  for (const name of HOOKS) {
    const command = scripts[name];

    if (command === undefined) continue;
    const trace: Trace = { name, command: command.slice(0, 4096), origin: 'declared', files: [] };
    state.analysis.scripts.push(trace);
    yield* traceShell(command, trace, new Set(), new Set([name]), state);
  }

  if (
    scripts.install === undefined &&
    scripts.preinstall === undefined &&
    state.files.get('binding.gyp')?.type === 'file'
  ) {
    const trace: Trace = { name: 'install', command: 'node-gyp rebuild', origin: 'implicit', files: [] };
    state.analysis.scripts.push(trace);
    yield* nativeBuild(trace, state);
  }

  return finishInspection(state);
});
