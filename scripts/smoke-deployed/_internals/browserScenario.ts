import { resolve } from 'node:path';

import { Effect, Fiber, Schema } from 'effect';
import { chromium, firefox, type Browser, type Page, type Response as BrowserResponse, type Route } from 'playwright';

import {
  BriefingSubmissionSchema,
  decodeBriefingSubmission,
} from '../../../shared/comparison/briefing/briefingJob.defs.ts';
import { parseBuildIdentity } from '../../../shared/site/buildIdentity.ts';
import { installScopedBrowserAccess, playwrightCall } from './browserAccess.ts';
import { captureBrowserErrors, type BrowserDiagnostics } from './browserDiagnostics.ts';
import type { SmokeConfig } from './config.ts';
import {
  decodePackageDeclarationsResponse,
  decodePackageMeasurementsResponse,
  decodePackageSearchResponse,
} from './contracts.ts';
import { SmokeFailure } from './errors.ts';

const FIXTURE_BULLET = 'Smoke fixture: inspect the package changes before updating.';

const smokeBriefingSubmission = decodeBriefingSubmission({
  status: 'available',
  packageName: 'is-number',
  from: '6.0.0',
  to: '7.0.0',
  briefing: {
    status: 'available',
    model: 'smoke-fixture',
    bullets: [{ kind: 'coverage', basis: 'fact', text: FIXTURE_BULLET, evidenceNumbers: [0] }],
    sources: [
      {
        number: 0,
        id: 'smoke-fixture',
        kind: 'coverage',
        label: 'Smoke fixture evidence',
        urls: [],
        text: 'This fixture verifies briefing rendering without contacting an AI provider.',
      },
    ],
  },
});

const browsers = { chromium, firefox } as const;

export type BrowserName = keyof typeof browsers;

export type BrowserOutcome = {
  browser: BrowserName;
  outcome: 'passed' | 'failed';
  blockedBriefingPosts: number;
  browserErrors: BrowserDiagnostics;
  failureStage?: string;
};

const waitForOpaqueSurface = (page: Page, selector: string): Effect.Effect<void, SmokeFailure> =>
  playwrightCall('browser-interaction', () =>
    page.waitForFunction((target) => {
      let element = document.querySelector(target);

      if (element === null) return false;

      while (element !== null) {
        if (getComputedStyle(element).opacity !== '1') return false;

        element = element.parentElement;
      }

      return true;
    }, selector),
  ).pipe(Effect.asVoid);

const verifyFooter = (page: Page, config: SmokeConfig): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const footer = page.locator('footer');
    const production = config.target === 'production';

    const link = footer.getByRole('link', {
      name: `View ${production ? 'release' : config.local ? 'dev' : 'stage'} commit ${config.expectedSha}`,
      exact: true,
    });

    if (production) {
      const version = config.expectedVersion;

      if (version === null) return yield* Effect.fail(new SmokeFailure('footer-version'));
      yield* playwrightCall('footer-version', () =>
        footer.getByText(`v${version}`, { exact: true }).waitFor({ state: 'visible' }),
      );
    }

    yield* playwrightCall('browser-interaction', () => link.waitFor({ state: 'visible' }));

    const href = yield* playwrightCall('browser-interaction', () => link.getAttribute('href'));
    const suffix = `/-/commit/${config.expectedSha}`;

    if (href === null || !href.endsWith(suffix)) return yield* Effect.fail(new SmokeFailure('footer-identity'));

    yield* Effect.try({
      try: () => parseBuildIdentity(config.expectedSha, href.slice(0, -suffix.length)),
      catch: () => new SmokeFailure('browser-interaction'),
    });
  });

