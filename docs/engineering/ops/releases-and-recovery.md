# Releases and recovery

**Status: reviewed.** This document records the agreed maintainer release and recovery policy, with current capabilities and missing prerequisites identified explicitly. It does not authorize a release or replace historical evidence.

See [development](development.md) for local checks and [deployment](deployment.md) for environment ownership, credentials, and deploy order.

## Who releases, and what is released?

Maintainers select a reviewed revision for release. Contributor PRs and contributor-owned demos do not grant production deployment authority. The official integration preview is one persistent, restricted environment; its deployed revision must be recorded so reviewers know what they are testing.

A release identifies the source revision, frontend build, three Worker deployments, target configuration, and migration state. Deployment order is evidence Worker, briefing Worker, then frontend, after required provisioning and reviewed D1 migrations. This is an order for dependencies, not an atomic transaction across Workers and databases.

Do not assume a failed step undoes earlier successful steps. Record partial deployments and assess compatibility before continuing or restoring code. Preview and production retain separate state and credentials.

## Release identity

The agreed footer behavior is:

- Production displays the release version from `package.json`.
- Preview displays an abbreviated deployed commit hash linking to that full commit on the actual repository host.
- Metadata describes the built artifact, not a developer's current working tree or a mutable branch tip.

The conventional display uses a short hash prefix. The exact abbreviation length is a presentation detail, not a database or deployment identity; records retain the full hash.

**Not implemented:** `package.json` currently has no `version`, and [`SiteFooter.vue`](../../../app/components/SiteFooter.vue) has no build metadata. A release-version update procedure and build-time metadata wiring must exist before claiming the footer identifies releases. These documents do not add them or introduce a release branch convention.

## Verification and release evidence

### Before deployment

