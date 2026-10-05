# Development operations

**Status: reviewed.** Commands in this document describe the current checkout. Policy statements describe the agreed contributor workflow.

For remote environments, see [deployment](deployment.md). For verification evidence and state recovery, see [releases and recovery](releases-and-recovery.md).

## What do I need to contribute?

Use Node 26, pinned in [`.node-version`](../../../.node-version), and Nub 0.9.6, pinned by the [`packageManager` field](../../../package.json). Run project scripts through Nub.

```bash
nub ci
nub run dev
```

Open `http://localhost:5173`. A Cloudflare account, deployment token, and paid AI provider are not required for local contribution. Hosted previews are optional. Contributors may submit locally verified changes without deploying their own instance; maintainers may deploy a reviewed revision to the official integration preview.

The launcher exposes the frontend and briefing socket on all interfaces. Treat local development as reachable by other devices on connected networks, not as an authenticated private service. For a Tailscale session, use this machine's Tailscale address on port `5173`.

## Zed Vue tooling

`@vue/language-server`, `@vue/typescript-plugin`, and `vue-tsc` are pinned to 3.3.11. Zed's managed Vue extension currently installs 3.3.12; its TypeScript plugin reports a false `TS2322` (`… is not assignable to type 'never'`) for the generic Reka Combobox update handler in `Combobox.vue` and `Select.vue`. `.zed/settings.json` launches the project-local Vue server through Nub and directs vtsls to the project-local plugin via `/proc/self/cwd`, which resolves to the Zed remote workspace root on Linux. Restart both `vue-language-server` and `vtsls` after `nub ci` so they pick up the locked versions.

Remove the temporary 3.3.11 pins and Zed override only after a later Vue language-tools release passes in Zed: no false diagnostics in both components, while a deliberately incompatible event handler still produces a diagnostic. Keep `vue-tsc` aligned with the language-tools release used by the editor workaround.

## What starts locally?

[`scripts/dev.ts`](../../../scripts/dev.ts) applies local D1 migrations, starts the two backend Workers, waits for readiness, and starts the frontend. It stops the processes on Ctrl-C or a sibling failure.

| Runtime         | Default port | Responsibility                                                    |
| --------------- | ------------ | ----------------------------------------------------------------- |
| Frontend        | `5173`       | Nuxt HMR, comparison APIs, private briefing submission            |
| Evidence Worker | `8790`       | Package evidence Durable Objects                                  |
| Briefing Worker | `8791`       | D1, briefing job Durable Objects, Queue, read-only browser socket |

Inspector ports are `9230`, `9231`, and `9232`. The browser reaches both the frontend and the briefing socket. The launcher configures socket origins for local interface addresses; the frontend adjusts loopback socket advertisements to the host used by the requesting device.

The default persistence root is `.wrangler/state`. A `launcher.lock` prevents `dev` and `preview` from owning the same state concurrently. The launcher passes the root to Wrangler, which uses its `v3` subdirectory. Do not delete state or remove a live launcher's lock to bypass the check.

## Where does configuration belong?

See [`.env.example`](../../../.env.example) for the current contract. Local environment files and Worker `.dev.vars` files are ignored by Git.

| Setting                     | Local owner                           | Remote owner                                              |
| --------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `NUXT_PUBLIC_SITE_URL`      | Frontend `.env` and build environment | Public frontend configuration matching the build origin   |
| `GITHUB_TOKEN`, optional    | `workers/evidence/.dev.vars`          | Evidence Worker secret                                    |
| `AI_BRIEFING_ENDPOINT`      | `workers/briefing/.dev.vars`          | Briefing Worker environment                               |
| `AI_BRIEFING_API_KEY`       | `workers/briefing/.dev.vars`          | Briefing Worker secret                                    |
| `AI_BRIEFING_MODEL`         | `workers/briefing/.dev.vars`          | Briefing Worker environment                               |
| Cloudflare deployment token | Not needed locally                    | External operator credentials, never application settings |

The frontend owns no AI settings and no D1 binding. Do not put provider credentials in the frontend `.env`, public runtime configuration, evidence Worker, or `.output/server/.dev.vars`. Builds recreate `.output`.

Wrangler can fall back to dotenv settings. Removing a `.dev.vars` file is not proof that a real credential cannot be loaded. Keep real keys out of repository dotenv files and the environment used for default local checks.

