import { Effect, Result, Schema } from 'effect';

import { compareSemver, isExactSemver } from '../../../shared/compareSemver';
import type { PackageRelease, PackageReleaseNotes } from '../../../shared/github.defs';
import type { RegistryVersionManifest } from '../../../shared/package.defs';
import {
  getGithubFile,
  listGithubDirectory,
  listGithubReleases,
  type GithubEntry,
  type GithubRelease,
  type GithubRepository,
} from '../../httpDependencies/github/client';

type Source = { repository: GithubRepository; directory: string };
type SourceResult = { ok: true; value: Source } | { ok: false; reason: string };
type ReleaseListing = Result.Result<{ releases: readonly GithubRelease[]; complete: boolean }, unknown>;
type ChangelogResult = { changelog: PackageReleaseNotes['changelog']; reason: string | null };

const RepositorySchema = Schema.Struct({
  url: Schema.String,
  type: Schema.optionalKey(Schema.String),
  directory: Schema.optionalKey(Schema.String),
});
const decodeRepository = Schema.decodeUnknownResult(RepositorySchema);
const CHANGELOG_NAMES = ['changelog', 'changes', 'history'];
const CHANGELOG_EXTENSIONS = ['', 'md', 'markdown', 'txt', 'rst'];

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeDirectory(directory: string): boolean {
  if (directory === '') return true;
  return (
    !hasControlCharacter(directory) &&
    !/[\\%?#]/.test(directory) &&
    directory.trim() === directory &&
    directory.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function parseRepositoryUrl(raw: string): URL | null {
  if (raw.trim() !== raw || hasControlCharacter(raw)) return null;
  let value = raw.replace(/^git\+/i, '').replace(/^git@github\.com:/i, 'https://github.com/');
  value = value.replace(/^github:/i, 'https://github.com/');
  if (/^[^/:?#]+\/[^/?#]+$/.test(value)) value = `https://github.com/${value}`;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function repositoryFromPath(path: string): GithubRepository | null {
  const match = /^\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(path);
  const owner = match?.[1];
  const repo = match?.[2]?.replace(/\.git$/, '');
  if (!owner || !repo || /^\.+$/.test(repo)) return null;
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
}

function repositoryFromUrl(url: URL): SourceResult {
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    return { ok: false, reason: 'unsupported repository host' };
  }
  if (!['https:', 'git:', 'ssh:'].includes(url.protocol))
    return { ok: false, reason: 'unsupported repository protocol' };
  if (url.search || url.hash || url.port || url.password) return { ok: false, reason: 'malformed repository URL' };
  const repository = repositoryFromPath(url.pathname);
  if (repository === null) return { ok: false, reason: 'malformed repository path' };
  return { ok: true, value: { repository, directory: '' } };
}

function normalizeManifestRepository(manifest: RegistryVersionManifest): SourceResult {
  if (manifest.repository == null) return { ok: false, reason: 'missing repository metadata' };
  const decoded = decodeRepository(
    typeof manifest.repository === 'string' ? { url: manifest.repository } : manifest.repository,
  );
  if (Result.isFailure(decoded)) return { ok: false, reason: 'malformed repository metadata' };
  const { url: rawUrl, directory = '', type = 'git' } = decoded.success;
  if (!['git', 'github', 'https', 'ssh'].includes(type.toLowerCase()))
    return { ok: false, reason: 'unsupported repository type' };
  if (!normalizeDirectory(directory)) return { ok: false, reason: 'unsafe repository directory or traversal' };
  const url = parseRepositoryUrl(rawUrl);
  if (url === null) return { ok: false, reason: 'malformed repository URL' };
  const source = repositoryFromUrl(url);
  if (!source.ok) return source;
  return { ok: true, value: { repository: source.value.repository, directory } };
}

function comparisonSource(from: RegistryVersionManifest, to: RegistryVersionManifest): SourceResult {
  const source = normalizeManifestRepository(from);
  const target = normalizeManifestRepository(to);
  if (!source.ok) return source;
  if (!target.ok) return target;
  const left = source.value.repository;
  const right = target.value.repository;
  if (left.owner !== right.owner || left.repo !== right.repo)
    return { ok: false, reason: 'version manifests identify different GitHub repositories' };
  if (source.value.directory !== target.value.directory)
    return { ok: false, reason: 'version manifests identify different repository directories' };
  return target;
}

function isSafeRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 512 || hasControlCharacter(ref)) return false;
  if (/[\\%?#~^:*[\]\s]/.test(ref) || ref.includes('..') || ref.includes('@{') || ref.endsWith('.')) return false;
  return ref.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function releaseVersion(tag: string, packageName: string, monorepo: boolean): string | null {
  const prefix = `${packageName}@`;
  const packageSpecific = tag.startsWith(prefix);
  if (monorepo && !packageSpecific) return null;
  const candidate = packageSpecific ? tag.slice(prefix.length) : tag;
  const version = candidate.startsWith('v') ? candidate.slice(1) : candidate;
  return isExactSemver(version) ? version : null;
}

function matchedVersions(releases: readonly GithubRelease[], packageName: string, monorepo: boolean) {
  return releases.flatMap((release) => {
    if (release.draft) return [];
    const version = releaseVersion(release.tag_name, packageName, monorepo);
    return version === null ? [] : [{ release, version }];
  });
}

function releaseEvidence(listing: ReleaseListing, packageName: string, from: string, to: string, monorepo: boolean) {
  if (Result.isFailure(listing)) return { releases: [], reasons: ['GitHub releases request failed'] };
  const matched = matchedVersions(listing.success.releases, packageName, monorepo)
    .filter(({ version }) => compareSemver(version, from) > 0 && compareSemver(version, to) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version));
  const reasons: string[] = [];
  if (!listing.success.complete) reasons.push('GitHub release pagination was truncated');
  if (matched.length === 0) reasons.push('no unambiguous GitHub release tags matched the requested semver interval');
  if (matched.some(({ release }) => !release.body?.trim())) reasons.push('some matched releases have no release notes');
  const releases: PackageRelease[] = matched.map(({ release, version }) => ({
    version,
    tag: release.tag_name,
    name: release.name,
    body: release.body ?? '',
    url: release.html_url,
  }));
  return { releases, reasons };
}

function changelogRank(entry: GithubEntry, directory: string): number {
  const expectedPath = directory ? `${directory}/${entry.name}` : entry.name;
  if (entry.type !== 'file' || entry.path !== expectedPath) return -1;
  const parts = /^([^.]+)(?:\.([^.]+))?$/.exec(entry.name.toLowerCase());
  const base = CHANGELOG_NAMES.indexOf(parts?.[1] ?? '');
  const extension = CHANGELOG_EXTENSIONS.indexOf(parts?.[2] ?? '');
  return base < 0 || extension < 0 ? -1 : base * CHANGELOG_EXTENSIONS.length + extension;
}

function chooseChangelog(entries: readonly GithubEntry[], directory: string): GithubEntry | undefined {
  let selected: GithubEntry | undefined;
  let rank = Infinity;
  for (const entry of entries) {
    const next = changelogRank(entry, directory);
    if (next >= 0 && next < rank) {
      rank = next;
      selected = entry;
    }
  }
  return selected;
}

const fetchChangelog = Effect.fn('Github.fetchChangelog')(function* (source: Source, ref: string, token?: string) {
  const entries = yield* listGithubDirectory(source.repository, source.directory, ref, token).pipe(Effect.result);
  if (Result.isFailure(entries)) return { changelog: null, reason: 'GitHub changelog directory request failed' };
  const entry = chooseChangelog(entries.success, source.directory);
  if (entry === undefined) return { changelog: null, reason: 'no package changelog was found at the pinned ref' };
  const file = yield* getGithubFile(source.repository, entry.path, ref, token).pipe(Effect.result);
  if (Result.isFailure(file)) return { changelog: null, reason: 'GitHub changelog file request failed' };
  if (file.success.trim() === '') return { changelog: null, reason: 'the pinned changelog is empty' };
  const path = entry.path.split('/').map(encodeURIComponent).join('/');
  return {
    changelog: {
      body: file.success,
      url: `https://github.com/${source.repository.owner}/${source.repository.repo}/blob/${encodeURIComponent(ref)}/${path}`,
      path: entry.path,
      ref,
    },
    reason: null,
  };
});

const PackageIdentitySchema = Schema.Struct({ name: Schema.String, version: Schema.String });

const verifyPackageTag = Effect.fn('Github.verifyPackageTag')(function* (
  source: Source,
  tag: string,
  packageName: string,
  targetVersion: string,
  token?: string,
) {
  const identity = yield* getGithubFile(source.repository, `${source.directory}/package.json`, tag, token).pipe(
    Effect.flatMap((text) => Effect.try((): unknown => JSON.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(PackageIdentitySchema)),
    Effect.result,
  );
  return (
    Result.isSuccess(identity) && identity.success.name === packageName && identity.success.version === targetVersion
  );
});

function targetReleaseMatches(listing: ReleaseListing, packageName: string, targetVersion: string) {
  if (Result.isFailure(listing) || !listing.success.complete) return [];
  return matchedVersions(listing.success.releases, packageName, false).filter(
    ({ version }) => compareSemver(version, targetVersion) === 0,
  );
}

const fallbackChangelog = Effect.fn('Github.fallbackChangelog')(function* (
  listing: ReleaseListing,
  source: Source,
  packageName: string,
  targetVersion: string,
  token?: string,
) {
  const matches = targetReleaseMatches(listing, packageName, targetVersion);
  const monorepo = source.directory !== '';
  const packageMatches = matches.filter(({ release }) => release.tag_name.startsWith(`${packageName}@`));
  const eligible = monorepo && packageMatches.length > 0 ? packageMatches : matches;
  const tag = eligible.length === 1 ? eligible[0]?.release.tag_name : undefined;
  if (tag === undefined || !isSafeRef(tag))
    return { changelog: null, reason: 'no unambiguous pinned target ref is available for the changelog' };
  // A repository-wide tag does not establish package ownership. Verify the target package
  // at that same ref, and use only its changelog, not potentially unrelated release prose.
  if (
    monorepo &&
    packageMatches.length === 0 &&
    !(yield* verifyPackageTag(source, tag, packageName, targetVersion, token))
  )
    return { changelog: null, reason: 'the target tag does not provide a verified package name and version' };
  return yield* fetchChangelog(source, tag, token);
});

function toReleaseNotes(
  listing: ReleaseListing,
  releases: PackageRelease[],
  reasons: string[],
  evidence: ChangelogResult,
): PackageReleaseNotes {
  if (evidence.reason !== null) reasons.push(evidence.reason);
  const hasEvidence = Result.isSuccess(listing) || evidence.changelog !== null;
  return {
    status: reasons.length === 0 ? 'available' : hasEvidence ? 'partial' : 'unavailable',
    reasons,
    releases,
    changelog: evidence.changelog,
  };
}

export const getPackageReleaseNotes = Effect.fn('Github.getPackageReleaseNotes')(function* (
  packageName: string,
  from: RegistryVersionManifest,
  to: RegistryVersionManifest,
  token?: string,
) {
  const source = comparisonSource(from, to);
  if (!source.ok)
    return {
      status: 'unavailable',
      reasons: [source.reason],
      releases: [],
      changelog: null,
    } satisfies PackageReleaseNotes;
  // Only a commit hash from npm can start a pinned changelog independently of release discovery.
  const ref = typeof to.gitHead === 'string' && /^[a-f0-9]{40}$/i.test(to.gitHead) ? to.gitHead : null;
  const { listing, pinned } = yield* Effect.all(
    {
      listing: listGithubReleases(source.value.repository, token).pipe(Effect.result),
      pinned:
        ref === null ? Effect.succeed({ changelog: null, reason: null }) : fetchChangelog(source.value, ref, token),
    },
    { concurrency: 2 },
  );
  const { releases, reasons } = releaseEvidence(
    listing,
    packageName,
    from.version,
    to.version,
    source.value.directory !== '',
  );
  const evidence =
    ref === null ? yield* fallbackChangelog(listing, source.value, packageName, to.version, token) : pinned;
  return toReleaseNotes(listing, releases, reasons, evidence);
});
