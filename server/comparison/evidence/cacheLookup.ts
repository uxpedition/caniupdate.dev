import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { HttpClient } from 'effect/http';

import type { RegistryVersionManifest } from '../../../shared/comparison/package/package.defs';
import {
  EvidenceCollectionError,
  toEvidenceCacheFailure,
  toPackageEvidenceFailure,
  type PackageEvidenceFailure,
} from './errors';
import type { ComparisonEvidenceCacheOptions, ComparisonEvidenceServices } from './services';

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

export const runCached = <T>(
  key: string,
  effect: Effect.Effect<T, unknown, HttpClient.HttpClient>,
  services: ComparisonEvidenceServices | undefined,
  options: ComparisonEvidenceCacheOptions<T>,
): Effect.Effect<T, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const cache = services?.cache;

  if (cache === undefined) {
    return effect.pipe(
      Effect.mapError(toPackageEvidenceFailure),
      Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
    );
  }

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* Effect.tryPromise({
      try: () =>
        cache.load(
          key,
          () =>
            Effect.runPromise(
              effect.pipe(
                Effect.provideService(HttpClient.HttpClient, client),
                Effect.mapError(toPackageEvidenceFailure),
                Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
              ),
            ),
          options,
        ),
      catch: toEvidenceCacheFailure,
    });
  });
};
