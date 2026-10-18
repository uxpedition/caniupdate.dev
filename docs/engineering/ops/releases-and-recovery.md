# Releases and recovery

This guide describes maintainer release and recovery procedures and their prerequisites. It does not authorize a release or establish the current state of a remote environment.

See [development](development.md) for local checks and [deployment](deployment.md) for environment ownership, credentials, and deploy order.

## Who releases, and what is released?

Maintainers select a reviewed revision for release. A contributor PR or demo does not grant production deployment authority.

The official integration stage is one persistent, restricted environment using Wrangler `stage`. Record its deployed revision so reviewers know what they are testing.

A release identifies the source revision, frontend build, three Worker deployments, target configuration, and migration state. After required provisioning and reviewed D1 migrations, deploy evidence → briefing → frontend.

**This order handles dependencies; it is not an atomic transaction.** A failed step does not undo successful earlier steps. Record partial deployments and check compatibility before continuing or restoring code. Stage and production keep separate state and credentials.

## Release identity

The authoritative release receipt is `.data/production-release/tag.json`. It contains exactly `version`, `tag`, `commitSha`, and `pipelineId`.

The receipt ties an immutable protected tag to the verified protected-main pipeline and build artifact. Production promotes the same hashed bundles with `--no-bundle`, without rebuilding.

- Production displays `vMAJOR.MINOR.PATCH - <short-commit>` from validated `NUXT_PUBLIC_RELEASE_VERSION` runtime identity and the promoted artifact's build identity, never `package.json`. The hash links to the full commit that the release tag identifies.
- Stage displays `stage - <short-commit>` for the main commit used to build the deployed artifact. Local dev runs display `dev - <short-commit>`. Both hashes link to the full commit on the actual repository host.
- Metadata describes the built artifact, not a developer's current working tree or a mutable branch tip.

The `stage` label requires exact site origin `https://stage.caniupdate.dev`. Other non-production origins use `dev`. Visible labels and accessible commit-link names use the same environment terms.

The footer abbreviates the hash for display only. Records and links keep the full hash. Promotion must verify that tag, receipt, and artifact all identify the same commit.

The shared release schema accepts stable `MAJOR.MINOR.PATCH` versions only. A receipt must have a matching `v<version>` tag, lowercase full commit SHA, and positive decimal pipeline ID.

At the production origin, version and commit render together only with a valid runtime version and build identity. An invalid version does not fall back to stage or dev. The release version is a runtime setting, not part of build identity.

[`SiteFooter.vue`](../../../app/components/SiteFooter.vue) implements stage/dev identity. Browser smoke compares its rendered commit link with the expected CI SHA. Nuxt app config contains the compiled, validated SHA/repository URL pair—not runtime configuration. Builds without metadata omit the link.

[`SiteFooter.vue`](../../../app/components/SiteFooter.vue) also implements production identity. A valid receipt version and promoted build identity display `vX.Y.Z - <short-commit>`, linked to the tag commit. GitLab smoke checks the expected version and full commit link in Chromium and Firefox. There is no build-metadata endpoint.

### Manual protected-main release

Every protected-main push runs required checks, builds the exact frontend/backend artifacts, and delivers stage. Only after stage deployment and both browser checks pass can a Maintainer/Owner select a stable SemVer version through blocking manual `release:tag`.

Using the read-only GitLab API, the job checks its protected-main push pipeline, required job/bridge evidence, current branch SHA, manual actor role, version progression, and protected-tag rules. It then writes the tag and receipt. It never opens or merges a version MR or changes `package.json`. Ordinary main pushes cannot deploy production.

`production:delivery` requires the receipt and original `build-smoke` artifact. It verifies tag/version/commit/pipeline identity and all artifact hashes. Before migration/deployment, the child checks the immutable annotated tag and current protected-main SHA.

It promotes the exact bundles in evidence → briefing → frontend order. Both browsers check the public surface and receipt-version footer. Smoke intercepts briefing POST before dispatch and returns a schema-valid synthetic fixture. It proves neither paid-provider integration nor rate limiting.

