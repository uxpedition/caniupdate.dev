import { defineRule } from '@oxlint/plugins';

import { isInsideBroadEffectHandler, isTagMember, tagMemberFromComparison } from '../shared/tagged-values.ts';

export const noManualTagComparisonRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow manual `_tag` comparisons and switches outside broad Effect catch handlers.',
    },
    messages: {
      manualComparison:
        'manual `_tag` comparison branches on a tagged value' +
        '\nhelp: branch with `Match.value(value).pipe(Match.tag("Tag", handler), Match.orElse(fallback))`, or use `Predicate.isTagged("Tag")` for a reusable guard' +
        '\nnote: `Predicate.isTagged` narrows only to `{ _tag }` and checks no payload; the enum `$is` narrows to the full member type, which is only as trustworthy as the value it guards',
      manualSwitch:
        'switch on `_tag` branches a tagged value by hand' +
        '\nhelp: use `Match.value(value).pipe(Match.tags({ Tag: handler }), Match.orElse(fallback))`, `Match.tagsExhaustive({ ... })` to require every tag, or the owning tagged enum `$match(value, cases)`' +
        '\nnote: a switch with no matching case falls through to the code after it; `Match` has no result without `orElse` or an exhaustive finisher, so keep the fallback behavior explicit',
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (tagMemberFromComparison(node) === undefined || isInsideBroadEffectHandler(node)) {
          return;
        }
        context.report({ node, messageId: 'manualComparison' });
      },
      SwitchStatement(node) {
        if (!isTagMember(node.discriminant) || isInsideBroadEffectHandler(node)) {
          return;
        }
        context.report({ node, messageId: 'manualSwitch' });
      },
    };
  },
});
