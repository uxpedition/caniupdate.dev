import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium, firefox } = require(process.argv[2] ?? '/tmp/playwright-core');

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<title>Browser image fixture</title><button onclick="this.textContent=\'verified\'">check</button>');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const address = server.address();
  assert(address && Object.hasOwn(address, 'port'));

  for (const browserType of [chromium, firefox]) {
    const browser = await browserType.launch({ headless: true });

    try {
      const page = await browser.newPage();
      const response = await page.goto(`http://127.0.0.1:${address.port}`);
      assert.equal(response.status(), 200);
      assert.equal(await page.title(), 'Browser image fixture');
      await page.getByRole('button', { name: 'check', exact: true }).click();
      assert.equal(await page.getByRole('button').textContent(), 'verified');
      console.log(`${browserType.name()} ${browser.version()}: fixture interaction verified`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