**Deployment is non-atomic, reports partial failures, and has no automatic rollback.**

If deployment fails while its commit is still protected `main`:

1. Inspect the report.
2. Retry only that pipeline with the same exact immutable receipt.
3. Do not reuse a conflicting or moved tag.

Once `main` advances, stale production jobs are rejected. Recovery needs a newer protected-main revision with passing checks and stage browsers, then a higher version selected in that pipeline's manual release job. Deploy forward, accounting for partial Worker/migration changes.

Verify each release's receipt and pipeline evidence rather than inferring provenance from deployment existence.

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

For frontend/build configuration changes, exercise Firefox and Chromium. The [entry-import-map decision](../adrs/firefox-entry-import-map.md) records the historical Firefox failure, retained startup workaround, and limits of that observation.

Routine contribution checks and [local smoke](development.md#exercise-the-asynchronous-briefing-without-paid-inference) use a fixture. Deployed browser smoke intercepts briefing POST before dispatch, validates the response envelope, and checks fixture text and citation rendering after comparison and reload.

That deployed smoke does not exercise provider generation, durable briefing reuse, or subscription completion. A separate, intentionally authorized stage provider check can use the stage key and incur charges. It is not part of default smoke. It authorizes neither production calls nor production-key reuse.

Deployed smoke uses Effect HTTP, configuration, and filesystem services. HTTP admission probes do not follow redirects. The health deadline includes response-body decoding, not just transport.

Each run attempts to write owner-only `.data/deployed-verification/report.json` on success, failure, defects, or graceful cancellation. Failure to write the report fails the command. Forced process termination cannot guarantee a report.

Label these outcomes separately:

- **Fixture generation:** exercised lifecycle with a test provider.
- **Stored result:** reused an existing D1 response; no proof of new provider integration.
- **Real generation:** deliberately exercised a provider call and checked its durable result.
- **Not exercised:** no evidence for the path in this release.

Do not silently retry failed paid checks or assume exactly-once billing. The app can retry invalid model output once. A later explicit submission can start another generation. See [generation failure semantics](../briefing.md#result-storage-and-generation-failures).

### Response-header changes and cached HTML

Changing the app's headers does not repair an HTML response already stored at the edge. Include cache replacement in an authorized frontend release:

1. Confirm the target's frontend config still has `cache.enabled: true` and `cross_version_cache: false`. A new Worker version then starts a separate cache; do not enable cross-version reuse for a header-policy change.
2. Deploy the reviewed frontend artifact through the authorized release workflow. Record its Worker version. A new version replaces the active cache namespace; do not assume a same-version restart invalidates responses.
3. GET `/`, `/about`, `/privacy`, and representative ordinary and scoped comparison URLs. Retain status, `X-Content-Type-Options`, `Referrer-Policy`, cache directives, and available cache-hit/age evidence. Repeat the exact URLs to check warm delivery after repopulation. Check a complete stored-result comparison as well as an uncached comparison.
4. Confirm a single `nosniff` value and the explicit referrer policy on successful responses. Check representative 4xx and 5xx responses separately; Nitro errors must retain `no-referrer`. Do not trigger paid generation or exhaust shared limits without separate authorization.
5. Where a response supplies `ETag` or `Last-Modified`, repeat its GET with `If-None-Match` or `If-Modified-Since`. Inspect the actual 304 and verify that the browser's reused response keeps the security policy. If the target returns 200 or supplies no validator, record 304 as not exercised rather than claiming support.
6. If old headers remain, identify whether Workers Cache, another Cloudflare cache rule, or an upstream layer served the response. Invalidate affected URLs in that owning layer using the target's separately authorized purge procedure, then repeat cold and warm GETs. This repository does not automate an account-wide purge.

Keep browser revalidation and the existing edge TTLs unchanged. Record cache replacement and repopulation evidence with the release. Local `smoke:routes:built` checks successful pages, ordinary/scoped comparisons, and 400/404/429/503 errors in the built Worker, but cannot prove hosted cache invalidation, warm edge delivery, or hosted 304 behavior.

Apply the same content-freshness checks to other HTML changes: compare the expected text or metadata, not only cache-hit status. Version separation is not a physical purge. Data changes within one Worker version do not invalidate eligible comparison HTML; it can remain cached until expiry or eviction. A rollback may reuse still-valid entries for the restored version. See the [hosted HTML cache policy](deployment.md#hosted-frontend-html-caching) and [Cloudflare cache controls](https://developers.cloudflare.com/workers/cache/configuration/).

The release operator owns recording these checks. Local header checks do not prove hosted invalidation. Confirm the target's deployed cache configuration rather than assuming the checked-in flags are active.

### Individual release record

Keep reusable procedures here and deployment observations with the individual release. Each record should include:

- Operator and timestamp, target environment, full source revision, and production package version when applicable.
- Frontend build origin and all three deployed Worker version IDs.
- Migration files applied, failures, and final migration state.
- Per-check observed results and explicit omissions, including fixture/cache/real-inference labels.
- Relevant workload and CPU/quota evidence, without converting limited samples into capacity guarantees.
- Partial-deployment status, compatible recovery revision, and migration constraints.
- Links to retained artifacts and incidents.

**Exclude tokens, keys, raw private configuration, and provider request bodies.** An ignored local artifact is not evidence another clone can access. State where evidence is retained and who can read it. This guide establishes no automated release-record publisher.

## Database and stored-data changes

Discuss database changes during review. D1 is SQLite-backed; the current application migration creates `package_briefings`.

Job state lives separately in SQLite-backed Durable Objects. D1 migrations do not migrate that job state.

Follow these rules:

1. For each schema change, generate a new migration with `nub run db:generate`. Commit generator SQL/snapshots and the byte-identical flat Wrangler mirror. Run `nub run db:check`. Never hand-edit or rewrite applied history. Only Wrangler applies D1 migrations.
2. Before remote application, review old/new code compatibility, scan or rewrite cost, deployment order, and recovery.
3. Prefer additions that preserve a compatible rollback target. Add structures, deploy compatible code, then backfill deliberately. Remove old structures only in a separately reviewed change.
4. Rehearse data-heavy or destructive changes on representative data. Validate backup and restoration before production execution.
5. Review stored JSON contract changes even without SQL changes. Existing `response_json` must stay readable, be deliberately migrated, or have an explicitly approved disposition. Do not discard paid results just to satisfy a new decoder.
6. Follow D1-specific migration and foreign-key procedures. Generic SQLite administration commands may not work in D1.

A new attribute does not always need a table. Design tables around entities, relationships, and queries. Each extra table adds joins, indexes, and consistency work.

[SQLite documents](https://www.sqlite.org/lang_altertable.html) that simple nullable-column additions and renames do not rewrite table contents. Constraint validation can scan rows; column removal rewrites contents. Rebuilds, backfills, and index creation can grow with data size.

A new column is not inherently an expensive rewrite. Review the actual migration.

[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) are ordered SQL files tracked in the database. Local validation does not apply them remotely. Remote commands must select the explicit account, config, environment, and database. Rolling back a Worker does not automatically reverse a successful migration.

### Evidence Durable Object schema changes

For evidence table/index changes, use `nub run db:generate:evidence`. Commit `workers/evidence/drizzle/` SQL/snapshots and `workers/evidence/migrations.generated.json`. `nub run db:check` checks both DO and D1 artifacts.

When an object constructs its cache, the public Drizzle DO migrator applies pending history synchronously. Wrangler D1 commands do not apply it.

Only the initial bundled bootstrap is safe to repeat. It adopts existing tables without changing rows, chunks, or expiry metadata. Later history is strict and append-only.

Rehearse adoption, reopening persisted state, rollback, and later migrations in disposable real-workerd state. Do not reset DOs or add a class migration tag to avoid a table collision.

**Migration failure leaves storage unavailable with its initialization error/cause.** Do not delete data or turn the failure into a cache miss. The pinned ORM patch preserves original SQL errors while `transactionSync` rolls back.

A Worker rollback does not reverse DO schema changes. Use code compatible with both histories or a reviewed forward migration. Never rewrite ledger rows or applied SQL.

### One-time Drizzle adoption cutover

**Use this procedure only for a target that still has the pre-Drizzle initial D1 history.** Routine deployments preserve databases, Queues, Durable Objects, and their history. They do not require a reset.

The [Drizzle decision](../adrs/drizzle-database-layer.md) defines the one-time exception for local and the existing maintainer stage, including discarded briefing rows and the blocked stage prerequisites. Check its execution status before proceeding; approval is not proof that a target has been migrated.

Production is excluded. Retained jobs can refer to discarded results. Do not delete/recreate databases or reset DO/Queue state. Later migrations remain append-only.

Use the verified checkout and installed `nub exec wrangler`. Before starting:

- Set `LOCAL_PERSIST_TO` to the **actual original checkout's absolute persistence path**, not an empty worktree directory.
- Set `CUTOVER_DIR` to a new ignored `.data` backup directory, with mode `700` and `umask 077`.
- Do not overwrite an earlier backup.

Before destruction:

1. Verify config, account, binding, and database identity against the intended target. Use `BRIEFINGS_DB` from the [briefing configuration](../../../workers/briefing/wrangler.jsonc): the root binding for local, or `env.stage` for staging. Check the account and database IDs before any state change.
2. Stop the actual local launcher and children; never bypass its live lock. For stage, block acceptance through **frontend** Access controls and prove accepted work has finished.

   Blocking sockets alone does not block the private submission binding. Zero Queue backlog or a fixed sleep does not prove terminal Durable Object KV job state. Stop if maintenance and settled work cannot be proved. Do not add a pause/admin subsystem as incidental migration work.

3. Inspect tables, indexes, and migration records. The reset SQL below is valid only if `package_briefings` is the sole application table and `d1_migrations` belongs entirely to the replaced history. Reassess unexpected tables/history. If the migration table is absent, omit `DELETE`; do not suppress unrelated SQL errors.
4. Keep a full D1 backup for recovery. This cutover discards briefing rows; do not restore them as part of normal completion. Rehearse generated initial and later migrations in disposable state before touching the target.

For local, run sequentially and stop on failure:

```bash
cp -a "$LOCAL_PERSIST_TO/v3/d1" "$CUTOVER_DIR/local-d1"
nub exec wrangler d1 execute can-i-update-local-briefings --local \
  --config workers/briefing/wrangler.jsonc --persist-to "$LOCAL_PERSIST_TO" \
  --command 'DROP TABLE IF EXISTS package_briefings; DELETE FROM d1_migrations;'
nub exec wrangler d1 migrations apply can-i-update-local-briefings --local \
  --config workers/briefing/wrangler.jsonc --persist-to "$LOCAL_PERSIST_TO"
```

**Remote reset requires separate authorization and a secure execution path.** Routine deployment or hostname changes do not authorize it. This guide provides no protected operator path for destructive cutover.

Never load a local dotenv file or copy GitLab credentials to a workstation. Ordinary stage deployments use only protected GitLab.

```bash
nub exec wrangler d1 info BRIEFINGS_DB \
  --config workers/briefing/wrangler.jsonc --env stage --json
nub exec wrangler d1 export BRIEFINGS_DB --remote \
  --config workers/briefing/wrangler.jsonc --env stage --output "$CUTOVER_DIR/stage-full.sql"
nub exec wrangler d1 execute BRIEFINGS_DB --remote \
  --config workers/briefing/wrangler.jsonc --env stage \
  --command 'DROP TABLE IF EXISTS package_briefings; DELETE FROM d1_migrations;'
```

After reset, check zero stored rows, table nullability/defaults/indexes, exact applied migration filenames, and no pending migrations.

Restart local from the verified checkout with `--persist-to "$LOCAL_PERSIST_TO"`. Never start an old checkout on reset history.

For a separately authorized stage cutover, do not manually run `wrangler d1 migrations apply` or `wrangler deploy`. After database verification, use protected GitLab [deployment](deployment.md#deploying-the-existing-maintainer-stage). It supplies runtime `https://stage.caniupdate.dev`, deploys with `--env stage`, and applies checked-in migrations.

Check deployed health and migration state without generating a paid result. A new paid call needs separate approval.

If any step fails, keep the launcher stopped or stage in maintenance. Restore the verified D1 backup with reviewed compatible code.

Do not reset DOs/Queues, replay jobs, regenerate SQL to hide failure, or restore migration records without matching schema/data. Record revision, operator/time, target IDs, filenames, backup location/access, checks, and unexercised paths. Only then restore access.

Approval is not proof of execution. See the ADR rollout status.

## Diagnose before changing state

| Symptom                             | Investigation boundary                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frontend briefing refusal           | Evidence/service bindings, protocol, configuration, D1 reads; do not treat every `503` as provider failure                          |
| Provider unavailable                | Worker-owned endpoint/key/model, spend limit, provider availability; use sanitized errors rather than exposing provider bodies      |
| Job accepted but no terminal result | Job/Queue state, dispatch and lease recovery, persistence; do not blindly submit again                                              |
| Socket fails                        | Public URL, exact Origin, Access on the socket hostname, browser authentication, and Worker errors                                  |
| Result no longer decodes            | Stored-data compatibility; not automatically a cache miss                                                                           |
| Requests fail under load            | Deployed CPU and independent resource quotas, rate-limit evidence, upstream failures; client latency alone cannot isolate the cause |

Frontend logs include sanitized submission error names and recognized reasons, not evidence packets or credentials. Configuration alone does not prove log ingestion. Verify actual diagnostic access in the target environment.

## State-preserving recovery

### Contain the incident

Contain a spending or generation incident by pausing new-generation acceptance. **No dedicated pause control is implemented.** Use an explicitly reviewed action, such as temporarily blocking the public submission route through target access rules. Record its scope and consequences; do not claim an unavailable toggle exists.

Understand what containment does not do:

- Removing provider configuration can refuse cold submissions and pending-job joins. It does not cancel a running call. Queued jobs may finish as unavailable without configuration.
- Blocking all submissions also blocks frontend access to cached results through that route.
- Read-only socket subscriptions do not cancel accepted jobs.
- Revoking a key does not guarantee reversal of an incurred charge.

### Recover code without silently rewinding data

- Identify deployed versions and the failure point, including partially completed deployments.
- Restore a reviewed, known-compatible revision only after checking schema, stored JSON, job-state, and queued-message compatibility.
- Reuse the compatible artifact or rebuild its reviewed revision. Supply target origin and environment-owned settings at runtime, never stage credentials.
- Recheck API/browser and storage behavior. Record recovered versions and remaining limits.
- Prefer a forward fix when previous code cannot read the new state. Not every release can safely roll back.

D1 restoration, DO state changes, Queue handling, and external billing are separate operations. Rewinding a database can erase paid results still referenced by jobs or messages.

Any state restoration needs an incident-specific plan, operator approval, and verification afterward.

**Do not delete databases, object namespaces, or briefing rows as routine troubleshooting.** Do not replay jobs indiscriminately; later accepted generations can spend again.

## Stage lifetime and teardown

Keep one persistent official integration stage initially and record its deployed revision. This guide does not promise official per-PR environments.

Contributors own their demos. Before teardown:

1. Identify the exact account, Workers, Queue, D1 database, and associated DO state.
2. Decide whether stored results need retention.
3. Remove only resources used exclusively by that demo.
4. Revoke unused demo/provider/access credentials. Account for retained state and pending work.

Removing a public URL does not prove all persistent resources or credentials are gone. Never provide a blanket deletion command using names copied from maintainer config.

**Teardown is destructive and requires explicit operator intent.**
