import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noUnknownParametersRule } from './no-unknown-parameters';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-unknown-parameters guard policy', () => {
  tester.run('guard subject and asserted result', noUnknownParametersRule, {
    valid: [
      'interface User { readonly id: string }\nfunction isUser(value: unknown): value is User { return true; }',
      'function consume(cause: unknown) { return cause; }',
    ],
    invalid: [
      {
        code: 'function render(value: unknown) { return value; }',
        errors: [{ messageId: 'unknownParameter', data: { parameter: 'value' } }],
      },
      {
        code: 'function isUser(value: unknown): value is unknown { return true; }',
        errors: [{ messageId: 'unknownPredicateResult' }],
      },
      {
        code: 'function isUser(value: unknown): value is unknown | string { return true; }',
        errors: [{ messageId: 'unknownPredicateResult' }],
      },
    ],
  });
});
