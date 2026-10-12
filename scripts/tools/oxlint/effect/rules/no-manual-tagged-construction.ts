import { defineRule } from '@oxlint/plugins';

import {
  isEffectMatchPatternObject,
  isStringLiteral,
  isVitestAssertionPatternObject,
  propertyName,
} from '../shared/tagged-values.ts';

export const noManualTaggedConstructionRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Construct tagged values with their existing Effect constructor instead of writing `_tag` manually.',
    },
    messages: {
      manualConstruction:
        'expected constructor-owned tagged construction, found literal `_tag: "{{tag}}"`' +
        '\nhelp: reuse the owning Schema tagged `.make` or tagged class/error constructor' +
        '\nhelp: for an internal union without constructors, define its variants once with `Data.taggedEnum`' +
        '\nnote: tag constructors do not replace decoding external input; preserve raw malformed fixtures and assertion patterns',
    },
  },
  createOnce(context) {
    return {
      ObjectExpression(node) {
        const sourceCode = context.sourceCode;
        const tag = node.properties.find(
          (property) =>
            property.type === 'Property' && propertyName(property) === '_tag' && isStringLiteral(property.value),
        );
        if (tag?.type === 'Property' && isStringLiteral(tag.value)) {
          if (isEffectMatchPatternObject(sourceCode, node) || isVitestAssertionPatternObject(sourceCode, node)) return;
          context.report({ node: tag, messageId: 'manualConstruction', data: { tag: tag.value.value } });
        }
      },
    };
  },
});
