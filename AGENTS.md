# Repository guidance

**Can I update?** compares two versions of one public npm package, not a consumer project. Missing evidence means uncertainty, not “unchanged” or “safe”; AI notes supplement facts, never gate them.

## Skill routing

Before any response or task action on a new user task—including clarifying questions, planning, or codebase exploration—read [using-agent-skills](.agents/skills/using-agent-skills/SKILL.md) and follow its mandatory routing guidance. Read the applicable skills before performing the work they govern. Re-evaluate routing when the task's scope or development phase changes.

Reuse skills already loaded in the current context; reload after context loss. Respect user-only invocation restrictions and existing authorization boundaries. Use the harness's skill loader when available, otherwise read the local files directly.

## Required Effect programming model

Implement application logic and computations using Effect across all runtimes: browser, server, Workers, and shared modules. This includes pure synchronous calculations, transformations, validation, and orchestration, not only I/O. This is a project convention, not a per-function cost-benefit choice.

Use Effect's typed composition, failure handling, schemas, and data utilities throughout the implementation. A token import or an outer `Effect.sync` wrapper around an otherwise unchanged imperative implementation does not satisfy this requirement. Being pure, synchronous, small, or expressible without Effect is not an exception.

The only exception is a concrete incompatibility with a framework or library integration, such as a Vue composable's requirements. Keep unavoidable native code at the smallest integration point, document the specific incompatibility beside it, and keep the remaining logic in Effect. Being inside a Vue component, `computed`, or composable is not itself an exception. Preserve the existing Vue Query and reactive-state ownership rules in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md#state-has-one-owner).

Before implementing or reviewing application logic, read `node_modules/effect/AGENTS.md` **completely**, and follow its links when required. For APIs and concepts it does not cover, consult `node_modules/effect/src`.

## Navigation

- **Architecture or cross-runtime changes:** read [the system overview](docs/engineering/overview.md). `app/` owns presentation and reactive queries; `server/api/` owns public handlers; `server/comparison/` owns domain workflows; `server/httpDependencies/` owns provider I/O; `shared/**/*.defs.ts` owns cross-runtime contracts. Route-local helpers belong in `_internals/` directories excluded from Nitro routing.
- **Implementation design or code review:** read [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) for module boundaries, contracts, state ownership, and evidence-driven review. Mechanical policy lives in the TypeScript, Oxlint, and Oxfmt configuration, not a second prose rule set.
- **PR/MR titles:** follow Conventional Commits; check [the current commitlint configuration](commitlint.config.mjs) and its extended rules rather than assuming the format. After editing a title, start a new MR pipeline via **Pipelines → Run pipeline**, rather than retrying the old pipeline or job.
- **Collection, archives, advisories, or evidence caching:** read [evidence architecture](docs/engineering/evidence.md); `workers/evidence/` owns per-package Durable Object SQLite storage.
- **Generation, queues, sockets, or stored briefings:** read [briefing architecture](docs/engineering/briefing.md); `workers/briefing/` owns durable jobs and D1 results.
- **Local setup, configuration, tests, smoke runs, or tooling failures:** read [development operations](docs/engineering/ops/development.md). Use Node and Nub pinned by `.node-version` and `package.json`; run scripts through Nub. `package.json` owns check commands.
- **Database schemas, migrations, or Drizzle upgrades:** read [the database ADR](docs/engineering/adrs/drizzle-database-layer.md) and [database development procedures](docs/engineering/ops/development.md#how-do-i-change-or-apply-the-database-schema). Generated histories and runtime artifacts are one change; Wrangler applies D1 migrations. Preserve applied history and the pinned ORM/Kit/patch combination.
- **Frontend or framework changes:** read [interface verification](docs/engineering/ops/development.md#comparison-interface) and [the Firefox startup ADR](docs/engineering/adrs/firefox-entry-import-map.md). Verify rendered interactions in Chromium and Firefox before changing the `entryImportMap: false` workaround.
- **Product copy or interpretation:** read [meaning and limitations](docs/product/meaning-and-limitations.md).
- **Deployment or recovery:** read [deployment operations](docs/engineering/ops/deployment.md) and [release/recovery operations](docs/engineering/ops/releases-and-recovery.md). Default Wrangler environments are local-only; checked-in remote resources are maintainer-specific, not deployment authorization.
- **Documentation changes:** use [the documentation map](docs/CONTEXT.md). Discuss proposals in issues and review implementations in merge requests. ADRs preserve decisions with meaningful complexity or reversal cost; current engineering documents describe implementation. Neither agreement nor an ADR proves shipment.

## Documentation style

- In `README.md` and `docs/`, use plain language for the document's intended audience. Make explanations understandable at any experience level within that audience; explain necessary technical terms and avoid jargon where simpler words work.
- Keep `README.md` and Markdown files under `docs/` focused on current behavior, decisions in force, and operating procedures. Only ADRs and Git history serve as historical records. Replace outdated explanations rather than appending audit findings, change narratives, or former-name explanations. Preserve ADR decision history and mark superseded decisions explicitly.
- Use **staging** for the current integration environment in prose. Keep exact current selectors such as `stage` and `--env stage` in commands. For resource identities, link to the owning configuration or use a stable binding instead of repeating former environment names. Documentation edits must not invent resource names or rename deployed infrastructure.
- Prefer short sentences and short paragraphs, with one main idea per paragraph. Use lists when they make information easier to scan.
- Put optional background and deeper technical detail in endnotes or linked detail sections when helpful. Keep essential meaning, limitations, and safety warnings in the main text beside the relevant explanation or step.

## Essential boundaries

- Decode external, persisted, RPC, Queue, and socket data with shared Effect schemas. Keep credentials, prompts, evidence packets, archive inventories, and raw provider errors private.
- Preserve durable job generation IDs, revisions, leases/fencing, and first-writer-wins success. Read-only socket reconnects observe jobs; they do not generate briefings.
- Create Vue Query hooks synchronously before the first `await` in `useComparisonPage.ts`. SSR prefetches declarations only; client measurements and briefings use resolved versions independently.
- Keep provider requests fixed-origin and bounded, archive downloads integrity-checked, and scoped package names encoded exactly once. Preserve absent-versus-declared manifest values and conditional export/type-mapping order.
- Edit source, not generated `.nuxt/` or `.output/`, or local `.wrangler/`/`.data/` state. Keep secrets in their owning Worker's private configuration; `.env.example` defines configuration ownership.
