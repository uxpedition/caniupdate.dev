import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

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

/** Require explicit return contracts that keep unknown within parsing and error-inspection boundaries. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow explicit return annotations exposing unknown, including unions and Promise/PromiseLike wrappers. Keep unknown local to parsing and error inspection: return decoded domain values, bytes or text from transport-only readers, producer-owned contracts, caller types for unchanged forwarding, or validated details/never from error helpers.',
    },
    messages: {
      unknownReturn:
        'expected a concrete return contract, found `unknown` in the return type' +
        '\nhelp: for external JSON, decode before returning, e.g. `Schema.decodeSync(Schema.fromJsonString(DomainSchema))(text)`' +
        '\nhelp: transport-only readers can return bytes or text; keep size bounds at the transport boundary' +
        '\nhelp: reuse producer or fixture contracts; use `T` for unchanged forwarding, validated details for error helpers, and `never` for throw-only helpers' +
        '\nnote: `unknown` is valid while parsing untrusted data, but should not escape an API without establishing a concrete contract' +
        '\nnote: a type annotation or assertion does not validate external data; keep runtime decoding and cleanup',
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
