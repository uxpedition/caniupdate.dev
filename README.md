# Can I update?

A Nuxt starter using Nub, Effect v4 RC, Oxlint, and Oxfmt.

## Legal pages

`/privacy` and `/terms` currently display `TBD` while their contents are under review. Both use `app/layouts/site.vue`, the shared layout also used by comparisons. The homepage and shared layout link to them through `SiteFooter.vue`.

`TBD` is only a placeholder, not an effective policy. Before publishing these pages as effective policies, confirm the production OpenRouter workspace's separate input/output logging and product-improvement settings, and the applicable provider data-processing/international-transfer arrangements; the provider allowlist and ZDR setting alone do not establish those facts. Update the privacy page to match those confirmations, then replace the placeholder with reviewed content and a review date. Planning assumptions to revisit: Cloudflare Workers Free logging (three-day retention), no visitor analytics, no Discord logging/export bots, and support correspondence kept only while needed for resolution and necessary follow-up. Reassess operator-address disclosures if the service becomes commercial or promotes paid services.

## Setup

Install the locked dependency graph with Nub:

```bash
nub ci
```

The `preinstall` guard rejects other package managers so `nub.lock` remains canonical.

## Development

Start the Nuxt development server on port `5173`, exposed on all network interfaces including Tailscale:

```bash
nub run --node dev
```

Open `http://<tailscale-ip>:5173` from another device. Get this device's current Tailscale IPv4 address with `tailscale ip -4`.

Nub's `--node` mode keeps Nub as the package/script runner while disabling its runtime augmentation for Nuxt worker processes. Node 26 is pinned by `.node-version` and TypeScript 6.0.3 is pinned in `package.json`; run project scripts as `nub run --node ...` so the Nuxt and Nitro processes execute on plain Node.

The Effect-based `dev` launcher applies the local D1 migration through `workers/briefing/wrangler.jsonc`, starts the private evidence Worker on port `8790` (inspector `9230`) and the private briefing Worker on port `8791` (inspector `9231`), waits for both to report readiness, then starts Nuxt with HMR on port `5173`. It stops all three processes on Ctrl-C or on any sibling failure, and it holds `launcher.lock` in the persistence root, so `dev` and `preview` cannot own the same local state at once. No Cloudflare account, API token, or remote resource is needed. Local D1 and Durable Object state is git-ignored under `.wrangler/state`: Nitro's dev proxy points at its `v3` subdirectory, and the launcher hands Wrangler the parent path, which appends `v3` itself.

Two browser-facing hostnames: the comparison page on `http://localhost:5173`, and the briefing Worker's public read-only socket on port `8791`, the `eventsUrl` a submission returns. A page opened from another device is served on this machine's own address, so the launcher runs the briefing Worker on every interface and allows every Origin that page can have — the loopback aliases and each non-internal interface address on the frontend port — in its `BRIEFING_ALLOWED_ORIGIN` list. The advertised URL stays `ws://localhost:8791`, and each submission is answered with that same socket re-pointed at the host the request arrived on, because only the request knows which address the device used; the briefing Worker then compares the browser's `Origin` byte-for-byte against its list. The Nuxt Worker reaches both private Workers through bindings resolved locally in Wrangler's dev registry — `PACKAGE_EVIDENCE` for the evidence Durable Object and `BRIEFING_SERVICE` for the briefing Worker's private `BriefingSubmitter` entrypoint — so the private Workers keep their own local sessions and only the briefing Worker owns the local D1 database. `node scripts/dev.ts --preview` starts the built frontend from `.output/server/wrangler.json` on `5173` instead of Nuxt. `--persist-to <dir>`, `--evidence-port`, `--briefing-port`, `--frontend-port`, and `--inspector-base` override the documented defaults; `node scripts/smoke.ts` uses them to run the isolated scenario below beside a live session.

Nuxt development reads `.env` (see `.env.example`), which may set `NUXT_PUBLIC_SITE_URL` to the address this page is opened on — `http://localhost:5173`, or this machine's LAN/Tailscale address such as `http://100.122.224.20:5173` when previewing from another device — so local pages render matching canonical links; without it those links are simply absent. Run `dev` and the production preview sequentially, never at the same time: two runtimes must not own that local D1 state concurrently.

