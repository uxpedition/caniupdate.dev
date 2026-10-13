import { defineRule } from '@oxlint/plugins';

import {
  isInsideBroadEffectHandler,
  isReasonTagMember,
  isTagMember,
  tagMemberFromComparison,
} from '../shared/tagged-values.ts';

export const noManualEffectErrorTagRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer tagged catch helpers over manual `_tag` checks inside broad Effect catch handlers.',
    },
    messages: {
      tag:
        'manual `_tag` check in a broad Effect catch handler' +
        '\nhelp: handle one tag with `Effect.catchTag("Tag", handler)` or several with `Effect.catchTags({ Tag: handler })`' +
        '\nnote: tagged catch helpers preserve unmatched failures by default; retain any existing fallback recovery and branch polarity rather than silently changing which errors are handled',
      reason:
        'manual `reason._tag` check in a broad Effect catch handler' +
        '\nhelp: handle one nested reason with `Effect.catchReason("ErrorTag", "ReasonTag", handler)` or several with `Effect.catchReasons("ErrorTag", { ReasonTag: handler })`' +
        '\nnote: the handler receives the unwrapped reason; unmatched reasons keep the parent tagged error in the error channel',
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        const tagMember = tagMemberFromComparison(node);
        if (tagMember === undefined || !isInsideBroadEffectHandler(node)) {
          return;
        }
        context.report({
          node,
          messageId: isReasonTagMember(tagMember) ? 'reason' : 'tag',
        });
      },
      SwitchStatement(node) {
        if (!isTagMember(node.discriminant) || !isInsideBroadEffectHandler(node)) {
          return;
        }
        context.report({
          node,
          messageId: isReasonTagMember(node.discriminant) ? 'reason' : 'tag',
        });
      },
    };
  },
});
