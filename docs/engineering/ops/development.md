# Development operations

This guide describes local development and the contributor verification workflow.

For remote environments, see [deployment](deployment.md). For verification evidence and state recovery, see [releases and recovery](releases-and-recovery.md).

## What do I need to contribute?

Use Node 26, pinned in [`.node-version`](../../../.node-version), and Nub 0.9.6, pinned by the [`packageManager` field](../../../package.json). Run project scripts through Nub.

```bash
nub ci
nub run dev
```

Open `http://localhost:5173`. Local contribution needs no Cloudflare account, deployment token, or paid AI provider.

The hosted stage is optional. Contributors can submit locally verified changes without deploying an instance. Maintainers can deploy a reviewed revision to the official integration stage.

**Local development is reachable by other devices on connected networks.** The launcher exposes the frontend and briefing socket on all network interfaces; it is not an authenticated private service. For Tailscale, use this machine's Tailscale address on port `5173`.

## Zed Vue tooling

`@vue/language-server`, `@vue/typescript-plugin`, and `vue-tsc` are pinned to 3.3.11. Zed's managed Vue extension currently installs 3.3.12. Its TypeScript plugin reports a false `TS2322` (`… is not assignable to type 'never'`) for the generic Reka Combobox update handler in `Combobox.vue` and `Select.vue`.

`.zed/settings.json` starts the project-local Vue server through Nub. It points vtsls at the local plugin through `/proc/self/cwd`, which resolves to the Zed remote workspace root on Linux. After `nub ci`, restart both `vue-language-server` and `vtsls` to load the locked versions.

Remove the temporary 3.3.11 pins and Zed override only after a later Vue language-tools release passes both checks in Zed:

- Neither component shows false diagnostics.
- A deliberately incompatible event handler still produces a diagnostic.

Keep `vue-tsc` aligned with the language-tools release used by the editor workaround.

## What starts locally?

[`scripts/dev/dev.ts`](../../../scripts/dev/dev.ts) applies local D1 database migrations, starts both backend Workers, waits until they are ready, then starts the frontend. Ctrl-C or failure of any child process stops them all.

| Runtime         | Default port | Responsibility                                                    |
| --------------- | ------------ | ----------------------------------------------------------------- |
| Frontend        | `5173`       | Nuxt HMR, comparison APIs, private briefing submission            |
| Evidence Worker | `8790`       | Package evidence Durable Objects                                  |
| Briefing Worker | `8791`       | D1, briefing job Durable Objects, Queue, read-only browser socket |

Inspector ports are `9230`, `9231`, and `9232`. The browser connects to both the frontend and the briefing socket. The launcher configures socket origins for local network addresses. The frontend replaces advertised loopback socket hosts with the host used by the requesting device.

Local data lives under `.wrangler/state` by default. A `launcher.lock` prevents `dev`, `dev:built`, and manual migrations from using the same state at once. Each Wrangler session has its own subdirectory: `evidence/v3`, `briefing/v3`, or `frontend/v3`.

Separate directories avoid conflicts over internal Cache API SQLite metadata during concurrent cold starts. Different application database names alone do not prevent those conflicts.

Before migrations or Worker startup, the launcher holds the lock and relocates old state:

- `v3/d1` moves to `briefing/v3/d1`.
- The two application Durable Object (DO) namespaces move to their owning runtime's `v3/do` directory.
- Whole directories move, including SQLite journals. An interrupted move resumes on the next run.

**If both old and new stores exist, startup stops without overwriting either.** Stop all runtimes, back up both stores, and reconcile them before restarting. Do not delete state or remove a live launcher's lock to bypass this check.

Unrelated old namespaces and internal caches stay untouched. The new runtimes do not use those old internal caches.

`nub run db:migrate:local` uses the same launcher with `--migrate-only`. It takes the lock, relocates old state if needed, applies local D1 migrations in the briefing directory, then exits without starting Workers. Use `nub run db:migrate:local --persist-to <directory>` only for an intentionally independent data directory.

## Where does configuration belong?

See [`.env.example`](../../../.env.example) for the current contract. Local environment files and Worker `.dev.vars` files are ignored by Git.

| Setting                         | Local owner                                    | Remote owner                                                                                                  |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_SITE_URL`          | Frontend `.env` and built dev runtime          | GitLab `stage` and `production` scope; frontend Worker runtime secret                                         |
| `NUXT_PUBLIC_TELEMETRY_ENABLED` | Frontend `.env`                                | Required `true` or `false` in GitLab `stage` and `production`; frontend Worker only                           |
| `NUXT_OTEL_ENDPOINT`            | Frontend `.env`                                | Derived for the frontend Worker from each environment's shared GitLab endpoint input; omission clears to `""` |
| `NUXT_OTEL_HEADERS`             | Frontend `.env`                                | Derived for the frontend Worker from each environment's shared GitLab headers input; omission clears to `{}`  |
| `AI_BRIEFING_ENDPOINT`          | `workers/briefing/.dev.vars`                   | GitLab `stage` and `production`, briefing Worker secret                                                       |
| `AI_BRIEFING_API_KEY`           | `workers/briefing/.dev.vars`                   | GitLab `stage` and `production`, briefing Worker secret                                                       |
| `AI_BRIEFING_MODEL`             | `workers/briefing/.dev.vars`                   | GitLab `stage` and `production`, briefing Worker secret                                                       |
| `BRIEFING_PUBLIC_URL`           | Local `workers/briefing/wrangler.jsonc` `vars` | GitLab `stage` and `production`, briefing Worker secret                                                       |
| `BRIEFING_ALLOWED_ORIGIN`       | Local `workers/briefing/wrangler.jsonc` `vars` | Derived from environment-specific `NUXT_PUBLIC_SITE_URL`; never a GitLab input                                |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | `workers/briefing/.dev.vars`                   | GitLab `stage` and `production` shared input; derives endpoint for frontend and briefing Workers; optional    |
| `OTEL_EXPORTER_OTLP_HEADERS`    | `workers/briefing/.dev.vars`                   | GitLab `stage` and `production` shared input; derives headers for frontend and briefing Workers; optional     |
| `GITHUB_TOKEN`                  | `workers/evidence/.dev.vars`                   | Optional GitLab `stage` or `production` value; omission clears the evidence Worker secret to `""`             |

GitLab stage and production share one telemetry pair: `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. Only the frontend and briefing Workers receive it.

