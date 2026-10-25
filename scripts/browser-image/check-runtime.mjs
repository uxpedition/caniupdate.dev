import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const image = JSON.parse(readFileSync('/opt/browser-ci/versions.json', 'utf8'));

const node = readFileSync(new URL('../../.node-version', import.meta.url), 'utf8').trim();

assert.equal(process.versions.node, node);

assert.equal(image.node, node);

assert.equal(manifest.packageManager, `nub@${image.nub}`);

assert.equal(image.playwright, manifest.devDependencies.playwright);

assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright');

console.log(`Prebuilt browser runtime verified: Node ${image.node}, Nub ${image.nub}, Playwright ${image.playwright}`);