The setup includes an Effect-backed health endpoint at `/api/health`.

### Comparison interface

Search for a package on the homepage, choose versions, and open `/{encodedPackageName}/{from}...{to}`. For example, `/vue/3.4.38...3.5.13` compares Vue releases using the live comparison and AI briefing APIs. Scoped package names are URL-encoded. The homepage title is `Can I update? · Review npm package changes before updating`; comparison titles use `<packageName> <fromVersion> -> <toVersion> · Can I Update?`.

The comparison prioritizes dependency changes, estimated gzip impact, and advisory coverage. Every comparison row has a Lucide info icon beside its title with an explanation available on hover, keyboard focus, or tap. Expand individual categories for complete declarations and measurement notes; AI migration notes and source evidence are collapsed initially. Citation links reveal their referenced evidence. Bullets cite evidence by number; the response keeps the cited sources plus coverage and renumbers them from zero, so the evidence index reads `[0] … [n]` with coverage last.

Bundle estimates with omitted dependencies remain visible but are marked “Incomplete estimate” for the affected version. Their delta reads “Not comparable: incomplete build”, and expanded details list the omitted dependencies for each version. Missing measurements use separate availability messages. These warnings do not change the backend comparability rules.

Row and evidence anchors deep-link: opening `#comparison-dependencies`, `#comparison-advisories`, or a citation anchor scrolls to that element once the comparison and briefing render. Declaration rows can already exist in SSR HTML, while measurement rows and briefing/citation entries arrive from client-side queries; `app/router.options.ts` replaces Nuxt's default scroll behavior with one that waits for the anchor to exist — up to 30 seconds — and scrolls to the last reachable position when the anchor sits near the end of the page.

The shared theme in `app/assets/css/main.css` defines neutral light/dark surfaces, DM Sans headings and body text, monospace package data, and a blue change/focus accent. Blue indicates a change, not a risk rating. Homepage controls retain their original responsive layout and dimensions. The self-hosted DM Sans face is cached immutably and preloaded in production HTML so a cold load does not wait until after first paint to discover it.

Comparison loading is tiered. During SSR, the page prefetches declarations and streams the package description together with the comparison table, including `Measuring…` placeholders for tier-2 rows. The description renders below the package name inside the same deferred component as “At a glance”, so it is visible before hydration and does not wait for measurements. The route-only header and declarations loader can still stream before that component resolves. Measurements and AI notes start client-side after the resolved versions arrive and fill in without interaction; a measurements endpoint failure degrades each affected row or tile to `Unavailable` instead of blocking declarations. Nuxt disables streaming for crawler user agents.

## Package comparison API

`GET /api/package/{encodedPackageName}/compare?from={versionOrTag}&to={versionOrTag}` returns `{ packageName, from, to, comparison }` for the resolved versions. The `comparison` contains declaration fields only: `dependencies`, `peers`, `node`, `moduleFormat`, `exports`, `types`, `licenses`, and `installScripts`. `from` and `to` contain registry manifest declarations; measurement evidence is served by the sibling measurements route, while `releaseNotes` are collected only inside the server-side briefing pipeline. This route makes no GitHub request.

Registry search and manifests come from the public `https://registry.npmjs.org` over HTTPS through the application's own Effect HTTP client. There is no npm CLI configuration, `.npmrc`, proxy-agent, or registry-authentication support, and no retry layer: the product requests the public registry explicitly and anonymously.

### Measurements route

`GET /api/package/{encodedPackageName}/compare/measurements?from={version}&to={version}` returns `{ packageName, from, to, comparison: { sizes, advisories } }` for a resolved pair. The page calls it with the exact versions resolved by the declarations response; each returned version includes a `tarball` summary with `status`, `reasons`, `url`, `fileCount`, and `changelogCount`. The per-file inventory, changelog bodies, and briefing evidence packing stay in the private Durable Object backend.

#### Measurement evidence

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. The measurements route makes one batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed. Each batch/detail request has a five-second deadline including response decoding, and the complete OSV producer has a 30-second deadline. A batch timeout marks both versions unavailable; a detail timeout retains its matched ID as partial evidence. If the producer deadline expires, both versions are unavailable.

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

