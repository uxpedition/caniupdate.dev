import type { ESTree } from '@oxlint/plugins';
import type { SourceCode } from '@oxlint/plugins';

import { functionParameterBindingName, functionParameterTypeAnnotation } from './function-parameters.ts';

/** A declared guard's narrowed subject annotation and its asserted result type. */
export type TypePredicateInfo = {
  /** Asserted result of `subject is Result`, when the guard narrows to a type. */
  assertedType?: ESTree.TSType;
  /** Annotation of the parameter the guard narrows, when that parameter is annotated. */
  subjectAnnotation?: ESTree.TSType;
};

/** Return a function's declared `subject is Result` predicate when its subject is a plain identifier. */
export function declaredTypePredicate(
  owner: ESTree.ArrowFunctionExpression | ESTree.Function,
  sourceCode: SourceCode,
): TypePredicateInfo | undefined {
  const predicate = owner.returnType?.typeAnnotation;
  if (predicate?.type !== 'TSTypePredicate') return undefined;
  if (predicate.parameterName.type !== 'Identifier') return undefined;

  for (const parameter of owner.params) {
    if (functionParameterBindingName(parameter, sourceCode) !== predicate.parameterName.name) {
      continue;
    }
    return {
      assertedType: predicate.typeAnnotation?.typeAnnotation ?? undefined,
      subjectAnnotation: functionParameterTypeAnnotation(parameter)?.typeAnnotation ?? undefined,
    };
  }
  return undefined;
}

/** Return whether this node is, or lives inside, one of the guarded subject annotations. */
export function isTypeWithinAny(node: ESTree.Node, roots: ReadonlySet<ESTree.TSType>): boolean {
  if (roots.size === 0) return false;
  let current: ESTree.Node | null | undefined = node;
  while (current !== null && current !== undefined) {
    if (roots.has(current as ESTree.TSType)) return true;
    current = current.parent;
  }
  return false;
}
