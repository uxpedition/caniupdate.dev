# Can I npm update?

A Nuxt starter using Nub, Effect v4 RC, Oxlint, and Oxfmt.

## Setup

Install the locked dependency graph with Nub:

```bash
nub ci
```

## Development

Start the Nuxt development server on port `5173`, exposed on all network interfaces including Tailscale:

```bash
nub run --node dev
```

Open `http://<tailscale-ip>:5173` from another device. Get this device's current Tailscale IPv4 address with `tailscale ip -4`.

Nub's `--node` mode keeps Nub as the package/script runner while disabling its runtime augmentation for Nuxt worker processes.

The setup includes an Effect-backed health endpoint at `/api/health`.

## Package comparison API

`GET /api/package/{encodedPackageName}/compare?from={versionOrTag}&to={versionOrTag}` returns registry metadata and a `vulnerabilities` object on each version. Tags resolve to published versions before OSV is queried.

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. On an OSV cache miss, the comparison makes one batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed.

- `status`: `available`, `partial`, or `unavailable`.
- `count`: unique OSV IDs for that version, excluding confirmed withdrawn records. A successful empty result is `0`; a failed or missing batch result is `null`. Counts are by OSV ID, not merged by CVE aliases.
- `advisories`: IDs, OSV links, detail availability, summaries, aliases, severity vectors, publication/modification times, references, and affected entries restricted to the selected npm package. Ranges retain their documented fixed events; these are not automatically recommended upgrade versions.

A failed detail lookup retains its batch match and count with `detailsStatus: 'unavailable'`, marking only the affected version `partial`. Pagination tokens also mark results `partial`: the returned count is not exhaustive, and zero must not be presented as a complete no-matches result. OSV failures do not discard registry metadata. Coverage concerns the package itself, not its dependency tree.

For example, `minimist` versions `1.2.5` and `1.2.8` currently return counts of `1` and `0`, respectively. Advisory data can change over time.

The response also includes a comparison-level `releaseNotes` object:

- `status`: `available`, `partial`, or `unavailable`, with `reasons` explaining coverage gaps. Missing evidence does not mean there were no changes.
- `releases`: GitHub release version, tag, name, full body, and source URL for `(from, to]`. Drafts are excluded; prereleases follow semver ordering. Packages with a repository subdirectory require package-specific tags such as `@scope/package@1.2.3`; ambiguous bare monorepo tags are not guessed.
- `changelog`: the target package directory's `CHANGELOG`, `CHANGES`, or `HISTORY` document (plain text, Markdown, or reStructuredText), including its body, path, explicit ref, and source URL; otherwise `null`. It is pinned to the target npm `gitHead` commit, or a unique matching target release tag when no usable commit is available. The default branch is never used.

GitHub starts after both npm manifests resolve their repository metadata, without waiting for OSV. Release pagination and the entire commit-pinned changelog lookup run concurrently. Only dependent requests—later release pages, reading a discovered changelog file, or discovering a fallback release tag—wait for their prerequisites. GitHub requests have a five-second timeout including the body, a 1 MiB response limit, and no retries. Release pagination stops after ten pages, preserving earlier results as partial evidence if later pages fail or the bound is reached.

Non-GitHub hosts, missing/malformed repository metadata, and repository/directory changes return unavailable release evidence without GitHub requests; npm and OSV results remain intact. GitHub failures, missing notes, and rate limits also preserve the rest of the comparison. This does not fetch GitLab/Bitbucket notes. Published tarball evidence is returned separately, as described below.

Optionally set `GITHUB_TOKEN` in the server environment to increase GitHub's authenticated rate allowance. It is sent only to `api.github.com`, never included in the response, and redirects are rejected. Public requests work without a token but are subject to GitHub's lower unauthenticated limits.

### Process-local evidence caches

The comparison server uses the existing Effect `Cache` API in memory—no Redis, database, new dependency, or cache service is required. Caches are created once per loaded server module, share pending same-key lookups, and evict least-recently-used entries when their entry capacities are exceeded. Cancelling one caller does not cancel a shared lookup while another caller is still waiting.

