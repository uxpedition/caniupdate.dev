import type { AnyNode, ImportDeclaration, Pattern, Program } from 'acorn';
import { fullAncestor } from 'acorn-walk';
import { Effect, Match, Predicate, Schema } from 'effect';

export type Scope = { parent: Scope | undefined; functionScope: boolean; bindings: Map<string, Binding> };

type Binding = {
  scope: Scope;
  init?: AnyNode | undefined;
  reference?: string | undefined;
  suffix: string;
  mutated: boolean;
};

export type Bindings = { scopes: WeakMap<AnyNode, Scope>; globals: Set<string>; reassigned: boolean };

const scopeTypes = {
  Program: true,
  BlockStatement: true,
  FunctionDeclaration: true,
  FunctionExpression: true,
  ArrowFunctionExpression: true,
  CatchClause: true,
  ForStatement: true,
  ForInStatement: true,
  ForOfStatement: true,
  SwitchStatement: true,
  StaticBlock: true,
};

const functionTypes = {
  Program: true,
  FunctionDeclaration: true,
  FunctionExpression: true,
  ArrowFunctionExpression: true,
};

const globalNames = { require: true, process: true, fetch: true, eval: true, Function: true, globalThis: true };

export class SyntaxInspectionError extends Schema.TaggedError<SyntaxInspectionError>()('SyntaxInspectionError', {}) {}

export const walkSyntax = (
  program: Program,
  visit: (node: AnyNode, ancestors: AnyNode[]) => Effect.Effect<void, SyntaxInspectionError>,
): Effect.Effect<void, SyntaxInspectionError> =>
  Effect.try({
    // Acorn's walker requires a synchronous void callback and reuses its ancestor array.
    // Run only the visitor here; scope and finding policy remain composed Effects.
    try: () => fullAncestor(program, (node, _state, ancestors) => Effect.runSync(visit(node, ancestors))),
    catch: () => new SyntaxInspectionError(),
  });

export const literal = (node: AnyNode | null | undefined): string | undefined =>
  Match.value(node).pipe(
    Match.when({ type: 'Literal', value: Predicate.isString }, (value) => value.value),
    Match.when({ type: 'TemplateLiteral' }, (value) =>
      value.expressions.length === 0 ? (value.quasis[0]?.value.cooked ?? undefined) : undefined,
    ),
    Match.orElse(() => undefined),
  );

export const property = (node: AnyNode): string | undefined =>
  Match.value(node).pipe(
    Match.when({ type: 'MemberExpression' }, (node) =>
      !node.computed && node.property.type === 'Identifier' ? node.property.name : literal(node.property),
    ),
    Match.orElse(() => undefined),
  );

const scopeAt = Effect.fnUntraced(function* (ancestors: AnyNode[], state: Bindings): Effect.fn.Return<Scope> {
  let parent: Scope | undefined;

  for (const node of ancestors) {
    if (!Object.hasOwn(scopeTypes, node.type)) continue;
    let scope = state.scopes.get(node);

    if (!scope) {
      scope = { parent, functionScope: Object.hasOwn(functionTypes, node.type), bindings: new Map() };
      state.scopes.set(node, scope);
    }

    parent = scope;
  }

  if (!parent) return yield* Effect.die(new Error('Missing syntax scope'));

  return parent;
});

const binding = Effect.fnUntraced(function* (scope: Scope, name: string): Effect.fn.Return<Binding | undefined> {
  return scope.bindings.get(name) ?? (scope.parent ? yield* binding(scope.parent, name) : undefined);
});

const declareObject = Effect.fnUntraced(function* (
  pattern: Extract<Pattern, { type: 'ObjectPattern' }>,
  scope: Scope,
  init: AnyNode | undefined,
  suffix: string,
): Effect.fn.Return<void> {
  for (const entry of pattern.properties) {
    if (entry.type === 'RestElement') yield* declare(entry.argument, scope);
    else {
      const key = !entry.computed && entry.key.type === 'Identifier' ? entry.key.name : literal(entry.key);
      yield* declare(entry.value, scope, key === undefined ? undefined : init, `${suffix}.${key}`);
    }
  }
});

