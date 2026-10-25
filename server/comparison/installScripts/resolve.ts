import { isBuiltin } from 'node:module';
import { posix } from 'node:path';

import { Array, Effect, Iterable, Match, Option, Order, Predicate, Ref, Schema, String as EffectString } from 'effect';

import type { PublishedFile } from '../../../shared/comparison/evidence/tarball.defs';
import {
  PackageNameSchema,
  PublishedModuleManifestSchema,
  type PublishedModuleManifest,
} from '../../../shared/comparison/package/package.defs';

export type ImportResolution =
  | { kind: 'local'; path: string }
  | { kind: 'external'; name: string }
  | { kind: 'unresolved'; reason: string }
  | { kind: 'builtin' };

type Mode = 'import' | 'require';

export type ImportResolver = (specifier: string, from: string, mode: Mode) => Effect.Effect<ImportResolution>;

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(PublishedModuleManifestSchema));

const isPackageName = Schema.is(PackageNameSchema);

// Values are already decoded JSON; only the map container needs narrowing.
const isPackageMap = (value: Schema.Json | undefined): value is Schema.JsonObject => Predicate.isObject(value);

type PackageScope = { root: string; manifest: PublishedModuleManifest };

type Scope = PackageScope | { reason: string };

type Target = { target: string } | { invalid: true } | null | undefined;

type Mapping = { value: Schema.Json; pattern?: string };

type Budget = Ref.Ref<number>;

class ResolutionLimit extends Schema.TaggedError<ResolutionLimit>()('ResolutionLimit', {}) {}

const NODE_CONDITIONS = new Set(['node', 'node-addons', 'module-sync', 'default']);

const EXTENSIONS = ['.js', '.json', '.node'];

const step = Effect.fnUntraced(function* (budget: Budget): Effect.fn.Return<void, ResolutionLimit> {
  if ((yield* Ref.updateAndGet(budget, (remaining) => remaining - 1)) < 0) return yield* new ResolutionLimit();
});

const unresolved = (reason: string): ImportResolution => ({ kind: 'unresolved', reason });

const insidePackage = (path: string): boolean =>
  path !== '..' &&
  !path.startsWith('../') &&
  !posix.isAbsolute(path) &&
  !Array.contains(path.split('/'), 'node_modules');

const decodedPath = Effect.fnUntraced(function* (target: string): Effect.fn.Return<string | undefined> {
  if (target.includes('\\') || target.includes('\0') || /%2f|%5c/i.test(target)) return undefined;

  return yield* Effect.try(() => decodeURIComponent(target)).pipe(
    Effect.map((decoded) => (decoded.includes('\0') ? undefined : decoded)),
    Effect.catch(() => Effect.succeed(undefined)),
  );
});