const searchPackage = (page: Page, config: SmokeConfig): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const responseFiber = yield* Effect.forkChild(
      playwrightCall('browser-interaction', () =>
        page.waitForResponse((candidate) => {
          const url = new URL(candidate.url());

          return (
            url.origin === config.frontendOrigin.origin &&
            url.pathname === '/api/search' &&
            url.searchParams.get('text') === 'is-number'
          );
        }),
      ),
      { startImmediately: true },
    );

    yield* Effect.yieldNow;
    yield* playwrightCall('browser-interaction', () => page.locator('#package-search').fill('is-number'));

    const response = yield* Fiber.join(responseFiber);
    const search = yield* decodePackageSearchResponse(playwrightCall('browser-interaction', () => response.json()));

    if (response.status() !== 200 || !search.data.some((item) => item.name === 'is-number')) {
      return yield* Effect.fail(new SmokeFailure('package-search'));
    }

    yield* playwrightCall('browser-interaction', () =>
      page
        .getByRole('option', { name: /^is-number\b/ })
        .first()
        .click(),
    );
  });

const selectVersion = (page: Page, label: string, version: string): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* playwrightCall('browser-interaction', () =>
      page.getByRole('combobox', { name: label, exact: true }).click(),
    );
    yield* playwrightCall('browser-interaction', () =>
      page.getByRole('option', { name: version, exact: true }).click(),
    );
  });

const comparisonResponse = (
  page: Page,
  config: SmokeConfig,
  suffix: string,
): Effect.Effect<BrowserResponse, SmokeFailure> =>
  playwrightCall('browser-interaction', () =>
    page.waitForResponse(
      (response) => {
        const url = new URL(response.url());

        return (
          url.origin === config.frontendOrigin.origin &&
          url.pathname === `/api/package/is-number/compare${suffix}` &&
          response.request().method() === 'GET'
        );
      },
      { timeout: 30_000 },
    ),
  );

const verifyDeclarations = (response: BrowserResponse): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const value = yield* decodePackageDeclarationsResponse(
      playwrightCall('browser-interaction', () => response.json()),
    );

    if (
      response.status() !== 200 ||
      value.packageName !== 'is-number' ||
      value.from.name !== 'is-number' ||
      value.to.name !== 'is-number' ||
      value.from.version !== '6.0.0' ||
      value.to.version !== '7.0.0'
    ) {
      return yield* Effect.fail(new SmokeFailure('declarations-response'));
    }
  });

const verifyMeasurements = (response: BrowserResponse): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const value = yield* decodePackageMeasurementsResponse(
      playwrightCall('browser-interaction', () => response.json()),
    );

    if (
      response.status() !== 200 ||
      value.packageName !== 'is-number' ||
      value.from.name !== 'is-number' ||
      value.to.name !== 'is-number' ||
      value.from.version !== '6.0.0' ||
      value.to.version !== '7.0.0'
    ) {
      return yield* Effect.fail(new SmokeFailure('measurements-response'));
    }
  });

const handleBriefingSubmission = (route: Route, outcome: BrowserOutcome): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const method = yield* Effect.try({
      try: () => route.request().method(),
      catch: () => new SmokeFailure('browser-interaction'),
    });

    if (method !== 'POST') {
      yield* playwrightCall('browser-interaction', () => route.continue());

      return;
    }

    yield* Effect.sync(() => {
      outcome.blockedBriefingPosts += 1;
    });

    // Return an available fixture before dispatch: the browser smoke exercises the page without invoking a provider.
    yield* playwrightCall('browser-interaction', () =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(smokeBriefingSubmission),
      }),
    );
  });

const interceptBriefingSubmissions = (
  page: Page,
  config: SmokeConfig,
  outcome: BrowserOutcome,
): Effect.Effect<void, SmokeFailure> =>
  playwrightCall('browser-interaction', () =>
    page.route(
      (url) =>
        url.origin === config.frontendOrigin.origin && url.pathname === '/api/package/is-number/compare/briefing',
      (route) =>
        Effect.runPromise(
          handleBriefingSubmission(route, outcome).pipe(
            Effect.catch(() =>
              playwrightCall('browser-interaction', () => route.abort('blockedbyclient')).pipe(
                Effect.orElseSucceed(() => undefined),
              ),
            ),
          ),
        ),
    ),
  );

