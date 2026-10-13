import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

import { functionParameterBindingName, functionParameterTypeAnnotation } from '../shared/function-parameters.ts';
import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from '../shared/type-alias-resolution.ts';
import { declaredTypePredicate } from '../shared/type-predicates.ts';
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow function parameters and type guard results that resolve to the broad object type.',
    },
    messages: {
      objectParameter:
        'parameter `{{parameter}}` resolves to the broad `object` type' +
        '\nhelp: accept the concrete owner type; decode external input at its boundary before calling this function' +
        '\nnote: a type predicate may accept an object-typed subject, but must narrow it to a concrete type',
      objectPredicateResult:
        'type guard asserts the broad `object` type' +
        '\nhelp: assert only the concrete type established by the guard; use the owning schema for domain validation' +
        '\nhelp: for a shallow non-null object or array check, use `Predicate.isObjectOrArray` instead of a custom broad predicate' +
        '\nnote: `object` excludes primitives but establishes no domain fields; do not claim a domain type without checking it',
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToObject = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === 'TSObjectKeyword') return true;
        if (resolved.type === 'TSParenthesizedType') {
          return matches(resolved.typeAnnotation);
        }
        return resolved.type === 'TSUnionType' && resolved.types.some(matches);
      });

    const checkParameters = (node: ParameterOwner) => {
      const ownerIsPredicate =
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'TSDeclareFunction';
      const predicate = ownerIsPredicate ? declaredTypePredicate(node, context.sourceCode) : undefined;
      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        if (predicate?.subjectAnnotation !== undefined && annotation.typeAnnotation === predicate.subjectAnnotation)
          continue;
        if (!resolvesToObject(annotation.typeAnnotation)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: 'objectParameter',
          data: { parameter: functionParameterBindingName(parameter, context.sourceCode) },
        });
      }
      if (predicate?.assertedType !== undefined && resolvesToObject(predicate.assertedType)) {
        context.report({
          node: predicate.assertedType,
          messageId: 'objectPredicateResult',
        });
      }
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