`POST /api/package/{encodedPackageName}/compare/briefing?from={versionOrTag}&to={versionOrTag}` submits the AI briefing for the same pair, where `from` and `to` are the resolved versions. It accepts the same parameters and validation as the comparison route, collects evidence server-side through the private evidence object, and never trusts browser-supplied facts. The route owns no generation, no store, and no credential: it forwards the bounded packet to the briefing Worker's private entrypoint and answers with one of two envelopes.

- `200 { status: 'available', packageName, from, to, briefing }` — the stored briefing for this exact evidence hash.
- `202 { status: 'queued' | 'running', packageName, from, to, hash, eventsUrl, revision }` — a job the page follows on the briefing Worker's own hostname (`ws://localhost:8791` locally, re-pointed at the host the request arrived on when the service advertises a loopback URL). The socket sends `queued`/`running` frames carrying a revision, then one terminal `available` frame with the briefing or `unavailable` frame with a sanitized reason, and closes. A reconnect re-reads that snapshot and never starts inference.

A refused submission is an opaque `503`; the page resubmits once after 250 ms, and since submissions are hash-addressed the resubmission can only rejoin the same job. The factual comparison route stays independent and never waits for inference.

A pending browser subscription has one 180-second deadline from its first socket attempt; progress frames and reconnects do not reset it. Expiry closes that browser's socket and fails its query without marking the shared job unavailable or cancelling generation. Query cancellation on comparison changes also releases only that subscriber; an already-cancelled subscription opens no socket and preserves its abort reason. Reconnects re-read job state and never resubmit.

#### Briefing release-note collection

GitHub collection starts after both npm manifests resolve their repository metadata, without waiting for OSV. Release pagination and the entire commit-pinned changelog lookup run concurrently. Only dependent requests—later release pages, reading a discovered changelog file, or discovering a fallback release tag—wait for their prerequisites. GitHub requests have a five-second timeout including the body, a 1 MiB response limit, and no retries. Release pagination stops after ten pages, preserving earlier results as partial evidence if later pages fail or the bound is reached.

Non-GitHub hosts, missing/malformed repository metadata, and repository/directory changes return unavailable release evidence without GitHub requests; npm and OSV results remain intact. GitHub failures, missing notes, and rate limits also preserve the rest of the comparison. This does not fetch GitLab/Bitbucket notes. Published tarball evidence is returned separately, as described below.

Optionally set `GITHUB_TOKEN` in the evidence Worker environment to increase GitHub's authenticated rate allowance. For local dev and preview, put it in the git-ignored `workers/evidence/.dev.vars`; for a deployment, use a secret on the evidence Worker, not the Nuxt Worker. It is sent only to `api.github.com`, never included in the response, and redirects are rejected. Public requests work without a token but are subject to GitHub's lower unauthenticated limits.

### Provider evidence and caching

Measurements and briefing evidence use the required `PACKAGE_EVIDENCE` binding to a separate private Worker. One SQLite-backed `PackageEvidence` Durable Object per npm package owns reusable evidence across version pairs, requests, and runtime restarts. The declarations route remains independent and uncached.

- Verified archive inspections persist without a TTL, keyed by `archive-inspector-v2` and the manifest integrity policy. Present SRI always takes precedence over legacy shasum, including malformed SRI. Changed integrity or inspector revision causes a miss. Identical integrity can reuse an inspection across versions and URLs, but the current URL must still pass validation.
- Successfully decoded manifests, complete OSV evidence, successful Bundlephobia estimates, and complete GitHub evidence expire after five minutes. Keys include `comparison-evidence-v1` and all result-affecting inputs. Changed mutable evidence is observed after expiry; failed/unavailable results and provider results containing transient partial failures are not persisted.
- Identical in-flight misses share native promises within their owning object. Completed evidence is read from SQLite rather than retained indefinitely in JavaScript memory. There is no shared Effect Cache or patched runtime.
- Large inspection JSON is split into Unicode-safe chunks below SQLite row limits and replaced atomically. Stored values are checked against provider result schemas on read. Expired mutable records are reclaimed on cache access. Immutable records have no automatic eviction policy: monitor account storage and request/duration quotas.
- Module-scoped, reject-fast Effect semaphores bound each backend isolate to two archive inspections, two distinct collection/response jobs, and sixteen pending HTTP requests (including coalesced callers). Permits wrap their owning archive inspection, shared collection, or request and release on every Effect exit; a coalesced collection waiter does not acquire another response permit. Excess work receives a temporary 503 rather than waiting on another object's I/O. These are per-isolate bounds, not an account-wide concurrency or memory guarantee. Caller disconnects do not cancel shared DO-owned cache population; provider deadlines, including OSV's five-second request and 30-second producer limits, apply to that shared work.

