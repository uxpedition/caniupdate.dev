import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noServiceConstructorImportsRule } from './no-service-constructor-imports';

const tester = new RuleTester();

describe('effect/no-service-constructor-imports unit exemption', () => {
  tester.run('unit test files may import constructors directly', noServiceConstructorImportsRule, {
    valid: [
      { filename: 'server/capability/cache.unit.ts', code: "import { makeCache } from './cache';\n" },
      { filename: 'server/capability/cache.test.ts', code: "import { makeCache } from './cache';\n" },
    ],
    invalid: [
      {
        filename: 'server/capability/route.ts',
        code: "import { makeCache } from './cache';\n",
        errors: [{ messageId: 'serviceConstructorImport', data: { name: 'makeCache' } }],
      },
    ],
  });
});
