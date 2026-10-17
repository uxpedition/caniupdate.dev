import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { Schema } from 'effect';
import ts from 'typescript';

type RateLimitBinding = 'PUBLIC_RATE_LIMITER' | 'BRIEFING_GENERATION_LIMITER';

const Extras = Schema.Record(Schema.String, Schema.Unknown);

const WorkerFields = {
  main: Schema.optionalKey(Schema.String),
  base_dir: Schema.optionalKey(Schema.String),
  assets: Schema.optionalKey(
    Schema.StructWithRest(Schema.Struct({ directory: Schema.optionalKey(Schema.String) }), [Extras]),
  ),
  d1_databases: Schema.optionalKey(
    Schema.Array(Schema.StructWithRest(Schema.Struct({ migrations_dir: Schema.optionalKey(Schema.String) }), [Extras])),
  ),
};

const WorkerConfigSchema = Schema.StructWithRest(Schema.Struct(WorkerFields), [Extras]);

const ConfigSchema = Schema.StructWithRest(
  Schema.Struct({
    ...WorkerFields,
    env: Schema.StructWithRest(Schema.Struct({ preview: WorkerConfigSchema }), [Extras]),
  }),
  [Extras],
);

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

/** Preserve relative runtime assets when deploying a temporary config outside the build artifact. */
export const stageRateLimitConfig = (
  input: Schema.Json,
  directory: string,
  binding: RateLimitBinding,
  limit: number,
) => {
  const config = Schema.decodeUnknownSync(ConfigSchema)(input);

  return {
    ...relocateWorkerConfig(config, directory),
    env: {
      ...config.env,
      preview: {
        ...relocateWorkerConfig(config.env.preview, directory),
        ratelimits: [
          {
            name: binding,
            namespace_id: binding === 'PUBLIC_RATE_LIMITER' ? '2001' : '2002',
            simple: { limit, period: 60 },
          },
        ],
      },
    },
  };
};

export async function withRateLimitConfig<Result>(
  source: string,
  binding: RateLimitBinding,
  limit: number,
  deploy: (path: string) => Promise<Result>,
): Promise<Result> {
  const parsed = ts.parseConfigFileTextToJson(source, await readFile(source, 'utf8'));

  if (parsed.error) throw new Error('Invalid Worker deployment configuration');

  const config = stageRateLimitConfig(
    Schema.decodeUnknownSync(Schema.Json)(parsed.config),
    dirname(resolve(source)),
    binding,
    limit,
  );

  const directory = await mkdtemp(join(tmpdir(), 'can-i-update-rate-config-'));

  try {
    const path = join(directory, 'wrangler.json');
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });

    return await deploy(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
