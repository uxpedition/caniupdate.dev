import type { ESTree, SourceCode } from '@oxlint/plugins';

import { resolveVariable } from '../../shared/scope.ts';

const equalityOperators = new Set(['==', '===', '!=', '!==']);
const broadEffectCatchMethods = new Set(['catch', 'catchAll', 'catchIf']);

export const isStringLiteral = (node: ESTree.Node | null | undefined): node is ESTree.StringLiteral =>
  node?.type === 'Literal' && typeof node.value === 'string';

export const isTagMember = (node: ESTree.Node | null | undefined): node is ESTree.MemberExpression =>
  node?.type === 'MemberExpression' &&
  ((!node.computed && node.property.type === 'Identifier' && node.property.name === '_tag') ||
    (node.computed && isStringLiteral(node.property) && node.property.value === '_tag'));

export const tagMemberFromComparison = (node: ESTree.BinaryExpression): ESTree.MemberExpression | undefined => {
  if (!equalityOperators.has(node.operator)) return undefined;
  if (isTagMember(node.left) && isStringLiteral(node.right)) return node.left;
  if (isTagMember(node.right) && isStringLiteral(node.left)) return node.right;
  return undefined;
};

const isBroadEffectCatchCall = (node: ESTree.Node | null | undefined): node is ESTree.CallExpression =>
  node?.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'Effect' &&
  !node.callee.computed &&
  node.callee.property.type === 'Identifier' &&
  broadEffectCatchMethods.has(node.callee.property.name);

export const isInsideBroadEffectHandler = (node: ESTree.Node): boolean => {
  let current: ESTree.Node | null | undefined = node.parent;
  while (current !== null && current !== undefined) {
    if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') {
      return isBroadEffectCatchCall(current.parent) && current.parent.arguments.includes(current);
    }
    current = current.parent;
  }
  return false;
};

export const isReasonTagMember = (node: ESTree.MemberExpression): boolean =>
  node.object.type === 'MemberExpression' &&
  ((!node.object.computed && node.object.property.type === 'Identifier' && node.object.property.name === 'reason') ||
    (node.object.computed && isStringLiteral(node.object.property) && node.object.property.value === 'reason'));

export const propertyName = (property: ESTree.ObjectProperty): string | undefined => {
  if (!property.computed && property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return undefined;
};

type ImportBinding = { source: string; imported: string };

const VITEST_EXPECT_MODIFIERS: Record<string, true> = { rejects: true, resolves: true, not: true };
const VITEST_PATTERN_MATCHERS: Record<string, true> = { toMatchObject: true };
const MATCH_PATTERN_CONSTRUCTORS: Record<string, true> = { when: true, not: true };

/** Resolve a reference to the module export it binds, or null for locals, shadows, and globals. */
const resolveImportBinding = (sourceCode: SourceCode, identifier: ESTree.IdentifierReference): ImportBinding | null => {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length !== 1) return null;
  const definition = variable.defs[0];
  if (definition === undefined || definition.type !== 'ImportBinding' || definition.node.type !== 'ImportSpecifier') {
    return null;
  }
  const { imported, parent } = definition.node;
  if (parent.type !== 'ImportDeclaration') return null;
  return {
    source: parent.source.value,
    imported: imported.type === 'Identifier' ? imported.name : imported.value,
  };
};

const isVitestExpect = (sourceCode: SourceCode, identifier: ESTree.IdentifierReference): boolean => {
  const binding = resolveImportBinding(sourceCode, identifier);
  return binding?.source === 'vitest' && binding.imported === 'expect';
};

/** `expect(value)` optionally followed by `.rejects`, `.resolves`, or `.not` modifiers. */
const isVitestExpectChain = (sourceCode: SourceCode, expression: ESTree.Node): boolean => {
  let current: ESTree.Node = expression;
  while (
    current.type === 'MemberExpression' &&
    !current.computed &&
    current.property.type === 'Identifier' &&
    Object.hasOwn(VITEST_EXPECT_MODIFIERS, current.property.name)
  ) {
    current = current.object;
  }
  return (
    current.type === 'CallExpression' && current.callee.type === 'Identifier' && isVitestExpect(sourceCode, current.callee)
  );
};

const isVitestPatternCall = (sourceCode: SourceCode, call: ESTree.CallExpression): boolean => {
  const callee = call.callee;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return false;
  const method = callee.property.name;
  if (method === 'objectContaining') {
    return callee.object.type === 'Identifier' && isVitestExpect(sourceCode, callee.object);
  }
  return Object.hasOwn(VITEST_PATTERN_MATCHERS, method) && isVitestExpectChain(sourceCode, callee.object);
};

/** `Match.when(pattern, handler)` and `Match.not(pattern, handler)` where `Match` is imported from `effect`. */
const isEffectMatchPatternCall = (sourceCode: SourceCode, call: ESTree.CallExpression): boolean => {
  const callee = call.callee;
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.object.type !== 'Identifier' ||
    callee.property.type !== 'Identifier' ||
    !Object.hasOwn(MATCH_PATTERN_CONSTRUCTORS, callee.property.name)
  ) {
    return false;
  }
  const binding = resolveImportBinding(sourceCode, callee.object);
  return binding?.source === 'effect' && binding.imported === 'Match';
};

/**
 * Whether an object literal is a partial pattern for a recognized pattern-taking call. Only the first argument
 * is a pattern; the walk climbs through object property values and array elements, and stops at any other call,
 * so a constructed value inside a pattern (for example `makeError({ _tag })`) is still a construction.
 */
const isPatternObject = (
  node: ESTree.ObjectExpression,
  isPatternCall: (call: ESTree.CallExpression) => boolean,
): boolean => {
  let current: ESTree.Node | null = node;
  while (current !== null) {
    const parent: ESTree.Node | null = current.parent;
    if (parent === null) return false;
    if (parent.type === 'CallExpression') {
      return parent.arguments[0] === current && isPatternCall(parent);
    }
    if (parent.type === 'Property' && parent.value === current && parent.parent.type === 'ObjectExpression') {
      current = parent.parent;
    } else if (parent.type === 'ArrayExpression') {
      current = parent;
    } else {
      return false;
    }
  }
  return false;
};

/** Partial-match patterns for an imported Vitest `expect` chain or `expect.objectContaining`. */
export const isVitestAssertionPatternObject = (sourceCode: SourceCode, node: ESTree.ObjectExpression): boolean =>
  isPatternObject(node, (call) => isVitestPatternCall(sourceCode, call));

/** Patterns passed to `Match.when` or `Match.not` on the Effect `Match` export, not a shadow or same-named value. */
export const isEffectMatchPatternObject = (sourceCode: SourceCode, node: ESTree.ObjectExpression): boolean =>
  isPatternObject(node, (call) => isEffectMatchPatternCall(sourceCode, call));
