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

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. Each comparison makes one OSV batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed.

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

Non-GitHub hosts, missing/malformed repository metadata, and repository/directory changes return unavailable release evidence without GitHub requests; npm and OSV results remain intact. GitHub failures, missing notes, and rate limits also preserve the rest of the comparison. This does not fetch GitLab/Bitbucket notes or inspect published tarballs.

Optionally set `GITHUB_TOKEN` in the server environment to increase GitHub's authenticated rate allowance. It is sent only to `api.github.com`, never included in the response, and redirects are rejected. Public requests work without a token but are subject to GitHub's lower unauthenticated limits.

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
