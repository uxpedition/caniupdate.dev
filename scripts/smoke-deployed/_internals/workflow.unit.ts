import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeFileSystem } from '@effect/platform-node';
import { Cause, ConfigProvider, Deferred, Effect, Exit, Fiber } from 'effect';
import { HttpClient } from 'effect/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSmoke } from './workflow.ts';

const environment = {
  SMOKE_LOCAL: 'true',
  PREVIEW_ORIGIN: 'http://localhost:5173',
  PREVIEW_SOCKET_ORIGIN: 'ws://localhost:8791',
  PREVIEW_EXPECTED_SHA: 'a'.repeat(40),
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'deployed-smoke-report-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('deployed verification report lifetime', () => {
  it('writes a sanitized, owner-only report for invalid configuration', async () => {
    const exit = await Effect.runPromise(
      runSmoke(directory).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({})),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.never),
        ),
        Effect.exit,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))).toEqual({
      outcome: 'failed',
      browsers: [],
      failureStage: 'configuration',
    });
    expect((await stat(join(directory, 'report.json'))).mode & 0o077).toBe(0);
  });

  it('publishes failure evidence when cancelled during an outstanding HTTP request', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const requested = yield* Deferred.make<void>();
        const client = HttpClient.make(() => Deferred.succeed(requested, undefined).pipe(Effect.andThen(Effect.never)));

        const fiber = yield* Effect.forkChild(
          runSmoke(directory).pipe(
            Effect.provide(NodeFileSystem.layer),
            Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(environment)),
            Effect.provideService(HttpClient.HttpClient, client),
          ),
        );

        yield* Deferred.await(requested);
        yield* Fiber.interrupt(fiber);
      }),
    );
    expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))).toMatchObject({
      outcome: 'failed',
      commitSha: environment.PREVIEW_EXPECTED_SHA,
      failureStage: 'interrupted',
      browsers: [],
    });
  });

  it('records a sanitized defect without leaking its details into the report', async () => {
    const exit = await Effect.runPromise(
      runSmoke(directory).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(environment)),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die(new Error('private-fixture-detail'))),
        ),
        Effect.exit,
      ),
    );

    expect(Exit.hasDies(exit)).toBe(true);
    const report = await readFile(join(directory, 'report.json'), 'utf8');
    expect(JSON.parse(report)).toMatchObject({ outcome: 'failed', failureStage: 'configuration-or-response' });
    expect(report).not.toContain('private-fixture-detail');
  });

  it('fails the workflow when its report cannot be written', async () => {
    const file = join(directory, 'not-a-directory');
    await writeFile(file, 'occupied');

    const exit = await Effect.runPromise(
      runSmoke(file).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({})),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.never),
        ),
        Effect.exit,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain('Smoke failed at report-write');
  });
});
