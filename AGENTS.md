# Repository guidance

**Can I update?** compares two versions of one public npm package, not a consumer project. Missing evidence means uncertainty, not “unchanged” or “safe”; AI notes supplement facts, never gate them.

## Navigation

- **Architecture or cross-runtime changes:** read [the system overview](docs/engineering/overview.md). `app/` owns presentation and reactive queries; `server/api/` owns public handlers; `server/comparison/` owns domain workflows; `server/httpDependencies/` owns provider I/O; `shared/*.defs.ts` owns cross-runtime contracts. Route-local helpers belong in `_internals/` directories excluded from Nitro routing.
- **Implementation design or code review:** read [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) for module boundaries, contracts, state ownership, and evidence-driven review. Mechanical policy lives in the TypeScript, Oxlint, and Oxfmt configuration, not a second prose rule set.
- **Collection, archives, advisories, or evidence caching:** read [evidence architecture](docs/engineering/evidence.md); `workers/evidence/` owns per-package Durable Object SQLite storage.
- **Generation, queues, sockets, or stored briefings:** read [briefing architecture](docs/engineering/briefing.md); `workers/briefing/` owns durable jobs and D1 results.
- **Local setup, configuration, tests, smoke runs, or tooling failures:** read [development operations](docs/engineering/ops/development.md). Use Node and Nub pinned by `.node-version` and `package.json`; run scripts through Nub. `package.json` owns check commands.
- **Database schemas, migrations, or Drizzle upgrades:** read [the database ADR](docs/engineering/adrs/drizzle-database-layer.md) and [database development procedures](docs/engineering/ops/development.md#how-do-i-change-or-apply-the-database-schema). Generated histories and runtime artifacts are one change; Wrangler applies D1 migrations. Preserve applied history and the pinned ORM/Kit/patch combination.
- **Frontend or framework changes:** read [interface verification](docs/engineering/ops/development.md#comparison-interface) and [the Firefox startup ADR](docs/engineering/adrs/firefox-entry-import-map.md). Verify rendered interactions in Chromium and Firefox before changing the `entryImportMap: false` workaround.
- **Product copy or interpretation:** read [meaning and limitations](docs/product/meaning-and-limitations.md).
- **Deployment or recovery:** read [deployment operations](docs/engineering/ops/deployment.md) and [release/recovery operations](docs/engineering/ops/releases-and-recovery.md). Default Wrangler environments are local-only; checked-in remote resources are maintainer-specific, not deployment authorization.
- **Documentation changes:** use [the documentation map](docs/CONTEXT.md). Current engineering documents describe implementation; ADRs and RFCs preserve decisions and proposals, not proof of shipment.

## Essential boundaries

- Decode external, persisted, RPC, Queue, and socket data with shared Effect schemas. Keep credentials, prompts, evidence packets, archive inventories, and raw provider errors private.
- Preserve durable job generation IDs, revisions, leases/fencing, and first-writer-wins success. Read-only socket reconnects observe jobs; they do not generate briefings.
- Create Vue Query hooks synchronously before the first `await` in `useComparisonPage.ts`. SSR prefetches declarations only; client measurements and briefings use resolved versions independently.
- Keep provider requests fixed-origin and bounded, archive downloads integrity-checked, and scoped package names encoded exactly once. Preserve absent-versus-declared manifest values and conditional export/type-mapping order.
- Edit source, not generated `.nuxt/` or `.output/`, or local `.wrangler/`/`.data/` state. Keep secrets in their owning Worker's private configuration; `.env.example` defines configuration ownership.
