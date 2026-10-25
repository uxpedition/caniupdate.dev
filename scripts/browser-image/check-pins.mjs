import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const manifest = JSON.parse(read('package.json'));

const dockerfile = read('scripts/browser-image/Dockerfile');

const bootstrap = read('scripts/deploy/ci-bootstrap.yml');

const lock = read('nub.lock');

const node = read('.node-version').trim();

const nub = manifest.packageManager.replace('nub@', '');

const playwright = manifest.devDependencies.playwright;

const argument = (name) => {
  const match = dockerfile.match(new RegExp(`^ARG ${name}=(.+)$`, 'm'));
  assert(match, `Missing Dockerfile argument ${name}`);

  return match[1];
};

assert.equal(argument('NODE_VERSION'), node);

assert.equal(argument('NUB_VERSION'), nub);

assert.equal(argument('PLAYWRIGHT_VERSION'), playwright);

assert(bootstrap.includes(`PIN_NODE_VERSION: '${node}'`));

assert(bootstrap.includes(`PIN_NUB_VERSION: '${nub}'`));

assert(bootstrap.includes(`NUB_ARCHIVE_SHA256: '${argument('NUB_SHA256')}'`));

const image = dockerfile.match(/^FROM (.+)$/m);

assert(image && bootstrap.includes(`image: ${image[1]}`), 'Node image must match the ordinary bootstrap digest');

assert(
  lock.includes(
    `playwright-core@${playwright}:\n    resolution: {integrity: sha512-${argument('PLAYWRIGHT_CORE_SHA512')}}`,
  ),
  'Playwright archive integrity must match nub.lock',
);

console.log(`Browser image pins synchronized: Node ${node}, Nub ${nub}, Playwright ${playwright}`);