- Enter headers as single-line JSON with string keys and string values. CI validates the map once, then derives each Worker's runtime names.
- The pair is optional. When omitted, CI sends an empty endpoint and `{}` headers to both Workers to clear old managed values.
- `NUXT_PUBLIC_TELEMETRY_ENABLED` is required as `true` or `false`. `true` requires the shared endpoint and controls frontend export only. The briefing Worker exports whenever its endpoint is configured.
- The GitLab endpoint must use HTTPS, without URL credentials, a query, or a fragment. Local loopback HTTP endpoints remain available for development.

Local names stay separate: Nuxt uses `NUXT_OTEL_*` in `.env`; briefing uses `OTEL_EXPORTER_*` in `workers/briefing/.dev.vars`. The required `AI_BRIEFING_ENDPOINT` is an HTTPS Chat Completions URL ending in `/chat/completions`, without URL credentials, a query, or a fragment.

See [deployment](deployment.md#where-do-credentials-and-runtime-settings-go) for exact remote values, visibility, scopes, and credentials. Use the [Grafana Cloud values guide](deployment.md#how-do-i-get-the-grafana-cloud-values) for the shared pair and the [GitHub token guide](deployment.md#how-do-i-create-the-github-token) for the optional evidence Worker token.

GitLab owns all remote runtime inputs. CI sends each Worker's complete list of allowed settings through a temporary `--secrets-file`. Explicit empty/default values clear optional settings omitted from GitLab rather than leaving stale secrets.

The credential-free `build-smoke` job receives public artifact identity, but no site origin or runtime/deployment credentials. Encrypting a public value as a Worker secret does not make it private.

Deployment and smoke credentials are separate from application settings:

- `CLOUDFLARE_API_TOKEN` is GitLab-only, scoped exactly to `stage` or `production`.
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are smoke credentials scoped only to `stage`.
- None belongs in a Worker secret file.

**Keep provider credentials out of the frontend `.env`, public runtime configuration, evidence Worker, and `.output/server/.dev.vars`.** The frontend has no AI settings or D1 binding. Builds recreate `.output`.

Wrangler can fall back to dotenv settings. Deleting `.dev.vars` does not prove a real credential cannot load. Keep real keys out of repository dotenv files and the environment used for default local checks.

Local hot-module replacement (HMR) and built dev can omit `NUXT_PUBLIC_SITE_URL`; pages then have no canonical link. Set it to the actual local frontend origin when those links are needed. Builds need no origin. If supplied, Nuxt validates it without embedding it in the artifact.

Local HTML defaults to `X-Robots-Tag: noindex, follow`, even with a production-looking configured origin.
The deployment helper derives `NUXT_INDEXING_ENABLED` from the validated target; it is not a build input or a new
GitLab setting. Stage stays `false`; production alone receives `true`. The
[reviewed inventory](../overview.md#search-indexing-pilot) and successful declaration SSR must also permit indexing.

The homepage includes a description and Open Graph and Twitter card metadata in the initial HTML. Its social card image is a static 1200 × 630 PNG. Image URLs use only the configured runtime origin, never request headers. Without an origin, the description remains but canonical, social page, and image URLs are omitted. The image describes package-version evidence, not compatibility approval.

The homepage also includes one JSON-LD graph in the initial HTML, describing the [WebSite](https://schema.org/WebSite) and [WebApplication](https://schema.org/WebApplication). Both use the homepage's name and description. With a configured origin, their URLs and fragment identifiers use that origin, and the website names the application as its main entity. Without an origin, both descriptions remain, but URLs, identifiers, and the reference between them are omitted. The graph belongs to the homepage and is removed when navigating away.

Validate the emitted JSON-LD with the [Schema Markup Validator](https://validator.schema.org/). Check both configured and unset origins, then navigate away and back in Chromium and Firefox to confirm that the graph is not duplicated. The markup describes the product; it does not claim ratings, reviews, compatibility approval, or eligibility for a search rich result.

## How do I check the built runtime?

Stop a launcher that owns `.wrangler/state` before starting another. Stop the built dev runtime before rebuilding its output.

```bash
nub run build
NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run dev:built
```

`build` needs no site origin and does not embed one. Nuxt validates an origin if supplied. Wrangler then dry-runs all three Workers without deploying, writing the exact deployment bundles to:

- `.output/workers/frontend/index.js`
- `.output/workers/evidence/index.js`
- `.output/workers/briefing/index.js`

`dev:built` reads `NUXT_PUBLIC_SITE_URL` at startup. It uses `.output/server/wrangler.json` for the frontend instead of Nuxt HMR and applies local migrations. Without a site URL, the built page has no canonical link.

**Local `dev:built` does not select the remote Wrangler `stage` environment or create remote resources.** It uses the root config, where Workers Cache is disabled. It can verify rendered HTML and policy headers, but not hosted edge-cache hits, eviction, or cache invalidation after deployment.

Pages use buffered SSR so title and canonical tags are literal HTML for both browsers and crawlers. Do not enable
[Nuxt SSR streaming](https://nuxt.com/docs/4.x/guide/going-further/experimental-features#ssrstreaming) while sharing
edge-cached HTML between user agents. Streaming can deliver page metadata only as JavaScript patches. Nuxt's crawler
exclusion applies at the origin, not when a crawler receives a browser-warmed cache entry. Buffering waits for the
declarations prefetch on a cold comparison request; browser revalidation and edge TTLs remain unchanged.

For a frontend-only missing-route and protection check, run `nub run smoke:routes:built` after building. It loads the deployable frontend bundle in local Miniflare/workerd. It checks unknown-route `404` responses, existing pages and health, invalid comparison input, exhausted-limit `429` responses, and missing-binding `503` responses. Both HTML and JSON request preferences receive Nitro's sanitized JSON errors. This check needs no credentials, backend Workers, migrations, saved state, or provider calls.

Run `nub run smoke:comparison:built` to check comparison response boundaries against fixed registry fixtures. It checks malformed routes (`400`), unknown packages and versions (`404`), temporary declaration failures (`503`), private error details, and usable declaration HTML (`200`) when measurements fail. CI runs this check against the built frontend. It needs no credentials, backend Workers, migrations, or external provider requests.

The same smoke checks production and nonproduction indexing against fixed registry fixtures. It verifies all twenty
reviewed comparisons and static pages, excluded and reverse comparisons, tracking-free canonical identity, and
reviewed comparisons with unavailable or insufficient declarations. Measurements and AI remain unavailable, proving
that they do not gate useful SSR facts.
It also checks production sitemap URLs against successful pages, canonical links and indexing headers; nonproduction
empty sitemaps; robots advertisement; and zero provider requests while rendering sitemap and robots output.

The same command checks eligible reviewed measurement SSR through isolated private binding fixtures: no stored notes,
stored success, partial or unavailable measurements, and a stored-read failure. It compares ordinary and crawler
overviews, checks measurement/read call counts and unchanged HTML-cache eligibility, and rejects generation submissions.
These fixtures have no job namespace, queue, credentials, or external providers. They verify frontend request bounds,
not provider-cache reuse inside the evidence Worker; the existing evidence tests cover that behavior.

For browser recovery, install the pinned Playwright browsers with `nub exec playwright install --with-deps chromium firefox`, then run `nub run smoke:comparison:built --browsers`. Each browser receives an initial `503`, recovers declarations without changing the comparison URL, and reloads successfully with `200`. Missing backend bindings deliberately keep measurements and AI notes unavailable. For manual inspection, `nub run smoke:comparison:built --serve` serves the same fixtures on loopback port `5273`; open `/recovery-fixture/1.0.0...2.0.0` once for the initial failure and client recovery.

The browser option also checks hydrated measurement facts and home/Back navigation in Chromium and Firefox.
It writes screenshots to an operating-system temporary directory and prints their paths.

The comparison smoke also checks dependency resolution with the real frontend and evidence Workers and fixed registry fixtures. It verifies non-cacheable redirects to the lowest matching published releases, shared metadata reuse, no-match responses, and recovery from temporary metadata failures. With `--browsers`, Chromium and Firefox open the changed-dependency popover, check that hovering makes no dependency metadata request, and follow copied links in a new tab and links activated with the keyboard.

Changing `NUXT_PUBLIC_SITE_URL` takes effect on the next built dev start or frontend Worker deployment. No rebuild is needed.

To check that one build works under different origins:

1. Build once without a site origin.
2. Start built dev with one `NUXT_PUBLIC_SITE_URL`.
3. In Chromium and Firefox, check canonical/social URLs, working search and version selection after hydration, navigation, and reload.
4. Stop built dev, change only the runtime origin, and repeat without rebuilding.
5. Under both origins, check that homepage headers retain browser revalidation and a one-year edge time-to-live (TTL).

Wrangler dev writes scratch bundles under `.output/server/.wrangler/`. Exclude that dev-only directory when comparing deployment artifact checksums. CI smoke uses a separate artifact copy so scratch files cannot enter the deployment artifact.

## How do I run checks?

```bash
nub run prepare
nub run type-check
nub run lint:check
nub run format:check
nub run test
```

`prepare` generates Nuxt configuration and installs Git hooks. Type checking covers Nuxt and both standalone Workers. Unit tests sit beside their implementation with the `.unit.ts` suffix. Use `nub run test:watch` while iterating.

`lint:check` and `format:check` leave files unchanged. The `lint` and `format` scripts modify files; use them intentionally.

Git hooks check lint, types, formatting, and commit messages. They do not run tests; run those separately.

### CI and merge protection

[`.gitlab-ci.yml`](../../../.gitlab-ci.yml) validates merge requests (MRs) and pushes to `main`. Other branch pushes do not create duplicate pipelines.

New commits on the same branch or MR cancel superseded validation jobs, including running builds and smoke checks.
The workflow uses [`on_new_commit: interruptible`](https://docs.gitlab.com/ci/yaml/#workflowauto_cancelon_new_commit);
only validation jobs opt into interruption. Delivery triggers, deployments, stage browser checks, and releases remain
non-interruptible. A newer commit therefore cannot interrupt a started delivery or release operation.

Jobs use a pinned Node image, Nub from the `packageManager` pin, and `nub ci`. They run the existing non-fixing package checks without changing lint severities or adding a coverage threshold.

### Dependency download cache

The [shared bootstrap](../../../scripts/deploy/ci-bootstrap.yml) sets `npm_config_store_dir` to
`$CI_PROJECT_DIR/.cache/nub/store`. Nub 0.9.6 uses this supported `storeDir` setting for its
[content-addressed package store](https://github.com/nubjs/nub/blob/v0.9.6/vendor/aube/crates/aube-store/src/lib.rs).
This is not npm's cache. Nub's separate `NUB_CACHE_DIR` controls metadata and policy caches, not downloaded package contents.

GitLab saves only `store/v1/files/` and `store/v1/index/`: downloaded package files and their integrity-keyed indices.
It does not save `node_modules`, linked or built packages, Nuxt output, browser binaries, runtime state, configuration,
or credentials. Every job still runs `nub ci`, including lifecycle scripts, patch application, and Nub's normal
integrity checks. Before installing, bootstrap runs
[`nub store status`](https://github.com/nubjs/nub/blob/v0.9.6/vendor/aube/docs/cli/store/status.md) to verify every indexed
file's BLAKE3 hash. If validation fails, bootstrap discards both cached directories and lets `nub ci` download them again.
This is necessary because Nub 0.9.6's warm install samples stored files rather than checking every file.
The cache is optional, not an install artifact; installation failures still fail the job without a retry.

Only `build-smoke` uploads a cache, after success. All other bootstrapped jobs, including deployment and browser child
jobs, only download it. Parallel validation jobs do not wait for a cache writer; a first pipeline may install cold in
several jobs. This avoids an extra setup stage and repeated uploads. Later pipelines and child jobs can reuse a completed
cache. A cancelled or failed build leaves cache population to a later successful build.

Keys include the Node and Nub pins, Linux/x64 platform, ref and protection status, and hashes of `nub.lock` and the
Drizzle patch. Keep the explicit patch input current when adding or renaming patches. Update the platform segment when
changing runner architecture or image platform; bump `nub-download-v1` when changing the stored layout or clearing a
suspect cache. No fallback keys are configured. Keep GitLab's
[separate caches for protected branches](https://docs.gitlab.com/ci/caching/#cache-key-names) enabled, never enable
`cache:unprotect`, and do not configure `CACHE_FALLBACK_KEY`. Ref isolation keeps maintainer-started MR caches separate
from `main` even when GitLab assigns both its protected suffix.

Nub 0.9.6 indices contain absolute store paths. A cache restored under a different checkout path can miss and download
packages again; it is not a portable installed dependency tree. Do not rewrite those indices or cache linked packages to
work around this. Confirm reuse in GitLab job logs and compare cache transfer time with install time before broadening
the policy. Local timings do not establish runner-minute savings. Shared runner storage or distributed caching is a
[GitLab runner prerequisite](https://docs.gitlab.com/ci/caching/#good-caching-practices), not something this repository
configures.

### Required validation

The required `quality` job checks `CI_MERGE_REQUEST_TITLE` with `nub run commitlint` in MR pipelines, using the same [`commitlint.config.mjs`](../../../commitlint.config.mjs) as the commit-message hook. It reuses the job's dependency installation before running the other quality checks. Use a Conventional Commit title, such as `fix(comparison): preserve missing evidence`, so it can become the squash commit subject. Push pipelines skip title validation, and MR pipelines do not check every commit on the source branch.

After editing a title, start a new pipeline from the MR's **Pipelines → Run pipeline** action before merging. A title edit alone does not trigger an [MR pipeline](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/). A passing pipeline validates the title supplied to that pipeline, not later title edits. Keep the final squash commit subject consistent with the validated title.

The test job uses four Vitest workers. The [sequencer](../../../test/realAlarm.sequencer.ts) starts the two real-time alarm guards first. Other suites share a fresh Worker bundle and use test-only clock control. Keep suite discovery, isolated storage/runtimes, and native scheduling guards intact when changing test scheduling.

Required gates cover:

- MR titles against the existing commit-message rules.
- Types across all three runtimes, lint, and formatting.
- The complete Vitest suite and migration consistency.
- Deployable frontend/backend bundles and built-application smoke.

`build-smoke` runs `nub run build`. Then `nub run build:identity` records the commit SHA, pipeline ID, each Worker bundle's hash, and the full `.output/` digest before uploading that exact artifact. The separate `smoke:built` job uses it with fixture-only briefing settings and isolated data.

This is not a hosted-stage check or an offline check: public evidence providers and build-time font downloads still need the network. CPU sampling is not part of the gate.

`build-smoke` has ten minutes. Quality, unit tests, and `smoke:built` each have five minutes, including bootstrap and dependency installation. These limits do not guarantee runner queueing time or total pipeline duration. If a job exceeds its limit, investigate the bottleneck rather than silently extending the timeout or skipping checks.

Validation jobs have no deployment credentials. Their reusable dependency cache is limited to the download-store paths above. Only `build-smoke` uploads `.output/`, retained for seven days. It has no GitLab environment and receives no site origin, private Worker runtime settings, or deployment credentials.

A passing protected `main` push continues to `stage:delivery`; MRs do not deploy. The child pipeline runs `deploy:stage`, then independent Chromium and Firefox `verify:stage` jobs. Its parent holds the `stage` resource-group lock through deployment and both browser checks, preventing another pipeline from replacing the site mid-test.

Child jobs use environment `stage`. `nub run deploy:stage` invokes `scripts/deploy/deploy.ts`, and Workers use Wrangler `--env stage`. Build artifacts and sanitized deployment/verification records have Maintainer-only access and bounded retention.

Protect all configured variables and use exact scopes:

- Stage inputs and credentials: `stage`.
- Production inputs and credentials: `production`.
- Access credentials: `stage` only.

Before deployment, stop or wait for any pipeline targeting the same resources outside the current `stage` lock. Different resource-group names do not coordinate deployments.

Bootstrap rejects credentials and private runtime settings outside their permitted jobs before dependency installation. Keep unprotected deployment/provider secrets out of project/group variables. Fork pipelines run in the fork, not with parent-project resources. Keep MR access to protected variables/runners restricted.

See [automatic stage deployment](deployment.md#automatic-main-to-stage-deployment) for setup, verification, and failure behavior.

The GitLab project requires successful pipelines and does not accept skipped pipelines. `main` allows Maintainers to merge, but nobody to push directly; force pushes are disabled. Fast-forward merging requires a source branch containing the current `main`. Rebase when `main` advances, then wait for the new revision's pipeline before merging. Do not bypass validation with `[skip ci]`.

These settings live in GitLab, not in YAML. Maintainers must preserve them under **Settings → Merge requests** and **Settings → Repository → Branch rules**, including when recreating or moving the project. See GitLab's [pipeline merge checks](https://docs.gitlab.com/user/project/merge_requests/auto_merge/#require-a-successful-pipeline-for-merge), [merge methods](https://docs.gitlab.com/user/project/merge_requests/methods/), and [fork pipeline controls](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/#run-pipelines-in-the-parent-project).

When changing CI configuration or project merge settings, verify hosted enforcement with an MR pipeline, including a deliberately failing check that blocks merge. Local checks and CI Lint simulations do not prove hosted enforcement.

A passing MR does not deploy. After review and normal merge, protected-main pipelines that complete validation
continue to stage; a newer commit can cancel superseded validation before delivery. The blocking manual `release:tag`
input becomes available only after required checks and stage Chromium/Firefox verification pass.

The selected version creates an immutable tag and receipt, not a version commit or MR. Production uses that receipt to promote the exact build-smoke artifact without rebuilding. Ordinary merges never deploy production. See [manual protected-main release](deployment.md#manual-protected-main-release) for prerequisites.

### Test harnesses

[`vitest.config.ts`](../../../vitest.config.ts) controls test discovery and runtime settings. Keep `.unit.ts` suites beside their implementation. Root `test/` holds shared helpers, not discovered suites.

Follow the nearest suite: `.harness.ts` starts runtimes and returns teardown; `.stub.ts` stands in for external systems.

Inject Effect HTTP services and use H3 `mockEvent` for handlers. Restore stubbed globals, environment, and timers. When needed, inject `FetchHttpClient.Fetch` per run: its default service can cache a global fetch stub. Assert boundary behavior, uncertainty, privacy, cancellation, and persistence, not implementation details. See [verification conventions](../../../CODE_CONVENTIONS.md#evidence-driven-review).

The pinned Miniflare 5 alpha types import Zod, but its published runtime dependencies omit it. The exact-pinned development dependency supplies those types for clean installs. Application boundary validation still uses Effect schemas. Do not remove Zod based only on an existing local dependency tree.

Worker `.workerd.unit.ts`, `workers/briefing/jobs.unit/`, and `sockets.unit/` suites exercise real Miniflare/workerd storage, queues, sockets, and restarts.

Briefing [global setup](../../../workers/briefing/test/workerBundle.globalSetup.ts) builds once per test run with pinned Wrangler. It passes the temporary directory through Vitest's [provide/inject contract](https://vitest.dev/config/globalsetup.html). Each suite loads those unchanged modules; its fixtures still own the Miniflare runtimes and data lifetimes. These do not become shared global state.

Watch reruns rebuild before tests start. Even focused pure-unit runs pay this fixed build cost.

The [clock harness](../../../workers/briefing/test/clock.harness.ts) appears only in opted-in test manifests, never the deployed Worker. It advances that Worker isolate's `Date.now()` to the deadline stored by production code, schedules its [native alarm](https://developers.cloudflare.com/durable-objects/api/alarms/#storage-methods) for immediate delivery, and waits for the production handler to return.

This is not a general virtual clock. Provider timeouts, socket handshakes, other Worker clocks, and Node timers remain real. `leaseExpiry.unit.ts` retains the real 90-second lease/restart guard. `eviction.unit.ts` retains real dispatch alarms and hibernating socket delivery. Keep production durations intact rather than shortening them for tests.

Duplicate and stale Queue-message cases use isolated runtimes. They wait for both real messages to be acknowledged before asserting one provider call. The completion signal is the pinned Miniflare broker's batch log, emitted after the consumer returns. A changed log format fails this completion check rather than silently passing.

Other checks for absence still use quiet windows. No provider call or socket frame is not, by itself, proof that work finished.

### Comparison interface

The global `app.head.htmlAttrs` setting in `nuxt.config.ts` declares English (`lang="en"`) in initial HTML, including Nuxt error documents. Pages inherit it through hydration and client navigation; do not repeat it in individual pages.

When changing document metadata, inspect raw HTML for the homepage, About, Privacy, a comparison, and Nuxt's error renderer. Then check hydration and in-app navigation in Chromium and Firefox. Unknown routes return sanitized JSON rather than an HTML error document; check HTML errors through `/__nuxt_error?statusCode=404` and `/__nuxt_error?statusCode=500`.

For comparison URL changes, check exact releases, tags, ranges, scoped packages, prereleases, and reverse direction in raw responses and browser direct loads and client navigation. Include returning to a comparison already held in the query cache. Moving selectors must use non-cacheable `302` redirects; permanent redirects are only for equivalent formatting of exact releases. Confirm that the final URL, title, visible versions, and canonical identity agree. Known tracking parameters are omitted from canonical links, while unknown parameters and repeated values remain. Check a canonical scoped URL directly to catch redirect loops caused by the router decoding path characters.

The homepage footer reaches the bottom of the viewport when content fits. Shorter or narrower screens scroll naturally. When changing the layout, check both cases and footer wrapping; do not assume a fixed footer height.

After a successful comparison, the shared form moves from the homepage to the navigation header and resets for another search. On compact screens it wraps to a second header row. In-app home links and browser Back animate it home; Forward animates it into the header again.

On homepage load or reload, the form fades in and rises 12 px over 400 ms after a 60 ms delay. That intro does not replay on in-app return. The product explanation and homepage footer use the same fade and rise on initial load and every return home, including browser Back and the logo link. The hero enters on initial load and return home. All entry and form-relocation animations honor reduced-motion preferences.

On comparison-page entry, the navigation header and footer use the content's 180 ms fade and 16 px rise after a 120 ms delay. The site layout owns these shared transition styles. Other site pages do not animate their header or footer on load.

The unpacked package size, estimated minified bundle, estimated gzip bundle, and published tarball rows do not expand. They show values and comparison notes inline, with definitions available from their info controls. The tarball row shows file counts and inspection coverage. Check that measurement loading, unavailable values, and incomplete estimates remain visible without a detail panel.

Expanded dependency and peer dependency sections show one table per version, side by side on wide screens and stacked on compact screens. Each header shows the package version and dependency count. Rows show package names, declared version ranges, and an “Optional” badge where applicable. Check both sections with optional entries and empty declarations when changing these tables.

The expanded security advisories section uses the same two-table layout and six-row scrolling limit. Each version's table lists matched advisory IDs linked to their OSV records, with summaries where available. Headers show counts and coverage. Missing details retain the advisory link; partial or unavailable coverage must not look like a complete list with no matches.

Above the advisory tables, a summary counts matches “only in previous,” “only in new,” and “present in both” when coverage is complete. Nonzero counts open popovers with links to the matching OSV records. Hover, click, tap, or use Enter to open them; Escape closes them. Lists scroll after six entries. Counts reuse the comparison's alias groups, so records describing the same issue count once. With incomplete coverage, one-sided matches appear as “unconfirmed,” not as proven differences. Confirmed shared matches remain available, but their list may be incomplete; an empty shared list says “No shared matches confirmed.”

Above each dependency table pair, a padded summary bar with a muted background counts updated, removed, and added dependencies separately. Updates include changes to a declared version range or optional status. The tables themselves have no shared background or outer padding.

Expanded blocks with background colors use the same 6 px corner radius as the AI notes and dependency tables. This includes the dependency changes bar.

Hover over, click, tap, or focus and press Enter on a nonzero updated count to see each updated dependency and its old and new declared version ranges. Each dependency appears on its own line. Links compare the lowest published release matching each range on the current site. Package metadata loads when the panel opens. If metadata is unavailable or a range has no matching release, the row explains why no link is available. The panel supports keyboard navigation and Escape to close.

Removed and added counts open separate panels. Removed entries show the old declared range; added entries show the new range. Zero counts are plain text and do not open a panel.

Dependency and advisory summaries share the generic [`HoverPopover`](../../../app/components/element/HoverPopover.vue) interaction. Callers own their labels, content, and which group is open. Hover panels close after 150 ms outside both the count and panel; moving into the panel keeps links clickable. Touch does not open a hover panel. Click, tap, and keyboard-opened panels remain open when the pointer leaves. Focusing content also keeps it open. Escape returns focus to the count; clicking or tapping outside dismisses the panel. Opening another count replaces the open panel within that summary. Verify these interactions in Chromium and Firefox, including touch at 320 px and 390 px.

Tables and hover-panel lists show at most six dependency entries before scrolling. Table version headers remain visible while scrolling. The limit uses rendered row heights so wrapped names and version ranges do not cut a row in half. Longer lists can also be focused and scrolled by keyboard.

Package surface starts collapsed, with a path total and ESM/CJS/TYPES evidence badges for each version. Ticks mark strong metadata evidence; circled question marks mark weaker indications. Badges without evidence are omitted. Format badges describe declared files across package paths, not `import`/`require()` support at the root. Expand for summary counts and separate version trees, using the dependency-table layout. Each tree shows at most six rows before scrolling and keeps its version header visible. Folder-only rows and blocked paths do not inflate path totals; wildcard patterns have separate counts. Missing export lists leave counts unknown rather than zero.

Check badge help by hover, keyboard focus, and tap, including clicking an already-hovered badge. Declared bundled types keep their tick. After measurements arrive, exact adjacent declaration-file matches add a question-mark TYPES badge with the matched JavaScript entry-target count. Its help must leave type resolution, correctness, and full export coverage unverified. Check pending and unavailable measurements, zero matches, and navigation or reverse comparisons without stale badges. Archive inventories stay private; only status and a bounded count reach the browser.

Bundled declarations and file matches take precedence over external types. Without them, a successful client-only metadata lookup for `@types/name` (or `@types/scope__name` for scoped packages) adds an uncertain TYPES badge and an npmx link. Check the version-compatibility warning and absent or failed lookups. Do not request types-of-types packages or delay declaration rendering for this lookup.

A deprecated latest `@types` release uses a warning-triangle TYPES badge, not the ordinary question mark. Its help names the `@types` release, includes the maintainer notice as plain text, and refers to the compared version in that column. Verify both comparison directions, a nondeprecated latest release with older deprecated releases, and empty notices. The warning follows the registry's `latest` tag, not the highest version number, and must not replace a bundled-types tick or an archive-match hint.

Tree rows have no horizontal dividers. Nesting guides connect across rows, continue past nested descendants when another sibling follows, and stop at the last child. Check these guides with wrapped path names and while scrolling.

Check nested paths, per-version membership, scoped package names, wildcard patterns, absent export maps, explicit `null` blocks, and changed condition order. Loading previews open on hover, focus, or tap and describe only the selected version. Moving into a preview keeps it open. Arrow Down focuses its scrollable content; Escape or the close button dismisses it and returns focus. Preview height follows the available viewport space.

On touch devices, tap a path, then swipe inside its preview. The preview must remain open after the gesture ends, keep focus inside, and scroll its own content rather than the page. Touch pointer exits must not start the mouse-hover close timer. Verify outside-tap and close-button dismissal as well as desktop hover and keyboard scrolling.

Check accordion toggling, format badges, summary counts, and help popovers in Chromium and Firefox, including narrow screens. **Package details** starts closed and contains a compact version comparison of JavaScript fields and type entries. Compiler-version mappings have their own disclosure. Verify these disclosures by keyboard. Citation links to loading or types open both the exports accordion and package details. Examples must stay metadata-based: do not infer unsupported loading styles from `type` alone, expand wildcard patterns into invented files, or treat missing declarations as missing functionality.

When changing this interface, exercise submission, reset, Back/Forward, fragment links, compact layouts, and reduced motion.

Comparison-route recognition uses an Effect Schema shape check: `packageName` and `versionPair` must be strings; unrelated params are allowed. The route composable handles each separately. A missing or non-string value becomes `''` without discarding the other valid param.

`Combobox` leaves placeholder and accessible input-label copy to its caller; `ComparisonForm` supplies “Search packages” and “Search npm packages” for package search.

### Exercise the asynchronous briefing without paid inference

The smoke script starts its own loopback provider fixture—a local stand-in for a paid provider. Put only these fixture values in `workers/briefing/.dev.vars`:

```dotenv
AI_BRIEFING_ENDPOINT="http://127.0.0.1:8787/v1/chat/completions"
AI_BRIEFING_API_KEY="local-fixture-key"
AI_BRIEFING_MODEL="local-fixture-model"
```

Then run:

```bash
node scripts/smoke/smoke.ts
nub run build
NUXT_PUBLIC_SITE_URL=http://localhost:5273 nub run smoke:built
```

`smoke:built` invokes `node scripts/smoke/smoke.ts --built`; `dev:built` uses the same `--built` mode in the local launcher. Local HMR remains `nub run dev`.

The scenario uses temporary data and offset ports. It exercises submission, socket completion, a device-shaped Origin, restart, D1 reuse, and reconnect.

Before submission, the scenario checks runtime-origin canonical links, browser revalidation, and the one-year edge TTL
on the homepage, About, and Privacy pages for browser and Googlebot user agents. On the homepage it also checks that
Open Graph and Twitter image URLs use the configured origin, and that the social card image is a fetchable PNG whose dimensions
match its metadata. Without a configured origin, those image URLs must be absent.
This checks cacheable response bytes, not a hosted Cloudflare cache HIT. It does not pin editorial wording.

**Keep the fixture on loopback; do not substitute a real provider.** The script deploys nothing remotely and leaves the normal `.wrangler/state` root untouched. Evidence collection can still contact public package providers, so this is not an offline test.

Fixture success proves only the exercised lifecycle, not model quality or production-provider integration. `--measure` samples local process-tree CPU; it is not Cloudflare per-invocation CPU accounting. See [`scripts/smoke/smoke.ts`](../../../scripts/smoke/smoke.ts) for the scenario and measurement implementation.

## How do I diagnose local failures?

The comparison page, each briefing POST attempt, the Nuxt route, and the briefing Durable Object share an Effect JSON console logger. Console diagnostics work with or without OTLP, the OpenTelemetry protocol used to export logs and traces.

To find a resolved comparison, search `comparison.package.name` with `comparison.version.from` / `comparison.version.to`. Only registry-resolved package/release identity is exported. Page roots and failed lookups contain no input identity.

Records contain trace/span IDs and validated public package/version identity. They exclude full URLs, hashes, evidence, prompts, raw provider errors, and credentials. Submission refusals use only a sanitized error name and validated service reason on the console error stream.

For how requests connect to queued generation, see [trace relationships](#further-detail-trace-relationships).

### Inspect OTLP logs and traces in Grafana

The application exports directly over OTLP/HTTP with TLS to a destination such as Grafana Cloud. There is no in-repo Collector, local receiver, or default remote endpoint.

Local settings are listed in [`.env.example`](../../../.env.example):

- Nuxt: `NUXT_OTEL_ENDPOINT` and `NUXT_OTEL_HEADERS`.
- Briefing Worker: `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.

GitLab stage uses one shared `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` pair to derive both sets of runtime names. Only frontend and briefing receive it, never evidence or the browser. Wrangler `env.stage.vars` selects no endpoint.

Enter headers as single-line JSON with string keys and values; CI reads and validates them once. Omitting the pair sends an empty endpoint and `{}` headers to both Workers, clearing old managed values.

Stage requires `NUXT_PUBLIC_TELEMETRY_ENABLED`. `true` requires the shared HTTPS endpoint and controls frontend export only. Briefing exports whenever its endpoint is configured. The endpoint must have no URL credentials, query, or fragment. Follow the [Grafana Cloud values guide](deployment.md#how-do-i-get-the-grafana-cloud-values).

The application sends OTLP/HTTP JSON to `/v1/logs` and `/v1/traces`. It consumes no protobuf protocol environment setting.

For local development, use a reachable TLS OTLP destination with Basic-auth JSON headers, or leave export unset for console diagnostics only. Query exported records in the Grafana UI.

Privacy filtering runs before console output and export. A single list of allowed scalar fields in `shared/telemetry/telemetryFields.ts` controls console records, native OTLP export, and incoming telemetry before serialization.

It keeps reviewed error types/source, normalized code locations, validated trace links, and approved scalar fields. It drops objects, arrays, unlisted keys, and sensitive whole fields such as headers, cookies, evidence, and raw causes. Malformed records are rejected, not forwarded unchanged.

The pinned `@pinojs/redact` removes configured object paths as an extra safeguard. It does not detect sensitive prose or personal information. Error messages and requested selectors are excluded, not scanned for sensitive-looking text. Local checks do not establish production collector retention or access controls.

Open a comparison page and query these service identities in Grafana:

- `can-i-update-browser`: `comparison.page` and client `briefing.submit` spans; page-open and submission-start logs, plus captured browser errors when present.
- `can-i-update-nuxt`: server `briefing.submit` and submission-accepted/refused diagnostics, plus unhandled server render and handler failures with `error.source` `nuxt`, `nuxt.vue` or `nuxt.ssr`.
- `can-i-update-evidence`: `evidence.request.completed` under the forwarded request `traceparent`, independent `evidence.collection` roots with `linkedTraceId` / `linkedSpanId` for joiners, and the evidence Worker's `OTEL_EXPORTER_OTLP_ENDPOINT` export configured in `workers/evidence/.dev.vars` (via `--otel-endpoint`).
- Evidence-owner records (admission refusal with `operation`, component-cache `hit`/`miss`/`coalesced` decisions, provider degradation summaries, and storage failure reasons) are emitted by the evidence Worker's cache and admission owners; they carry fixed fields, not SQL, keys, rows or provider payloads. Their export wiring is documented with the request flow.
- `can-i-update-briefing`: independent acceptance root and later generation child, plus `briefing.job.settled`, `briefing.job.recovery`, `briefing.dispatch.decision`, and `briefing.queue.decision`. A stored-result hit does not start another generation. `briefing.job.settled` means terminal persistence succeeded; alarm recovery hit/miss/failure describes a lookup, not a won settlement.

Comparison identity belongs on log/span records, never service resources or metric labels. Package names follow public-route npm validation, including scoped names and the 214-character maximum. Versions must be concrete and at most 256 characters. Tags, ranges, URLs, control characters, and blank values are omitted.

Invalid diagnostic fields are dropped without rejecting a valid operation. Browser records remain untrusted even after same-origin validation. Server identity comes from trusted evidence; generation identity comes from its stored packet.

Search and metadata failures are not sampled. They use a fixed `reason` and an optional `statusClass` derived only from a valid numeric HTTP status. Successful completions are sampled at 10%, with a bounded `resultCount` bucket. `durationMs` appears when the guarded clock is available. Query text and payloads are never recorded; typing aborts are silent.

`comparison.navigation.completed` reports `success`, `cancelled`, `ignored` (repeat submit while submitting), or `failure`. Failure reasons are `invalid-input` or `navigation`. It omits route text and rejected form values. Identity appears only with matching resolved metadata. A diagnostic failure may drop a record, but cannot change query or navigation results.

With `--otel-endpoint`, the launcher supplies private Nuxt `NUXT_OTEL_ENDPOINT`, public `NUXT_PUBLIC_TELEMETRY_ENABLED=true`, and private `OTEL_EXPORTER_OTLP_ENDPOINT` for both evidence and briefing Workers. See [`.env.example`](../../../.env.example) for manual settings and private Nuxt headers.

The browser reads only the enablement flag through a bounded, no-store `/api/telemetry/config` request. It sends to same-origin `/api/telemetry/v1/{logs,traces}`, never receiving upstream credentials. Runtime flag lookup also works when navigating from a built-dev homepage; local telemetry settings need not be embedded in release builds.

Browser capture covers Vue, app-startup and chunk errors, recognized uncaught exceptions, and promise rejections. Error rejections retain their exception name. Primitive rejections use `error.source` `browser.rejection` with no message.

Only reviewed exception type, source, and filtered code locations are sent. Exception messages, raw rejection payloads, arbitrary console arguments, performance data, and session tracking are excluded.

Server diagnostics use the same bounded pipeline. Nitro handler failures produce `can-i-update-nuxt` `runtime.error` with `error.source` `nuxt`. Nuxt server-side rendering (SSR) failures use `nuxt.vue` and `nuxt.ssr`, with the same request-scoped deduplication.

Telemetry routes (`/api/telemetry/*`), expected outcomes below 500, and aborted requests are excluded to avoid recursion and noise. Sending runs separately from the request, ignores disabled destinations, and absorbs its own failures without logging raw runtime errors. Diagnostics never change the request outcome.

For partial-page loading, filter `comparison.tier.settled` by `operation` (`declarations` or `measurements`), `outcome`, and `reason`:

- `failure` with `reason` `upstream`: the request was rejected.
- `cancelled`: its signal aborted first.
- `retainedData: true`: the query already had data when the request began; this does not prove what rendered.
- `partial` measurements: advisory, tarball, or bundle evidence was unavailable, but the rest loaded.

Neither failure nor cancellation records contain the error message.

Use `briefing.subscription.transition` to follow deduplicated queued/running state, available/unavailable terminal results, timeout, malformed protocol, transport/disconnection retries or exhaustion, and cancellation. Cancellation is informational, not an error alert. Reconnecting never POSTs.

Browser intake requires exact same-origin JSON requests, fixes the browser resource identity, and bounds request bodies and intake. Trace/span IDs and parent/link relationships remain available for correlation.

Browser export may be lost when a page closes or a request is interrupted. Grafana Cloud failure must not affect comparison, submission, or generation. These diagnostics are best-effort local paths, not an account-wide abuse-control guarantee.

| Symptom                                | Check first                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher reports state already in use  | Stop the owning `dev` or `dev:built` process. Use a separate persistence root only for an intentionally independent session.                |
| Briefing refuses a cold request        | Confirm briefing Worker settings, D1 schema, and private service binding. A stored result can still be available without provider settings. |
| Browser cannot follow a queued job     | Check socket reachability on `8791`, advertised host, and the exact browser Origin.                                                         |
| Built page has the wrong canonical URL | Set the correct `NUXT_PUBLIC_SITE_URL` for the next built dev start or frontend Worker deployment; rebuilding is not required.              |
| API works but browser controls do not  | Inspect browser errors and exercise search, navigation, and direct reload. API checks do not establish hydration.                           |

## How do I change or apply the database schema?

The [briefing schema](../../../shared/db/briefingSchema.ts) generates D1 migration history through [drizzle.config.ts](../../../drizzle.config.ts). The [evidence schema](../../../shared/db/evidenceSchema.ts) generates separate DO history through [workers/evidence/drizzle.config.ts](../../../workers/evidence/drizzle.config.ts). Effect 4 Schema still validates runtime data independently of Drizzle.

```bash
nub run db:generate           # D1 SQL/snapshots and flat Wrangler mirrors
nub run db:migrate:local      # Wrangler applies D1 history locally
nub run db:generate:evidence  # DO SQL/snapshots and bundled runtime migration map
nub run db:check              # Read-only checks of both independent histories
nub run db:check:evidence     # DO bundle/layout/history check only
```

For D1, commit [`drizzle/`](../../../drizzle/) and byte-identical [`migrations/`](../../../migrations/) mirrors. The [mirror script](../../../scripts/sync-migrations/sync-migrations.ts) checks the pinned Kit layout and snapshot metadata, then compares existing SQL before writing. It creates only missing mirrors and rejects stale, changed, or occupied paths.

**Wrangler alone applies D1 migrations. Do not use Kit push/migrate commands against D1.**

For evidence, commit [`workers/evidence/drizzle/`](../../../workers/evidence/drizzle/) and [`migrations.generated.json`](../../../workers/evidence/migrations.generated.json). The [bundler](../../../scripts/bundle-evidence-migrations/bundle-evidence-migrations.ts) makes only the fixed initial bootstrap's generated CREATE statements safe to repeat. It does not change source SQL or schema expressions. Existing objects keep their tables and data while Drizzle adds migration tracking.

Before publishing a bundle, the guard rejects changed, removed, renamed, or backdated history. Later migration SQL stays strict. Worker construction applies pending history synchronously through `drizzle-orm/durable-sqlite/migrator`. It uses no runtime filesystem, Kit access, or handwritten constructor schema SQL. No DO class migration tag or state reset is needed.

The exact-pinned ORM includes a committed [two-line DO migrator patch](../../../patches/drizzle-orm@1.0.0-rc.5-ab785fc.patch). It removes redundant rollback calls that hid the original SQL error. `transactionSync` still rolls back when the exception escapes. Nub installs the patch from committed configuration and lock metadata.

Review and remove the patch only during a separately verified SDK upgrade that fixes the upstream behavior.

Ordinary `dev`, `dev:built`, and `db:migrate:local` are non-destructive. Replacing the old `0001` history requires the separately approved [one-time local/stage cutover](releases-and-recovery.md#one-time-drizzle-adoption-cutover). Do not start the new launcher on old history before that cutover, or an old checkout on a reset target afterward.

Raw SQL is limited to generated migrations, operational metadata, and test fault injection—not handwritten production initialization. Driver compatibility uses narrow type-only SDK aliases, not blanket Cloudflare globals.

Do not treat a storage failure as a cache miss or delete persisted results to make the request succeed. Database changes and recovery follow the [migration policy](releases-and-recovery.md#database-and-stored-data-changes).

## Deployment prerequisites

Contributor deployments need account-local configuration; there is no setup command to generate it. See [account-local deployment](deployment.md#how-should-an-account-local-configuration-be-prepared).

Stage and production require valid credentials, protected tags/environments, current migrations, and hosted verification. Deployment existence does not prove pipeline provenance or complete verification. See [deployment prerequisites](deployment.md#outstanding-setup-and-verification) and [release identity](releases-and-recovery.md#release-identity).

## Further detail: trace relationships

A span records one unit of work; trace IDs connect related spans. The logger records these relationships:

- `comparison.page.opened` identifies the page's root span.
- Each `briefing.submission.started` client span sends its own `traceparent`.
- The API's `briefing.submission.accepted` record carries the server parent. For queued/running jobs it also carries scalar `linkedTraceId` and `linkedSpanId` for the shared generation.
- Submitters joining one pending generation share that link target.
- `briefing.generation.accepted` records an independent root. `briefing.generation.started` records a later child span after a current lease is claimed.

OTLP exports the same sanitized logs and completed spans. Queued generations remain independent roots linked from submitters, not long-lived children of their requests.
