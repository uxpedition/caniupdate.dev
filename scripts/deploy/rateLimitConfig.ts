import { dirname, join, resolve } from 'node:path';

import { Data, Effect, FileSystem, Schema } from 'effect';
import ts from 'typescript';

import type { DeploymentTarget } from './runtimeSettings.ts';

const RateLimitBindingSchema = Schema.Literals(['PUBLIC_RATE_LIMITER', 'BRIEFING_GENERATION_LIMITER']);

export type RateLimitBinding = typeof RateLimitBindingSchema.Type;

const WRANGLER_ENVIRONMENT: Record<DeploymentTarget, 'stage' | 'production'> = {
  stage: 'stage',
  production: 'production',
};

// Cloudflare requires account-unique namespace IDs; bindings are not inherited by Wrangler environments.
// Sources: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
//          https://developers.cloudflare.com/workers/wrangler/environments/
const RATE_LIMIT_NAMESPACE_IDS: Record<DeploymentTarget, Record<RateLimitBinding, string>> = {
  stage: { PUBLIC_RATE_LIMITER: '2001', BRIEFING_GENERATION_LIMITER: '2002' },
  production: { PUBLIC_RATE_LIMITER: '3001', BRIEFING_GENERATION_LIMITER: '3002' },
};

const Extras = Schema.Record(Schema.String, Schema.Json);

const RateLimitEntrySchema = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    namespace_id: Schema.String,
    simple: Schema.optionalKey(
      Schema.StructWithRest(Schema.Struct({ limit: Schema.Number, period: Schema.Number }), [Extras]),
    ),
  }),
  [Extras],
);

const WorkerFields = {
  main: Schema.optionalKey(Schema.String),
  base_dir: Schema.optionalKey(Schema.String),
  assets: Schema.optionalKey(
    Schema.StructWithRest(Schema.Struct({ directory: Schema.optionalKey(Schema.String) }), [Extras]),
  ),
  d1_databases: Schema.optionalKey(
    Schema.Array(Schema.StructWithRest(Schema.Struct({ migrations_dir: Schema.optionalKey(Schema.String) }), [Extras])),
  ),
  ratelimits: Schema.optionalKey(Schema.Array(RateLimitEntrySchema)),
};

const WorkerConfigSchema = Schema.StructWithRest(Schema.Struct(WorkerFields), [Extras]);

const ConfigSchema = Schema.StructWithRest(
  Schema.Struct({
    ...WorkerFields,
    env: Schema.StructWithRest(
      Schema.Struct({
        stage: WorkerConfigSchema,
        production: Schema.optionalKey(WorkerConfigSchema),
      }),
      [Extras],
    ),
  }),
  [Extras],
);

export type DeploymentRateLimitConfig = typeof ConfigSchema.Type;

const relocateWorkerConfig = (worker: typeof WorkerConfigSchema.Type, directory: string) => {
  const relocated = { ...worker };

  if (worker.main !== undefined) relocated.main = resolve(directory, worker.main);

  if (worker.base_dir !== undefined) relocated.base_dir = resolve(directory, worker.base_dir);

  if (worker.assets?.directory !== undefined) {
    relocated.assets = { ...worker.assets, directory: resolve(directory, worker.assets.directory) };
  }

  if (worker.d1_databases !== undefined) {
    relocated.d1_databases = worker.d1_databases.map((database) => {
      const relocatedDatabase = { ...database };

      if (database.migrations_dir !== undefined) {
        relocatedDatabase.migrations_dir = resolve(directory, database.migrations_dir);
      }

      return relocatedDatabase;
    });
  }

  return relocated;
};

export class RateLimitConfigFailure extends Data.TaggedError('RateLimitConfigFailure')<{
  readonly message: string;
}> {}

export function deploymentRateLimitConfig(
  input: Schema.Json,
  directory: string,
  target: DeploymentTarget,
  binding: RateLimitBinding,
  limit: number,
): Effect.Effect<DeploymentRateLimitConfig, RateLimitConfigFailure> {
  return Effect.gen(function* () {
    const config = yield* Schema.decodeUnknownEffect(ConfigSchema, { errors: 'all' })(input).pipe(
      Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })),
    );

    const environment = WRANGLER_ENVIRONMENT[target];
    const environmentConfig = config.env[environment];

    if (environmentConfig === undefined) {
      return yield* Effect.fail(new RateLimitConfigFailure({ message: `Missing Wrangler ${environment} environment` }));
    }

    return {
      ...relocateWorkerConfig(config, directory),
      env: {
        ...config.env,
        [environment]: {
          ...relocateWorkerConfig(environmentConfig, directory),
          ratelimits: [
            {
              name: binding,
              namespace_id: RATE_LIMIT_NAMESPACE_IDS[target][binding],
              simple: { limit, period: 60 },
            },
          ],
        },
      },
    } satisfies DeploymentRateLimitConfig;
  });
}

const readRateLimitSource = Effect.fnUntraced(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;

  const contents = yield* fs
    .readFileString(source, 'utf8')
    .pipe(Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })));

  const parsed = ts.parseConfigFileTextToJson(source, contents);

  if (parsed.error) {
    return yield* Effect.fail(new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' }));
  }

  return yield* Schema.decodeUnknownEffect(Schema.Json, { errors: 'all' })(parsed.config).pipe(
    Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })),
  );
});

export function withRateLimitConfig<A, E, R>(
  source: string,
  target: DeploymentTarget,
  binding: RateLimitBinding,
  limit: number,
  deploy: (path: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, RateLimitConfigFailure | E, FileSystem.FileSystem | R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const json = yield* readRateLimitSource(source);
      const config = yield* deploymentRateLimitConfig(json, dirname(resolve(source)), target, binding, limit);

      const directory = yield* fs
        .makeTempDirectoryScoped({ prefix: 'can-i-update-rate-config-' })
        .pipe(
          Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })),
        );

      const path = join(directory, 'wrangler.json');

      yield* fs
        .chmod(directory, 0o700)
        .pipe(
          Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })),
        );

      yield* fs
        .writeFileString(path, JSON.stringify(config), { mode: 0o600 })
        .pipe(
          Effect.mapError(() => new RateLimitConfigFailure({ message: 'Invalid Worker deployment configuration' })),
        );

      return yield* deploy(path);
    }),
  );
}
