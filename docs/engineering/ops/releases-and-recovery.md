# Releases and recovery

**Status: reviewed.** This document records the agreed maintainer release and recovery policy, with current capabilities and missing prerequisites identified explicitly. It neither authorizes a release nor asserts a current remote environment state.

See [development](development.md) for local checks and [deployment](deployment.md) for environment ownership, credentials, and deploy order.

## Who releases, and what is released?

Maintainers select a reviewed revision for release. Contributor PRs and contributor-owned demos do not grant production deployment authority. The official integration stage is one persistent, restricted environment; its Cloudflare Workers continue using Wrangler environment `stage`, and its deployed revision must be recorded so reviewers know what they are testing.

A release identifies the source revision, frontend build, three Worker deployments, target configuration, and migration state. Deployment order is evidence Worker, briefing Worker, then frontend, after required provisioning and reviewed D1 migrations. This is an order for dependencies, not an atomic transaction across Workers and databases.

Do not assume a failed step undoes earlier successful steps. Record partial deployments and assess compatibility before continuing or restoring code. Stage and production retain separate state and credentials.

## Release identity

The release receipt `.data/production-release/tag.json` is authoritative and contains exactly `version`, `tag`, `commitSha`, and `pipelineId`. It binds the immutable protected tag to the verified protected-main pipeline and artifact; production promotes the same hashed bundles with `--no-bundle`, without rebuilding.

- Production displays `vMAJOR.MINOR.PATCH - <short-commit>` from validated `NUXT_PUBLIC_RELEASE_VERSION` runtime identity and the promoted artifact's build identity, never `package.json`. The hash links to the full commit that the release tag identifies.
- Stage displays `stage - <short-commit>` for the main commit used to build the deployed artifact. Local dev runs display `dev - <short-commit>`. Both hashes link to the full commit on the actual repository host.
- Metadata describes the built artifact, not a developer's current working tree or a mutable branch tip.

Stage selection requires the exact configured site origin `https://stage.caniupdate.dev`; other non-production origins use the `dev` fallback. Visible footer labels and accessible commit-link names use the same environment terminology.

The footer uses a short hash prefix. The exact abbreviation length is a presentation detail, not a database or deployment identity; records and commit links retain the full hash. A release tag names a commit; production promotion must verify that the tag, receipt, and artifact identify that same commit.

The shared release schema accepts stable `MAJOR.MINOR.PATCH` versions only and validates a receipt's matching `v<version>` tag, lowercase full commit SHA, and positive decimal pipeline ID. At the production origin, the footer renders version and commit together only when the runtime version is valid and build identity is present; invalid production versions do not fall back to a stage or dev label. The release version is a runtime setting, not part of the build identity. No build-metadata endpoint is exposed.

Stage and dev identity is implemented in [`SiteFooter.vue`](../../../app/components/SiteFooter.vue). Browser smoke checks compare its rendered commit link directly with the expected CI SHA. The validated SHA/repository URL pair is compiled into Nuxt app config, not runtime configuration; builds without metadata omit the link. No build-metadata endpoint is exposed.

Production identity is implemented in [`SiteFooter.vue`](../../../app/components/SiteFooter.vue): a valid receipt-derived version and the promoted build identity display `vX.Y.Z - <short-commit>`, linked to the tag commit. GitLab smoke checks both the expected version and full commit link in Chromium and Firefox. A missing or invalid production version does not fall back to a stage or dev label.

### Manual protected-main release

Every protected-main push runs required checks, builds the exact deployable frontend and backend artifacts, and delivers stage. Only after stage deployment and both Chromium/Firefox checks pass can a Maintainer/Owner use the blocking manual `release:tag` input to select a stable SemVer version. The job verifies its protected-main push pipeline, required job/bridge evidence, current branch SHA, manual actor role, version progression, and the protected-tag rules through the read-only GitLab API; it then writes the tag and receipt. It never opens/merges a version MR or changes `package.json`. Ordinary main pushes cannot deploy production.