The frontend receives only measurement summaries or a briefing packet capped at 48 KiB / 64 sources. Missing bindings, storage failures, and backend failures return a sanitized 503; they never trigger archive work in the frontend. Evidence-cache schema initialization either succeeds during object construction or throws a tagged storage error; a failed object rejects evidence requests before collection begins. The backend has no public HTTP application endpoint.

The separate D1 briefing-result cache remains permanent and keyed by the exact model-visible evidence hash. Requests rebuild the bounded packet from fresh-or-reused evidence, then check D1 before provider configuration. Evidence coalescing applies to the comparison pipeline's evidence cache; duplicate submissions for one hash rejoin that hash's job object and share a single generation, while distinct evidence hashes can still incur independent inference charges.

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

These three settings belong to the private briefing Worker, not to the Nuxt environment: put them in the git-ignored `workers/briefing/.dev.vars` beside its Wrangler config for local runs, or set them as a Worker secret for a deployment. Nuxt reads no AI setting, and nothing needs to be copied into `.output/server/.dev.vars` (see `.env.example`):

```dotenv
AI_BRIEFING_ENDPOINT=https://opencode.ai/zen/go/v1/chat/completions
AI_BRIEFING_API_KEY=your-development-key
AI_BRIEFING_MODEL=deepseek-v4-flash
```

For OpenRouter, replace the endpoint with `https://openrouter.ai/api/v1/chat/completions`, the key with your OpenRouter key, and the model with `deepseek/deepseek-v4-flash`. The endpoint is the complete OpenAI-compatible Chat Completions URL: its path must end with `/chat/completions`, and query parameters are rejected. Production deployments must set the environment explicitly on the briefing Worker; do not expose these settings in public runtime configuration. Restart the local briefing Worker after changing `.dev.vars`.

To exercise the briefing path without paying for generation, point these three settings at a local OpenAI-compatible fixture endpoint—loopback HTTP is allowed—and treat its output as a test double rather than real inference. Only set real credentials when you intend to pay for real generations; no smoke or development workflow requires them.

Model choice matters for latency. Measured against OpenCode Go with a real comparison payload: `glm-5.3-flash` answered in 7–11 s (three of three requests produced a valid briefing), `mimo-v2.5` in 13–75 s, and the reasoning models `deepseek-v4-flash` and `qwen3.8-flash` spent 2.3–4.5k tokens on hidden reasoning and needed 37–50 s. `minimax-m2.7` returned HTTP 500 from the gateway. Prefer a fast model such as `glm-5.3-flash`; requests that exceed the deadline come back as `timeout`.

After evidence collection and local comparison finish, a non-streaming AI request summarizes the evidence through Effect's OpenAI-compatible provider (`@effect/ai-openai-compat` over `effect/unstable/ai`). Invalid provider output gets one fresh generation via `Effect.retry` (at most two attempts), reusing the same evidence and prompt without refetching non-AI data or feeding rejected text back to the model. HTTP/authentication failures, transport failures, timeouts, configuration errors, and local evidence-packaging failures are not retried. There are no repair conversations, browsing, tools, or Jev calls. The request uses ordinary Chat Completions fields rather than requiring provider-specific structured-output support, and every attempt is validated locally. Provider reasoning may consume part of each attempt's 4,096-token output allowance.

