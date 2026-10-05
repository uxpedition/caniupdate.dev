# Repository Guidelines

## Project Overview

**Can I update?** compares two versions of one public npm package: declarations, dependencies, Node requirements, bundle estimates, advisories, archive evidence, and optional cited AI notes. It supports upgrade review; it does not inspect a consumer project or guarantee compatibility. Missing evidence means uncertainty, not “nothing changed” or “safe.”

## Architecture & Data Flow

- **Nuxt frontend/Nitro API:** `app/` renders the UI; `server/api/` validates public requests. Search, metadata, and declarations use fixed-origin npm registry clients. Comparison URLs are `/:packageName/:from...:to`, with scoped package names URI-encoded.
- **Progressive queries:** `app/composables/useComparisonPage.ts` SSR-prefetches declarations only. Create all Vue Query hooks synchronously before its first `await`. Resolved exact versions enable client-only measurements and briefings; factual rendering must not depend on AI.
- **Evidence Worker:** the private `PACKAGE_EVIDENCE` binding addresses a Durable Object by package name. `server/comparison/collect.ts` orchestrates bounded npm archive, OSV, Bundlephobia, and GitHub collection; `workers/evidence/store.ts` caches validated evidence in Durable Object SQLite.
- **Briefing Worker:** Nitro packs bounded evidence and submits through private `BRIEFING_SERVICE` RPC. `workers/briefing/job.ts` coordinates an evidence-hash-keyed Durable Object, Queue execution, recovery alarms, and successful-result persistence in D1. The browser receives status/results through a read-only WebSocket; reconnects must not trigger generation.
- **Trust boundaries:** decode external, persisted, RPC, Queue, and socket data with shared Effect schemas. Keep archive inventories, evidence packets, prompts, credentials, and raw provider errors out of public responses. Preserve job generation IDs, revisions, leases/fencing, and first-writer-wins success ordering.

## Key Directories

| Path                                                | Responsibility                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `app/components/`, `app/composables/`, `app/pages/` | Vue presentation, reactive/query orchestration, routed pages and pure view helpers               |
| `server/api/`                                       | H3/Nitro handlers; route-local helpers belong in ignored `_internals/` directories               |
| `server/comparison/`                                | Domain collection, declaration/measurement comparisons, evidence packing and briefing generation |
| `server/httpDependencies/`                          | Provider adapters: origins, decoding, status handling, deadlines and download limits             |
| `shared/`                                           | Cross-runtime schemas/contracts (`*.defs.ts`); `shared/db/` contains Drizzle database schemas    |
| `workers/evidence/`, `workers/briefing/`            | Separate Cloudflare runtime entrypoints, storage and job ownership                               |
| `scripts/`, `test/helpers/`                         | Operational tooling and shared runtime test harnesses                                            |
| `docs/engineering/`, `docs/product/`                | Current architecture/operations and product interpretation                                       |

Do not edit generated `.nuxt/`, `.output/`, or local `.wrangler/`/`.data/` state.

## Development Commands

Run from the repository root:

```bash
nub ci
nub run dev                         # frontend :5173, evidence :8790, briefing :8791
NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run build
nub run preview                     # local built three-runtime stack; not remote preview
nub run prepare                     # regenerate Nuxt types and install hooks
nub run type-check                  # Nuxt plus both Worker projects
nub run lint:check
nub run format:check
nub run test
nub run test:watch
nub run db:check                     # check both migration artifact sets for drift
```

`build` validates the site origin, builds Nuxt, and dry-runs both Worker bundles; it does not deploy. `lint` and `format` modify files, unlike their `:check` counterparts. Stop built preview before rebuilding. The launcher applies local D1 migrations and owns `.wrangler/state/launcher.lock`; stop its owner instead of deleting a live lock/state. Development exposes the frontend and briefing socket to connected networks without authentication.

## Code Conventions & Common Patterns