Local development can omit `NUXT_PUBLIC_SITE_URL`, in which case canonical links are absent. To render matching links, set it to the actual local frontend origin. Release builds require a valid origin.

## How do I check the built runtime?

Stop a launcher that owns `.wrangler/state` before starting another. Stop the built preview before rebuilding its output.

```bash
NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run build
nub run preview
```

`build` validates the public site URL, builds Nuxt, and dry-runs both backend bundles without deploying them. `preview` runs the same three-process launcher but uses `.output/server/wrangler.json` for the frontend instead of Nuxt HMR. It also applies local migrations.

**The local `preview` script does not select the remote Wrangler `preview` environment.** No remote resource is created by these commands.

The build-time origin is baked into prerendered HTML. A later Worker variable change cannot repair HTML generated for a different origin. Rebuild for the intended destination.

## How do I run checks?

```bash
nub run prepare
nub run type-check
nub run lint:check
nub run format:check
nub run test
```

`prepare` generates Nuxt configuration and installs Git hooks. Type checking covers Nuxt and both standalone Workers. Unit tests use the `.unit.ts` suffix beside their implementation. Use `nub run test:watch` when iterating.

`lint:check` and `format:check` are non-fixing checks. The `lint` and `format` scripts modify files; use them intentionally rather than as read-only verification. Git hooks check lint, types, formatting, and commit messages, not tests; run tests separately.

### Test harnesses

Vitest discovery and runtime settings live in [`vitest.config.ts`](../../../vitest.config.ts). Colocate `.unit.ts` suites with their implementation; root `test/` contains shared helpers, not discovered suites. Follow the nearest suite: `.harness.ts` boots runtimes and returns teardown, while `.stub.ts` impersonates external systems.

