import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { ConfigProvider, Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { runSmoke } from './_internals/workflow.ts';

const OUTPUT_DIRECTORY = resolve(fileURLToPath(new URL('../..', import.meta.url)), '.data/preview-verification');

const workflow = runSmoke(OUTPUT_DIRECTORY).pipe(
  Effect.provide(FetchHttpClient.layer),
  // Access redirects must be inspected, not followed with service-token headers.
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))),
  Effect.provide(NodeFileSystem.layer),
);

NodeRuntime.runMain(workflow);
