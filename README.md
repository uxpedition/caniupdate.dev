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

### Comparison interface

Search for a package on the homepage, choose versions, and open `/{encodedPackageName}/{from}...{to}`. For example, `/vue/3.4.38...3.5.13` compares Vue releases using the live comparison and AI briefing APIs. Scoped package names are URL-encoded.

The comparison prioritizes dependency changes, estimated gzip impact, and advisory coverage. Every comparison row has a Lucide info icon beside its title with an explanation available on hover, keyboard focus, or tap. Expand individual categories for complete declarations and measurement notes; AI migration notes and source evidence are collapsed initially. Citation links reveal their referenced evidence.

Bundle estimates with omitted dependencies remain visible but are marked “Incomplete estimate” for the affected version. Their delta reads “Not comparable: incomplete build”, and expanded details list the omitted dependencies for each version. Missing measurements use separate availability messages. These warnings do not change the backend comparability rules.

Row and evidence anchors deep-link: opening `#comparison-dependencies`, `#comparison-advisories`, or a citation anchor scrolls to that element once the comparison and briefing render. Declaration rows can already exist in SSR HTML, while measurement rows and briefing/citation entries arrive from client-side queries; `app/router.options.ts` replaces Nuxt's default scroll behavior with one that waits for the anchor to exist — up to 30 seconds — and scrolls to the last reachable position when the anchor sits near the end of the page.

The shared theme in `app/assets/css/main.css` defines neutral light/dark surfaces, DM Sans headings and body text, monospace package data, and a blue change/focus accent. Blue indicates a change, not a risk rating. Homepage controls retain their original responsive layout and dimensions.

Comparison loading is tiered. During SSR, the page prefetches declarations and streams the comparison table in the first HTML, including `Measuring…` placeholders for tier-2 rows. Measurements and AI notes start client-side after the resolved versions arrive and fill in without interaction; a measurements endpoint failure degrades each affected row or tile to `Unavailable` instead of blocking declarations. Nuxt disables streaming for crawler user agents.

## Package comparison API

`GET /api/package/{encodedPackageName}/compare?from={versionOrTag}&to={versionOrTag}` returns `{ packageName, from, to, comparison }` for the resolved versions. The `comparison` contains declaration fields only: `dependencies`, `peers`, `node`, `moduleFormat`, `exports`, `types`, `licenses`, and `installScripts`. `from` and `to` contain registry manifest declarations; measurement evidence is served by the sibling measurements route, while `releaseNotes` are collected only inside the server-side briefing pipeline. This route makes no GitHub request.

### Measurements route

`GET /api/package/{encodedPackageName}/compare/measurements?from={version}&to={version}` returns `{ packageName, from, to, comparison: { sizes, advisories } }` for a resolved pair. The page calls it with the exact versions resolved by the declarations response; each returned version includes a `tarball` summary with `status`, `reasons`, `url`, `fileCount`, and `changelogCount`. The per-file inventory and changelog bodies stay server-side for briefing evidence packing.

#### Measurement evidence

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. On an OSV cache miss, the measurements route makes one batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed.

The measurements response keeps `sizes` and `advisories` under `comparison`:

- `sizes.unpacked`: before/after bytes, `delta` (`to - from`), `percent`, coverage status/reasons, and per-version `sources`. Uses valid registry `unpackedSize`, falling back to the verified tarball's regular-file bytes. Partial changelog text does not invalidate the complete tarball inventory. Missing measurements are `null`, never zero; a zero baseline has `percent: null`.
- `sizes.bundle.minified` and `.gzip`: separate Bundlephobia estimate comparisons with the same numeric fields and coverage states. Builds reporting ignored missing dependencies retain values but have no calculated delta. These are provider estimates, not reproducible application bundle measurements; retrieval times and returned build metadata remain under each version's `bundleSize`.
- `advisories`: groups records transitively by shared OSV IDs/aliases, retaining the original records under each group's `from`/`to`, plus sorted `ids` and `aliases`. `related` IDs are not duplicates. With complete evidence, groups are `fromOnly`, `both`, or `toOnly`. Under incomplete evidence, one-sided groups go to `uncertain` rather than implying a fix or a newly introduced vulnerability. `coverage`, `status`, and `reasons` retain lookup limitations. Per-version counts remain counts of OSV IDs; grouped comparison entries are not interchangeable with those counts.