const urlPath = Effect.fnUntraced(function* (target: string): Effect.fn.Return<string | undefined, ResolutionLimit> {
  const suffix = target.search(/[?#]/);

  return yield* decodedPath(suffix < 0 ? target : target.slice(0, suffix));
});

const external = (target: string): ImportResolution => {
  const [first, second] = target.split('/', 2);
  const name = target.startsWith('@') ? `${first}/${second ?? ''}` : first;

  return Match.value(name).pipe(
    Match.when(isPackageName, (name): ImportResolution => ({ kind: 'external', name })),
    Match.orElse(() => unresolved('Import path could not be resolved')),
  );
};

const patternMatch = (candidate: string, key: string): string | undefined => {
  const star = candidate.indexOf('*');

  if (star < 0 || star !== candidate.lastIndexOf('*')) return undefined;
  const prefix = EffectString.slice(0, star)(candidate);
  const suffix = EffectString.slice(star + 1)(candidate);

  if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length <= prefix.length + suffix.length) return undefined;

  return EffectString.slice(star, key.length - suffix.length)(key);
};

const moreSpecific = (candidate: string, current: string): boolean =>
  (Order.Number(candidate.indexOf('*'), current.indexOf('*')) || Order.Number(candidate.length, current.length)) > 0;

// Node map order and pattern precedence: https://nodejs.org/api/packages.html#subpath-patterns
const mapEntry = Effect.fnUntraced(function* (
  map: Schema.JsonObject,
  key: string,
  budget: Budget,
): Effect.fn.Return<Mapping | undefined, ResolutionLimit> {
  if (key.endsWith('/') || key === '#') return undefined;
  const exact = map[key];

  if (exact !== undefined && !key.includes('*')) return { value: exact };
  let best: string | undefined;
  let result: Mapping | undefined;

  for (const [candidate, value] of Object.entries(map)) {
    yield* step(budget);
    const pattern = patternMatch(candidate, key);

    if (pattern === undefined) continue;

    if (best !== undefined && !moreSpecific(candidate, best)) continue;
    best = candidate;
    result = { value, pattern };
  }

  return result;
});

const stringTarget = Effect.fnUntraced(function* (
  value: string,
  internal: boolean,
  pattern: string | undefined,
): Effect.fn.Return<Target, ResolutionLimit> {
  const target = pattern === undefined ? value : value.replaceAll('*', pattern);

  if (!target.startsWith('./'))
    return internal && !/^(?:[.#/]|[a-z][a-z\d+.-]*:)/i.test(target) ? { target } : { invalid: true };
  const decoded = yield* decodedPath(target);

  if (!decoded) return { invalid: true };

  const invalid = decoded
    .slice(2)
    .split('/')
    .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === 'node_modules');

  return invalid ? { invalid: true } : { target };
});

const arrayTarget = Effect.fnUntraced(function* (
  values: Schema.JsonArray,
  mode: Mode,
  internal: boolean,
  pattern: string | undefined,
  budget: Budget,
  depth: number,
): Effect.fn.Return<Target, ResolutionLimit> {
  let last: Target = null;

  for (const value of values) {
    const selected = yield* selectTarget(value, mode, internal, pattern, budget, depth + 1);

    if (selected === null || (selected && 'target' in selected)) return selected;

    if (selected !== undefined) last = selected;
  }

  return last;
});

const conditionalTarget = Effect.fnUntraced(function* (
  values: Schema.JsonObject,
  mode: Mode,
  internal: boolean,
  pattern: string | undefined,
  budget: Budget,
  depth: number,
): Effect.fn.Return<Target, ResolutionLimit> {
  for (const [condition, value] of Object.entries(values)) {
    yield* step(budget);

    const index = Number(condition);

    if (Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === condition)
      return { invalid: true };

    if (condition !== mode && !NODE_CONDITIONS.has(condition)) continue;
    const selected = yield* selectTarget(value, mode, internal, pattern, budget, depth + 1);

    if (selected !== undefined) return selected;
  }

  return undefined;
});

const selectTarget = Effect.fnUntraced(function* (
  value: Schema.Json,
  mode: Mode,
  internal: boolean,
  pattern: string | undefined,
  budget: Budget,
  depth: number = 0,
): Effect.fn.Return<Target, ResolutionLimit> {
  yield* step(budget);

  if (depth > 32) return yield* new ResolutionLimit();

  if (value === null) return null;

  if (Predicate.isString(value)) return yield* stringTarget(value, internal, pattern);

  if (Array.isArray<Schema.Json>(value)) return yield* arrayTarget(value, mode, internal, pattern, budget, depth);

  if (isPackageMap(value)) return yield* conditionalTarget(value, mode, internal, pattern, budget, depth);

  return { invalid: true };
});

const exportsEntry = Effect.fnUntraced(function* (
  exports: Schema.Json | undefined,
  key: string,
  budget: Budget,
): Effect.fn.Return<Mapping | undefined, ResolutionLimit> {
  if (exports === undefined) return undefined;

  if (!isPackageMap(exports)) return key === '.' ? { value: exports } : undefined;

  const keys = Object.keys(exports);

  if (keys.some((name) => name.startsWith('.'))) {
    if (keys.some((name) => !name.startsWith('.'))) return undefined;

    return yield* mapEntry(exports, key, budget);
  }

  return key === '.' ? { value: exports } : undefined;
});

const selfReference = (specifier: string, name: Schema.Json | undefined): boolean =>
  Match.value(name).pipe(
    Match.when(Predicate.isString, (name) => specifier === name || specifier.startsWith(`${name}/`)),
    Match.orElse(() => false),
  );

type ResolverState = {
  files: ReadonlyMap<string, PublishedFile>;
  sources: ReadonlyMap<string, string>;
  manifests: Map<string, Scope>;
  budget: Budget;
};

const manifestAt = Effect.fnUntraced(function* (
  root: string,
  state: ResolverState,
): Effect.fn.Return<Scope, ResolutionLimit> {
  const cached = state.manifests.get(root);

  if (cached) return cached;

  const path = posix.join(root, 'package.json');
  const source = state.sources.get(path);

  const scope: Scope =
    state.files.get(path)?.type !== 'file' || source === undefined || source.length > 256 * 1024
      ? { reason: `Package metadata unavailable or invalid: ${path}` }
      : yield* decodeManifest(source).pipe(
          Effect.map((manifest): Scope => ({ root, manifest })),
          Effect.catch(() => Effect.succeed<Scope>({ reason: `Package metadata unavailable or invalid: ${path}` })),
        );

  state.manifests.set(root, scope);

  return scope;
});

const scopeFor = Effect.fnUntraced(function* (
  from: string,
  state: ResolverState,
): Effect.fn.Return<Scope | undefined, ResolutionLimit> {
  let root = posix.dirname(from);

  for (;;) {
    yield* step(state.budget);

    if (state.files.has(posix.join(root, 'package.json'))) return yield* manifestAt(root, state);

    if (root === '.') return undefined;

    root = posix.dirname(root);
  }
});

const fileAt = (path: string, files: ReadonlyMap<string, PublishedFile>): ImportResolution | undefined => {
  if (!insidePackage(path)) return unresolved('Import points outside the package or into a dependency');

  for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
    const ancestor = files.get(parent);

    if (ancestor && ancestor.type !== 'directory') return unresolved('Linked or non-directory paths were not followed');
  }

  return Match.value(files.get(path)).pipe(
    Match.when({ type: 'file' }, (): ImportResolution => ({ kind: 'local', path })),
    Match.whenOr({ type: 'symlink' }, { type: 'link' }, () => unresolved('Linked files were not followed')),
    Match.orElse(() => undefined),
  );
};

const requireFile = (path: string, files: ReadonlyMap<string, PublishedFile>): ImportResolution | undefined =>
  fileAt(path, files) ??
  Option.getOrUndefined(
    Array.findFirst(
      Iterable.map(EXTENSIONS, (extension) => fileAt(`${path}${extension}`, files)),
      Predicate.isNotUndefined,
    ),
  );

const directoryIndex = (path: string, files: ReadonlyMap<string, PublishedFile>): ImportResolution | undefined =>
  Option.getOrUndefined(
    Array.findFirst(
      Iterable.map(EXTENSIONS, (extension) => fileAt(posix.join(path, `index${extension}`), files)),
      Predicate.isNotUndefined,
    ),
  );

const directoryMain = Effect.fnUntraced(function* (
  path: string,
  state: ResolverState,
): Effect.fn.Return<ImportResolution | undefined, ResolutionLimit> {
  if (!state.files.has(posix.join(path, 'package.json'))) return undefined;

  const scope = yield* manifestAt(path, state);

  if ('reason' in scope) return unresolved(scope.reason);

  const main = scope.manifest.main;

  if (!Predicate.isString(main) || !main) return undefined;

  if (main.includes('\\') || main.includes('\0')) return unresolved('Package entry path could not be resolved');

  const target = posix.normalize(posix.join(path, main));

  return requireFile(target, state.files) ?? directoryIndex(target, state.files);
});

const loadFile = Effect.fnUntraced(function* (
  path: string,
  mode: Mode,
  state: ResolverState,
): Effect.fn.Return<ImportResolution, ResolutionLimit> {
  if (mode === 'import') return fileAt(path, state.files) ?? unresolved('Imported file was not found');

  return (
    requireFile(path, state.files) ??
    (yield* directoryMain(path, state)) ??
    directoryIndex(path, state.files) ??
    unresolved('Imported file was not found')
  );
});

const relativeImport = Effect.fnUntraced(function* (
  specifier: string,
  from: string,
  mode: Mode,
  state: ResolverState,
): Effect.fn.Return<ImportResolution, ResolutionLimit> {
  const path = mode === 'import' ? yield* urlPath(specifier) : specifier;

  if (path === undefined) return unresolved('Import path could not be resolved');

  return yield* loadFile(posix.normalize(posix.join(posix.dirname(from), path)), mode, state);
});

const mappedImport = Effect.fnUntraced(function* (
  scope: PackageScope,
  specifier: string,
  mode: Mode,
  state: ResolverState,
): Effect.fn.Return<ImportResolution, ResolutionLimit> {
  const internal = specifier.startsWith('#');
  let entry: Mapping | undefined;

  if (internal) {
    if (isPackageMap(scope.manifest.imports)) entry = yield* mapEntry(scope.manifest.imports, specifier, state.budget);
  } else {
    const name = scope.manifest.name;

    if (!Predicate.isString(name)) return unresolved('Package name unavailable');

    const key = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
    entry = yield* exportsEntry(scope.manifest.exports, key, state.budget);
  }

  if (!entry) return unresolved('Package import mapping is missing or invalid');

  const selected = yield* selectTarget(entry.value, mode, internal, entry.pattern, state.budget);

  if (!selected || 'invalid' in selected)
    return unresolved('Import mapping is blocked, invalid, or has no matching condition');

  const from = posix.join(scope.root, 'package.json');

  if (selected.target.startsWith('./')) return yield* relativeImport(selected.target, from, 'import', state);

  return yield* resolve(selected.target, from, mode, state);
});

const resolve = Effect.fnUntraced(function* (
  specifier: string,
  from: string,
  mode: Mode,
  state: ResolverState,
): Effect.fn.Return<ImportResolution, ResolutionLimit> {
  if (isBuiltin(specifier)) return { kind: 'builtin' };

  yield* step(state.budget);

  if (specifier.startsWith('./') || specifier.startsWith('../'))
    return yield* relativeImport(specifier, from, mode, state);

  const scope = yield* scopeFor(from, state);

  if (!scope)
    return specifier.startsWith('#')
      ? unresolved('Package metadata needed to resolve this import')
      : external(specifier);

  if ('reason' in scope) return unresolved(scope.reason);

  if (!specifier.startsWith('#') && !selfReference(specifier, scope.manifest.name)) return external(specifier);

  return yield* mappedImport(scope, specifier, mode, state);
});

export const createImportResolver = Effect.fnUntraced(function* (
  files: ReadonlyMap<string, PublishedFile>,
  sources: ReadonlyMap<string, string>,
): Effect.fn.Return<ImportResolver> {
  const state: ResolverState = { files, sources, manifests: new Map(), budget: yield* Ref.make(8192) };

  return (specifier, from, mode) =>
    resolve(specifier, from, mode, state).pipe(
      Effect.catchTag('ResolutionLimit', () => Effect.succeed(unresolved('Import resolution limit reached'))),
    );
});
