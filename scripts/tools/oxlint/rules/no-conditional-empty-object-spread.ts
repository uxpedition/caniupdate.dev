import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === 'ParenthesizedExpression') {
    current = current.expression;
  }
  return current;
}

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === 'ObjectExpression' && node.properties.length === 0;
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  const conditional = unwrapParentheses(node);
  return (
    conditional.type === 'ConditionalExpression' &&
    (isEmptyObjectExpression(conditional.consequent) || isEmptyObjectExpression(conditional.alternate))
  );
}

/** Ban conditional empty-object spreads without changing their omission semantics. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow object spreads that conditionally spread an empty object to omit fields.',
    },
    messages: {
      avoid:
        'expected explicit optional-field construction, found a conditional empty-object spread' +
        '\nhelp: build the object in separate statements and assign the property only when its value is present' +
        '\nnote: assigning `undefined` creates an own key, which changes `in`, `Object.keys`, and `hasOwn`; absent, `undefined`, `null`, and `false` are distinct values and must stay distinct',
    },
  },
  createOnce(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== 'ObjectExpression') return;

        if (isConditionalEmptyObjectSpread(node.argument)) {
          context.report({ node, messageId: 'avoid' });
        }
      },
    };
  },
});
