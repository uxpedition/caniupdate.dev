import { parse, type AnyNode } from 'acorn';
import { Effect, Match, String } from 'effect';

import type { InstallFinding } from '../../../shared/comparison/evidence/installScripts.defs';
import {
  buildBindings,
  literal,
  property,
  reference,
  walkSyntax,
  SyntaxInspectionError,
  type Bindings,
  type Scope,
} from './bindings';

type Kind = InstallFinding['kind'];

export type ScriptSyntax = {
  findings: Omit<InstallFinding, 'script' | 'path'>[];
  imports: { specifier: string; mode: 'import' | 'require' }[];
  reasons: string[];
};

const processCalls = {
  exec: true,
  execSync: true,
  execFile: true,
  execFileSync: true,
  spawn: true,
  spawnSync: true,
  fork: true,
};

const networkCalls = { get: true, request: true, connect: true, createConnection: true, Socket: true, WebSocket: true };

const readCalls = { readFile: true, readFileSync: true, readdir: true, readdirSync: true, createReadStream: true };

const writeCalls = {
  writeFile: true,
  writeFileSync: true,
  appendFile: true,
  appendFileSync: true,
  createWriteStream: true,
  mkdir: true,
  mkdirSync: true,
  chmod: true,
  chmodSync: true,
  chown: true,
  chownSync: true,
  copyFile: true,
  copyFileSync: true,
  rename: true,
  renameSync: true,
  symlink: true,
  symlinkSync: true,
};

const deleteCalls = { rm: true, rmSync: true, unlink: true, unlinkSync: true, rmdir: true, rmdirSync: true };

const fileOperation = (method: string): Kind | undefined =>
  Match.value(method).pipe(
    Match.whenOr('open', 'openSync', (): Kind => 'file-open'),
    Match.when(
      (name) => Object.hasOwn(readCalls, name),
      (): Kind => 'file-read',
    ),
    Match.when(
      (name) => Object.hasOwn(writeCalls, name),
      (): Kind => 'file-write',
    ),
    Match.when(
      (name) => Object.hasOwn(deleteCalls, name),
      (): Kind => 'file-delete',
    ),
    Match.orElse(() => undefined),
  );

const moduleOperation = (module: string, method: string): Kind | undefined =>
  Match.value(module).pipe(
    Match.when(
      (name) => name === 'child_process' && Object.hasOwn(processCalls, method),
      (): Kind => 'process',
    ),
    Match.when(
      (name) => /^(https?|http2|net|tls|dns|dgram)$/.test(name) && Object.hasOwn(networkCalls, method),
      (): Kind => 'network',
    ),
    Match.when(
      (name) => /^fs(?:[/.]promises)?$/.test(name),
      () => fileOperation(method),
    ),
    Match.when(
      (name) =>
        name === 'vm' &&
        /^(Script|SourceTextModule|compileFunction|runInThisContext|runInNewContext|runInContext)$/.test(method),
      (): Kind => 'dynamic-code',
    ),
    Match.when(
      (name) => `${name}.${method}` === 'worker_threads.Worker' || `${name}.${method}` === 'process.dlopen',
      (): Kind => 'process',
    ),
    Match.orElse(() => undefined),
  );

const operation = (name: string | undefined): Kind | undefined =>
  Match.value(name).pipe(
    Match.whenOr('global:fetch', 'global:globalThis.fetch', (): Kind => 'network'),
    Match.whenOr('global:eval', 'global:Function', (): Kind => 'dynamic-code'),
    Match.orElse((name) => {
      const match = name ? /^module:(.+)[.]([^.]+)$/.exec(name) : null;

      return match ? moduleOperation(match[1] ?? '', match[2] ?? '') : undefined;
    }),
  );

const sourceExcerpt = (node: AnyNode, source: string): Pick<InstallFinding, 'line' | 'endLine' | 'excerpt'> => {
  const line = node.loc?.start.line ?? 1;
  const excerpt = String.slice(node.start, Math.min(node.end, node.start + 600))(source);

  return { line, endLine: line + String.split(excerpt, '\n').length - 1, excerpt };
};

const addImport = (
  node: AnyNode | undefined | null,
  result: ScriptSyntax,
  mode: 'import' | 'require' = 'import',
): Effect.Effect<void> =>
  Effect.sync(() => {
    const specifier = literal(node);

    if (specifier === undefined) result.reasons.push('Import path only known when the script runs');
    else result.imports.push({ specifier, mode });
  });