const declare = Effect.fnUntraced(function* (
  pattern: Pattern,
  scope: Scope,
  init?: AnyNode,
  suffix: string = '',
): Effect.fn.Return<void> {
  if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, { scope, init, suffix, mutated: false });
  else if (pattern.type === 'ObjectPattern') yield* declareObject(pattern, scope, init, suffix);
  else if (pattern.type === 'AssignmentPattern') yield* declare(pattern.left, scope);
  else if (pattern.type === 'RestElement') yield* declare(pattern.argument, scope);
  else if (pattern.type === 'ArrayPattern')
    for (const entry of pattern.elements) if (entry) yield* declare(entry, scope);
});

const functionParent = Effect.fnUntraced(function* (scope: Scope): Effect.fn.Return<Scope> {
  return scope.functionScope || !scope.parent ? scope : yield* functionParent(scope.parent);
});

const collectImports = (node: ImportDeclaration, scope: Scope): Effect.Effect<void> =>
  Effect.sync(() => {
    const source = literal(node.source)?.replace(/^node:/, '');

    if (source === undefined) return;

    for (const entry of node.specifiers) {
      let imported: string | undefined;

      if (entry.type === 'ImportSpecifier')
        imported = entry.imported.type === 'Identifier' ? entry.imported.name : literal(entry.imported);

      const name = imported === undefined ? `module:${source}` : `module:${source}.${imported}`;
      scope.bindings.set(entry.local.name, { scope, suffix: '', reference: name, mutated: false });
    }
  });

const collect = Effect.fnUntraced(function* (node: AnyNode, scope: Scope): Effect.fn.Return<void> {
  if (node.type === 'VariableDeclaration') {
    for (const entry of node.declarations)
      yield* declare(entry.id, node.kind === 'var' ? yield* functionParent(scope) : scope, entry.init ?? undefined);
  } else if (node.type === 'ImportDeclaration') yield* collectImports(node, scope);
  else if (node.type === 'CatchClause' && node.param) yield* declare(node.param, scope);
  else if (node.type === 'ClassDeclaration' && node.id) yield* declare(node.id, scope);
});

const collectFunction = Effect.fnUntraced(function* (node: AnyNode, scope: Scope): Effect.fn.Return<void> {
  if (
    node.type !== 'FunctionDeclaration' &&
    node.type !== 'FunctionExpression' &&
    node.type !== 'ArrowFunctionExpression'
  )
    return;

  for (const param of node.params) yield* declare(param, scope);

  if (node.type !== 'ArrowFunctionExpression' && node.id) {
    const owner = node.type === 'FunctionDeclaration' ? (scope.parent ?? scope) : scope;
    yield* declare(node.id, owner);
  }
});

const rootName = Effect.fnUntraced(function* (node: AnyNode): Effect.fn.Return<string | undefined> {
  if (node.type === 'Identifier') return node.name;

  return node.type === 'MemberExpression' ? yield* rootName(node.object) : undefined;
});

const invalidate = Effect.fnUntraced(function* (name: string, scope: Scope, state: Bindings): Effect.fn.Return<void> {
  const found = yield* binding(scope, name);

  if ((yield* identifierReference(name, scope, state, new Set())) !== undefined) state.reassigned = true;

  if (found) found.mutated = true;
  else state.globals.add(name);
});

