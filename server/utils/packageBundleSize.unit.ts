import { Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { bundlephobiaSizeUrl } from '../httpDependencies/bundlephobia/client';
import { getPackageBundleSize } from './packageBundleSize';

const measurements: Record<string, unknown> = {
  '1.0.0': { name: 'widget', version: '1.0.0', size: 100, gzip: 50 },
  '2.0.0': { name: 'widget', version: '2.0.0', size: 250, gzip: 90 },
};

const load = (respond: (version: string) => { status: number; body: unknown }) => {
  const client = HttpClient.make((request) => {
    const requested = decodeURIComponent(new URL(request.url).searchParams.get('package') ?? '');
    const { status, body } = respond(requested.slice(requested.indexOf('@') + 1));
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status })));
  });
  return Effect.runPromise(
    getPackageBundleSize('widget', '1.0.0', '2.0.0').pipe(Effect.provideService(HttpClient.HttpClient, client)),
  );
};

describe('getPackageBundleSize', () => {
  it('reports the measurement of each requested version', async () => {
    expect(await load((version) => ({ status: 200, body: measurements[version] }))).toMatchObject({
      from: { status: 'available', name: 'widget', version: '1.0.0', size: 100, gzip: 50 },
      to: { status: 'available', name: 'widget', version: '2.0.0', size: 250, gzip: 90 },
    });
  });

  it.each([
    { label: 'a failed build', status: 503, body: { message: 'Build unavailable' } },
    {
      label: 'a measurement for another version',
      status: 200,
      body: { name: 'widget', version: '9.0.0', size: 100, gzip: 50 },
    },
  ])('reports unavailable evidence for $label without affecting the other version', async ({ status, body }) => {
    const result = await load((version) =>
      version === '1.0.0' ? { status, body } : { status: 200, body: measurements['2.0.0'] },
    );
    expect(result).toMatchObject({
      from: {
        provider: 'bundlephobia',
        url: bundlephobiaSizeUrl('widget', '1.0.0'),
        status: 'unavailable',
        size: null,
        gzip: null,
      },
      to: { provider: 'bundlephobia', url: bundlephobiaSizeUrl('widget', '2.0.0'), status: 'available', size: 250 },
    });
  });
});