An available `briefing` contains `status`, `model`, `bullets`, and collected `sources`. Fresh generations return one to five distinct, comparison-relevant insights about consequential changes, security findings, and specific migration actions, preferring fewer useful points over padding. Each generated bullet has `kind` (`change` or `migration`), `basis` (`fact`, `maintainer`, or `inference`), text, and `evidenceNumbers`, the `sources[].number` values it cites. Fresh output validation rejects coverage bullets; the prompt focuses on specific insights rather than generic disclaimers, unchanged-metadata inventories, or repeated points. The prompt requires timeless, exact-version wording: advisory matches do not establish discovery time or the first affected release, and recency or latest-release status must not be inferred. Coverage remains a structured source in the response even when no bullet cites it. Existing permanent snapshots remain unchanged and may contain the previous `coverage` bullet kind; snapshots written before sources were numbered by packet position no longer satisfy the stored-response schema and are unreachable, because numbering is part of the hashed packet. Source records contain their packet position, an ID, a label, provenance URLs, and evidence text. Internal coverage evidence has no external URL. The model cannot supply new citation URLs or inline links. Local validation checks structure and reference membership, not whether every interpretation is semantically correct; this is not a verified safety or compatibility verdict.

Successful briefings are stored permanently in the Cloudflare D1 binding `BRIEFINGS_DB` on the briefing Worker, which is required. One SQLite-backed job Durable Object per evidence hash owns the submission: it stores the bounded packet, claims a generation lease, reconciles against D1 before and after the provider call, and notifies its subscribers. A Cloudflare Queue only wakes that object with a hash and a generation id, so the packet, the prompt, and the credential never travel through it. A queued or running job is a service-binding call and a socket read only; only a POST can start a generation, and a failed generation stays terminal until a later POST. The key is SHA-256 of the bounded evidence packet sent to the model. A later request obtains factual evidence under the freshness policy above, rebuilds that packet in the evidence backend, then reuses the stored response when the hash matches. Changed advisories, release notes, measurements, or other model-visible evidence create a new snapshot and may generate a new briefing. API-key, endpoint, model, and prompt changes do not invalidate an existing snapshot; this preserves the already-generated result.

Storage is first-writer-wins: the first validated response stored for a hash stays in place, and a later duplicate insert for the same hash is ignored. `created_at` defaults to the insert time but is not part of the key, so it never affects reuse. A missing binding, an unapplied schema, or a failed read returns `cache-error` before any provider request. A write failure also returns `cache-error`, but can occur after the provider has already generated a result; D1 persistence cannot undo that spend. Install the schema with `nub run --node db:migrate:local`.

Unavailable briefings have empty bullets/sources and a sanitized reason: `not-configured`, `invalid-config`, `provider-error`, `cache-error`, `timeout`, or `invalid-response`. All three settings absent disables AI; incomplete configuration is invalid, and a submission against an unconfigured or misconfigured briefing Worker is refused with the sanitized `503` before any job exists. A D1 read failure prevents the provider call; a write failure is never reported as durable success. A failed briefing changes only the briefing route's answer; the factual comparison route never calls the provider and is unaffected.

Evidence packaging is bounded to 48 KiB and 64 sources, with maintainer excerpts capped at 4 KiB. Advisory evidence keeps computed match groups, IDs/aliases, summaries, severity, source links, and coverage status; it explicitly excludes full affected-version ranges and reference lists, which remain available from the factual comparison endpoint. Sources are admitted in priority order with coverage space reserved, skipping sources that cannot fit rather than evicting every smaller fact. Omitted or truncated evidence becomes an explicit coverage limitation. Conservative Markdown version-heading matching excludes unversioned, unreleased, and out-of-range changelog sections. The AI stage has one 75-second total deadline across both attempts, including body decoding and validation, a 128 KiB response limit per attempt enforced while reading, and no redirects. HTTPS is required except for HTTP loopback development endpoints.

Raw credentials are not exposed, and credentials or raw provider error bodies never enter either endpoint's response.

Generation is asynchronous: a `202` submission returns as soon as the packet is durable and the Queue has accepted the pointer, and the page follows the job on the socket. The job Durable Object's serialized decision sections mean two simultaneous submissions for one hash share a single generation, and a duplicate Queue delivery for a settled or superseded generation only reports the current snapshot. D1 still decides which persisted result becomes canonical (first writer wins) and is not a spend limiter: the OpenRouter key's configured budget is the spend boundary. Access control, per-account budgets, and deployment observability are later milestones and are not part of this runtime.