| Evidence                 | Key                                                                             | Successful lifetime                                     | Maximum entries |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------- |
| npm manifest             | Package + requested exact version                                               | 5 minutes                                               | 128             |
| OSV comparison           | Package + ordered resolved version pair                                         | 5 minutes, only when both sides are complete            | 128             |
| Bundlephobia measurement | Package + exact version                                                         | 1 hour                                                  | 128             |
| GitHub release listing   | Repository + credential identity                                                | 5 minutes, only when pagination is complete             | 16              |
| GitHub directory listing | Repository + path + ref + credential identity                                   | 24 hours for full commit SHAs; 5 minutes for other refs | 32              |
| GitHub changelog text    | Repository + path + ref + credential identity                                   | 24 hours for full commit SHAs; 5 minutes for other refs | 16              |
| Tarball inspection       | Validated normalized URL + integrity/shasum mode and value + inspection version | 24 hours                                                | 16              |

Tags and ranges resolve afresh on each request; they are only shared while a lookup is in flight or within that request. Expiration is measured from lookup completion. Successful empty results can be cached. Failed lookups, unavailable measurements, and incomplete OSV/release-list results have zero lifetime, so the next request can recover without waiting for a success TTL. Deterministic partial tarball evidence (for example, truncated changelog text with a complete inventory) is cacheable.

Caches retain parsed evidence, not HTTP response objects or raw archives. Tarball URL validation still runs before cache lookup, and changed integrity metadata cannot reuse a previously verified entry. GitHub caches are isolated by credential identity; credentials never appear in the API response. Bundlephobia cache hits retain the original `retrievedAt`, rather than presenting cached measurements as newly fetched.

The response shape is unchanged. Warm and overlapping comparisons reuse cached provider evidence, but an uncached comparison still waits for upstream services. OSV and other mutable evidence can lag by their configured TTL. Cache entries are local to each server process, disappear on restart/module reload, and are not shared across multiple instances. This caches evidence, not the complete HTTP response, and does not introduce retries, stale-while-revalidate behavior, or streaming.

### Local comparison

The top-level `comparison` object calculates facts from the two resolved versions and their collected evidence. It adds no network calls and never executes package code. Existing `from`, `to`, and `releaseNotes` evidence remains available.

- `dependencies`: sorted added/removed/changed declarations, each with `name`, `kind`, and nullable `from`/`to` values containing `category` (`runtime` or `optional`) and `range`. Optional requirements override same-name runtime requirements. Category moves are one change, not two dependencies. Dev dependencies are excluded.
- `peers`: separate requirement changes, including optional/required transitions. Before/after values contain `range` and `optional`.
- `node`: changes to the declared Node engine range. Missing means unspecified, not unrestricted support. This is not semver range-containment analysis or a Node lifecycle check.
- `moduleFormat`, `exports`, and `types`: before/after declarations with `changed`. Module metadata contains `type`, `main`, and `module`; it does not prove that loading the package with `require` or `import` succeeds. Type metadata includes `types`, legacy `typings`, `typesVersions`, and the full export map when it contains nested `types` or versioned `types@…` conditions. Export condition and type-version mapping order is preserved, since precedence can matter. Presence flags (`fromDeclared`, `toDeclared`) distinguish an absent field from an explicit JSON `null`; nullable before/after values alone cannot do so. Composite declaration objects can be empty.
- `licenses`: unique sorted declarations with `added`/`removed`, without legal compatibility advice.
- `installScripts`: added, removed, and changed explicit `preinstall`, `install`, and `postinstall` commands. Per-version `installScriptCommands` retains their bodies alongside the existing `installScripts` names. This does not infer implicit npm lifecycle behavior such as a default native build.
- `sizes.unpacked`: before/after bytes, `delta` (`to - from`), `percent`, coverage status/reasons, and per-version `sources`. Uses valid registry `unpackedSize`, falling back to the verified tarball's regular-file bytes. Partial changelog text does not invalidate the complete tarball inventory. Missing measurements are `null`, never zero; a zero baseline has `percent: null`.
- `sizes.bundle.minified` and `.gzip`: separate Bundlephobia estimate comparisons with the same numeric fields and coverage states. Builds reporting ignored missing dependencies retain values but have no calculated delta. These are provider estimates, not reproducible application bundle measurements; retrieval times and returned build metadata remain under each version's `bundleSize`.
- `advisories`: groups records transitively by shared OSV IDs/aliases, retaining the original records under each group's `from`/`to`, plus sorted `ids` and `aliases`. `related` IDs are not duplicates. With complete evidence, groups are `fromOnly`, `both`, or `toOnly`. Under incomplete evidence, one-sided groups go to `uncertain` rather than implying a fix or a newly introduced vulnerability. `coverage`, `status`, and `reasons` retain lookup limitations. Per-version counts remain counts of OSV IDs; grouped comparison entries are not interchangeable with those counts.

