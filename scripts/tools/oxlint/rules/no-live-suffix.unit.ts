import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noLiveSuffixRule } from './no-live-suffix';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-live-suffix ownership', () => {
  tester.run('locally owned names and aliased imports', noLiveSuffixRule, {
    valid: [
      "import { FooLive as FooLayer } from 'some-package';\nexport const layer = FooLayer;",
      'const isLiveStreaming = true;',
      'interface CacheStore {}\n type BagLayer = CacheStore;\n class CacheStore {}\n function openCache() {}',
      'const settings = { Live: true, waitUntilLive: false };',
      "export { FooLive as FooLayer } from 'some-package';",
    ],
    invalid: [
      {
        code: 'import { FooLive } from "some-package";\n',
        errors: [{ messageId: 'liveSuffix', data: { name: 'FooLive' } }],
      },
      {
        code: 'export const ConsoleLoggerLive = makeLayer();',
        errors: [{ messageId: 'liveSuffix', data: { name: 'ConsoleLoggerLive' } }],
      },
      {
        code: 'function resolveLive() {}',
        errors: [{ messageId: 'liveSuffix', data: { name: 'resolveLive' } }],
      },
      {
        code: 'type BagLive = object;',
        errors: [{ messageId: 'liveSuffix', data: { name: 'BagLive' } }],
      },
      {
        code: 'class CacheLive {}',
        errors: [{ messageId: 'liveSuffix', data: { name: 'CacheLive' } }],
      },
      {
        code: "export { layer as ExporterLive } from 'some-package';",
        errors: [{ messageId: 'liveSuffix', data: { name: 'ExporterLive' } }],
      },
    ],
  });
});