### Published npm tarballs

Each tarball lookup starts as soon as its own npm manifest resolves, without waiting for the other manifest, GitHub, OSV, or Bundlephobia. On an inspection-cache miss, downloads can overlap within the backend admission limit; warm requests reuse the verified persisted inspection. GitHub still waits for both manifests to validate repository agreement, but does not wait for either tarball.

The browser-facing `/compare/measurements` response exposes `from.tarball` and `to.tarball` summaries:

- `status`: `available`, `partial`, or `unavailable`; `reasons` explains incomplete inspection. Failure for one version preserves the other version and all unrelated evidence.
- `url`: the manifest's published tarball URL.
- `fileCount`: the number of inspected package files.
- `changelogCount`: the number of matching changelog files.

The full per-file inventory (`path`, `type`, `size`, `sha256`, and link targets) and changelog bodies (`path`, UTF-8 `body`, and `truncated`) remain server-side for briefing evidence packing; they are not returned by either comparison route. These artifact contents are not version-filtered release notes or source diffs.

A complete archive with no matching changelog is `available` with `changelogCount: 0`; that does not mean there were no changes. Truncated text or invalid UTF-8 marks inspection `partial` while preserving the server-side inventory and summary counts. Integrity, transport, archive, and hard resource-limit failures return `unavailable` with zero summary counts, never a misleading partial inventory.

Inspection accepts only `https://registry.npmjs.org` URLs without credentials or fragments, rejects redirects, sends no registry/GitHub credentials, and performs no retries. It verifies the strongest supported manifest integrity digest (SHA-512, SHA-384, SHA-256), or the legacy SHA-1 `shasum` only when integrity is absent. A present but unsupported or invalid integrity value never falls back to SHA-1.

Limits per version: ten seconds, 10 MiB downloaded, 32 MiB decompressed archive, 10,000 entries, 4,096 characters per archive path/link target, 256 KiB captured per changelog, and 1 MiB total captured changelog text. Archives must use npm's `package/` root; malformed/truncated archives, duplicate paths, unsafe paths or link targets, and unsupported entry types are rejected. The bounded compressed download is verified before a 64 KiB streaming gunzip/tar pipeline inspects it with backpressure; the complete decompressed archive is never buffered. Output listeners and entry inspection are registered before compressed input is fed, so invalid gzip can terminate inspection without leaving cleanup waiting on a closed parser. There is no filesystem extraction, package installation, lifecycle script execution, or package import. This is artifact evidence, not a claim that the package is safe to execute.

## Local D1 persistence

Briefing snapshots live in the emulated Cloudflare D1 database bound as `BRIEFINGS_DB` in `workers/briefing/wrangler.jsonc`, whose `migrations_dir` is the repository's `migrations/`. The briefing Worker is the only local owner of that database: the root `wrangler.jsonc` declares no D1 binding, so neither Nitro's dev proxy nor the built frontend opens it. Apply the schema explicitly; it is never installed lazily by a briefing request:

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
nub exec -- wrangler d1 execute BRIEFINGS_DB --local --config workers/briefing/wrangler.jsonc --persist-to .wrangler/state --file .data/briefings-export.sql
```

The exporter writes a new SQL file and refuses to touch an existing one, so a previous export is never overwritten. Every row is validated before it is emitted: a malformed row, a key that is not a 64-character lowercase SHA-256, or a stored response that fails the briefing schema stops the export with a nonzero exit and leaves no importable partial output. Snapshots written before sources were numbered by packet position fail that schema check, so the exporter refuses them. Stored JSON text and its `created_at` value are copied verbatim—escaped for SQL literals but never decoded and re-encoded—so already-paid responses survive exactly. The generated SQL uses `ON CONFLICT (evidence_hash) DO NOTHING`, so importing it into a D1 database that already holds a snapshot for the same hash preserves the existing winner, and re-running the import is safe.

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

Vitest discovers `*.unit.ts` files under `app/`, `server/`, `shared/`, `scripts/`, and `workers/`, using a Node environment with `~`, `@`, and `#shared` aliases. Import test helpers explicitly from `vitest`. Nuxt and Nitro ignore these files during application discovery, and `pages.pattern` keeps page routes to `.vue` files so page-owned modules such as `versionSearch.ts` are not routed. The local `npmx.dev/` reference checkout is not part of the suite.

