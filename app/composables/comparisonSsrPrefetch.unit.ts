import { QueryClient } from '@tanstack/vue-query';
import { mockEvent } from 'h3';
import type { H3Event } from 'h3';
import { describe, expect, it, vi } from 'vitest';

import type { StoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';

import { prefetchStoredComparison } from './comparisonSsrPrefetch';
import { packageBriefingQueryKey } from './packageBriefingQueryOptions';

const PACKAGE = 'minimist';

const FROM = '1.0.0';

const TO = '2.0.0';

const storedSuccess: StoredBriefingResult = {
  status: 'available',
  packageName: PACKAGE,
  from: FROM,
  to: TO,
  briefing: {
    status: 'available',
    model: 'test-model',
    bullets: [{ kind: 'change', basis: 'fact', text: 'The package changed.', evidenceNumbers: [0] }],
    sources: [{ number: 0, id: 'release', kind: 'fact', label: 'Release notes', urls: [], text: 'Evidence.' }],
  },
};

const missing: StoredBriefingResult = { status: 'missing', packageName: PACKAGE, from: FROM, to: TO };

type PrefetchFixture = {
  readonly readStoredBriefing: () => Promise<StoredBriefingResult>;
  readonly prefetchMeasurements: () => Promise<boolean>;
  readonly queryClient: QueryClient;
  readonly event: Pick<H3Event, 'context'>;
};

const createPrefetchFixture = (storedResult: StoredBriefingResult | Error, measurementsSucceed = true) => {
  const readStoredBriefing = vi.fn(async (): Promise<StoredBriefingResult> => {
    if (storedResult instanceof Error) throw storedResult;

    return storedResult;
  });

  const prefetchMeasurements = vi.fn(async () => measurementsSucceed);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const event = mockEvent('http://localhost/minimist/1.0.0...2.0.0');

  return { readStoredBriefing, prefetchMeasurements, queryClient, event };
};

const runPrefetch = (fixture: PrefetchFixture) =>
  prefetchStoredComparison({
    ...fixture,
    packageName: PACKAGE,
    from: FROM,
    to: TO,
  });

describe('prefetchStoredComparison', () => {
  it('hydrates a stored success and enables edge caching only after measurements succeed', async () => {
    const fixture = createPrefetchFixture(storedSuccess);

    try {
      await runPrefetch(fixture);

      expect(fixture.queryClient.getQueryData(packageBriefingQueryKey(PACKAGE, FROM, TO))).toEqual({
        packageName: PACKAGE,
        from: FROM,
        to: TO,
        briefing: storedSuccess.briefing,
      });
      expect(fixture.event.context.comparisonHtmlCacheable).toBe(true);
      expect(fixture.readStoredBriefing).toHaveBeenCalledTimes(1);
      expect(fixture.prefetchMeasurements).toHaveBeenCalledTimes(1);
    } finally {
      fixture.queryClient.clear();
    }
  });

  it('leaves a stored miss unhydrated and does not prefetch measurements', async () => {
    const fixture = createPrefetchFixture(missing);

    try {
      await runPrefetch(fixture);

      expect(fixture.queryClient.getQueryData(packageBriefingQueryKey(PACKAGE, FROM, TO))).toBeUndefined();
      expect(fixture.event.context.comparisonHtmlCacheable).toBeUndefined();
      expect(fixture.readStoredBriefing).toHaveBeenCalledTimes(1);
      expect(fixture.prefetchMeasurements).not.toHaveBeenCalled();
    } finally {
      fixture.queryClient.clear();
    }
  });

  it('keeps the briefing visible but opts out when SSR measurements fail', async () => {
    const fixture = createPrefetchFixture(storedSuccess, false);

    try {
      await runPrefetch(fixture);

      expect(fixture.queryClient.getQueryData(packageBriefingQueryKey(PACKAGE, FROM, TO))).toMatchObject({
        briefing: storedSuccess.briefing,
      });
      expect(fixture.event.context.comparisonHtmlCacheable).toBeUndefined();
      expect(fixture.prefetchMeasurements).toHaveBeenCalledTimes(1);
    } finally {
      fixture.queryClient.clear();
    }
  });

  it('fails closed on stored-result read errors and identity mismatches', async () => {
    const readFailure = createPrefetchFixture(new Error('storage unavailable'));
    const wrongIdentity = createPrefetchFixture({ ...storedSuccess, to: '9.9.9' });
    const fixtures = [readFailure, wrongIdentity];

    try {
      for (const fixture of fixtures) await runPrefetch(fixture);

      for (const fixture of fixtures) {
        expect(fixture.queryClient.getQueryData(packageBriefingQueryKey(PACKAGE, FROM, TO))).toBeUndefined();
        expect(fixture.event.context.comparisonHtmlCacheable).toBeUndefined();
        expect(fixture.prefetchMeasurements).not.toHaveBeenCalled();
      }
    } finally {
      for (const fixture of fixtures) fixture.queryClient.clear();
    }
  });
});
