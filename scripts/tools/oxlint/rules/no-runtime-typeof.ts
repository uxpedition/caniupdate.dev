import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

/** Return whether typeof safely probes for the existence of a possibly absent binding. */
function isExistenceProbe(node: ESTree.UnaryExpression): boolean {
  const parent = node.parent;
  if (parent.type !== 'BinaryExpression') return false;
  if (!['===', '!==', '==', '!='].includes(parent.operator)) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other.type === 'Literal' && other.value === 'undefined';
}

/**
 * This syntactic rule cannot distinguish unparsed input from an established union.
 * Decode external data with Effect's Schema.decodeUnknown* at its boundary and use the decoded result.
 * For schema-backed type narrowing, Schema.is(DomainSchema)(value) checks the schema's Type without decoding.
 * Prefer Effect's Predicate.is* for primitive/callable checks on already-typed values.
 * Binding-existence probes remain valid: evaluating an absent binding before calling a predicate can throw.
 */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow runtime typeof expressions except comparisons against "undefined" for binding-existence probes.',
    },
    messages: {
      runtimeTypeof:
        'direct runtime `typeof` checks are not allowed' +
        '\nhelp: for external input, decode its complete contract with `Schema.decodeUnknownResult(DomainSchema)(input)` at the I/O boundary and use the decoded value' +
        "\nhelp: to check conformance to a schema's decoded type without transformation, use `Schema.is(DomainSchema)(value)`" +
        '\nhelp: for primitive or callable checks on an already-typed value, use an Effect predicate such as `Predicate.isFunction`' +
        '\nhelp: for a shallow non-null object or array gate, use `Predicate.isObjectOrArray`; `Schema.is(Schema.Struct({}))` does not prove object identity and accepts non-nullish primitives' +
        '\nnote: primitive predicates do not replace boundary decoding' +
        '\nnote: `typeof name === "undefined"` binding-existence probes are allowed and are not reported',
    },
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === 'typeof' && !isExistenceProbe(node)) {
          context.report({ node, messageId: 'runtimeTypeof' });
        }
      },
    };
  },
});
