import { defineRule } from '@oxlint/plugins';
import type { ESTree, Scope, SourceCode } from '@oxlint/plugins';

import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from '../shared/type-alias-resolution.ts';

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

type EffectImportBinding = ESTree.ImportSpecifier | ESTree.ImportNamespaceSpecifier;

const EFFECT_PACKAGE = 'effect';

/** Resolve an identifier to its import from the `effect` package, or null when a local binding shadows it. */
function effectImportBinding(name: string, use: ESTree.Node, sourceCode: SourceCode): EffectImportBinding | null {
  let scope: Scope | null = sourceCode.getScope(use);
  while (scope !== null) {
    const variable = scope.set.get(name);
    if (variable !== undefined) {
      const [definition] = variable.defs;
      if (variable.defs.length !== 1 || definition?.type !== 'ImportBinding') return null;
      const declaration = definition.parent;
      if (declaration?.type !== 'ImportDeclaration' || declaration.source.value !== EFFECT_PACKAGE) return null;
      const binding = definition.node;
      return binding.type === 'ImportSpecifier' || binding.type === 'ImportNamespaceSpecifier' ? binding : null;
    }
    scope = scope.upper;
  }
  return null;
}

/**
 * Return whether a type name is the `Effect` interface from the `effect` package, reached through either
 * `import { Effect } from 'effect'` (`Effect.Effect`) or `import * as Ns from 'effect'` (`Ns.Effect.Effect`).
 */
function isEffectInterfaceName(
  typeName: ESTree.TSTypeReference['typeName'],
  use: ESTree.Node,
  sourceCode: SourceCode,
): boolean {
  if (typeName.type !== 'TSQualifiedName' || typeName.right.name !== 'Effect') return false;
  const qualifier = typeName.left;
  if (qualifier.type === 'Identifier') {
    const binding = effectImportBinding(qualifier.name, use, sourceCode);
    if (binding?.type !== 'ImportSpecifier') return false;
    const importedName = binding.imported.type === 'Identifier' ? binding.imported.name : binding.imported.value;
    return importedName === 'Effect';
  }
  if (
    qualifier.type === 'TSQualifiedName' &&
    qualifier.right.name === 'Effect' &&
    qualifier.left.type === 'Identifier'
  ) {
    return effectImportBinding(qualifier.left.name, use, sourceCode)?.type === 'ImportNamespaceSpecifier';
  }
  return false;
}

/** Require explicit return contracts that keep unknown within parsing and error-inspection boundaries. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow explicit return annotations exposing unknown, including unions, Promise/PromiseLike wrappers, and the success slot of Effect. Keep unknown local to parsing and error inspection: return decoded domain values, bytes or text from transport-only readers, producer-owned contracts, caller types for unchanged forwarding, or validated details/never from error helpers.',
    },
    messages: {
      unknownReturn:
        'expected a concrete return contract, found `unknown` in the return type' +
        '\nhelp: for external JSON, decode before returning, e.g. `Schema.decodeSync(Schema.fromJsonString(DomainSchema))(text)`' +
        '\nhelp: transport-only readers can return bytes or text; keep size bounds at the transport boundary' +
        '\nhelp: reuse producer or fixture contracts; use `T` for unchanged forwarding, validated details for error helpers, and `never` for throw-only helpers' +
        '\nhelp: Effect success, error, and requirement slots are return contracts; declare the concrete success value, failure type, and service requirements' +
        '\nnote: `unknown` is valid while parsing untrusted data, but should not escape an API without establishing a concrete contract' +
        '\nnote: a type annotation or assertion does not validate external data; keep runtime decoding and cleanup' +
        '\nnote: dropping the annotation does not establish a contract; the producer still returns `unknown`, so decode or type the value at its source',
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === 'TSUnknownKeyword') return true;
        if (resolved.type === 'TSParenthesizedType') {
          return matches(resolved.typeAnnotation);
        }
        if (resolved.type === 'TSUnionType') return resolved.types.some(matches);
        if (
          resolved.type === 'TSTypeReference' &&
          isEffectInterfaceName(resolved.typeName, resolved, context.sourceCode)
        ) {
          return resolved.typeArguments?.params.some(matches) ?? false;
        }
        if (
          resolved.type !== 'TSTypeReference' ||
          resolved.typeName.type !== 'Identifier' ||
          (resolved.typeName.name !== 'Promise' && resolved.typeName.name !== 'PromiseLike')
        ) {
          return false;
        }
        const value = resolved.typeArguments?.params[0];
        return value !== undefined && matches(value);
      });

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (!resolvesToUnknown(annotation.typeAnnotation)) return;
      context.report({ node: annotation.typeAnnotation, messageId: 'unknownReturn' });
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      ArrowFunctionExpression: checkReturnType,
      FunctionDeclaration: checkReturnType,
      FunctionExpression: checkReturnType,
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
    };
  },
});