`production:delivery` requires that receipt and consumes the same `build-smoke` artifact, verifies the tag/version/commit/pipeline identity and all artifact hashes, then promotes those exact bundles. The production child verifies the immutable annotated tag and current protected-main SHA before migrating/deploying. It deploys evidence → briefing → frontend and checks the public surface and receipt version footer in both browsers. Its smoke intercepts the briefing POST before dispatch and returns a schema-valid synthetic fixture; it does not prove paid-provider integration or rate limiting. Deployment is non-atomic, failed partial state is reported, and there is no automatic rollback.

If deployment fails while its commit is still the current protected-main SHA, inspect the report and retry only that pipeline with the same exact immutable receipt. A conflicting or moved tag cannot be reused. Once `main` advances, stale production jobs are rejected; recovery requires a newer protected-main revision with all checks and stage browser verification, then a higher version selected in that pipeline's manual release job and a forward deployment accounting for partial Worker/migration changes. This workflow is implemented locally but has not deployed production.

## Verification and release evidence

### Before deployment

1. Select and record the reviewed source revision.
2. Run the applicable type, lint, format, unit, and isolated fixture checks in [development](development.md#how-do-i-run-checks).
3. Review the exact target account, origins, private bindings, resources, secrets ownership, and access policy.
4. Review pending migrations, stored-response compatibility, deployment order, and the known compatible recovery revision.
5. Build the origin-independent artifact and record its identity. Supply the target frontend origin at runtime; stop a built local dev runtime before replacing its output.
6. For production, establish representative deployed CPU/quota evidence and verify implemented abuse controls. These are not replaced by local CPU measurements.

### After deployment

Exercise the actual public surface, not only bundle compilation:

| Check                         | Evidence to retain                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health                        | HTTP status and expected health payload                                                                                                                                                                                           |
| Search and metadata           | Requested package identity and valid response                                                                                                                                                                                     |
| Declarations and measurements | Requested package/version pair, validated response, rendered evidence                                                                                                                                                             |
| Browser interaction           | Hydrated search, version selection, comparison navigation, and direct reload; browser errors                                                                                                                                      |
| Briefing reuse                | Stored-result response distinguished from new generation                                                                                                                                                                          |
| Socket lifecycle              | Queue/subscription completion when intentionally exercised; origin/access results                                                                                                                                                 |
| Restricted stage              | Authorized browser and approved automation work; unauthorized access is refused on both browser-facing hosts                                                                                                                      |
| Managed rate limiting         | General API/SSR 429 with retry guidance; new-generation refusal before acceptance; D1 hits and pending joins exempt from that allowance; explicit retries count again; browser manual recovery without automatic 429 resubmission |
| Capacity                      | Workload, duration, cache state, concurrency, generator locations, deployed CPU/limits and observed failures                                                                                                                      |

For frontend/build configuration changes, exercise both Firefox and Chromium. The [entry-import-map decision](../adrs/firefox-entry-import-map.md) records the historical Firefox failure, retained startup workaround, and limits of the observation.

Routine contribution checks and the [local smoke](development.md#exercise-the-asynchronous-briefing-without-paid-inference) use a fixture. The deployed browser smoke intercepts the briefing POST before dispatch, validates the response envelope, and verifies fixture text and its citation render both after comparison and after reload. It does not exercise provider generation, durable briefing reuse, or subscription completion. A separate, intentionally authorized stage provider check may use that environment's dedicated key; it is not part of the default smoke and can incur charges. This does not authorize production provider calls or reuse of production keys.

The deployed smoke uses Effect's HTTP, configuration, and filesystem services. HTTP admission probes do not follow redirects; the health deadline covers response-body decoding as well as transport. Each run attempts to write its owner-only `.data/deployed-verification/report.json` on success, failure, defects, or graceful cancellation. A report-write failure fails the command; forced process termination cannot guarantee a report.

Label these outcomes separately:

- **Fixture generation:** exercised lifecycle with a test provider.
- **Stored result:** reused an existing D1 response; no proof of new provider integration.
- **Real generation:** deliberately exercised a provider call and checked its durable result.
- **Not exercised:** no evidence for the path in this release.

Do not silently retry failed paid checks or infer exactly-once billing. The application can retry invalid model output once, and a later explicit submission can start another generation. See [generation failure semantics](../briefing.md#result-storage-and-generation-failures).

### Individual release record

Keep reproducible procedures here and deployment-specific observations with the individual release. A record should contain:

- Operator and timestamp, target environment, full source revision, and production package version when applicable.
- Frontend build origin and all three deployed Worker version IDs.
- Migration files applied, failures, and final migration state.
- Per-check observed results and explicit omissions, including fixture/cache/real-inference labels.
- Relevant workload and CPU/quota evidence, without converting limited samples into capacity guarantees.
- Partial-deployment status, compatible recovery revision, and migration constraints.
- Links to retained artifacts and incidents.

Never include tokens, keys, raw private configuration, or provider request bodies. An ignored local artifact is not reproducible evidence available to another clone; say where evidence is retained and who can access it. No automated release-record publisher is established by this document.

## Database and stored-data changes

Database changes must be discussed during review. D1 is a SQLite-backed database; the current application migration creates `package_briefings`. Job state also lives in SQLite-backed Durable Objects. D1 migrations do not migrate that separate job state automatically.

Adopt these rules:

1. Generate a new migration for each schema change with `nub run db:generate`, commit generator SQL/snapshots and the byte-identical flat Wrangler mirror, and run `nub run db:check`. Do not hand-edit or rewrite already-applied history. Wrangler is the sole D1 migration applier.
2. Review old/new code compatibility, scan or rewrite cost, deployment sequence, and recovery before applying it remotely.
3. Prefer additive changes that preserve a compatible rollback target. Add structures first, deploy compatible code, backfill deliberately, and remove obsolete structures only through a separately reviewed change.
4. Rehearse data-heavy or destructive changes against representative data, and validate the intended backup/restoration procedure before production execution.
5. Review stored JSON contract changes even when no SQL schema changes. Existing `response_json` must remain readable, be deliberately migrated, or have an explicitly approved disposition. Do not discard paid results merely to satisfy a new decoder.
6. Use D1-specific migration and foreign-key procedures. Generic SQLite administrative recipes are not automatically supported by D1.

There is no rule requiring a new table for every attribute. Normalize around entities, relationships, and query needs. Extra tables introduce joins, indexes, and consistency work.

[SQLite documents](https://www.sqlite.org/lang_altertable.html) that simple nullable-column additions and renames do not rewrite existing table contents. Constraint validation can scan rows; column removal rewrites contents. Table rebuilds, backfills, and index creation can scale with existing data. A new column is therefore not inherently an expensive rewrite, but each actual migration needs review.

[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) are ordered SQL files tracked in the database. Local validation does not apply them remotely. Remote commands must select the explicit account, config, environment, and database. A migration that succeeds is not automatically reversed by a Worker rollback.

### Evidence Durable Object schema changes

Evidence table/index changes use `nub run db:generate:evidence`, with committed `workers/evidence/drizzle/` SQL/snapshots and `workers/evidence/migrations.generated.json`. `nub run db:check` verifies both DO and D1 artifacts. Pending evidence history is applied synchronously by the public Drizzle DO migrator when an object constructs its cache; Wrangler D1 commands do not apply it. The initial bundled bootstrap alone is idempotent to adopt pre-existing tables without changing rows/chunks/expiry metadata. Subsequent history is strict and append-only.

Rehearse adoption, persisted reopen, rollback and subsequent migrations in disposable actual-workerd state. Do not reset DOs or add a new class migration tag to avoid a table collision. A migration failure retains its initialize error/cause and leaves storage unavailable; do not delete data or substitute a miss. The pinned ORM package patch preserves original SQL failure causes while `transactionSync` rolls back. A Worker rollback does not reverse applied DO schema changes: choose code compatible with both histories or a reviewed forward migration, never rewrite ledger rows or applied SQL.

### One-time Drizzle adoption cutover

This separately approved, destructive data cutover is **not part of the stage hostname or GitLab runtime-settings change**. No database, Queue, or Durable Object is recreated or reset by a stage redeployment; existing data and history remain intact. Do not execute the cutover below as part of routine staging, a custom-domain attachment, or this task.

The [accepted Drizzle ADR](../adrs/drizzle-database-layer.md) authorizes replacing the old initial D1 schema/history **once, for local and the existing maintainer stage only**. On 2026-10-05 the user explicitly amended retention: **discard old briefing rows, without restoration**. Retained jobs can reference discarded results; those old references are not preserved. Production is excluded. Do not delete/recreate databases or reset Durable Object/Queue state. Subsequent migrations remain append-only.

Use the verified source checkout and installed `nub exec wrangler`. `LOCAL_PERSIST_TO` must be the **actual original checkout's absolute persistence path**, not the worktree's empty state. Set `CUTOVER_DIR` to a new ignored `.data` backup directory with mode `700` and `umask 077`, without overwriting an earlier backup.

Before destruction:

1. Verify config/account/binding/database identity. Local is `can-i-update-local-briefings`, ID `00000000-0000-0000-0000-000000000001`; stage account is `8a0be24aad326a55ba610b94b106be81`, database `can-i-update-preview-briefings`, ID `351da802-5296-4e6a-a186-f9d1e99036b6`, briefing config `--env stage`.
2. Stop the actual local launcher and its children; do not bypass its live lock. For stage, block acceptance through the **frontend** Access controls and prove accepted work has settled. Socket denial alone does not block the private submission binding. A zero Queue backlog or fixed sleep does not establish terminal Durable Object KV job state. Stop if maintenance/quiescence cannot be proved; do not add a pause/admin subsystem as incidental migration work.
3. Inspect table/index inventory and migration records. The reset SQL below is valid only when `package_briefings` is the sole application table and `d1_migrations` belongs entirely to its replaced history. Unexpected tables/history require reassessment. If the migration table does not exist, omit the `DELETE` rather than suppressing unrelated SQL errors.
4. Retain a full D1 backup for recovery. Do not perform row-only export, retention validation, or row restoration for this explicitly approved empty cutover. Generated initial and subsequent migrations have already been rehearsed in disposable state.

For local, execute sequentially and stop on failure:

```bash
cp -a "$LOCAL_PERSIST_TO/v3/d1" "$CUTOVER_DIR/local-d1"
nub exec wrangler d1 execute can-i-update-local-briefings --local \
  --config workers/briefing/wrangler.jsonc --persist-to "$LOCAL_PERSIST_TO" \
  --command 'DROP TABLE IF EXISTS package_briefings; DELETE FROM d1_migrations;'
nub exec wrangler d1 migrations apply can-i-update-local-briefings --local \
  --config workers/briefing/wrangler.jsonc --persist-to "$LOCAL_PERSIST_TO"
```

The remote reset commands below are retained for the separately approved one-time cutover, but this hostname/runtime-settings change does not authorize them. No protected operator path for this destructive cutover is established here; do not run these commands until a separate authorization and secure execution path are in place. Never load a local dotenv file or copy GitLab credentials to a workstation. Ordinary stage deployments use the protected GitLab procedure only.

```bash
nub exec wrangler d1 info can-i-update-preview-briefings \
  --config workers/briefing/wrangler.jsonc --env stage --json
nub exec wrangler d1 export can-i-update-preview-briefings --remote \
  --config workers/briefing/wrangler.jsonc --env stage --output "$CUTOVER_DIR/stage-full.sql"
nub exec wrangler d1 execute can-i-update-preview-briefings --remote \
  --config workers/briefing/wrangler.jsonc --env stage \
  --command 'DROP TABLE IF EXISTS package_briefings; DELETE FROM d1_migrations;'
```

Check zero stored rows, table nullability/defaults/indexes, exact applied migration filenames, and no pending migrations. Restart local with the verified checkout and `--persist-to "$LOCAL_PERSIST_TO"`; never restart an old checkout on the reset history. For an independently authorized stage cutover, do not manually run `wrangler d1 migrations apply` or `wrangler deploy`: after database verification, use the protected GitLab procedure in [deployment](deployment.md#deploying-the-existing-maintainer-stage), which supplies `https://stage.caniupdate.dev` at runtime, deploys with `--env stage`, and applies the checked-in migration history. Verify deployed health and migration state without generating a new paid result; a new paid call requires separate approval.

If any step fails, keep the launcher stopped or stage in maintenance. Restore the verified D1 backup with reviewed compatible code; do not reset DOs/Queues, replay jobs, regenerate SQL to conceal failure, or restore migration records without matching schema/data. Record source revision, operator/time, target IDs, filenames, backup access/location, checks and unexercised paths. Only then restore access. Approval and execution evidence are distinct; see the ADR rollout status.

## Diagnose before changing state

| Symptom                             | Investigation boundary                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frontend briefing refusal           | Evidence/service bindings, protocol, configuration, D1 reads; do not treat every `503` as provider failure                          |
| Provider unavailable                | Worker-owned endpoint/key/model, spend limit, provider availability; use sanitized errors rather than exposing provider bodies      |
| Job accepted but no terminal result | Job/Queue state, dispatch and lease recovery, persistence; do not blindly submit again                                              |
| Socket fails                        | Public URL, exact Origin, Access on the socket hostname, browser authentication, and Worker errors                                  |
| Result no longer decodes            | Stored-data compatibility; not automatically a cache miss                                                                           |
| Requests fail under load            | Deployed CPU and independent resource quotas, rate-limit evidence, upstream failures; client latency alone cannot isolate the cause |

The frontend logs sanitized submission error names and recognized reasons, not evidence packets or credentials. Observability configuration does not prove logs are being ingested; verify actual diagnostic access in the target environment.

## State-preserving recovery

### Contain the incident

Pause acceptance of new generation while investigating a spending or generation incident. **A dedicated pause control is not implemented yet.** Use an explicitly reviewed containment action, such as temporarily blocking the public submission route through the target's access rules. Record the scope and consequences rather than claiming an unavailable toggle exists.

Removing provider configuration can refuse new cold submissions and pending-job joins, but does not cancel an already-running call; queued jobs may settle unavailable when configuration is missing. Blocking all submissions also prevents frontend access to cached results through that route. Socket subscriptions are read-only and do not cancel accepted jobs. Key revocation is not a promise to reverse a charge already incurred.

### Recover code without silently rewinding data

- Identify deployed versions and the point of failure, including partially completed deploys.
- Restore a known-compatible reviewed revision only after checking schema, stored JSON, job-state, and queued-message compatibility.
- Reuse the identified compatible artifact, or rebuild its reviewed revision; supply the target origin and environment-owned configuration at runtime, never stage credentials.
- Re-exercise API/browser and storage behavior, then record the recovered versions and remaining limitations.
- Prefer a forward fix where previous code is incompatible with the new state. Do not claim every release can be safely rolled back.

D1 restoration, Durable Object state changes, Queue handling, and external billing are separate operations. A database rewind can erase successful paid results while jobs or queued messages still reference them. Any state restoration needs an incident-specific plan, operator approval, and post-restoration verification.

Do not delete databases, object namespaces, or briefing rows as routine troubleshooting. Do not replay jobs indiscriminately; later accepted generations can spend again.

## Stage lifetime and teardown

Keep one persistent official integration stage initially. Maintain a record of the revision currently deployed. Separate official per-PR environments are not promised by this document.

Contributor demos remain contributor-owned. Before teardown, identify the exact account, Worker names, Queue, D1 database, and associated Durable Object state. Decide whether any stored results must be retained and remove only resources belonging exclusively to that demo. Removing a public URL alone is not proof that all persistent resources or credentials were removed.

Revoke unused demo/provider/access credentials and account for retained state and pending work. Never provide a blanket deletion command targeting names copied from the maintainer configuration. Teardown is destructive and requires explicit operator intent.