Per-version OSV data under `from.vulnerabilities` and `to.vulnerabilities` retains:

- `status`: `available`, `partial`, or `unavailable`.
- `count`: unique OSV IDs for that version, excluding confirmed withdrawn records. A successful empty result is `0`; a failed or missing batch result is `null`. Counts are by OSV ID, not merged by CVE aliases.
- `advisories`: IDs, OSV links, detail availability, summaries, aliases, severity vectors, publication/modification times, references, and affected entries restricted to the selected npm package. Ranges retain their documented fixed events; these are not automatically recommended upgrade versions.

A failed detail lookup retains its batch match and count with `detailsStatus: 'unavailable'`, marking only the affected version `partial`. Pagination tokens also mark results `partial`: the returned count is not exhaustive, and zero must not be presented as a complete no-matches result. OSV failures do not discard registry metadata. Coverage concerns the package itself, not its dependency tree.

For example, `minimist` versions `1.2.5` and `1.2.8` currently return counts of `1` and `0`, respectively. Advisory data can change over time.

### Briefing route

`GET /api/package/{encodedPackageName}/compare/briefing?from={versionOrTag}&to={versionOrTag}` returns the AI briefing for the same pair as `{ packageName, from, to, briefing }`, where `from` and `to` are the resolved versions. It accepts the same parameters and validation as the comparison route, collects evidence server-side through the same providers and caches, and never trusts browser-supplied facts. Keeping it separate lets clients render the factual comparison without waiting for inference.

#### Briefing release-note collection

GitHub collection starts after both npm manifests resolve their repository metadata, without waiting for OSV. Release pagination and the entire commit-pinned changelog lookup run concurrently. Only dependent requests—later release pages, reading a discovered changelog file, or discovering a fallback release tag—wait for their prerequisites. GitHub requests have a five-second timeout including the body, a 1 MiB response limit, and no retries. Release pagination stops after ten pages, preserving earlier results as partial evidence if later pages fail or the bound is reached.

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

The declarations and measurements routes read these same process-local caches, so a page load collects each version's manifest once even though they are separate requests. The briefing route shares the same caches while assembling complete server-side facts. Warm and overlapping comparisons reuse cached provider evidence, but an uncached comparison still waits for upstream services. OSV and other mutable evidence can lag by their configured TTL. Cache entries are local to each server process, disappear on restart/module reload, and are not shared across multiple instances. This caches evidence, not complete HTTP responses, and does not introduce retries or stale-while-revalidate behavior.

### Local comparison

The declarations comparison calculates facts from the two resolved manifest versions. It adds no network calls and never executes package code. Measurement comparisons for `sizes` and `advisories` are returned by the measurements route described above; the briefing pipeline combines both tiers internally with its server-side evidence.

- `dependencies`: sorted added/removed/changed declarations, each with `name`, `kind`, and nullable `from`/`to` values containing `category` (`runtime` or `optional`) and `range`. Optional requirements override same-name runtime requirements. Category moves are one change, not two dependencies. Dev dependencies are excluded.
- `peers`: separate requirement changes, including optional/required transitions. Before/after values contain `range` and `optional`.
- `node`: changes to the declared Node engine range. Missing means unspecified, not unrestricted support. This is not semver range-containment analysis or a Node lifecycle check.
- `moduleFormat`, `exports`, and `types`: before/after declarations with `changed`. Module metadata contains `type`, `main`, and `module`; it does not prove that loading the package with `require` or `import` succeeds. Type metadata includes `types`, legacy `typings`, `typesVersions`, and the full export map when it contains nested `types` or versioned `types@…` conditions. Export condition and type-version mapping order is preserved, since precedence can matter. Presence flags (`fromDeclared`, `toDeclared`) distinguish an absent field from an explicit JSON `null`; nullable before/after values alone cannot do so. Composite declaration objects can be empty.
- `licenses`: unique sorted declarations with `added`/`removed`, without legal compatibility advice.
- `installScripts`: added, removed, and changed explicit `preinstall`, `install`, and `postinstall` commands. Per-version `installScriptCommands` retains their bodies alongside the existing `installScripts` names. This does not infer implicit npm lifecycle behavior such as a default native build.

