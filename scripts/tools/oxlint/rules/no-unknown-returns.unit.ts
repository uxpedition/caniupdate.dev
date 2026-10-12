import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noUnknownReturnsRule } from './no-unknown-returns';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-unknown-returns', () => {
  tester.run('guides callers toward concrete boundary contracts', noUnknownReturnsRule, {
    valid: [
      'function parse(text: string): { readonly id: string } { return { id: text }; }',
      "import { Effect } from 'effect'; declare function load(): Effect.Effect<string, Error, never>;",
      "import { Effect } from '@acme/effect'; declare function load(): Effect.Effect<unknown>;",
      "import { Effect } from 'effect'; namespace Shadow { export namespace Effect { export interface Effect<A> { readonly value: A; } } export declare function load(): Effect.Effect<unknown>; }",
    ],
    invalid: [
      {
        code: 'async function receive(): Promise<unknown> { return JSON.parse("{}"); }',
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; declare function load(): Effect.Effect<unknown, Error>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; declare function load(): Effect.Effect<string, unknown>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; declare function load(): Effect.Effect<string, Error, unknown>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect as Eff } from 'effect'; type Loaded = Eff.Effect<unknown, never, never>; declare function load(): Loaded;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import * as Ns from 'effect'; declare function load(): Ns.Effect.Effect<unknown>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; type Loaded<A> = Effect.Effect<A>; declare function load(): Loaded<unknown>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; declare function load(): Promise<Effect.Effect<unknown>>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
      {
        code: "import { Effect } from 'effect'; declare function load(): Effect.Effect<Promise<unknown>, Error>;",
        errors: [{ messageId: 'unknownReturn' }],
      },
    ],
  });
});
