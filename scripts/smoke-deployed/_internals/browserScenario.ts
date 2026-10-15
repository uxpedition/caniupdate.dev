import { resolve } from 'node:path';

import { chromium, firefox, type Page, type Response as BrowserResponse } from 'playwright';

import { parseBuildIdentity } from '../../../shared/site/buildIdentity.ts';
import { installScopedBrowserAccess, SmokeFailure, type SmokeConfig } from './access.ts';
import { BriefingObserver, decodeSubmission, nextSubmission, type GenerationOutcome } from './briefing.ts';
import {
  decodePackageDeclarationsResponse,
  decodePackageMeasurementsResponse,
  decodePackageSearchResponse,
} from './contracts.ts';

const browsers = { chromium, firefox } as const;

export type BrowserName = keyof typeof browsers;

export type BrowserOutcome = {
  browser: BrowserName;
  outcome: 'passed' | 'failed';
  generation?: GenerationOutcome;
  reloadGeneration?: GenerationOutcome;
  failureStage?: string;
};

async function waitForOpaqueSurface(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((target) => {
    let element = document.querySelector(target);

    if (element === null) return false;

    while (element !== null) {
      if (getComputedStyle(element).opacity !== '1') return false;

      element = element.parentElement;
    }

    return true;
  }, selector);
}

async function verifyFooter(page: Page, expectedSha: string): Promise<void> {
  const link = page.getByRole('link', { name: `View preview commit ${expectedSha}`, exact: true });

  await link.waitFor({ state: 'visible' });

  const href = await link.getAttribute('href');
  const suffix = `/-/commit/${expectedSha}`;

  if (href === null || !href.endsWith(suffix)) throw new SmokeFailure('footer-identity');

  parseBuildIdentity(expectedSha, href.slice(0, -suffix.length));
}

async function searchPackage(page: Page, config: SmokeConfig): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());

    return (
      url.origin === config.frontendOrigin.origin &&
      url.pathname === '/api/search' &&
      url.searchParams.get('text') === 'is-number'
    );
  });

  const [response] = await Promise.all([responsePromise, page.locator('#package-search').fill('is-number')]);
  const payload: unknown = await response.json();
  const search = decodePackageSearchResponse(payload);

  if (response.status() !== 200 || !search.data.some((item) => item.name === 'is-number'))
    throw new SmokeFailure('package-search');

  await page
    .getByRole('option', { name: /^is-number\b/ })
    .first()
    .click();
}

async function selectVersion(page: Page, label: string, version: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: version, exact: true }).click();
}

function comparisonResponse(page: Page, config: SmokeConfig, suffix: string): Promise<BrowserResponse> {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());

      return (
        url.origin === config.frontendOrigin.origin &&
        url.pathname === `/api/package/is-number/compare${suffix}` &&
        response.request().method() === 'GET'
      );
    },
    { timeout: 30_000 },
  );
}

async function verifyDeclarations(response: BrowserResponse): Promise<void> {
  const payload: unknown = await response.json();
  const value = decodePackageDeclarationsResponse(payload);

  if (
    response.status() !== 200 ||
    value.packageName !== 'is-number' ||
    value.from.name !== 'is-number' ||
    value.to.name !== 'is-number' ||
    value.from.version !== '6.0.0' ||
    value.to.version !== '7.0.0'
  ) {
    throw new SmokeFailure('declarations-response');
  }
}

async function verifyMeasurements(response: BrowserResponse): Promise<void> {
  const payload: unknown = await response.json();
  const value = decodePackageMeasurementsResponse(payload);

  if (
    response.status() !== 200 ||
    value.packageName !== 'is-number' ||
    value.from.name !== 'is-number' ||
    value.to.name !== 'is-number' ||
    value.from.version !== '6.0.0' ||
    value.to.version !== '7.0.0'
  ) {
    throw new SmokeFailure('measurements-response');
  }
}

async function compare(page: Page, config: SmokeConfig, observer: BriefingObserver): Promise<GenerationOutcome> {
  await searchPackage(page, config);
  await selectVersion(page, 'From version', '6.0.0');
  await selectVersion(page, 'To version', '7.0.0');

  const declarations = comparisonResponse(page, config, '').then(verifyDeclarations);
  const measurements = comparisonResponse(page, config, '/measurements').then(verifyMeasurements);
  const submission = nextSubmission(page, config).then(decodeSubmission);
  const navigation = page.waitForURL('**/is-number/6.0.0...7.0.0');

  const [decoded] = await Promise.all([
    submission,
    declarations,
    measurements,
    navigation,
    page.getByTestId('compare').click(),
  ]);

  await waitForComparisonRender(page);

  return await observer.settle(decoded, config);
}

async function waitForComparisonRender(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'At a glance', exact: true }).waitFor({ state: 'visible' });
  await waitForOpaqueSurface(page, '.comparison-shell');
}

async function verifyReload(page: Page, config: SmokeConfig): Promise<GenerationOutcome> {
  const pending = nextSubmission(page, config).then(decodeSubmission);
  const [submission] = await Promise.all([pending, page.reload({ waitUntil: 'domcontentloaded' })]);

  if (submission.status !== 'available') throw new SmokeFailure('reload-cached-briefing');

  await waitForComparisonRender(page);

  return { submission: 'available', outcome: 'cached-available', frames: 0 };
}

async function openHomepage(page: Page, config: SmokeConfig, screenshot: string): Promise<void> {
  await page.goto(config.frontendOrigin.href, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: 'Check what changes before you update an npm package.', exact: true })
    .waitFor();
  await verifyFooter(page, config.expectedSha);
  await waitForOpaqueSurface(page, 'h1');
  await waitForOpaqueSurface(page, '#package-search');
  await page.screenshot({ path: screenshot, fullPage: true });
}

async function exercisePage(page: Page, config: SmokeConfig, output: string, outcome: BrowserOutcome): Promise<void> {
  let errors = 0;

  page.on('pageerror', () => {
    errors += 1;
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors += 1;
  });
  page.setDefaultTimeout(30_000);
  await openHomepage(page, config, resolve(output, `${outcome.browser}-homepage.png`));

  const observer = new BriefingObserver(page);

  outcome.generation = await compare(page, config, observer);
  outcome.reloadGeneration = await verifyReload(page, config);
  await verifyFooter(page, config.expectedSha);
  await page.screenshot({ path: resolve(output, `${outcome.browser}-comparison.png`), fullPage: true });

  if (errors) throw new SmokeFailure('browser-errors');
}

export async function runBrowser(name: BrowserName, config: SmokeConfig, output: string): Promise<BrowserOutcome> {
  const outcome: BrowserOutcome = { browser: name, outcome: 'failed' };
  const browser = await browsers[name].launch({ headless: true });

  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1365, height: 900 } });

    // Routed loopback documents need Chromium's explicit local-network permission for the separate socket port.
    if (config.local && name === 'chromium') {
      await context.grantPermissions(['local-network-access'], { origin: config.frontendOrigin.origin });
    }

    await installScopedBrowserAccess(context, config);
    await exercisePage(await context.newPage(), config, output, outcome);
    outcome.outcome = 'passed';
  } catch (cause) {
    outcome.failureStage = cause instanceof SmokeFailure ? cause.stage : `browser-${name}-interaction`;
  } finally {
    await browser.close();
  }

  return outcome;
}
