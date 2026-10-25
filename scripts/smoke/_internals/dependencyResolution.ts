import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser, BrowserType, Locator, Page } from 'playwright';

import { dependencyResolutionRuntime, type DependencyFixture } from './dependencyResolutionFixture.ts';

const resolvePath = (name: string, from: string, to: string) =>
  `/resolve/${encodeURIComponent(name)}?${new URLSearchParams({ from, to })}`;

async function verifyResolverRedirects(fixture: DependencyFixture, origin: string) {
  const { runtime } = fixture;
  const path = resolvePath('@scope/child', '1.x', '2.x');
  const response = await runtime.dispatchFetch(`${origin}${path}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/%40scope%2Fchild/1.2.3...2.1.0');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  await runtime.dispatchFetch(`${origin}${path}`, { redirect: 'manual' });
  assert.equal(fixture.metadataCalls, 1, 'separate resolver requests share durable metadata');

  for (const [name, from, to, status] of [
    ['@scope/child', '9.x', '*', 404],
    ['@scope/child', '', '*', 400],
    ['@scope/child', '2.x', '1.x', 302],
    ['@scope/child', '3.0.0-beta.1', '*', 302],
  ] as const) {
    assert.equal(
      (await runtime.dispatchFetch(`${origin}${resolvePath(name, from, to)}`, { redirect: 'manual' })).status,
      status,
    );
  }
}

async function verifyResolverRecovery(fixture: DependencyFixture, origin: string) {
  fixture.setUnavailable(true);
  const unavailablePath = resolvePath('temporarily-unavailable', '1.x', '2.x');
  const failure = await fixture.runtime.dispatchFetch(`${origin}${unavailablePath}`, { redirect: 'manual' });
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes('private-provider-marker'));
  fixture.setUnavailable(false);
  assert.equal(
    (await fixture.runtime.dispatchFetch(`${origin}${unavailablePath}`, { redirect: 'manual' })).status,
    302,
  );
}

export async function verifyDependencyResolution() {
  const fixture = await dependencyResolutionRuntime();
  const { runtime } = fixture;

  try {
    const origin = (await runtime.ready).origin;
    await verifyResolverRedirects(fixture, origin);
    await verifyResolverRecovery(fixture, origin);
    console.log('Dependency resolver: exact lowest published redirects, shared cache, no-match and temporary recovery');
  } finally {
    await runtime.dispose();
  }
}

async function verifyResolverFailurePages(page: Page, setUnavailable: (value: boolean) => void, origin: string) {
  setUnavailable(true);
  const path = resolvePath('browser-unavailable', '1.x', '2.x');
  const failure = await page.goto(`${origin}${path}`);
  assert.equal(failure?.status(), 503);
  assert.ok((await page.locator('body').textContent())?.includes('Reload this page'));
  assert.ok(!(await page.locator('body').textContent())?.includes('private-provider-marker'));
  setUnavailable(false);
  await page.reload();
  await page.waitForURL((url) => url.pathname === '/browser-unavailable/1.2.3...2.1.0');
  const noMatch = await page.goto(`${origin}${resolvePath('@scope/child', '9.x', '*')}`);
  assert.equal(noMatch?.status(), 404);
  assert.ok((await page.locator('body').textContent())?.includes('No published release'));
}

async function verifyPassiveDependencyLink(
  page: Page,
  fixture: DependencyFixture,
  metadataRequests: string[],
  origin: string,
  browserName: string,
) {
  await page.goto(`${origin}/%40scope%2Fparent/1.0.0...2.0.0`);
  await page.getByRole('button', { name: 'Dependencies', exact: true }).click();
  await page.getByRole('button', { name: '1 dependency updated', exact: true }).hover();
  const link = page.locator('a[href^="/resolve/"]');
  await link.waitFor({ state: 'visible' });
  assert.equal(await link.getAttribute('href'), resolvePath('@scope/child', '1.x', '2.x'));
  assert.equal(fixture.metadataCalls, 0, 'hover never resolves metadata');
  assert.deepEqual(metadataRequests, [], 'hover makes no public metadata requests');
  const directory = await mkdtemp(join(tmpdir(), 'dependency-link-browser-'));
  await page.screenshot({ path: join(directory, `${browserName}.png`), fullPage: true });

  return { link, directory };
}

async function verifyDependencyNavigation(
  browser: Browser,
  page: Page,
  link: Locator,
  fixture: DependencyFixture,
  origin: string,
) {
  // Copy/open-in-new-tab keeps the complete resolver URL and performs resolution only in that tab.
  const target = await browser.newPage();
  await target.goto(`${origin}${await link.getAttribute('href')}`);
  await target.waitForURL((url) => decodeURIComponent(url.pathname) === '/@scope/child/1.2.3...2.1.0');
  assert.equal(await target.locator('h1').textContent(), '@scope/child');
  assert.equal(fixture.metadataCalls, 1);
  await target.close();
  await page.bringToFront();
  await page.getByRole('button', { name: '1 dependency updated', exact: true }).hover();
  await link.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => decodeURIComponent(url.pathname) === '/@scope/child/1.2.3...2.1.0');
  assert.equal(fixture.metadataCalls, 1, 'activation reuses successful metadata');
}

async function createObservedDependencyPage(browser: Browser) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  const metadataRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/package/%40scope%2Fchild') metadataRequests.push(request.url());
  });

  return { page, errors, metadataRequests };
}

export async function verifyDependencyLinks(engine: BrowserType) {
  const fixture = await dependencyResolutionRuntime();
  const browser = await engine.launch({ headless: true });

  try {
    const { page, errors, metadataRequests } = await createObservedDependencyPage(browser);
    const origin = (await fixture.runtime.ready).origin;

    const { link, directory } = await verifyPassiveDependencyLink(
      page,
      fixture,
      metadataRequests,
      origin,
      engine.name(),
    );

    await verifyDependencyNavigation(browser, page, link, fixture, origin);
    await verifyResolverFailurePages(page, (value) => fixture.setUnavailable(value), origin);
    assert.deepEqual(errors, [], 'no browser execution errors');
    console.log(
      `${engine.name()}: passive hover, copyable resolver URL, new-tab and keyboard navigation; screenshot ${directory}`,
    );
  } finally {
    await browser.close();
    await fixture.runtime.dispose();
  }
}
