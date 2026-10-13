import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

import {
  classifyUnsafeDictionary,
  classifyUnsafeDictionaryValue,
  createTypeEnvironment,
  type TypeEnvironment,
} from '../shared/dictionary-types.ts';
import { visibleTypeAlias } from '../shared/type-alias-resolution.ts';
import { declaredTypePredicate, isTypeWithinAny } from '../shared/type-predicates.ts';

const typeNodeKinds: ReadonlySet<string> = new Set([
  'JSDocNonNullableType',
  'JSDocNullableType',
  'JSDocUnknownType',
  'TSAnyKeyword',
  'TSArrayType',
  'TSBigIntKeyword',
  'TSBooleanKeyword',
  'TSConditionalType',
  'TSConstructorType',
  'TSFunctionType',
  'TSImportType',
  'TSIndexedAccessType',
  'TSInferType',
  'TSIntersectionType',
  'TSIntrinsicKeyword',
  'TSLiteralType',
  'TSMappedType',
  'TSNamedTupleMember',
  'TSNeverKeyword',
  'TSNullKeyword',
  'TSNumberKeyword',
  'TSObjectKeyword',
  'TSParenthesizedType',
  'TSStringKeyword',
  'TSSymbolKeyword',
  'TSTemplateLiteralType',
  'TSThisType',
  'TSTupleType',
  'TSTypeLiteral',
  'TSTypeOperator',
  'TSTypePredicate',
  'TSTypeQuery',
  'TSTypeReference',
  'TSUndefinedKeyword',
  'TSUnionType',
  'TSUnknownKeyword',
  'TSVoidKeyword',
]);

function isTypeNode(node: ESTree.Node): node is ESTree.TSType {
  return typeNodeKinds.has(node.type);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === 'Identifier' ? type.typeName.name : null;
}

function isInsideTypeAliasDeclaration(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== 'Program') {
    if (current.type === 'TSTypeAliasDeclaration') return true;
    current = current.parent;
  }
  return false;
}

function isPlainAliasConsumerUse(node: ESTree.TSType, environment: TypeEnvironment): boolean {
  if (node.type !== 'TSTypeReference' || node.typeArguments?.params.length) return false;
  const name = typeReferenceName(node);
  return (
    name !== null &&
    visibleTypeAlias(name, node, environment.typeAliases) !== null &&
    !isInsideTypeAliasDeclaration(node)
  );
}

function isInsideTypeParameterConstraint(node: ESTree.TSType): boolean {
  let child: ESTree.Node = node;
  let parent: ESTree.Node | null = child.parent;
  while (parent !== null && parent.type !== 'Program') {
    if (parent.type === 'TSTypeParameter' && parent.constraint === child) return true;
    child = parent;
    parent = child.parent;
  }
  return false;
}

function shouldReportType(node: ESTree.TSType, environment: TypeEnvironment): boolean {
  if (isInsideTypeParameterConstraint(node)) return false;
  if (isPlainAliasConsumerUse(node, environment)) return false;
  if (classifyUnsafeDictionary(node, environment) === null) return false;
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== 'Program') {
    if (isTypeNode(current) && classifyUnsafeDictionary(current, environment) !== null) return false;
    current = current.parent;
  }
  return true;
}

/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Require concrete dictionary values, except in subjects narrowed by concrete type predicates.',
    },
    messages: {
      unsafeDictionary:
        'expected a concrete dictionary value contract, found an unsafe `{{value}}` value type' +
        '\nhelp: reuse the owning library or schema contract; for a library configuration field, use its indexed type such as `NonNullable<LibraryConfig["env"]>`' +
        "\nhelp: heterogeneous dictionaries can use the owner's concrete value union; arbitrary JSON fixtures can use `Record<string, Schema.Json>`" +
        '\nhelp: decode external payloads with `Schema.decodeUnknownResult(DomainSchema)` before inserting or consuming their values' +
        '\nnote: a type annotation or assertion does not validate external data' +
        '\nnote: a type predicate may accept a broad dictionary as its subject, but must assert a concrete type',
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null;
    const guardSubjects = new Set<ESTree.TSType>();

    const noteGuardSubject = (node: ESTree.ArrowFunctionExpression | ESTree.Function) => {
      const predicate = declaredTypePredicate(node, context.sourceCode);
      if (predicate?.subjectAnnotation !== undefined) guardSubjects.add(predicate.subjectAnnotation);
    };

    const report = (node: ESTree.Node, value: string) => {
      context.report({ node, messageId: 'unsafeDictionary', data: { value } });
    };
    const reportIfUnsafe = (node: ESTree.TSType) => {
      if (environment === null || !shouldReportType(node, environment)) return;
      if (isTypeWithinAny(node, guardSubjects)) return;
      const unsafe = classifyUnsafeDictionary(node, environment);
      if (unsafe === null) return;
      report(node, unsafe.unsafeValue);
    };

    return {
      Program(node) {
        environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
      },
      ArrowFunctionExpression: noteGuardSubject,
      FunctionDeclaration: noteGuardSubject,
      FunctionExpression: noteGuardSubject,
      TSDeclareFunction: noteGuardSubject,
      TSTypeReference: reportIfUnsafe,
      TSTypeLiteral: reportIfUnsafe,
      TSMappedType: reportIfUnsafe,
      TSIndexSignature(node) {
        if (
          environment === null ||
          node.typeAnnotation === null ||
          node.parent.type === 'TSTypeLiteral' ||
          isTypeWithinAny(node, guardSubjects)
        )
          return;
        const unsafe = classifyUnsafeDictionaryValue(node.typeAnnotation.typeAnnotation, environment);
        if (unsafe !== null) report(node, unsafe.unsafeValue);
      },
    };
  },
});
