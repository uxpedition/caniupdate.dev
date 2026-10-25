import { Effect, Schema } from 'effect';
import { HttpClient } from 'effect/http';

import { PackageTarballSchema, type PackageTarball } from '../../../shared/comparison/evidence/tarball.defs';
import type { RegistryVersionManifest } from '../../../shared/comparison/package/package.defs';
import { getPackageTarball } from '../../httpDependencies/npm/tarball';
import { analyzeInstallScripts } from '../installScripts/analyze';
import { cacheKey, runCached } from './cacheLookup';
import { toPackageEvidenceFailure, type PackageEvidenceFailure } from './errors';
import type { ComparisonEvidenceServices } from './services';

const ARCHIVE_INSPECTOR_REVISION = 'archive-inspector-v4-install-analysis-v4';

const safeTarballUrl = (url: string): Effect.Effect<boolean> =>
  Effect.try(() => new URL(url)).pipe(
    Effect.map(
      (parsed) =>
        parsed.origin === 'https://registry.npmjs.org' &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.hash === '',
    ),
    Effect.catch(() => Effect.succeed(false)),
  );

const withArchiveAdmission = (
  manifest: RegistryVersionManifest,
  services: ComparisonEvidenceServices | undefined,
): Effect.Effect<PackageTarball, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const inspect = getPackageTarball(manifest, (files, sources) =>
    analyzeInstallScripts(manifest.scripts ?? {}, files, sources),
  ).pipe(Effect.mapError(toPackageEvidenceFailure));

  const admission = services?.archiveAdmission;

  return admission === undefined ? inspect : admission.withPermit(inspect);
};

export const cachedTarball = Effect.fnUntraced(function* (
  manifest: RegistryVersionManifest,
  services?: ComparisonEvidenceServices,
): Effect.fn.Return<PackageTarball, PackageEvidenceFailure, HttpClient.HttpClient> {
  const validUrl = yield* safeTarballUrl(manifest.dist.tarball);

  const inspect = (
    validUrl
      ? withArchiveAdmission(manifest, services)
      : getPackageTarball(manifest, (files, sources) => analyzeInstallScripts(manifest.scripts ?? {}, files, sources))
  ).pipe(Effect.mapError(toPackageEvidenceFailure));

  if (services?.cache === undefined || !validUrl) return yield* inspect;

  return yield* runCached(
    'tarball',
    cacheKey('archive', {
      revision: ARCHIVE_INSPECTOR_REVISION,
      packageName: manifest.name,
      scripts: manifest.scripts ?? {},
      integrity:
        manifest.dist.integrity === undefined
          ? { algorithm: 'sha1', value: manifest.dist.shasum }
          : { algorithm: 'sri', value: manifest.dist.integrity },
    }),
    inspect,
    services,
    {
      ttlMs: null,
      cacheable: (value) => value.status !== 'unavailable',
      isValid: Schema.is(PackageTarballSchema),
    },
  ).pipe(Effect.map((value) => ({ ...value, url: manifest.dist.tarball })));
});
