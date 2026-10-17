import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { describe, expect, it } from 'vitest';

import { deploymentRateLimitConfig, withRateLimitConfig } from './rateLimitConfig.ts';

const runWithNodeServices = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));

describe('stage rate binding configuration', () => {
  it('separates local and stage counters while preserving runtime files outside the artifact', () => {
    const config = Effect.runSync(
      deploymentRateLimitConfig(
        {
          main: 'index.mjs',
          assets: { directory: '../public', binding: 'ASSETS' },
          ratelimits: [{ name: 'PUBLIC_RATE_LIMITER', namespace_id: '1001', simple: { limit: 60, period: 60 } }],
          env: {
            preview: {
              name: 'can-i-update-preview',
              d1_databases: [{ binding: 'DB', migrations_dir: '../../migrations' }],
            },
          },
        },
        '/artifact/server',
        'PUBLIC_RATE_LIMITER',
        90,
      ),
    );

    expect(config.env.preview.ratelimits).toEqual([
      { name: 'PUBLIC_RATE_LIMITER', namespace_id: '2001', simple: { limit: 90, period: 60 } },
    ]);
    expect(config.main).toBe('/artifact/server/index.mjs');
    expect(config.assets?.directory).toBe('/artifact/public');
    expect(config.env.preview.d1_databases?.[0]?.migrations_dir).toBe('/migrations');
  });

  it('does not alter the source config and removes the temporary override when deployment fails', async () => {
    const source = 'workers/briefing/wrangler.jsonc';
    const before = await readFile(source, 'utf8');
    let temporary = '';
    const failure = new Error('fixture deployment failure');
    const program = withRateLimitConfig(source, 'BRIEFING_GENERATION_LIMITER', 2, (path) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        temporary = path;
        expect(path).not.toContain(resolve('.'));
        expect(yield* fs.readFileString(path, 'utf8')).toContain('"namespace_id":"2002"');

        return yield* Effect.fail(failure);
      }),
    );

    await expect(runWithNodeServices(program)).rejects.toBe(failure);
    expect(await readFile(source, 'utf8')).toBe(before);
    await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