`Select` keeps search opt-in: pass a `search` prop (`{ filter, placeholder?, emptyMessage? }`) to render the filter input, or omit it for a plain list. The version-select filter lives with the page that owns it and is covered by local fixtures for ranking, numeric/hash/date matches, tag descriptions, normalization, stable ordering, and input preservation. The suite does not start Nuxt or call the npm registry.

## Production runtime

Build the application, then boot the built Worker locally under the real Cloudflare runtime, through Nub without runtime augmentation:

```bash
NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run --node build
nub run --node db:migrate:local
nub run --node preview
```

`build` emits the Nuxt Worker entry, assets, and `.output/server/wrangler.json`, then dry-runs the backend bundle from `workers/evidence/wrangler.jsonc` without deploying it. `type-check` checks both Nuxt and the standalone backend TypeScript project. The build refuses to run unless `NUXT_PUBLIC_SITE_URL` names a valid origin (`scripts/check-site-url.ts`): canonical and social URLs are absolute, and the prerendered homepage bakes the build-time value into its HTML. It is public configuration, never a secret, and it is never derived from a request's `Host` or forwarded headers. The deployed Worker must carry the same value — that cannot repair already generated HTML, it only keeps server-rendered pages consistent with the prerendered ones.

`preview` runs the same launcher with `--preview`, so the three runtimes are the built frontend on `5173` (real `workerd`, from `.output/server/wrangler.json`) plus the evidence Worker on `8790` and the briefing Worker on `8791`. The generated frontend config carries only `PACKAGE_EVIDENCE` and `BRIEFING_SERVICE`; the briefing Worker's own session owns `BRIEFINGS_DB`, its job Durable Objects, and the provider settings from `workers/briefing/.dev.vars`. All three sessions persist to `.wrangler/state`, and the launcher lock refuses a concurrent `dev` or `preview` against the same root. Backend SQLite tables initialize inside each object; a first deployment also requires the configured `v1` SQLite-class migration for the evidence object and the job object.

Nuxt's entry-import-map optimization is disabled: Firefox can load modules from HTTP preload headers before the HTML import map is registered, leaving the server-rendered page non-interactive with an unresolved `#entry` error. Direct chunk imports avoid that startup failure while retaining SSR streaming. After changing the Nuxt build configuration, check search, search-to-comparison navigation, and a direct comparison-page reload in both Firefox and Chromium—not only the API responses.

The frontend has no server-only settings of its own any more — only the public `NUXT_PUBLIC_SITE_URL` (see `.env.example`) — so `.output/server/.dev.vars` is neither needed nor created by the launcher; a build recreates `.output/`, and no credential belongs there. The briefing Worker reads the git-ignored `workers/briefing/.dev.vars` beside its config in both `dev` and `preview` (verified locally with the loopback fixture). Wrangler also supports dotenv fallback, so do not assume an absent `.dev.vars` disables credentials; never put a real provider key in `.env` or in a repo file.

The default environment in `wrangler.jsonc` remains local-only: its database ID is a placeholder and `remote` is disabled. Never deploy the default environment. The separately approved remote trial uses the explicitly named `preview` environment below; it is not the full production rollout or the later queue/client milestones.

### Remote preview trial

**Current status (2026-10-01):** The preview runs the current frontend/API, evidence Worker, and asynchronous briefing Worker, including the Queue, job Durable Object, socket route, and briefing-owned D1. The deployed versions and one-minute 10/25 req/s warm-cache results are recorded in [Cloudflare handoff](docs/cloudflare-handoff.md). No AI credentials were deployed or inference requests made. The load run used one generator location and does not establish cold-cache, global, or production Free-tier capacity. [Optimization plan](docs/optimization-plan.md) records remaining SSR/hash/tracing work.

