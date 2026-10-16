import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { HttpClient } from 'effect/http';

import type { RegistryVersionManifest } from '../../../shared/comparison/package/package.defs';
import type { TelemetryProviderSchema } from '../../../shared/telemetry/telemetryFields';
import {
  EvidenceCollectionError,
  EvidenceStorageCorruptionError,
  EvidenceStorageError,
  evidenceStorageDiagnostic,
  toEvidenceCacheFailure,
  toPackageEvidenceFailure,
  type PackageEvidenceFailure,
} from './errors';
import type {
  ComparisonEvidenceCacheDecision,
  ComparisonEvidenceCacheOptions,
  ComparisonEvidenceServices,
} from './services';

type EvidenceProvider = typeof TelemetryProviderSchema.Type;

// Each identity is a closed object built at one call site; the github key serializes whole manifests so every
// field the release-note lookup depends on contributes to the digest.
type CacheIdentity =
  | { readonly revision: string; readonly packageName: string; readonly version: string }
  | {
      readonly revision: string;
      readonly packageName: string;
      readonly fromVersion: string;
      readonly toVersion: string;
    }
  | { readonly revision: string; readonly integrity: { readonly algorithm: string; readonly value: string } }
  | {
      readonly revision: string;
      readonly packageName: string;
      readonly from: RegistryVersionManifest;
      readonly to: RegistryVersionManifest;
    };

export const cacheKey = (scope: string, input: CacheIdentity): string => {
  const serialized = JSON.stringify(input);
  const digest = createHash('sha256').update(serialized).digest('hex');

  return `${scope}:${digest}`;
};

/**
 * Runs one provider lookup through the caller's cache. The loader inherits the caller's context so logs and spans
 * from providers reach the configured export; without a cache the provider runs directly on the ambient client.
 */
export const runCached = <T>(
  provider: EvidenceProvider,
  key: string,
  effect: Effect.Effect<T, unknown, HttpClient.HttpClient>,
  services: ComparisonEvidenceServices | undefined,
  options: ComparisonEvidenceCacheOptions<T>,
): Effect.Effect<T, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const cache = services?.cache;

  // Loader defects are unexpected collection failures; typed provider failures keep their evidence classification.
  if (cache === undefined) {
    return effect.pipe(
      Effect.mapError(toPackageEvidenceFailure),
      Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
    );
  }

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const context = yield* Effect.context<never>();
    // The cache reports at most one decision per lookup; a lookup that fails before deciding reports none.
    let decision: ComparisonEvidenceCacheDecision | undefined;

    const loaded = Effect.tryPromise({
      try: () =>
        cache.load(
          key,
          () =>
            Effect.runPromiseWith(context)(
              effect.pipe(
                Effect.provideService(HttpClient.HttpClient, client),
                Effect.mapError(toPackageEvidenceFailure),
                Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
              ),
            ),
          {
            ...options,
            observe: (observed) => {
              decision = observed;
            },
          },
        ),
      catch: toEvidenceCacheFailure,
    });

    // This caller owns the lookup: it reports a storage failure once and the decision it observed.
    return yield* loaded.pipe(
      Effect.tapError((cause) =>
        cause instanceof EvidenceStorageError || cause instanceof EvidenceStorageCorruptionError
          ? Effect.logError('evidence.storage.failed').pipe(
              Effect.annotateLogs({ provider, outcome: 'failure', ...evidenceStorageDiagnostic(cause) }),
            )
          : Effect.void,
      ),
      Effect.ensuring(
        Effect.suspend(() =>
          decision === undefined
            ? Effect.void
            : Effect.logInfo('evidence.cache.decision').pipe(Effect.annotateLogs({ provider, outcome: decision })),
        ),
      ),
    );
  });
};
