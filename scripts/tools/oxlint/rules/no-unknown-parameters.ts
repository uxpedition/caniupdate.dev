import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

import {
  containsUnknownType,
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from '../shared/function-parameters.ts';
import { declaredTypePredicate } from '../shared/type-predicates.ts';
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function isTypePredicateSubject(owner: ParameterOwner, parameterName: string): boolean {
  const predicate = owner.returnType?.typeAnnotation;
  return (
    predicate?.type === 'TSTypePredicate' &&
    predicate.parameterName.type === 'Identifier' &&
    predicate.parameterName.name === parameterName
  );
}

/** Require typed inputs, except error causes and subjects narrowed by concrete type predicates. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require concrete input contracts, except unknown causes and subjects narrowed by concrete type predicates.',
    },
    messages: {
      unknownParameter:
        'expected a typed input contract for parameter `{{parameter}}`, found `unknown`' +
        '\nhelp: for external input, use a schema-generated decoder such as `Schema.decodeUnknownResult(DomainSchema)`, then pass the decoded domain type to this function' +
        "\nhelp: if this function only forwards the value unchanged, use a type parameter such as `T` to preserve the caller's type" +
        '\nnote: `unknown` is allowed for error-cause parameters named `cause` and for the subject narrowed by a type predicate',
      unknownPredicateResult:
        'expected a concrete type in this type predicate, found `unknown`' +
        '\nhelp: assert the type established by the guard, such as `value is User`' +
        '\nnote: `value is unknown` does not narrow the value; a union containing `unknown` also loses its type information',
    },
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        if (!containsUnknownType(annotation.typeAnnotation)) continue;
        const name = functionParameterBindingName(parameter, context.sourceCode);
        if (name === 'cause' || isTypePredicateSubject(node, name)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: 'unknownParameter',
          data: { parameter: name },
        });
      }
      if (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'TSDeclareFunction'
      ) {
        const predicate = declaredTypePredicate(node, context.sourceCode);
        if (predicate?.assertedType !== undefined && containsUnknownType(predicate.assertedType)) {
          context.report({ node: predicate.assertedType, messageId: 'unknownPredicateResult' });
        }
      }
    };

    return {
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