const invalidatePattern = Effect.fnUntraced(function* (
  node: AnyNode,
  scope: Scope,
  state: Bindings,
): Effect.fn.Return<void> {
  if (node.type === 'ObjectPattern') {
    for (const entry of node.properties)
      yield* invalidatePattern(entry.type === 'RestElement' ? entry.argument : entry.value, scope, state);
  } else if (node.type === 'ArrayPattern') {
    for (const entry of node.elements) if (entry) yield* invalidatePattern(entry, scope, state);
  } else if (node.type === 'AssignmentPattern') yield* invalidatePattern(node.left, scope, state);
  else if (node.type === 'RestElement') yield* invalidatePattern(node.argument, scope, state);
  else {
    const name = yield* rootName(node);

    if (name) yield* invalidate(name, scope, state);
  }
});

export const buildBindings = Effect.fnUntraced(function* (
  program: Program,
): Effect.fn.Return<Bindings, SyntaxInspectionError> {
  const state: Bindings = { scopes: new WeakMap(), globals: new Set(), reassigned: false };
  yield* walkSyntax(
    program,
    Effect.fnUntraced(function* (node, ancestors) {
      const scope = yield* scopeAt(ancestors, state);
      state.scopes.set(node, scope);
      yield* collect(node, scope);
      yield* collectFunction(node, scope);
    }),
  );
  yield* walkSyntax(
    program,
    Effect.fnUntraced(function* (node, ancestors) {
      if (node.type !== 'AssignmentExpression' && node.type !== 'UpdateExpression') return;
      yield* invalidatePattern(
        node.type === 'AssignmentExpression' ? node.left : node.argument,
        yield* scopeAt(ancestors, state),
        state,
      );
    }),
  );

  return state;
});

const identifierReference = Effect.fnUntraced(function* (
  name: string,
  scope: Scope,
  state: Bindings,
  seen: Set<Binding>,
): Effect.fn.Return<string | undefined> {
  const found = yield* binding(scope, name);

  if (!found) return Object.hasOwn(globalNames, name) && !state.globals.has(name) ? `global:${name}` : undefined;

  if (found.mutated || seen.has(found)) return undefined;
  seen.add(found);
  const value = found.reference ?? (yield* reference(found.init, found.scope, state, seen));

  return value === undefined ? undefined : value + found.suffix;
});

const memberReference = Effect.fnUntraced(function* (
  node: Extract<AnyNode, { type: 'MemberExpression' }>,
  scope: Scope,
  state: Bindings,
  seen: Set<Binding>,
): Effect.fn.Return<string | undefined> {
  const key = property(node);
  const object = yield* reference(node.object, scope, state, seen);

  return key === undefined || object === undefined ? undefined : `${object}.${key}`;
});

const moduleReference = (node: AnyNode | null | undefined): string | undefined =>
  Match.value(literal(node)).pipe(
    Match.when(Predicate.isString, (source) => `module:${source.replace(/^node:/, '')}`),
    Match.orElse(() => undefined),
  );

const callReference = Effect.fnUntraced(function* (
  node: Extract<AnyNode, { type: 'CallExpression' }>,
  scope: Scope,
  state: Bindings,
  seen: Set<Binding>,
): Effect.fn.Return<string | undefined> {
  return (yield* reference(node.callee, scope, state, seen)) === 'global:require'
    ? moduleReference(node.arguments[0])
    : undefined;
});

export const reference = Effect.fnUntraced(function* (
  node: AnyNode | null | undefined,
  scope: Scope,
  state: Bindings,
  seen: Set<Binding> = new Set<Binding>(),
): Effect.fn.Return<string | undefined> {
  if (!node || seen.size > 12) return undefined;

  switch (node.type) {
    case 'Identifier':
      return yield* identifierReference(node.name, scope, state, seen);
    case 'MemberExpression':
      return yield* memberReference(node, scope, state, seen);
    case 'CallExpression':
      return yield* callReference(node, scope, state, seen);
    case 'ChainExpression':
      return yield* reference(node.expression, scope, state, seen);
    case 'AwaitExpression':
      return yield* reference(node.argument, scope, state, seen);
    case 'ImportExpression':
      return moduleReference(node.source);
    default:
      return undefined;
  }
});