Declaration change lists contain only differences. Scalar/composite comparisons retain unchanged values with `changed: false`. Comparison direction follows the requested version pair, including identical versions and downgrades; the factual comparison itself does not generate upgrade advice. Missing provider evidence affects only its comparison sections. No published-file diff, dependency-tree resolution, or consumer compatibility verdict is implied. The AI briefing is served by its own endpoint, described below.

### Optional AI briefing

The briefing route keeps collecting complete facts server-side, including release notes, but release notes are inference evidence only. They are not returned as a standalone response field or rendered in a page section; if included in the briefing evidence, they appear solely as `maintainer` sources and support bullets with `basis: 'maintainer'`.

Set these server-only environment variables (see `.env.example`):

```dotenv
AI_BRIEFING_ENDPOINT=https://opencode.ai/zen/go/v1/chat/completions
AI_BRIEFING_API_KEY=your-development-key
AI_BRIEFING_MODEL=deepseek-v4-flash
```

For OpenRouter, replace the endpoint with `https://openrouter.ai/api/v1/chat/completions`, the key with your OpenRouter key, and the model with `deepseek/deepseek-v4-flash`. The endpoint is the complete OpenAI-compatible Chat Completions URL: its path must end with `/chat/completions`, and query parameters are rejected. Production deployments must set the environment explicitly; do not expose these settings in public runtime configuration. Restart the server after changing its environment.

Model choice matters for latency. Measured against OpenCode Go with a real comparison payload: `glm-5.3-flash` answered in 7–11 s (three of three requests produced a valid briefing), `mimo-v2.5` in 13–75 s, and the reasoning models `deepseek-v4-flash` and `qwen3.8-flash` spent 2.3–4.5k tokens on hidden reasoning and needed 37–50 s. `minimax-m2.7` returned HTTP 500 from the gateway. Prefer a fast model such as `glm-5.3-flash`; requests that exceed the deadline come back as `timeout`.

After evidence collection and local comparison finish, a non-streaming AI request summarizes the evidence through Effect's OpenAI-compatible provider (`@effect/ai-openai-compat` over `effect/unstable/ai`). Invalid provider output gets one fresh generation via `Effect.retry` (at most two attempts), reusing the same evidence and prompt without refetching non-AI data or feeding rejected text back to the model. HTTP/authentication failures, transport failures, timeouts, configuration errors, and local evidence-packaging failures are not retried. There are no repair conversations, browsing, tools, or Jev calls. The request uses ordinary Chat Completions fields rather than requiring provider-specific structured-output support, and every attempt is validated locally. Provider reasoning may consume part of each attempt's 4,096-token output allowance.

An available `briefing` contains `status`, `model`, `bullets`, and collected `sources`. Fresh generations return one to five distinct, comparison-relevant insights about consequential changes, security findings, and specific migration actions, preferring fewer useful points over padding. Each generated bullet has `kind` (`change` or `migration`), `basis` (`fact`, `maintainer`, or `inference`), text, and `evidenceIds`. Fresh output validation rejects coverage bullets; the prompt focuses on specific insights rather than generic disclaimers, unchanged-metadata inventories, or repeated points. The prompt requires timeless, exact-version wording: advisory matches do not establish discovery time or the first affected release, and recency or latest-release status must not be inferred. Coverage remains a structured source in the response even when no bullet cites it. Existing permanent snapshots remain unchanged and may contain the previous `coverage` bullet kind. Source records contain IDs, labels, provenance URLs, and evidence text. Internal coverage evidence has no external URL. The model cannot supply new citation URLs or inline links. Local validation checks structure and reference membership, not whether every interpretation is semantically correct; this is not a verified safety or compatibility verdict.

