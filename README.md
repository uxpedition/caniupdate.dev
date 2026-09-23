# Can I update?

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

Nub's `--node` mode keeps Nub as the package/script runner while disabling its runtime augmentation for Nuxt worker processes. Node 26 is pinned by `.node-version` and TypeScript 6.0.3 is pinned in `package.json`; run project scripts as `nub run --node ...` so the Nuxt and Nitro processes execute on plain Node.

`dev` applies the local D1 migrations first, then starts Nuxt dev with HMR. Nitro's Cloudflare dev proxy emulates the `BRIEFINGS_DB` binding, so local development needs no Cloudflare account, API token, or remote resource. Local state is git-ignored under `.wrangler/state`: the dev proxy writes `.wrangler/state/v3`, the Wrangler CLI uses the parent `.wrangler/state`, and both paths address the same physical database.

Nuxt development reads `.env` (see `.env.example`). Run `dev` and the production preview sequentially, never at the same time: two runtimes must not own that local D1 state concurrently.

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

Registry search and manifests come from the public `https://registry.npmjs.org` over HTTPS through the application's own Effect HTTP client. There is no npm CLI configuration, `.npmrc`, proxy-agent, or registry-authentication support, and no retry layer: the product requests the public registry explicitly and anonymously.

### Measurements route

`GET /api/package/{encodedPackageName}/compare/measurements?from={version}&to={version}` returns `{ packageName, from, to, comparison: { sizes, advisories } }` for a resolved pair. The page calls it with the exact versions resolved by the declarations response; each returned version includes a `tarball` summary with `status`, `reasons`, `url`, `fileCount`, and `changelogCount`. The per-file inventory and changelog bodies stay server-side for briefing evidence packing.

#### Measurement evidence

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. The measurements route makes one batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed.

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

`GET /api/package/{encodedPackageName}/compare/briefing?from={versionOrTag}&to={versionOrTag}` returns the AI briefing for the same pair as `{ packageName, from, to, briefing }`, where `from` and `to` are the resolved versions. It accepts the same parameters and validation as the comparison route, collects evidence server-side through the same providers, and never trusts browser-supplied facts. Keeping it separate lets clients render the factual comparison without waiting for inference.

#### Briefing release-note collection

GitHub collection starts after both npm manifests resolve their repository metadata, without waiting for OSV. Release pagination and the entire commit-pinned changelog lookup run concurrently. Only dependent requests—later release pages, reading a discovered changelog file, or discovering a fallback release tag—wait for their prerequisites. GitHub requests have a five-second timeout including the body, a 1 MiB response limit, and no retries. Release pagination stops after ten pages, preserving earlier results as partial evidence if later pages fail or the bound is reached.

Non-GitHub hosts, missing/malformed repository metadata, and repository/directory changes return unavailable release evidence without GitHub requests; npm and OSV results remain intact. GitHub failures, missing notes, and rate limits also preserve the rest of the comparison. This does not fetch GitLab/Bitbucket notes. Published tarball evidence is returned separately, as described below.

Optionally set `GITHUB_TOKEN` in the server environment to increase GitHub's authenticated rate allowance. It is sent only to `api.github.com`, never included in the response, and redirects are rejected. Public requests work without a token but are subject to GitHub's lower unauthenticated limits.

### Provider evidence and caching

The comparison server keeps no process-local evidence cache. npm manifests, OSV records, Bundlephobia estimates, GitHub release/directory/file reads, and tarball inspections are fetched again by every request that needs them, and nothing is shared between requests, isolates, or restarts. Within a single request, each comparison side's manifest is fetched once and shared across that request's branches; that sharing never outlives the request. The two sides fetch independently even when their version strings are equal.

