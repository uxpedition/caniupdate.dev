// The smoke scenario's shared contract: identity fixtures, port offsets, timing budgets, the submission envelope the
// route promises, and the failure/assert/log vocabulary every helper shares. The values live here so the entrypoint,
// the launcher, the submission flow, and the CPU sampler cannot drift apart.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

export const root = fileURLToPath(new URL('../../..', import.meta.url));
export const devVarsPath = join(root, 'workers', 'briefing', '.dev.vars');
export const builtFrontendConfig = join(root, '.output', 'server', 'wrangler.json');

export const PACKAGE_NAME = 'minimist';
export const SETTLED_FROM = '1.2.5';
export const SETTLED_TO = '1.2.8';
/** A second pair, so `--measure` can time a cold generation instead of the D1 hit the scenario settles. */
export const COLD_FROM = '1.2.5';
export const COLD_TO = '1.2.6';
/** A third pair, generated for the device-shaped Origin check, so `--measure`'s cold pair stays cold. */
export const REMOTE_FROM = '1.2.7';
export const REMOTE_TO = '1.2.8';
/** A larger package for `--measure`: the frontend re-serializes the whole bounded packet on every POST. */
export const LARGE_PACKAGE_NAME = 'vue';
export const LARGE_FROM = '3.4.38';
export const LARGE_TO = '3.5.13';

/** Offset from the documented 8790/8791/5173 so the scenario can run beside a live development session. */
export const EVIDENCE_PORT = 8890;
export const BRIEFING_PORT = 8891;
export const FRONTEND_PORT = 5273;
/** Offset from the documented 9230, so a live session's inspector ports stay free. */
export const INSPECTOR_BASE = 9330;

export const FRONTEND_ORIGIN = `http://localhost:${FRONTEND_PORT}`;
export const HASH_PATH = /^\/api\/briefings\/([0-9a-f]{64})\/events$/;

export const HEALTH_TIMEOUT_MS = 180_000;
export const SUBSCRIPTION_TIMEOUT_MS = 120_000;
export const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * The submission envelope the route promises, decoded strictly with the same library the application uses: the
 * scenario asserts the wire contract instead of trusting whatever the route happened to answer.
 */
export const SubmissionSchema = Schema.Struct({
  status: Schema.Literals(['available', 'queued', 'running']),
  packageName: Schema.String,
  from: Schema.String,
  to: Schema.String,
  eventsUrl: Schema.optional(Schema.String),
  hash: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Natural),
});

export type BriefingSubmission = typeof SubmissionSchema.Type;

export const decodeSubmission = Schema.decodeUnknownSync(SubmissionSchema, { errors: 'all' });

/** Every assertion failure in this scenario carries the command and the observed output, never just a verdict. */
export class SmokeFailure extends Error {
  override readonly name = 'SmokeFailure';
}

export const check = (condition: boolean, message: string): void => {
  if (!condition) throw new SmokeFailure(message);
};

export const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};
