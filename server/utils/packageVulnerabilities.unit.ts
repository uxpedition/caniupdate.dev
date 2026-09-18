import { Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getPackageVulnerabilities as lookupVulnerabilities } from './packageVulnerabilities';

let getPackageVulnerabilities: typeof lookupVulnerabilities;
beforeEach(async () => {
  // Reload the module boundary so each test owns fresh process-local caches.
  vi.resetModules();
  ({ getPackageVulnerabilities } = await import('./packageVulnerabilities'));
});
afterEach(() => vi.useRealTimers());

const modified = '2026-03-13T22:11:31.390433Z';
const match = (id: string) => ({ id, modified });

function run(batch: unknown, details: Record<string, unknown> = {}, batchStatus = 200) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);
      calls.push({
        method: request.method,
        url: request.url,
        body: request.method === 'POST' ? yield* Effect.promise(() => webRequest.json()) : undefined,
      });
      const isBatch = request.method === 'POST';
      const id = decodeURIComponent(request.url.slice(request.url.lastIndexOf('/') + 1));
      const body = isBatch ? batch : details[id];
      return HttpClientResponse.fromWeb(
        request,
        Response.json(body ?? { message: 'unavailable' }, { status: isBatch ? batchStatus : body ? 200 : 503 }),
      );
    }),
  );

  return {
    calls,
    result: Effect.runPromise(
      getPackageVulnerabilities('minimist', '0.0.8', '1.2.8').pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      ),
    ),
  };
}

describe('getPackageVulnerabilities', () => {
  it('refreshes advisory membership at the five-minute boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    expect(await run({ results: [{}, {}] }).result).toMatchObject({ from: { count: 0 } });
    vi.setSystemTime(299_999);
    const beforeExpiry = run({ results: [{ vulns: [match('NEW')] }, {}] }, { NEW: { id: 'NEW', modified } });
    expect(await beforeExpiry.result).toMatchObject({ from: { count: 0 } });
    expect(beforeExpiry.calls).toEqual([]);
    vi.setSystemTime(300_000);
    const expired = run({ results: [{ vulns: [match('NEW')] }, {}] }, { NEW: { id: 'NEW', modified } });
    expect(await expired.result).toMatchObject({ from: { count: 1, advisories: [{ id: 'NEW' }] } });
  });

  it('does not retain failed or incomplete advisory coverage', async () => {
    expect(await run({}, {}, 503).result).toMatchObject({ from: { status: 'unavailable' } });
    expect(await run({ results: [{ vulns: [match('A')] }, {}] }).result).toMatchObject({ from: { status: 'partial' } });
    expect(await run({ results: [{ vulns: [match('A')] }, {}] }, { A: { id: 'A', modified } }).result).toMatchObject({
      from: { status: 'available', count: 1, advisories: [{ id: 'A', detailsStatus: 'available' }] },
    });
  });

  it('queries both versions once and shares unique detail requests without mixing version membership', async () => {
    const { calls, result } = run(
      { results: [{ vulns: [match('A'), match('B'), match('B')] }, { vulns: [match('B'), match('C')] }] },
      {
        A: { id: 'A', modified, summary: 'Old version only' },
        B: {
          id: 'B',
          modified,
          aliases: ['CVE-example'],
          summary: 'Shared finding',
          severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
          references: [{ type: 'ADVISORY', url: 'https://example.com/advisory' }],
          affected: [
            {
              package: { name: 'minimist', ecosystem: 'npm' },
              ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
            },
            { package: { name: 'unrelated', ecosystem: 'npm' }, versions: ['9.0.0'] },
            { package: { name: 'minimist', ecosystem: 'PyPI' }, versions: ['9.0.0'] },
          ],
        },
        C: { id: 'C', modified, withdrawn: modified },
      },
    );
    const comparison = await result;

    expect(calls[0]).toEqual({
      method: 'POST',
      url: 'https://api.osv.dev/v1/querybatch',
      body: {
        queries: [
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '0.0.8' },
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.8' },
        ],
      },
    });
    expect(
      calls
        .slice(1)
        .map(({ url }) => url)
        .sort(),
    ).toEqual(['A', 'B', 'C'].map((id) => `https://api.osv.dev/v1/vulns/${id}`));
    expect(comparison.from).toMatchObject({ status: 'available', count: 2, advisories: [{ id: 'A' }, { id: 'B' }] });
    expect(comparison.to).toMatchObject({
      status: 'available',
      count: 1,
      advisories: [{ id: 'B', aliases: ['CVE-example'] }],
    });
    expect(comparison.to.advisories[0]).toMatchObject({
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
      references: [{ type: 'ADVISORY', url: 'https://example.com/advisory' }],
      affected: [
        {
          package: { name: 'minimist', ecosystem: 'npm' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
        },
      ],
    });
  });

  it('returns zero for empty version results without requesting details', async () => {
    const { calls, result } = run({ results: [{}, { vulns: [] }] });
    expect(await result).toEqual({
      from: { status: 'available', count: 0, advisories: [] },
      to: { status: 'available', count: 0, advisories: [] },
    });
    expect(calls).toHaveLength(1);
  });

  it('retains batch matches when details fail without affecting the clean version', async () => {
    const { calls, result } = run({ results: [{ vulns: [match('A')] }, {}] });
    expect(await result).toMatchObject({
      from: { status: 'partial', count: 1, advisories: [{ id: 'A', detailsStatus: 'unavailable' }] },
      to: { status: 'available', count: 0, advisories: [] },
    });
    expect(calls).toHaveLength(2);
  });

  it('does not turn a failed batch into zero counts', async () => {
    const { calls, result } = run({ error: 'rate limited' }, {}, 429);
    expect(await result).toEqual({
      from: { status: 'unavailable', count: null, advisories: [] },
      to: { status: 'unavailable', count: null, advisories: [] },
    });
    expect(calls).toHaveLength(1);
  });

  it('distinguishes a missing batch result from a successful empty result', async () => {
    const { result } = run({ results: [{}] });
    expect(await result).toMatchObject({
      from: { status: 'available', count: 0 },
      to: { status: 'unavailable', count: null },
    });
  });

  it('marks paginated results partial without making another batch request', async () => {
    const { calls, result } = run({ results: [{ next_page_token: 'more' }, {}] });
    expect(await result).toMatchObject({
      from: { status: 'partial', count: 0 },
      to: { status: 'available', count: 0 },
    });
    expect(calls).toHaveLength(1);
  });
});