For code review or decisions about module boundaries, contracts, state ownership, or verification scope, read [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

- Use explicit imports: Nuxt auto-imports and component discovery are disabled. TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; prefer schema-derived types, `readonly` contracts, and `satisfies`, not assertions, `any`, or non-null assertions.
- Oxfmt: 120 columns, single quotes, semicolons, trailing commas, sorted imports. Oxlint is type-aware; production limits include complexity 10 and 400 nonblank/noncomment lines per file. Follow Conventional Commits.
- Naming: PascalCase Vue components/classes, `useX` composables, `package*QueryOptions.ts` query factories, `compareX` pure comparisons, `decodeX` boundary decoders, `*.defs.ts` shared contracts, and method-suffixed Nitro routes such as `index.get.ts`.
- Keep I/O separate from pure normalization/comparison/presentation. Effect workflows use `Effect.gen`, explicit concurrency, tagged failures, scoped resources and timeouts; use `Effect.runPromise` at runtime boundaries. Inject `HttpClient.HttpClient` and narrow `ComparisonEvidenceServices` ports rather than coupling collectors to Cloudflare globals.
- Expected evidence failures become explicit `available`/`partial`/`unavailable` domain states. Do not turn incomplete advisory coverage into zero advisories or a resolved vulnerability. Sanitize infrastructure errors; storage corruption/failure is not a cache miss.
- Vue Query owns server data; keyed Nuxt `useState` owns shared form/UI state, `ref` local interaction state, and `computed` derived values. Pass query abort signals to requests. Worker correctness state is durable; in-memory maps only coalesce active work and clean up in `finally`.
- Preserve absent-versus-declared manifest semantics: omit absent optional keys rather than assigning `undefined`. Conditional exports and `typesVersions` object order matter; do not sort them before comparison. Preserve exact-once scoped-name encoding and fixed-origin, integrity-checked, bounded archive fetching.

## Important Files

- `app/app.vue`, `app/pages/index.vue`, `app/pages/[packageName]/[versionPair].vue`: application/page entrypoints.
- `app/plugins/vue-query.ts`, `app/composables/useComparisonPage.ts`, `app/composables/packageBriefingQueryOptions.ts`: SSR hydration, progressive data and socket lifecycle.
- `server/comparison/collect.ts`, `shared/comparison.defs.ts`, `shared/briefingJob.defs.ts`: collection and public contracts.
- `workers/evidence/index.ts`, `workers/briefing/index.ts`, `workers/briefing/job.ts`: Worker entrypoints and durable jobs.
- `package.json`, `nuxt.config.ts`, `vitest.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`: authoritative scripts and checks. `wrangler.jsonc` and each Worker's `wrangler.jsonc` define runtime bindings.
- `docs/engineering/overview.md`, `evidence.md`, `briefing.md`, and `docs/engineering/ops/development.md`: current design and workflows. Prefer these and source over historical RFC baselines; `docs/CONTEXT.md` contains stale RFC-status/count statements.

## Runtime/Tooling Preferences

- Required: **Node 26 and Nub 0.9.6** (`.node-version`, `package.json`, `nub.lock`). The preinstall guard rejects other package managers. Do not substitute npm, pnpm, Yarn, or Bun.
- ESM TypeScript scripts run directly with Node. Deployment targets Cloudflare Workers, Durable Objects, D1 and Queues; local contribution needs no Cloudflare account or paid AI provider.
- Root `.env` owns only public `NUXT_PUBLIC_SITE_URL`; it is required for builds and baked into prerendered HTML. Optional `GITHUB_TOKEN` belongs in `workers/evidence/.dev.vars`; AI endpoint/key/model belong only in `workers/briefing/.dev.vars`. See `.env.example`; never commit credentials or put them in public config/generated output.
- Keep exact Drizzle ORM/Kit pins and the committed ORM patch in `patches/` together. Do not casually desynchronize pinned Vue language tooling. Preserve Nuxt's Firefox `entryImportMap: false` compatibility setting without real browser verification.
- Schema changes: `nub run db:generate` generates D1 history plus flat `migrations/` mirrors; `nub run db:generate:evidence` generates evidence DO history plus `workers/evidence/migrations.generated.json`. Commit both sides. Use Wrangler (`nub run db:migrate:local`) to apply D1; never Drizzle Kit push/migrate. Evidence DO migrations run during cache construction. Do not rewrite applied history or import database schema modules into browser bundles.
- Default Wrangler environments are local-only; checked-in remote preview resources are maintainer-specific. Do not deploy defaults or infer a portable/production setup. Consult `docs/engineering/ops/deployment.md` for authorized operations.

## Testing & QA

- Vitest runs in Node and discovers `{app,server,shared,scripts,workers}/**/*.unit.ts`. Colocate suites; `*.harness.ts` boots runtimes and returns teardown, while `*.stub.ts` impersonates external systems. Root `test/` contains helpers, not discovered suites. No numeric coverage threshold is configured.
- Follow the nearest suite: inject Effect HTTP services, use H3 `mockEvent` for handlers, and restore stubbed globals/env/timers. Inject `FetchHttpClient.Fetch` per run when needed; its default fetch service can memoize a global stub. Assert boundary behavior, uncertainty, privacy, cancellation and persistence rather than implementation details.
- Worker `*.workerd.unit.ts`, `workers/briefing/jobs.unit/`, and `sockets.unit/` are real Miniflare/workerd integrations with SQLite, D1, queues, sockets and runtime restarts. Some wait for real alarms with timeouts up to 180 seconds; do not shorten production leases to accelerate tests.
- Hooks check lint, types and formatting, **not tests**. Run tests separately. Unit tests do not render Vue components: UI changes need browser checks for hydration/errors, search/submission/reset, direct reload, Back/Forward, fragment links, compact layouts and reduced motion. Frontend/build changes also need Chromium and Firefox verification.
- Lifecycle smoke: configure the loopback AI fixture exactly as documented in `docs/engineering/ops/development.md`, then run `node scripts/smoke.ts`. For built mode: `NUXT_PUBLIC_SITE_URL=http://localhost:5273 nub run build`, then `node scripts/smoke.ts --preview`. It uses isolated state and exercises submission → socket completion → restart → D1 reuse → reconnect. It refuses non-loopback AI endpoints but still contacts public evidence providers; it is not offline or proof of real-provider/model quality.