- Site: <https://can-i-update-preview.caniupdate-dev.workers.dev>
- Account: `caniupdate.dev` (`8a0be24aad326a55ba610b94b106be81`).
- Frontend Worker: `can-i-update-preview`. Private backends: `can-i-update-preview-evidence` and `can-i-update-preview-briefing`. All three current Workers are deployed; latest version IDs and the tested workload are in [Cloudflare handoff](docs/cloudflare-handoff.md).
- D1: `can-i-update-preview-briefings`, bound as `BRIEFINGS_DB` by the briefing Worker. Remote migrations use `workers/briefing/wrangler.jsonc`, whose `migrations_dir` resolves to the repository's migrations.
- The preview Queue (`can-i-update-preview-briefings`), SQLite-backed briefing job Durable Object, and public read-only socket route are deployed. No AI credentials, custom-domain routes, KV, or paid-plan upgrade are part of this trial. Cloudflare Access protects the preview hostname; automated checks use a locally stored Access service token. The default local environment and its existing data stay separate.
- Canonical and social URLs are built from `NUXT_PUBLIC_SITE_URL`: this trial publishes `https://can-i-update-preview.caniupdate-dev.workers.dev` (`env.preview.vars`), which is also the build-time value in the deployment command below. Production will use `https://caniupdate.dev` for both the build and its Worker environment. The value is never read from the request.

Deployment credentials live outside the repository in `~/.config/can-i-update/cloudflare.env` (directory mode `700`, file mode `600`), with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token is scoped to this account: Workers Scripts Edit, D1 Edit, and Workers Tail Read for live diagnostics. Do not put deployment credentials in app `.env` or `.dev.vars` files. Explicit token authentication leaves other projects' Wrangler OAuth login unchanged.

Stop the local preview before rebuilding its output. Build without loading deployment credentials, then migrate and deploy with the restricted credentials in a subshell:

```bash
NUXT_PUBLIC_SITE_URL=https://can-i-update-preview.caniupdate-dev.workers.dev nub run --node build
(
  set -a
  . "$HOME/.config/can-i-update/cloudflare.env"
  set +a
  export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
  export CLOUDFLARE_INCLUDE_PROCESS_ENV=false
  nub x --node wrangler queues create can-i-update-preview-briefings &&
    nub x --node wrangler d1 migrations apply BRIEFINGS_DB --remote --config workers/briefing/wrangler.jsonc --env preview &&
    nub x --node wrangler deploy --config workers/evidence/wrangler.jsonc --env preview &&
    nub x --node wrangler deploy --config workers/briefing/wrangler.jsonc --env preview &&
    nub x --node wrangler deploy --config .output/server/wrangler.json --env preview
)
```

The deployment sequence above was run on 2026-10-01: the Queue already existed, D1 had no pending migrations, and the evidence, briefing, and frontend Workers were deployed in order. AI secrets remain unset; the API load run exercised only measurements. Keep `--env preview` on every remote command and deploy the private backends before the frontend so its bindings resolve. `nub run --node preview` still starts only the local runtime; its name does not select the remote environment.

The 2026-10-01 remote warm-cache load run exercised three TypeScript version pairs and mixed TypeScript, Nuxt, Vue, and minimist comparisons. At 10 and 25 requests/s for 60 seconds per workload, all 4,200 requests returned validated HTTP 200 responses; no 503s, transport errors, or skipped requests. Warm-run p95 latency ranged from 30–44 ms and p99 from 36–51 ms. This is one generator location and mostly warmed evidence: it is not a cold-cache, global-concurrency, or sustained Free-tier CPU test. Full per-run results: `.data/preview-load-2026-10-01.json`. No AI inference was requested.

Historical 2026-09-24 live-tail samples showed CPU times above the [documented Workers Free 10 ms allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time): for example, 35 ms for measurements and 140 ms for a briefing evidence request, both returning 200. Cloudflare documents limited flexibility for occasional overruns; successful smoke requests do not prove sustained Free-tier suitability. Profile CPU and larger-package workloads before treating this trial as production-ready. Do not enable public paid inference without separately addressing access and spending controls.
