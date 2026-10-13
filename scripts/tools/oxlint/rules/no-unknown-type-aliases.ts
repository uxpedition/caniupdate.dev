import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from '../shared/type-alias-resolution.ts';

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow type aliases whose resolved type is unknown.',
    },
    messages: {
      unknownAlias:
        'type alias `{{alias}}` resolves to `unknown`' +
        '\nhelp: keep `unknown` explicit at the parsing or error-cause boundary; otherwise use the decoded owner type' +
        '\nnote: naming `unknown` does not establish a contract, and a union containing it still resolves to `unknown`',
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === 'TSUnknownKeyword') return true;
        if (resolved.type === 'TSParenthesizedType') {
          return matches(resolved.typeAnnotation);
        }
        return resolved.type === 'TSUnionType' && resolved.types.some(matches);
      });

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      TSTypeAliasDeclaration(node) {
        if (!resolvesToUnknown(node.typeAnnotation)) return;
        context.report({
          node: node.id,
          messageId: 'unknownAlias',
          data: { alias: node.id.name },
        });
      },
    };
  },
});
