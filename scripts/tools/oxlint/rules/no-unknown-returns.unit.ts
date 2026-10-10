import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noUnknownReturnsRule } from './no-unknown-returns';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

const expectedMessage =
  'expected a concrete return contract, found `unknown` in the return type' +
  '\nhelp: for external JSON, decode before returning, e.g. `Schema.decodeSync(Schema.fromJsonString(DomainSchema))(text)`' +
  '\nhelp: transport-only readers can return bytes or text; keep size bounds at the transport boundary' +
  '\nhelp: reuse producer or fixture contracts; use `T` for unchanged forwarding, validated details for error helpers, and `never` for throw-only helpers' +
  '\nnote: `unknown` is valid while parsing untrusted data, but should not escape an API without establishing a concrete contract' +
  '\nnote: a type annotation or assertion does not validate external data; keep runtime decoding and cleanup';

describe('rules/no-unknown-returns diagnostic', () => {
  tester.run('guides callers toward concrete boundary contracts', noUnknownReturnsRule, {
    valid: ['function parse(text: string): { readonly id: string } { return { id: text }; }'],
    invalid: [
      {
        code: 'async function receive(): Promise<unknown> { return JSON.parse("{}"); }',
        errors: [{ message: expectedMessage }],
      },
    ],
  });
});
