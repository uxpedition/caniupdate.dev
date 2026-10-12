import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noKnownValueWideningRule } from './no-known-value-widening';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-known-value-widening diagnostic classification', () => {
  tester.run('broad targets and anonymous contracts', noKnownValueWideningRule, {
    valid: [
      'const values: Record<string, number> = {};',
      'interface CloseDetails { readonly code: number; readonly reason: string }\nfunction closeDetails(): CloseDetails { return { code: 1, reason: "x" }; }',
      'function label(): string { return "x"; }',
      'declare function read(): unknown;\nconst value: unknown = read();',
    ],
    invalid: [
      {
        code: 'function read(): unknown { return { code: 1 }; }',
        errors: [{ messageId: 'widening' }],
      },
      {
        code: 'const meta: Record<string, unknown> = { code: 1 };',
        errors: [{ messageId: 'widening' }],
      },
      {
        code: 'function closeDetails(): { code: number; reason: string } { return { code: 1, reason: "x" }; }',
        errors: [{ messageId: 'anonymousContract' }],
      },
      {
        code: 'const details: { code: number } = { code: 1 };',
        errors: [{ messageId: 'anonymousContract' }],
      },
    ],
  });
});