const verifyBriefingResponse = (page: Page, config: SmokeConfig) =>
  Effect.gen(function* () {
    const response = yield* playwrightCall('briefing-submission', () =>
      page.waitForResponse((candidate) => {
        const url = new URL(candidate.url());

        return (
          candidate.request().method() === 'POST' &&
          url.origin === config.frontendOrigin.origin &&
          url.pathname === '/api/package/is-number/compare/briefing'
        );
      }),
    );

    const payload: unknown = yield* playwrightCall('briefing-submission', () => response.json());

    const submission = yield* Schema.decodeUnknownEffect(BriefingSubmissionSchema, {
      errors: 'all',
      onExcessProperty: 'error',
    })(payload).pipe(Effect.mapError(() => new SmokeFailure('briefing-submission')));

    if (
      response.status() !== 200 ||
      submission.status !== 'available' ||
      submission.packageName !== 'is-number' ||
      submission.from !== '6.0.0' ||
      submission.to !== '7.0.0'
    ) {
      return yield* Effect.fail(new SmokeFailure('briefing-submission'));
    }
  });

const verifyBriefingRender = (page: Page, fixtureBullet?: string): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const region = page.getByRole('region', { name: 'AI briefing', exact: true, includeHidden: true });
    const disclosure = page.locator('details').filter({ has: region });

    if (fixtureBullet !== undefined) {
      yield* playwrightCall('briefing-render', () =>
        region.getByText(fixtureBullet, { exact: true }).waitFor({ state: 'attached' }),
      );
    }

    const open = yield* playwrightCall('briefing-render', () =>
      disclosure.evaluate((element) => element.matches('details[open]')),
    );

    if (!open) yield* playwrightCall('briefing-render', () => disclosure.locator('summary').click());

    if (fixtureBullet !== undefined) {
      yield* playwrightCall('briefing-render', () =>
        region.getByText(fixtureBullet, { exact: true }).waitFor({ state: 'visible' }),
      );
      yield* playwrightCall('briefing-render', () =>
        region.getByRole('link', { name: 'Jump to Smoke fixture evidence', exact: true }).waitFor({ state: 'visible' }),
      );
    } else {
      const availableBullet = region.locator('ol > li').first();

      if ((yield* playwrightCall('briefing-render', () => availableBullet.count())) > 0) {
        yield* playwrightCall('briefing-render', () => availableBullet.waitFor({ state: 'visible' }));
      } else {
        yield* playwrightCall('briefing-render', () =>
          region.getByRole('status').filter({ hasText: 'Package facts remain available.' }).waitFor({
            state: 'visible',
          }),
        );
      }
    }

    yield* waitForOpaqueSurface(page, '[aria-label="AI briefing"]');
  });

const compare = (page: Page, config: SmokeConfig): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* searchPackage(page, config);
    yield* selectVersion(page, 'From version', '6.0.0');
    yield* selectVersion(page, 'To version', '7.0.0');

    const declarations = comparisonResponse(page, config, '').pipe(Effect.flatMap(verifyDeclarations));
    const measurements = comparisonResponse(page, config, '/measurements').pipe(Effect.flatMap(verifyMeasurements));
    const navigation = playwrightCall('browser-interaction', () => page.waitForURL('**/is-number/6.0.0...7.0.0'));

    const responseAndNavigation = Effect.all(
      [declarations, measurements, navigation, verifyBriefingResponse(page, config)],
      { concurrency: 'unbounded' },
    );

    const waitFiber = yield* Effect.forkChild(responseAndNavigation, { startImmediately: true });

    yield* Effect.yieldNow;
    yield* playwrightCall('browser-interaction', () => page.getByTestId('compare').click());
    yield* Fiber.join(waitFiber);

    yield* waitForComparisonRender(page);
    yield* verifyBriefingRender(page, FIXTURE_BULLET);
  });

const waitForComparisonRender = (page: Page): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* playwrightCall('browser-interaction', () =>
      page.getByRole('heading', { name: 'At a glance', exact: true }).waitFor({ state: 'visible' }),
    );
    yield* waitForOpaqueSurface(page, '.comparison-shell');
  });