Warm and overlapping comparisons therefore reuse no earlier provider evidence: each request waits for its own upstream calls; the application no longer retains mutable evidence such as OSV or Bundlephobia results between requests. There is no KV store, cache service, or new dependency. A deployment-native cache for provider evidence (for example Cloudflare's Cache API) is deliberately deferred; when it is added, it must not be an isolate-local `Cache`.

The single durable cache is the briefing result store described below: a successful briefing is permanent, keyed by the exact evidence hash, and read before provider configuration. No other briefing evidence is cached — a later request rebuilds the factual evidence, repacks the packet, and reuses the stored response only when that hash still matches.

Deterministic provider failures and unavailable measurements are never retained; the next request makes a fresh attempt.

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

To exercise the briefing path without paying for generation, point these three settings at a local OpenAI-compatible fixture endpoint—loopback HTTP is allowed—and treat its output as a test double rather than real inference. Only set real credentials when you intend to pay for real generations; no smoke or development workflow requires them.

Model choice matters for latency. Measured against OpenCode Go with a real comparison payload: `glm-5.3-flash` answered in 7–11 s (three of three requests produced a valid briefing), `mimo-v2.5` in 13–75 s, and the reasoning models `deepseek-v4-flash` and `qwen3.8-flash` spent 2.3–4.5k tokens on hidden reasoning and needed 37–50 s. `minimax-m2.7` returned HTTP 500 from the gateway. Prefer a fast model such as `glm-5.3-flash`; requests that exceed the deadline come back as `timeout`.

After evidence collection and local comparison finish, a non-streaming AI request summarizes the evidence through Effect's OpenAI-compatible provider (`@effect/ai-openai-compat` over `effect/unstable/ai`). Invalid provider output gets one fresh generation via `Effect.retry` (at most two attempts), reusing the same evidence and prompt without refetching non-AI data or feeding rejected text back to the model. HTTP/authentication failures, transport failures, timeouts, configuration errors, and local evidence-packaging failures are not retried. There are no repair conversations, browsing, tools, or Jev calls. The request uses ordinary Chat Completions fields rather than requiring provider-specific structured-output support, and every attempt is validated locally. Provider reasoning may consume part of each attempt's 4,096-token output allowance.

An available `briefing` contains `status`, `model`, `bullets`, and collected `sources`. Fresh generations return one to five distinct, comparison-relevant insights about consequential changes, security findings, and specific migration actions, preferring fewer useful points over padding. Each generated bullet has `kind` (`change` or `migration`), `basis` (`fact`, `maintainer`, or `inference`), text, and `evidenceIds`. Fresh output validation rejects coverage bullets; the prompt focuses on specific insights rather than generic disclaimers, unchanged-metadata inventories, or repeated points. The prompt requires timeless, exact-version wording: advisory matches do not establish discovery time or the first affected release, and recency or latest-release status must not be inferred. Coverage remains a structured source in the response even when no bullet cites it. Existing permanent snapshots remain unchanged and may contain the previous `coverage` bullet kind. Source records contain IDs, labels, provenance URLs, and evidence text. Internal coverage evidence has no external URL. The model cannot supply new citation URLs or inline links. Local validation checks structure and reference membership, not whether every interpretation is semantically correct; this is not a verified safety or compatibility verdict.

Successful briefings are stored permanently in the Cloudflare D1 binding `BRIEFINGS_DB`, which is required. The key is SHA-256 of the bounded evidence packet sent to the model. A later request still refreshes factual evidence enough to build that packet, then reuses the stored response when the hash matches. Changed advisories, release notes, measurements, or other model-visible evidence create a new snapshot and may generate a new briefing. API-key, endpoint, model, and prompt changes do not invalidate an existing snapshot; this preserves the already-generated result.

Storage is first-writer-wins: the first validated response stored for a hash stays in place, and a later duplicate insert for the same hash is ignored. `created_at` defaults to the insert time but is not part of the key, so it never affects reuse. A missing binding, an unapplied schema, or a failed read returns `cache-error` before any provider request. A write failure also returns `cache-error`, but can occur after the provider has already generated a result; D1 persistence cannot undo that spend. Install the schema with `nub run --node db:migrate:local`.

Unavailable briefings have empty bullets/sources and a sanitized reason: `not-configured`, `invalid-config`, `provider-error`, `cache-error`, `timeout`, or `invalid-response`. All three settings absent disables AI; incomplete configuration is invalid. A failed briefing changes only the briefing endpoint's response; the factual comparison route never calls the provider and is unaffected.

Evidence packaging is bounded to 48 KiB and 64 sources, with maintainer excerpts capped at 4 KiB. Advisory evidence keeps computed match groups, IDs/aliases, summaries, severity, source links, and coverage status; it explicitly excludes full affected-version ranges and reference lists, which remain available from the factual comparison endpoint. Sources are admitted in priority order with coverage space reserved, skipping sources that cannot fit rather than evicting every smaller fact. Omitted or truncated evidence becomes an explicit coverage limitation. Conservative Markdown version-heading matching excludes unversioned, unreleased, and out-of-range changelog sections. The AI stage has one 75-second total deadline across both attempts, including body decoding and validation, a 128 KiB response limit per attempt enforced while reading, and no redirects. HTTPS is required except for HTTP loopback development endpoints.

Raw credentials are not exposed, and credentials or raw provider error bodies never enter either endpoint's response.

The briefing route is still synchronous: its response waits for evidence collection, inference, and storage. Inference is not coalesced — two concurrent requests that miss D1 for the same evidence hash, even inside the same isolate, may each call the provider and pay for a generation. D1 decides only which persisted result becomes canonical (first writer wins); it is not a spend limiter. Queueing, global inference budgets, and push notifications are later milestones and are not part of this runtime.

### Published npm tarballs

Each tarball lookup starts as soon as its own npm manifest resolves, without waiting for the other manifest, GitHub, OSV, or Bundlephobia. The downloads can overlap; every lookup downloads and verifies its own artifact instead of reusing an earlier inspection. GitHub still waits for both manifests to validate repository agreement, but does not wait for either tarball.

The browser-facing `/compare/measurements` response exposes `from.tarball` and `to.tarball` summaries:

- `status`: `available`, `partial`, or `unavailable`; `reasons` explains incomplete inspection. Failure for one version preserves the other version and all unrelated evidence.
- `url`: the manifest's published tarball URL.
- `fileCount`: the number of inspected package files.
- `changelogCount`: the number of matching changelog files.

The full per-file inventory (`path`, `type`, `size`, `sha256`, and link targets) and changelog bodies (`path`, UTF-8 `body`, and `truncated`) remain server-side for briefing evidence packing; they are not returned by either comparison route. These artifact contents are not version-filtered release notes or source diffs.

A complete archive with no matching changelog is `available` with `changelogCount: 0`; that does not mean there were no changes. Truncated text or invalid UTF-8 marks inspection `partial` while preserving the server-side inventory and summary counts. Integrity, transport, archive, and hard resource-limit failures return `unavailable` with zero summary counts, never a misleading partial inventory.

Inspection accepts only `https://registry.npmjs.org` URLs without credentials or fragments, rejects redirects, sends no registry/GitHub credentials, and performs no retries. It verifies the strongest supported manifest integrity digest (SHA-512, SHA-384, SHA-256), or the legacy SHA-1 `shasum` only when integrity is absent. A present but unsupported or invalid integrity value never falls back to SHA-1.

Limits per version: ten seconds, 10 MiB downloaded, 32 MiB decompressed archive, 10,000 entries, 4,096 characters per archive path/link target, 256 KiB captured per changelog, and 1 MiB total captured changelog text. Archives must use npm's `package/` root; malformed/truncated archives, duplicate paths, unsafe paths or link targets, and unsupported entry types are rejected. Parsing uses in-memory archive data only: no filesystem extraction, package installation, lifecycle scripts, or package imports. This is artifact evidence, not a claim that the package is safe to execute.

## Local D1 persistence

Briefing snapshots live in the emulated Cloudflare D1 database bound as `BRIEFINGS_DB`, defined in the root `wrangler.jsonc` with migrations from `migrations/`. Apply the schema explicitly; it is never installed lazily by a briefing request:

```bash
nub run --node db:migrate:local
```

`nub run --node dev` runs that migration before starting Nuxt dev, so development normally needs no separate step. The database files are git-ignored under `.wrangler/state`, are local-only, and are never synced to a remote service. The binding is not optional: without it, or against a database missing the schema, the briefing route answers `cache-error`.

Effect `4.0.0-rc.115` is used exactly as published. The repository carries no dependency patch and configures no `patchedDependencies`; a patch that bridged shared `Cache` waiters through a native promise existed only while the process-local caches did. Cross-request promise safety stays enabled.

## Moving existing briefing snapshots

Snapshots generated before D1 can be carried over without regenerating them. Stop the application that owns the old file first and keep a backup; the exporter opens the source read-only, never writes to it, and leaves it in place. The default source is `.data/briefings.db`; a setup that previously used a custom `AI_BRIEFING_CACHE_PATH` passes that file as the source argument instead, since the path is no longer a runtime setting. Run the exporter on plain Node 26 (the `.node-version` release) so `node:sqlite` and TypeScript execution are available:

```bash
cp .data/briefings.db .data/briefings.db.bak
nub --node scripts/export-briefings.ts .data/briefings.db .data/briefings-export.sql
nub run --node db:migrate:local
nub exec -- wrangler d1 execute BRIEFINGS_DB --local --config wrangler.jsonc --persist-to .wrangler/state --file .data/briefings-export.sql
```

The exporter writes a new SQL file and refuses to touch an existing one, so a previous export is never overwritten. Every row is validated before it is emitted: a malformed row, a key that is not a 64-character lowercase SHA-256, or a stored response that fails the briefing schema stops the export with a nonzero exit and leaves no importable partial output. Stored JSON text and its `created_at` value are copied verbatim—escaped for SQL literals but never decoded and re-encoded—so already-paid responses survive exactly. The generated SQL uses `ON CONFLICT (evidence_hash) DO NOTHING`, so importing it into a D1 database that already holds a snapshot for the same hash preserves the existing winner, and re-running the import is safe.

The exporter is an offline operational script. Its `node:sqlite` and filesystem access are never imported into the application server or Worker graph.

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

Vitest discovers `*.unit.ts` files under `app/`, `server/`, `shared/`, and `scripts/`, using a Node environment with `~`, `@`, and `#shared` aliases. Import test helpers explicitly from `vitest`. Nuxt and Nitro ignore these files during application discovery, and `pages.pattern` keeps page routes to `.vue` files so page-owned modules such as `versionSearch.ts` are not routed. The local `npmx.dev/` reference checkout is not part of the suite.

`Select` keeps search opt-in: pass a `search` prop (`{ filter, placeholder?, emptyMessage? }`) to render the filter input, or omit it for a plain list. The version-select filter lives with the page that owns it and is covered by local fixtures for ranking, numeric/hash/date matches, tag descriptions, normalization, stable ordering, and input preservation. The suite does not start Nuxt or call the npm registry.

## Production runtime

Build the application, then boot the built Worker locally under the real Cloudflare runtime, through Nub without runtime augmentation:

```bash
nub run --node build
nub run --node db:migrate:local
nub run --node preview
```

`build` emits the Worker entry, assets, and the generated `.output/server/wrangler.json`, which carries the built `main`/`assets` alongside the same local `BRIEFINGS_DB` binding as the root `wrangler.jsonc`. `preview` runs that generated config with `wrangler dev --local` (real `workerd`), serving on port `5173` from all interfaces and persisting to `.wrangler/state`. Dev and preview therefore share one physical local D1 database: run them sequentially, never concurrently.

Nuxt's entry-import-map optimization is disabled: Firefox can load modules from HTTP preload headers before the HTML import map is registered, leaving the server-rendered page non-interactive with an unresolved `#entry` error. Direct chunk imports avoid that startup failure while retaining SSR streaming. After changing the Nuxt build configuration, check search, search-to-comparison navigation, and a direct comparison-page reload in both Firefox and Chromium—not only the API responses.

Use `.output/server/.dev.vars` for this preview's server-only settings. Wrangler also supports dotenv fallback, so do not assume an absent `.dev.vars` disables credentials. A build recreates the output directory; copy the intentionally configured, git-ignored file after every build:

```bash
cp .dev.vars .output/server/.dev.vars
```

`nub run --node dev` reads `.env` instead. Keep the same intentional server-only settings in whichever local file the runtime you use reads; neither file is committed, and neither should hold real credentials for a fixture-based check.

The root `wrangler.jsonc` is a local-only development configuration. Its `database_id` is a placeholder, `remote` is disabled, and no account id, route, or secret is defined, so it is not deployable as-is: do not run `wrangler deploy` against it. Remote resources and the production launch gate belong to M4, which is a separate milestone. Nuxt-side deployment options are described in the [Nuxt deployment documentation](https://nuxt.com/docs/getting-started/deployment).
