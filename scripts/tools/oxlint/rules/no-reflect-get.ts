import { defineRule } from '@oxlint/plugins';

import { isGlobalReflectMethodCall } from '../shared/reflect-method.ts';

/** Ban Reflect.get, which bypasses ordinary property access and useful type evidence. */
export const noReflectGetRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Reflect.get; use typed property access or parse dynamic input into a domain type.',
    },
    messages: {
      reflectGet:
        'expected an owner-typed property read, found Reflect.get' +
        '\nhelp: for a fixed key on an object this code owns, read the property directly after narrowing its type' +
        '\nhelp: for external application data, decode the owning schema with `Schema.decodeUnknownResult` before reading fields' +
        '\nhelp: for runtime capabilities or error inspection, guard the object and key, read once, and validate the property value' +
        '\nnote: preserve inherited getters, throwing accessors, explicit receivers, and RPC disposal; direct reads are not equivalent when a receiver differs',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'Super' || node.callee.type === 'V8IntrinsicExpression') return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, 'get')) {
          context.report({ node, messageId: 'reflectGet' });
        }
      },
    };
  },
});
