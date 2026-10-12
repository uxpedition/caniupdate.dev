import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noManualTaggedConstructionRule } from './no-manual-tagged-construction';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('effect/no-manual-tagged-construction assertion patterns', () => {
  tester.run('imported vitest expect chains and objectContaining patterns', noManualTaggedConstructionRule, {
    valid: [
      "import { expect } from 'vitest';\nawait expect(result).rejects.toMatchObject({ _tag: 'SchemaError' });",
      "import { expect } from 'vitest';\nexpect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'write' });",
      "import { expect } from 'vitest';\nexpect(outcomes.second).toMatchObject({ ok: false, error: { _tag: 'EvidenceStorageCorruptionError' } });",
      "import { expect } from 'vitest';\nexpect(result).toMatchObject({ errors: [{ _tag: 'SchemaError' }] });",
      "import { expect } from 'vitest';\nexpect(handler).toHaveBeenCalledWith(expect.objectContaining({ error: { _tag: 'SchemaError' } }));",
      "import { expect as expectValue } from 'vitest';\nexpectValue(result).resolves.not.toMatchObject({ _tag: 'SchemaError' });",
      "import { Match } from 'effect';\nMatch.when({ _tag: 'SchemaError' }, () => 1);",
      "import { Match } from 'effect';\nMatch.not({ _tag: 'SchemaError' }, () => 1);",
      "import { Match as M } from 'effect';\nM.when({ error: { _tag: 'SchemaError' } }, () => 1);",
      "import { Match } from 'effect';\nMatch.not({ errors: [{ _tag: 'SchemaError' }] }, () => 1);",
    ],
    invalid: [
      {
        code: "import { Match } from 'effect';\nMatch.not({ _tag: 'SchemaError' }, { _tag: 'Other' });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'Other' } }],
      },
      {
        code: "import { Match } from 'effect';\nimport { makeError } from './errors';\nMatch.when({ error: makeError({ _tag: 'SchemaError' }) }, () => 1);",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { expect } from 'vitest';\nimport { makeError } from './errors';\nexpect(result).toMatchObject({ error: makeError({ _tag: 'SchemaError' }) });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "const error = { _tag: 'SchemaError' };",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { makeError } from './errors';\nmakeError({ _tag: 'SchemaError' });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { makeResult } from './results';\nmakeResult({ error: { _tag: 'SchemaError' } });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { expect } from 'vitest';\nconst pattern = { _tag: 'SchemaError' };\nexpect(result).toMatchObject(pattern);",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { expect } from 'vitest';\nfunction check(expect: (value: unknown) => { toMatchObject(pattern: unknown): void }) {\n  expect(result).toMatchObject({ _tag: 'SchemaError' });\n}",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { expect } from 'chai';\nexpect(result).toMatchObject({ _tag: 'SchemaError' });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "expect(result).toMatchObject({ _tag: 'SchemaError' });",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "const Match = { when: (pattern: unknown, handler: () => number) => handler };\nMatch.when({ _tag: 'SchemaError' }, () => 1);",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
      {
        code: "import { Match } from 'ts-pattern';\nMatch.when({ _tag: 'SchemaError' }, () => 1);",
        errors: [{ messageId: 'manualConstruction', data: { tag: 'SchemaError' } }],
      },
    ],
  });
});