Inject Effect HTTP services and use H3 `mockEvent` for handlers. Restore stubbed globals, environment, and timers. Inject `FetchHttpClient.Fetch` per run when needed: its default fetch service can memoize a global stub. Assert boundary behavior, uncertainty, privacy, cancellation, and persistence rather than implementation details; see [verification conventions](../../../CODE_CONVENTIONS.md#evidence-driven-review).

Worker `.workerd.unit.ts`, `workers/briefing/jobs.unit/`, and `sockets.unit/` suites exercise real Miniflare/workerd storage, queues, sockets, and restarts. Some await real alarms with timeouts up to 180 seconds. Keep production leases intact rather than shortening them to accelerate tests.

### Comparison interface

The shared comparison form moves from the homepage into the navigation header after a successful comparison and resets for another search. Compact screens wrap it to a second header row. In-app home links and browser Back animate it back to the homepage; Forward animates it into the header again. On homepage load or reload, the form fades in and rises 12 px over 400 ms after a 60 ms delay; this intro does not replay on in-app return. The hero enters on initial load and when returning home. Hero, form, and comparison-content motion honor reduced-motion preferences. Exercise submission, reset, Back/Forward, fragment links, compact layouts, and reduced motion when changing this interface.

`Combobox` leaves placeholder and accessible input-label copy to its caller; `ComparisonForm` supplies “Search packages” and “Search npm packages” for package search.

### Exercise the asynchronous briefing without paid inference

The existing smoke script starts its own loopback provider fixture. Put only these fixture values in `workers/briefing/.dev.vars`:

```dotenv
AI_BRIEFING_ENDPOINT="http://127.0.0.1:8787/v1/chat/completions"
AI_BRIEFING_API_KEY="local-fixture-key"
AI_BRIEFING_MODEL="local-fixture-model"
```

Then run:

```bash
node scripts/smoke.ts
NUXT_PUBLIC_SITE_URL=http://localhost:5273 nub run build
node scripts/smoke.ts --preview
```

The scenario uses temporary persistence and offset ports. It exercises submission, socket completion, a device-shaped Origin, restart, D1 reuse, and reconnect. Its fixture must be loopback; do not substitute a real provider. It starts no remote deployment and does not touch the normal `.wrangler/state` root. Evidence collection can still use public package providers, so this is not an offline test.

Fixture success proves the exercised lifecycle, not model quality or production-provider integration. `--measure` adds local process-tree CPU sampling, not Cloudflare per-invocation CPU accounting. See [`scripts/smoke.ts`](../../../scripts/smoke.ts) for the scenario and measurement implementation.

## How do I diagnose local failures?

| Symptom                                | Check first                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher reports state already in use  | Stop the owning `dev` or `preview` process. Use a separate persistence root only for an intentionally independent session.                  |
| Briefing refuses a cold request        | Confirm briefing Worker settings, D1 schema, and private service binding. A stored result can still be available without provider settings. |
| Browser cannot follow a queued job     | Check socket reachability on `8791`, advertised host, and the exact browser Origin.                                                         |
| Built page has the wrong canonical URL | Rebuild with the correct `NUXT_PUBLIC_SITE_URL`; changing only runtime configuration is insufficient.                                       |
| API works but browser controls do not  | Inspect browser errors and exercise search, navigation, and direct reload. API checks do not establish hydration.                           |

## How do I change or apply the database schema?

The [briefing schema](../../../shared/db/briefingSchema.ts) generates D1 history through [drizzle.config.ts](../../../drizzle.config.ts). The [evidence schema](../../../shared/db/evidenceSchema.ts) generates separate DO history through [workers/evidence/drizzle.config.ts](../../../workers/evidence/drizzle.config.ts). Effect 4 Schema remains the runtime data validator, independent of Drizzle.

```bash
nub run db:generate           # D1 SQL/snapshots and flat Wrangler mirrors
nub run db:migrate:local      # Wrangler applies D1 history locally
nub run db:generate:evidence  # DO SQL/snapshots and bundled runtime migration map
nub run db:check              # Read-only checks of both independent histories
nub run db:check:evidence     # DO bundle/layout/history check only
```

For D1, commit [`drizzle/`](../../../drizzle/) and byte-identical [`migrations/`](../../../migrations/) mirrors. The [mirror script](../../../scripts/sync-migrations.ts) validates the pinned Kit layout/snapshot metadata, compares existing SQL before writing, creates missing mirrors exclusively, and rejects stale, changed or occupied paths. Wrangler remains the sole D1 applier; do not use Kit push/migrate commands against D1.

For evidence, commit [`workers/evidence/drizzle/`](../../../workers/evidence/drizzle/) and [`migrations.generated.json`](../../../workers/evidence/migrations.generated.json). The [bundler](../../../scripts/bundle-evidence-migrations.ts) makes only the fixed initial bootstrap's generated CREATE statements idempotent, without changing its source SQL or schema expressions. Existing objects retain their tables/data while Drizzle adds migration tracking. The guard rejects changed, removed, renamed or backdated history before publishing a new bundle; later migration SQL remains strict. Worker construction applies pending history synchronously through `drizzle-orm/durable-sqlite/migrator`; there is no runtime filesystem/Kit access or handwritten constructor DDL. No DO class migration tag or state reset is required.

The exact-pinned ORM carries a committed [two-line DO migrator patch](../../../patches/drizzle-orm@1.0.0-rc.5-ab785fc.patch): it removes redundant explicit rollback calls that discarded the original SQL error. `transactionSync` still rolls back on the escaping exception. Nub installs the patch from committed configuration/lock metadata. Review and remove it only during a separately verified SDK upgrade that fixes upstream behavior.

Ordinary `dev`, `preview`, and `db:migrate:local` remain non-destructive. The old `0001` history is replaced only through the separately approved [one-time local/preview cutover](releases-and-recovery.md#one-time-drizzle-adoption-cutover); do not start the new launcher on the old history before that cutover, or start an old checkout on a reset target afterward.

The offline exporter generates a typed Node SQLite SELECT but still streams through `DatabaseSync.iterate()` and preserves the original JSON/timestamps. Raw SQL remains only for generated migration statements, operational metadata, test fault injection, and emitted import serialization—not handwritten production initialization. Driver compatibility uses narrow type-only SDK aliases, not blanket Cloudflare globals.

Do not treat a storage failure as a cache miss or delete persisted results to make the request succeed. Database changes and recovery follow the [migration policy](releases-and-recovery.md#database-and-stored-data-changes).

## What remains planned?

The agreed public rate-limit policy, portable account-local deployment workflow, production configuration, and footer build identity are not implemented by these documents. Their status is tracked in [deployment](deployment.md#agreed-requirements-not-yet-implemented) and [release identity](releases-and-recovery.md#release-identity).
