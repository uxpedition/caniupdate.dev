import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noObjectParametersRule } from './no-object-parameters';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-object-parameters guard policy', () => {
  tester.run('guard subject and asserted result', noObjectParametersRule, {
    valid: [
      'interface Owner { readonly id: string } function isOwner(value: object): value is Owner;',
      "function isOwner(value: object): value is { readonly id: string } { return 'id' in value; }",
      'type Bag = object; function isBag(value: Bag): value is { readonly id: string };',
    ],
    invalid: [
      { code: 'function save(value: object) {}', errors: [{ messageId: 'objectParameter' }] },
      {
        code: 'type Bag = object; function consume(value: Bag) {}',
        errors: [{ messageId: 'objectParameter' }],
      },
      {
        code: 'function isBag(value: object): value is object { return false; }',
        errors: [{ messageId: 'objectPredicateResult' }],
      },
      {
        code: 'type Bag = object; function isBag(value: Bag): value is Bag { return false; }',
        errors: [{ messageId: 'objectPredicateResult' }],
      },
    ],
  });
});