const verifyReload = (page: Page): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* playwrightCall('browser-interaction', () => page.reload({ waitUntil: 'domcontentloaded' }));
    yield* waitForComparisonRender(page);
    yield* playwrightCall('browser-interaction', () => page.waitForLoadState('networkidle'));
    yield* verifyBriefingRender(page);
  });

const openHomepage = (page: Page, config: SmokeConfig, screenshot: string): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* playwrightCall('browser-interaction', () =>
      page.goto(config.frontendOrigin.href, { waitUntil: 'domcontentloaded' }),
    );
    yield* playwrightCall('browser-interaction', () =>
      page
        .getByRole('heading', { name: 'Check what changes before you update an npm package.', exact: true })
        .waitFor(),
    );
    yield* verifyFooter(page, config);
    yield* waitForOpaqueSurface(page, 'h1');
    yield* waitForOpaqueSurface(page, '#package-search');
    yield* playwrightCall('browser-interaction', () => page.screenshot({ path: screenshot, fullPage: true }));
  });

const exercisePage = (
  page: Page,
  config: SmokeConfig,
  output: string,
  outcome: BrowserOutcome,
): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      captureBrowserErrors(page, config, outcome.browserErrors);
      page.setDefaultTimeout(30_000);
    });

    yield* interceptBriefingSubmissions(page, config, outcome);
    yield* openHomepage(page, config, resolve(output, `${outcome.browser}-homepage.png`));
    yield* compare(page, config);
    yield* verifyReload(page);
    yield* verifyFooter(page, config);
    yield* playwrightCall('browser-interaction', () =>
      page.screenshot({ path: resolve(output, `${outcome.browser}-comparison.png`), fullPage: true }),
    );

    if (outcome.browserErrors.total !== 0) return yield* Effect.fail(new SmokeFailure('browser-errors'));
  });

const exerciseBrowser = (
  browser: Browser,
  name: BrowserName,
  config: SmokeConfig,
  output: string,
  outcome: BrowserOutcome,
) =>
  Effect.acquireUseRelease(
    playwrightCall('browser-interaction', () =>
      browser.newContext({ serviceWorkers: 'block', viewport: { width: 1365, height: 900 } }),
    ),
    (context) =>
      Effect.gen(function* () {
        // Routed loopback documents need Chromium's explicit local-network permission for the separate socket port.
        if (config.local && name === 'chromium') {
          yield* playwrightCall('browser-interaction', () =>
            context.grantPermissions(['local-network-access'], { origin: config.frontendOrigin.origin }),
          );
        }

        yield* installScopedBrowserAccess(context, config);

        const page = yield* playwrightCall('browser-interaction', () => context.newPage());

        yield* exercisePage(page, config, output, outcome);
      }),
    (context) => playwrightCall('browser-interaction', () => context.close()).pipe(Effect.asVoid),
  );

export const runBrowser = (
  name: BrowserName,
  config: SmokeConfig,
  output: string,
): Effect.Effect<BrowserOutcome, SmokeFailure> => {
  const outcome: BrowserOutcome = {
    browser: name,
    outcome: 'failed',
    blockedBriefingPosts: 0,
    browserErrors: { total: 0, entries: [] },
  };

  return Effect.acquireUseRelease(
    playwrightCall('configuration-or-response', () => browsers[name].launch({ headless: true })),
    (browser) =>
      Effect.matchEffect(exerciseBrowser(browser, name, config, output, outcome), {
        onFailure: (failure) => {
          const failureStage =
            failure.stage === 'browser-interaction' || failure.stage === 'browser-access'
              ? `browser-${name}-interaction`
              : failure.stage;

          return Effect.succeed({ ...outcome, outcome: 'failed' as const, failureStage });
        },
        onSuccess: () => Effect.succeed({ ...outcome, outcome: 'passed' as const }),
      }),
    (browser) => playwrightCall('configuration-or-response', () => browser.close()).pipe(Effect.asVoid),
  );
};
