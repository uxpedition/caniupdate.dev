import { defineRule } from '@oxlint/plugins';

import { arrayMethodTarget, isKnownArrayExpression, unwrapArrayExpression } from '../shared/array-method.ts';

/** Reject eager array filter/map pipelines; lazy iterator helpers remain allowed. */
export const noArrayFilterMapRule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer an equivalent single-pass transformation over adjacent array filter/map passes.',
    },
    messages: {
      arrayFilterMap:
        'expected one equivalent transformation pass, found consecutive array `{{first}}` and `{{second}}` passes' +
        '\nhelp: for side-effect-free callbacks, prefer a small loop; preserve original indexes for map-then-filter and retained-element indexes for filter-then-map' +
        '\nnote: fusion interleaves callbacks; two passes finish every first callback before starting any second callback. Analyze observable effects and callback array arguments before fusing' +
        '\nnote: array map/filter skip sparse holes, while values() yields undefined for them; iterator helpers also require runtime support' +
        '\nnote: Effect v4 Array.filterMap expects Result, not Option; an explicit loop avoids per-element wrapper allocation',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const outer = arrayMethodTarget(node.callee);
        if (outer === null || (outer.name !== 'map' && outer.name !== 'filter')) return;
        const innerCall = unwrapArrayExpression(outer.object);
        if (innerCall.type !== 'CallExpression') return;
        const inner = arrayMethodTarget(innerCall.callee);
        if (inner === null || inner.name !== (outer.name === 'map' ? 'filter' : 'map')) return;
        if (!isKnownArrayExpression(context.sourceCode, inner.object)) return;
        context.report({ node, messageId: 'arrayFilterMap', data: { first: inner.name, second: outer.name } });
      },
    };
  },
});