const detectImport = Effect.fnUntraced(function* (
  node: AnyNode,
  state: Bindings,
  result: ScriptSyntax,
): Effect.fn.Return<void> {
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') yield* addImport(node.source, result);
  else if (node.type === 'ExportNamedDeclaration' && node.source) yield* addImport(node.source, result);
  else if (node.type === 'ImportExpression') yield* addImport(node.source, result);
  else if (node.type === 'CallExpression') {
    const scope = state.scopes.get(node);

    if (scope && (yield* reference(node.callee, scope, state)) === 'global:require')
      yield* addImport(node.arguments[0], result, 'require');
  }
});

const isWriteTarget = (node: AnyNode, parent: AnyNode | undefined): boolean =>
  Match.value(parent).pipe(
    Match.when({ type: 'AssignmentExpression' }, (value) => value.left === node),
    Match.when({ type: 'UpdateExpression' }, (value) => value.argument === node),
    Match.orElse(() => false),
  );

const environmentRead = Effect.fnUntraced(function* (
  node: AnyNode,
  parent: AnyNode | undefined,
  scope: Scope,
  state: Bindings,
): Effect.fn.Return<boolean> {
  let target: string | undefined;

  if (node.type === 'MemberExpression' && !isWriteTarget(node, parent))
    target = yield* reference(node.object, scope, state);
  else if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern')
    target = yield* reference(node.init, scope, state);

  return target === 'global:process.env' || target === 'module:process.env';
});

const detectOperation = Effect.fnUntraced(function* (
  node: AnyNode,
  ancestors: AnyNode[],
  state: Bindings,
  source: string,
  result: ScriptSyntax,
): Effect.fn.Return<void> {
  const scope = state.scopes.get(node);

  if (!scope || result.findings.length >= 64) return;
  let kind: Kind | undefined;
  let detail = '';

  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    kind = operation(yield* reference(node.callee, scope, state));
    detail = literal(node.arguments[0])?.slice(0, 200) ?? '';
  } else if (yield* environmentRead(node, ancestors.at(-2), scope, state)) kind = 'environment';

  if (!kind) return;
  result.findings.push({ kind, ...sourceExcerpt(node, source), detail });

  if (kind === 'dynamic-code') result.reasons.push('Code created while the script runs was not inspected');
});

const detectComputedMethod = Effect.fnUntraced(function* (
  node: AnyNode,
  state: Bindings,
  result: ScriptSyntax,
): Effect.fn.Return<void> {
  if (node.type !== 'MemberExpression' || !node.computed || property(node) !== undefined) return;
  const scope = state.scopes.get(node);
  const name = scope ? yield* reference(node.object, scope, state) : undefined;

  if (name !== undefined && /^(?:module:[^.]+(?:[.]promises)?|global:(?:process|globalThis))$/.test(name))
    result.reasons.push('Function name only known when the script runs');
});

const parseProgram = (source: string, sourceType: 'module' | 'commonjs') =>
  Effect.try({
    try: () => parse(source, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true }),
    catch: () => new SyntaxInspectionError(),
  });

export const inspectJavaScript = Effect.fnUntraced(function* (source: string): Effect.fn.Return<ScriptSyntax> {
  const result: ScriptSyntax = { findings: [], imports: [], reasons: [] };
  yield* Effect.gen(function* () {
    const program = yield* parseProgram(source, 'module').pipe(Effect.catch(() => parseProgram(source, 'commonjs')));
    const state = yield* buildBindings(program);

    if (state.reassigned) result.reasons.push('Calls to replaced functions not followed');
    let count = 0;
    yield* walkSyntax(
      program,
      Effect.fnUntraced(function* (node, ancestors) {
        if (++count > 50_000) return yield* new SyntaxInspectionError();
        yield* detectImport(node, state, result);
        yield* detectComputedMethod(node, state, result);
        yield* detectOperation(node, ancestors, state, source, result);
      }),
    );

    if (result.findings.length >= 64) result.reasons.push('The operation display limit was reached');
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => {
        result.reasons.push('This file could not be fully parsed within inspection limits');
      }),
    ),
  );

  return result;
});
