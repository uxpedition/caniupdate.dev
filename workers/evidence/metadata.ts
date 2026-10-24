import { Effect, Schema } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

import type { ArchiveAdmission, ComparisonEvidenceCache } from '../../server/comparison/evidence/services';
import { getRegistryJson } from '../../server/httpDependencies/npm/registry';
import {
  ParsedPackageMetadataSchema,
  RegistryPackageMetadataSchema,
  toPackageMetadata,
} from '../../shared/comparison/package/package.defs';

const METADATA_TTL_MS = 30 * 60 * 1000;

/** One package object shares successful metadata across callers; failed refreshes never become cached values. */
export function getCachedPackageMetadata(
  cache: ComparisonEvidenceCache,
  packageName: string,
  admission: ArchiveAdmission,
) {
  return cache.load(
    `package-metadata-v1:${packageName}`,
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* getRegistryJson(`/${encodeURIComponent(packageName)}`, {
            accept: 'application/vnd.npm.install-v1+json',
          });

          const decoded = yield* Schema.decodeUnknownEffect(RegistryPackageMetadataSchema)(response);

          if (decoded.name !== packageName) return yield* Effect.fail(new Error('Registry package identity mismatch'));

          return toPackageMetadata(decoded);
        }).pipe(
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          Effect.provide(FetchHttpClient.layer),
          (load) => admission.withPermit(load),
        ),
      ),
    {
      ttlMs: METADATA_TTL_MS,
      cacheable: () => true,
      isValid: Schema.is(
        ParsedPackageMetadataSchema.check(Schema.makeFilter((metadata) => metadata.name === packageName)),
      ),
    },
  );
}