Declaration change lists contain only differences. Scalar/composite comparisons retain unchanged values with `changed: false`. Comparison direction follows the requested version pair, including identical versions and downgrades; this endpoint does not generate upgrade advice. Missing provider evidence affects only its comparison sections. No published-file diff, AI briefing, dependency-tree resolution, or consumer compatibility verdict is implied.

### Published npm tarballs

Each version also includes a `tarball` object. Each tarball lookup starts as soon as its own npm manifest resolves, without waiting for the other manifest, GitHub, OSV, or Bundlephobia. The downloads can overlap; verified cache hits skip download and inspection entirely. GitHub still waits for both manifests to validate repository agreement, but does not wait for either tarball.

- `status`: `available`, `partial`, or `unavailable`; `reasons` explains incomplete inspection. Failure for one version preserves the other version and all unrelated evidence.
- `url`: the manifest's published tarball URL.
- `files`: sorted package-relative paths, entry `type`, declared byte `size`, and a hex `sha256` of regular-file contents. Directories and links have `sha256: null`; links include their original `linkTarget` and are never followed. The `package/` root directory itself is omitted.
- `changelogs`: shipped `CHANGELOG`, `CHANGES`, and `HISTORY` files, case-insensitive, with no extension or `.md`, `.markdown`, `.txt`, or `.rst`, at any depth. Each includes `path`, UTF-8 `body`, and `truncated`. These are artifact contents, not version-filtered release notes or source diffs; they remain separate from GitHub `releaseNotes`.

A complete archive with no matching changelog is `available` with `changelogs: []`; that does not mean there were no changes. Truncated text or invalid UTF-8 marks inspection `partial` while preserving the file inventory. Integrity, transport, archive, and hard resource-limit failures return `unavailable` with empty evidence arrays, never a misleading partial inventory.

Inspection accepts only `https://registry.npmjs.org` URLs without credentials or fragments, rejects redirects, sends no registry/GitHub credentials, and performs no retries. It verifies the strongest supported manifest integrity digest (SHA-512, SHA-384, SHA-256), or the legacy SHA-1 `shasum` only when integrity is absent. A present but unsupported or invalid integrity value never falls back to SHA-1.

Limits per version: ten seconds, 10 MiB downloaded, 32 MiB decompressed archive, 10,000 entries, 4,096 characters per archive path/link target, 256 KiB captured per changelog, and 1 MiB total captured changelog text. Archives must use npm's `package/` root; malformed/truncated archives, duplicate paths, unsafe paths or link targets, and unsupported entry types are rejected. Parsing uses in-memory archive data only: no filesystem extraction, package installation, lifecycle scripts, or package imports. This is artifact evidence, not a claim that the package is safe to execute.

## Checks

Always pass `--node` so Nuxt processes run on plain Node without Nub's runtime augmentation, matching the dev, build, and preview commands:

```bash
nub run --node prepare
nub run --node type-check
nub run --node lint:check
nub run --node format:check
```

## Unit tests

Unit tests live beside their implementation and use the `.unit.ts` suffix:

```text
app/pages/versionSearch.ts
app/pages/versionSearch.unit.ts
```

Run the suite once or watch for changes:

```bash
nub run --node test
nub run --node test:watch
```

Vitest discovers `*.unit.ts` files under `app/`, `server/`, and `shared/`, using a Node environment with `~`, `@`, and `#shared` aliases. Import test helpers explicitly from `vitest`. Nuxt and Nitro ignore these files during application discovery, and `pages.pattern` keeps page routes to `.vue` files so page-owned modules such as `versionSearch.ts` are not routed. The local `npmx.dev/` reference checkout is not part of the suite.

`Select` keeps search opt-in: pass a `search` prop (`{ filter, placeholder?, emptyMessage? }`) to render the filter input, or omit it for a plain list. The version-select filter lives with the page that owns it and is covered by local fixtures for ranking, numeric/hash/date matches, tag descriptions, normalization, stable ordering, and input preservation. The suite does not start Nuxt or call the npm registry.

## Production

Build and preview the application through Nub without runtime augmentation:

```bash
nub run --node build
nub run --node preview
```

See the [Nuxt deployment documentation](https://nuxt.com/docs/getting-started/deployment) for deployment options.
