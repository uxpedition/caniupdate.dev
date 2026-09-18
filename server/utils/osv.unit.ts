import { Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';

import { getVulnerability, queryBatch } from './osv';

/** Runs an OSV effect against a stub client that replies with `body`, capturing outgoing request URLs. */
function runWithStub<T, E>(effect: Effect.Effect<T, E, HttpClient.HttpClient>, body: unknown, status = 200) {
  const urls: Array<string> = [];

  const client = HttpClient.make((request) => {
    urls.push(request.url);
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status })));
  });

  return {
    urls,
    result: Effect.runPromise(effect.pipe(Effect.provideService(HttpClient.HttpClient, client))),
  };
}

const request = {
  queries: ['0.0.8', '1.2.5', '1.2.8'].map((version) => ({
    package: { name: 'minimist', ecosystem: 'npm' as const },
    version,
  })),
};

describe('queryBatch', () => {
  it('preserves empty result positions and per-query continuation tokens', async () => {
    const { result } = runWithStub(queryBatch(request), {
      results: [
        { vulns: [{ id: 'GHSA-vh95-rmgr-6w4m', modified: '2026-03-13T22:11:31.390433Z' }] },
        {},
        { next_page_token: 'next-page' },
      ],
    });
    const response = await result;

    expect(response.results[1]).toEqual({});
    expect(response.results[2]).toEqual({ next_page_token: 'next-page' });
    expect(response.results[0]?.vulns?.[0]?.modified).toBe('2026-03-13T22:11:31.390433Z');
  });

  it('rejects HTTP failures even when their body looks like a successful empty result', async () => {
    const { result } = runWithStub(queryBatch(request), { results: [{}, {}, {}] }, 429);

    await expect(result).rejects.toMatchObject({ _tag: 'HttpClientError' });
  });

  it('rejects malformed advisory records instead of treating them as no matches', async () => {
    const { result } = runWithStub(queryBatch(request), { results: [{ vulns: [{ id: 42 }] }, {}, {}] });

    await expect(result).rejects.toMatchObject({ _tag: 'SchemaError' });
  });
});

const advisory = {
  schema_version: '1.7.3',
  id: 'GHSA-vh95-rmgr-6w4m',
  modified: '2026-03-13T22:11:31.390433Z',
  published: '2022-03-02T00:00:00Z',
  aliases: ['CVE-2020-7598'],
  related: ['CVE-2021-44906'],
  summary: 'Prototype Pollution in minimist',
  details: 'Upgrade to versions 0.2.1, 1.2.3 or later.',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L' }],
  affected: [
    {
      package: { ecosystem: 'npm', name: 'minimist', purl: 'pkg:npm/minimist' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '0.2.1' }] }],
    },
  ],
  references: [{ type: 'ADVISORY', url: 'https://github.com/advisories/GHSA-vh95-rmgr-6w4m' }],
  database_specific: { cwe_ids: ['CWE-1321'], severity: 'HIGH' },
};

describe('getVulnerability', () => {
  it('requests the advisory endpoint and preserves aliases, severity and range events', async () => {
    const { urls, result } = runWithStub(getVulnerability('GHSA-vh95-rmgr-6w4m'), advisory);
    const vulnerability = await result;

    expect(urls).toEqual(['https://api.osv.dev/v1/vulns/GHSA-vh95-rmgr-6w4m']);
    expect(vulnerability.aliases).toEqual(['CVE-2020-7598']);
    expect(vulnerability.related).toEqual(['CVE-2021-44906']);
    expect(vulnerability.severity?.[0]?.score).toBe('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L');
    expect(vulnerability.affected?.[0]?.ranges?.[0]?.events).toEqual([{ introduced: '0' }, { fixed: '0.2.1' }]);
    expect(vulnerability.affected?.[0]?.package.name).toBe('minimist');
    expect(vulnerability.withdrawn).toBeUndefined();
  });

  it('rejects unknown advisory ids instead of returning an empty record', async () => {
    const { result } = runWithStub(getVulnerability('GHSA-0000-0000-0000'), { code: 5, message: 'not found' }, 404);

    await expect(result).rejects.toMatchObject({ _tag: 'HttpClientError' });
  });

  it('rejects advisory records whose affected entries are malformed', async () => {
    const { result } = runWithStub(getVulnerability('GHSA-vh95-rmgr-6w4m'), {
      id: 'GHSA-vh95-rmgr-6w4m',
      modified: '2026-03-13T22:11:31.390433Z',
      affected: { package: { ecosystem: 'npm', name: 'minimist' } },
    });

    await expect(result).rejects.toMatchObject({ _tag: 'SchemaError' });
  });
});