1. Select and record the reviewed source revision.
2. Run the applicable type, lint, format, unit, and isolated fixture checks in [development](development.md#how-do-i-run-checks).
3. Review the exact target account, origins, private bindings, resources, secrets ownership, and access policy.
4. Review pending migrations, stored-response compatibility, deployment order, and the known compatible recovery revision.
5. Build for the target frontend origin. Stop a built local preview before replacing its output.
6. For production, establish representative deployed CPU/quota evidence and verify implemented abuse controls. These are not replaced by local CPU measurements.

### After deployment

Exercise the actual public surface, not only bundle compilation:

| Check                           | Evidence to retain                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Health                          | HTTP status and expected health payload                                                                                                 |
| Search and metadata             | Requested package identity and valid response                                                                                           |
| Declarations and measurements   | Requested package/version pair, validated response, rendered evidence                                                                   |
| Browser interaction             | Hydrated search, version selection, comparison navigation, and direct reload; browser errors                                            |
| Briefing reuse                  | Stored-result response distinguished from new generation                                                                                |
| Socket lifecycle                | Queue/subscription completion when intentionally exercised; origin/access results                                                       |
| Restricted preview              | Authorized browser and approved automation work; unauthorized access is refused on both browser-facing hosts                            |
| Rate limiting, once implemented | General rejection behavior; new-generation allowance rejects before acceptance; D1 hits and pending joins do not consume that allowance |
| Capacity                        | Workload, duration, cache state, concurrency, generator locations, deployed CPU/limits and observed failures                            |

For frontend/build configuration changes, exercise both Firefox and Chromium. The [entry-import-map decision](../adrs/firefox-entry-import-map.md) explains the retained startup workaround; the [handoff](../../cloudflare-handoff.md#completed-work) records the historical Firefox failure that API-only smoke missed.

Routine contribution checks and default official preview configuration perform no real inference. The [local smoke](development.md#exercise-the-asynchronous-briefing-without-paid-inference) uses a fixture. A real-provider check is explicit, separately approved, and uses the intended environment's dedicated key. It can incur charges, including when the response or persistence fails.

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

1. Add a new numbered migration file for each schema change. Do not rewrite already-applied migration history.
2. Review old/new code compatibility, scan or rewrite cost, deployment sequence, and recovery before applying it remotely.
3. Prefer additive changes that preserve a compatible rollback target. Add structures first, deploy compatible code, backfill deliberately, and remove obsolete structures only through a separately reviewed change.
4. Rehearse data-heavy or destructive changes against representative data, and validate the intended backup/restoration procedure before production execution.
5. Review stored JSON contract changes even when no SQL schema changes. Existing `response_json` must remain readable, be deliberately migrated, or have an explicitly approved disposition. Do not discard paid results merely to satisfy a new decoder.
6. Use D1-specific migration and foreign-key procedures. Generic SQLite administrative recipes are not automatically supported by D1.

There is no rule requiring a new table for every attribute. Normalize around entities, relationships, and query needs. Extra tables introduce joins, indexes, and consistency work.

[SQLite documents](https://www.sqlite.org/lang_altertable.html) that simple nullable-column additions and renames do not rewrite existing table contents. Constraint validation can scan rows; column removal rewrites contents. Table rebuilds, backfills, and index creation can scale with existing data. A new column is therefore not inherently an expensive rewrite, but each actual migration needs review.

[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) are ordered SQL files tracked in the database. Local validation does not apply them remotely. Remote commands must select the explicit account, config, environment, and database. A migration that succeeds is not automatically reversed by a Worker rollback.

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
- If rebuilding, use the target origin and configuration, not the old preview build.
- Re-exercise API/browser and storage behavior, then record the recovered versions and remaining limitations.
- Prefer a forward fix where previous code is incompatible with the new state. Do not claim every release can be safely rolled back.

D1 restoration, Durable Object state changes, Queue handling, and external billing are separate operations. A database rewind can erase successful paid results while jobs or queued messages still reference them. Any state restoration needs an incident-specific plan, operator approval, and post-restoration verification.

Do not delete databases, object namespaces, or briefing rows as routine troubleshooting. Do not replay jobs indiscriminately; later accepted generations can spend again.

### Legacy snapshot import

The existing exporter is for pre-D1 local snapshots, not a backup system for the current full deployment. It reads the source SQLite file without modifying it, validates rows, and produces SQL that preserves existing target hashes. Stop the application owning the old file and take a backup first. See the [current import procedure](../../../README.md#moving-existing-briefing-snapshots) and [`scripts/export-briefings.ts`](../../../scripts/export-briefings.ts).

Its D1 import does not restore Durable Object job state, Queue state, provider configuration, or access policies. Do not describe it as whole-system recovery.

## Preview lifetime and teardown

Keep one persistent official integration preview initially. Maintain a record of the revision currently deployed. Separate official per-PR environments are not promised by this document.

Contributor demos remain contributor-owned. Before teardown, identify the exact account, Worker names, Queue, D1 database, and associated Durable Object state. Decide whether any stored results must be retained and remove only resources belonging exclusively to that demo. Removing a public URL alone is not proof that all persistent resources or credentials were removed.

Revoke unused demo/provider/access credentials and account for retained state and pending work. Never provide a blanket deletion command targeting names copied from the maintainer configuration. Teardown is destructive and requires explicit operator intent.

## Documentation consolidation

| Source material                                                        | Status                                                        | Proposed disposition                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| README setup, development, checks, local persistence and built runtime | Current commands mixed with stale ownership/runtime wording   | Keep quick start; replace detailed guidance with links to these approved operations documents |
| README remote preview instructions                                     | Existing maintainer-specific procedure and dated observations | Separate bootstrap/redeploy procedures from historical evidence                               |
| `.env.example`                                                         | Current configuration ownership                               | Preserve as the setting reference; link instead of creating competing secret guidance         |
| Cloudflare handoff                                                     | Dated evidence mixed with older deployment/roadmap material   | Preserve unique history with dates; do not use as an undated current-state ledger             |
| Optimization plan                                                      | Implemented behavior mixed with remaining work                | Retain relevant readiness limitations without presenting planned protections as delivered     |

These reviewed documents leave those sources unchanged pending documentation consolidation. The next documentation migration must update affected links and remove competing current guidance rather than leave two authoritative runbooks.
