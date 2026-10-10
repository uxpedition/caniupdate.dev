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

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause` and type-predicate subjects; decode unknown input at its I/O boundary instead. A guard's narrowed subject may be unknown, but it must assert a concrete type.",
    },
    messages: {
      unknownParameter:
        'Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.',
      unknownPredicateResult:
        'A guard must narrow its subject to a concrete type; asserting `unknown` discards all evidence.',
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