Successful briefings are stored indefinitely in a local libSQL database at `.data/briefings.db` by default (`AI_BRIEFING_CACHE_PATH` can override the file). The key is SHA-256 of the bounded evidence packet sent to the model. A later request still refreshes factual evidence enough to build that packet, then reuses the stored response when the hash matches. Changed advisories, release notes, measurements, or other model-visible evidence create a new snapshot and may generate a new briefing. API-key, endpoint, model, and prompt changes do not invalidate an existing snapshot; this preserves the already-generated result. Cache read/write failures return `cache-error` rather than silently spending another AI request. The file is local-only and is not synced to Turso Cloud.

Unavailable briefings have empty bullets/sources and a sanitized reason: `not-configured`, `invalid-config`, `provider-error`, `cache-error`, `timeout`, or `invalid-response`. All three settings absent disables AI; incomplete configuration is invalid. A failed briefing changes only the briefing endpoint's response; the factual comparison route never calls the provider and is unaffected.

Evidence packaging is bounded to 48 KiB and 64 sources, with maintainer excerpts capped at 4 KiB. Advisory evidence keeps computed match groups, IDs/aliases, summaries, severity, source links, and coverage status; it explicitly excludes full affected-version ranges and reference lists, which remain available from the factual comparison endpoint. Sources are admitted in priority order with coverage space reserved, skipping sources that cannot fit rather than evicting every smaller fact. Omitted or truncated evidence becomes an explicit coverage limitation. Conservative Markdown version-heading matching excludes unversioned, unreleased, and out-of-range changelog sections. The AI stage has one 75-second total deadline across both attempts, including body decoding and validation, a 128 KiB response limit per attempt enforced while reading, and no redirects. HTTPS is required except for HTTP loopback development endpoints.

The persistent store is paired with a process-local Effect cache that shares identical in-flight lookups. Raw credentials are not exposed. Failures are not retained as successful cache entries, and credentials or raw provider error bodies never enter either endpoint's response.

### Published npm tarballs

Each tarball lookup starts as soon as its own npm manifest resolves, without waiting for the other manifest, GitHub, OSV, or Bundlephobia. The downloads can overlap; verified cache hits skip download and inspection entirely. GitHub still waits for both manifests to validate repository agreement, but does not wait for either tarball.

The browser-facing `/compare/measurements` response exposes `from.tarball` and `to.tarball` summaries:

- `status`: `available`, `partial`, or `unavailable`; `reasons` explains incomplete inspection. Failure for one version preserves the other version and all unrelated evidence.
- `url`: the manifest's published tarball URL.
- `fileCount`: the number of inspected package files.
- `changelogCount`: the number of matching changelog files.

The full per-file inventory (`path`, `type`, `size`, `sha256`, and link targets) and changelog bodies (`path`, UTF-8 `body`, and `truncated`) remain server-side for briefing evidence packing; they are not returned by either comparison route. These artifact contents are not version-filtered release notes or source diffs.

A complete archive with no matching changelog is `available` with `changelogCount: 0`; that does not mean there were no changes. Truncated text or invalid UTF-8 marks inspection `partial` while preserving the server-side inventory and summary counts. Integrity, transport, archive, and hard resource-limit failures return `unavailable` with zero summary counts, never a misleading partial inventory.

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

Lefthook installs the Git hooks through `prepare`. The `pre-commit` hook runs the type, lint, and format checks in parallel; the `commit-msg` hook enforces the conventional commit format.

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
