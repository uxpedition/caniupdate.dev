import { Cause, Duration, Effect, Result } from 'effect';

import type {
  OsvQueryBatchResponse,
  OsvVulnerability,
  PackageAdvisory,
  PackageVulnerabilities,
} from '../../../shared/comparison/evidence/osv.defs';
import { getVulnerability, queryBatch } from '../../httpDependencies/osv/client';

const unavailable: PackageVulnerabilities = { status: 'unavailable', count: null, advisories: [] };

const COLLECTION_TIMEOUT = Duration.seconds(30);

type AvailableAdvisory = Extract<PackageAdvisory, { detailsStatus: 'available' }>;

type AdvisoryBuilder = { -readonly [Key in keyof AvailableAdvisory]: AvailableAdvisory[Key] };

function toPackageAdvisory(packageName: string, detail: OsvVulnerability, url: string): PackageAdvisory {
  const { id, modified, published, summary, aliases, severity, references } = detail;
  const advisory: AdvisoryBuilder = { id, url, detailsStatus: 'available', modified };

  // Optional fields stay absent when OSV omitted them; exactOptionalPropertyTypes forbids assigning undefined.
  if (published !== undefined) advisory.published = published;

  if (summary !== undefined) advisory.summary = summary;

  if (aliases !== undefined) advisory.aliases = aliases;

  if (severity !== undefined) advisory.severity = severity;

  if (references !== undefined) advisory.references = references;

  // Keep ranges intact rather than claiming every fixed event is an upgrade for this version.
  if (detail.affected !== undefined) {
    advisory.affected = detail.affected.filter(
      ({ package: pkg }) => pkg.ecosystem === 'npm' && pkg.name === packageName,
    );
  }

  return advisory;
}

function toVersionVulnerabilities(
  packageName: string,
  result: OsvQueryBatchResponse['results'][number] | undefined,
  details: ReadonlyMap<string, OsvVulnerability | undefined>,
): PackageVulnerabilities {
  if (result === undefined) return unavailable;

  const advisories: PackageAdvisory[] = [];
  let partial = Boolean(result.next_page_token);

  for (const id of new Set(result.vulns?.map((vuln) => vuln.id))) {
    const detail = details.get(id);
    const url = `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;

    if (detail === undefined || detail.id !== id) {
      partial = true;
      advisories.push({ id, url, detailsStatus: 'unavailable' });
      continue;
    }

    if (detail.withdrawn !== undefined) continue;

    advisories.push(toPackageAdvisory(packageName, detail, url));
  }

  return { status: partial ? 'partial' : 'available', count: advisories.length, advisories };
}

/** One batch request, then one detail request per unique returned ID; no retries or pagination. */
export const getPackageVulnerabilities = Effect.fn('Osv.getPackageVulnerabilities')(
  function* (packageName: string, fromVersion: string, toVersion: string) {
    const batch = yield* queryBatch({
      queries: [fromVersion, toVersion].map((version) => ({
        package: { name: packageName, ecosystem: 'npm' as const },
        version,
      })),
    }).pipe(Effect.result);

    if (Result.isFailure(batch)) return { from: unavailable, to: unavailable };

    const ids = new Set(batch.success.results.flatMap((result) => result.vulns?.map(({ id }) => id) ?? []));

    const entries = yield* Effect.forEach(
      ids,
      (id) =>
        getVulnerability(id).pipe(
          Effect.result,
          Effect.map((detail) => [id, Result.isSuccess(detail) ? detail.success : undefined] as const),
        ),
      { concurrency: 5 },
    );

    const details = new Map(entries);

    return {
      from: toVersionVulnerabilities(packageName, batch.success.results[0], details),
      to: toVersionVulnerabilities(packageName, batch.success.results[1], details),
    };
  },
  Effect.timeout(COLLECTION_TIMEOUT),
  Effect.result,
  Effect.flatMap((result) => {
    if (Result.isSuccess(result)) return Effect.succeed(result.success);

    if (Cause.isTimeoutError(result.failure)) return Effect.succeed({ from: unavailable, to: unavailable });

    return Effect.failCause(result.failure);
  }),
);
