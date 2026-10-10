---
name: deprecation-and-migration
description: Plans safe removal and transition of legacy code, public APIs, features, dependencies, data, or infrastructure. Use when sunsetting a system, migrating consumers or stored data, removing a compatibility path, or changing a live schema without downtime.
---

# Deprecation and Migration

## Overview

Code is a liability as well as a capability: every live path costs maintenance, security updates, tests, and future readers' attention. Deprecation makes an orderly path to removal; migration moves existing consumers and data safely. The objective is not to preserve every old path, but to leave users, stored data, and active work in a supported state through the cutover.

## When to use

- Replacing an old system, API, library, implementation, or data contract
- Sunsetting a feature or service no longer earning its maintenance cost
- Consolidating duplicate implementations or removing dead code
- Migrating a production database or persisted payload
- Planning the retirement conditions for a new system
- Deciding whether to maintain a legacy component or invest in migration

## Core principles

### Code is a liability

Every retained line and path needs tests, security maintenance, documentation, and an owner. Measure value by capability and reliability, not code volume. Remove redundant implementation after every caller and consumer has been accounted for. Keep only compatibility that protects a real active consumer and has a named retirement condition.

### Hyrum's Law makes removal hard

With enough users, every observable behavior can acquire a consumer—including error shapes, ordering, timing, retries, undocumented side effects, and bugs. Search and measure real usage; do not equate “not documented” or “not found in this repository” with “unused.” Internal callers, external clients, scheduled jobs, queued messages, operators, and persisted data may all depend on an old contract.

### Plan the removal at design time

When introducing a public surface, long-lived data shape, runtime, or integration, ask how it will be retired. A narrow interface, explicit ownership, limited persistence, and a feature flag with a cleanup condition make future removal safer. Do not add an abstraction or compatibility layer solely because a hypothetical future consumer might exist.

## The deprecation decision

Before choosing a path, answer all of these questions with repository or usage evidence:

```
1. Does the old system still provide unique value? If so, can it be maintained instead?
2. Which consumers depend on it—internal call sites, external clients, operators, jobs, stored data?
3. Is the replacement available and production-proven for critical use cases?
4. What does each consumer need to change, and can that change be automated?
5. What is the ongoing cost/risk of retention (security, compatibility, ownership, complexity)?
6. What is the impact and recovery path if the transition fails partway through?
```

Separate observed usage from inference. If usage cannot be measured, state that uncertainty and choose a safer staged path; do not claim zero consumers.

## Advisory versus compulsory deprecation

| Type           | When it fits                                                                                                 | Mechanism                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Advisory**   | Migration is optional and the old system remains safe to operate                                             | Clear status, replacement guidance, warnings where supported, and a measured adoption path                          |
| **Compulsory** | Security exposure, blocked progress, unsupported dependencies, or unsustainable ownership justify a deadline | Explicit removal date, migration tooling and guide, communication, support window, and an approved enforcement plan |

Default to advisory when continued support is safe. Use compulsory removal only when the cost or risk is sufficient to justify forcing migration. A deadline is a commitment: provide working tooling, documentation, compatibility information, and support before setting it. Record the owner and how progress is measured.

## Migration process

### 1. Establish the replacement and contract

Build and verify the replacement before asking consumers to leave a working path. Confirm it covers the old critical use cases and required behavior, including error handling, permissions, performance, accessibility, and operational recovery where relevant. A theoretically better implementation is not production proof.

Write down the old and new contract, consumers, and compatibility window in the existing repository convention. Use `api-and-interface-design` for public interface design, `domain-modeling` for domain terminology, and `codebase-design` for module/interface/seam decisions; this skill owns retirement sequencing. Discussing an approach or drafting a temporary migration plan does not authorize implementation or publication. Keep AI-generated plans and checklists in the named external working directory described by [`../../references/POLICY.md`](../../references/POLICY.md); request authorization before changing a public contract, durable documentation, or production data. Obtain explicit authorization for each external CLI invocation or remote migration command; one approved operation does not authorize subsequent calls.

### 2. Announce and document

Communicate status, replacement, reason, effective date, removal date or advisory policy, migration path, compatibility gaps, support channel, and verification steps. Use the established documentation location and format rather than introducing a second migration-guide convention. Keep private customer identities, credentials, provider/runtime configuration, and sensitive usage details out of public notices.

Illustrative notice:

```markdown
## Deprecation: OldService

**Status:** Deprecated as of YYYY-MM-DD
**Replacement:** NewService (migration guide: <repository-approved link>)
**Removal:** Advisory, or YYYY-MM-DD after the stated support window
**Reason:** State the user-visible maintenance or reliability problem.

### Migration

1. Update the import/configuration using the documented new contract.
2. Run the migration verification against the consumer's supported data.
3. Confirm the relevant behavior and error handling before removal.
```

Do not promise a date that is not supported by the owner, release, and user-communication plan.

### 3. Migrate consumers incrementally

Migrate an identifiable consumer cohort or vertical slice at a time:

```
1. Inventory all touchpoints and persisted references.
2. Migrate one consumer to the replacement.
3. Verify behavior and data against the old/new contract.
4. Observe relevant success, error, and residual old-path usage.
5. Remove that consumer's old references and confirm no regression.
6. Continue until every active consumer is accounted for.
```

The **Churn Rule**: the owner of deprecated infrastructure is responsible for migrating its users or providing a justified, time-bounded compatibility path. Do not announce retirement and leave users to discover the breakage themselves.

### 4. Remove old paths completely

Only after confirming that active consumers have migrated and the retention/rollback window is satisfied:

1. Verify zero active usage using suitable bounded metrics, logs, source/dependency analysis, or direct consumer confirmation. Account for low-frequency work and retained messages, not just recent request volume.
2. Remove old code and obsolete branches, aliases, re-exports, comments, tests, docs, configuration, feature flags, and generated registration that exist only for the retired path.
3. Update tests and public documentation to the clean contract. Retain historical decision records according to the repository's ADR policy; retire stale operational guidance rather than accumulating duplicate manuals.
4. Verify the replacement still covers consumers and the old path no longer routes traffic or reads stale data.

**Default to a clean cutover:** migrate every internal caller and delete the old implementation, aliases, re-exports, and deprecated paths. Do not introduce a shim or adapter for internal callers. Keep an adapter only when an identifiable, real deployed external consumer cannot migrate atomically; make it a deliberately temporary compatibility contract with an owner, visibility, sunset date/condition, telemetry that avoids sensitive identities, tests, and removal plan. An adapter with no demonstrated consumer is another permanent system to maintain.

## Migration patterns

### Strangler migration

Run old and new implementations in parallel only for as long as needed to transfer a real workload. Route a controlled cohort, compare outcome and failure behavior, increase only when thresholds pass, then stop old traffic and delete the old path:

```
old 100% / new 0% → new canary → measured cohorts → new 100% / old 0% → retire old
```

Define the measurement, comparator, stop threshold, and rollback before shifting traffic. Preserve the same data/privacy boundary in both implementations. Shadow or dual-run behavior must not duplicate irreversible side effects such as payments, email, writes, or provider calls.

### Adapter compatibility

An adapter retains an old public contract while delegating to a new implementation. Use it only for a real external migration window, never as the default way to avoid updating in-repository callers. Keep translation explicit, test old contract semantics, observe use with bounded privacy-safe telemetry, and set the condition that removes the adapter. If the old behavior cannot be represented without risk, provide a migration path rather than silently changing semantics.

Illustrative compatibility adapter for an identified external consumer; do not add it for internal callers:

```typescript
class LegacyResourceAdapter implements OldResourceAPI {
  constructor(private readonly replacement: NewResourceService) {}

  async getResource(id: number): Promise<OldResource> {
    const resource = await this.replacement.findById(String(id));
    return toOldContract(resource);
  }
}
```

The adapter's owner, support window, measured usage, public removal date/condition, tests, and eventual deletion must be explicit.

### Feature-flag migration

A flag can move one supported cohort at a time:

```text
for an explicitly identified cohort:
    enable the replacement if the flag and compatibility conditions pass
otherwise:
    preserve the supported old behavior until that cohort is migrated
```

Test old and new states, ownership, flag-off recovery, and data compatibility. Use bounded rollout and a cleanup date. After the transition, delete the flag and old branch; flags are not permanent substitute APIs.

### Database schema migrations: expand, migrate, contract

A schema change is riskier than a code revert because the data may not be recoverable by restoring old code. Old and new application versions can coexist during rollout, so changing a column in place can make one version fail while the other deploys. Use additive phases and keep each deployed code version valid against the active schema:

```
EXPAND → MIGRATE → SWITCH → CONTRACT
add compatible shape   backfill/dual-write  read new shape   stop old use, drop later
```

Worked example: rename `name` to `full_name` without an in-place rename:

1. **Expand:** Add nullable `full_name` beside `name`; deploy code that remains valid against the old and new shape.
2. **Dual-write:** Write both fields for new and changed rows. Ensure retries and partial failure cannot leave data silently divergent.
3. **Backfill:** Copy existing `name` values to `full_name` in throttled batches away from the hottest path. Track completion and verify consistency.
4. **Switch reads:** Read from `full_name` while retaining dual-write for a measured compatibility period. Deploy and observe.
5. **Contract:** Stop writing `name`; after every old reader/writer and rollback target is retired, drop `name` in a separate later change.

Each phase should be independently deployable and compatible with versions that can overlap. A code rollback does not undo a schema change. Use `incremental-implementation` for safely sliced implementation work.

Rules:

- **Additive first, destructive last and alone.** Add the new nullable field/table/index before stopping old use; drop/rename only after no supported code references it.
- **Test recovery before release.** Test a down path when it is genuinely safe and data-preserving. If the migration is irreversible, document that fact and prove the approved backup/restore or forward-recovery path; never present a lossy `down` as a rollback.
- **Backfill in bounded batches off the hot path.** Measure locks, replication, transaction duration, and throttling; do not issue one huge update across a large live table without evidence it is safe.
- **Create large indexes with an engine-appropriate non-blocking/concurrent method** where supported and verify its operational cost.
- **Decouple a risky cutover with a flag only when data ownership and both states stay correct.** A flag does not make an incompatible schema or destructive write reversible.
- **Preserve migration history.** Never rewrite applied migrations merely to make a new application version fit.

## Zombie code

Zombie code has no active owner but still has consumers, stale dependencies, or unclear correctness. Signals include long inactivity with active usage, orphaned tests, unresolved vulnerabilities, compatibility code no one can explain, or docs pointing to removed systems. Inactivity by itself is not proof of obsolescence.

Assign an owner and fund maintenance, or plan deprecation with verified consumer inventory and concrete migration support. Do not leave code indefinitely in an unowned limbo, and do not remove it merely because a directory is old.

## Common rationalizations

| Rationalization                                            | Reality                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| “It still works; why remove it?”                           | A working, unowned path accumulates security and compatibility debt. Measure its remaining value and maintenance cost.  |
| “Someone might need it later.”                             | Retain only real supported consumers; hypothetical paths have a maintenance cost and can be rebuilt when needed.        |
| “The migration is too expensive.”                          | Compare one-time, risk-adjusted migration cost with continued maintenance and security exposure; state both estimates.  |
| “We will plan the retirement after the replacement ships.” | Design its owner, data boundary, and exit condition at the time the replacement is proposed.                            |
| “Users will migrate on their own.”                         | Give them a tested guide/tool and account for the owner’s migration obligation.                                         |
| “We can maintain both forever.”                            | Duplicate implementations double tests, docs, onboarding, and incidents. Require evidence for any ongoing dual support. |
| “Just rename the column.”                                  | During deploy overlap, old code may still query the old column. Expand, migrate, switch, contract.                      |
| “Add and drop in one migration.”                           | This removes the compatibility window and ties a safe additive step to an irreversible one.                             |
| “We will write the rollback if we need it.”                | Test a safe down path or state the irreversible consequence and validate an actual recovery plan before release.        |

## Red flags

- Deprecation announced before a production-proven replacement exists
- No inventory or measurement of active consumers and persisted references
- Compulsory deadline without tooling, migration guidance, owner, or support window
- A deprecated feature still receives new capabilities without a justified exception
- Zombie code with no owner, or removal justified only by age
- “Zero usage” based only on a short observation window or source search
- New adapter/shim for internal callers instead of migrating them
- Old aliases, re-exports, comments, tests, docs, or flags left after removal
- Schema rename/drop coupled to the deployment that first relies on it
- Backfill blocks live traffic or has no progress, verification, or throttle plan
- A migration with no tested safe recovery path, or a false claim that a data-losing down migration is reversible
- Flag rollout that duplicates side effects or has no owner and cleanup condition
- A migration plan published or destructive remote change made without explicit authorization

## Verification

After a code/API/feature deprecation:

- [ ] The replacement is available and proven for the critical cases it is meant to cover.
- [ ] Consumer inventory includes internal callers, external users, jobs, and stored data; its evidence window is adequate.
- [ ] The notice and migration guide state status, replacement, compatibility gaps, support/removal policy, and executable verification steps.
- [ ] Consumers are migrated incrementally and behavior is verified against the actual replacement.
- [ ] Any retained adapter is protecting a real external consumer and has an owner, bounded use, and removal condition.
- [ ] Old implementation, internal aliases/re-exports, comments, tests, docs, configs, and flags are removed when no longer needed.
- [ ] The transition and any irreversible action were explicitly authorized; private data was not exposed by usage telemetry or migration records.

After a schema/data migration:

- [ ] Old and new code are valid against the schema at every overlap step.
- [ ] Expand/backfill/switch/contract ordering, batch size, lock impact, and data verification are tested against representative state.
- [ ] Rollback compatibility is demonstrated; if rollback cannot preserve data, the irreversible condition and approved recovery are explicit.
- [ ] Destructive steps ship alone after confirming no supported code reads/writes the old shape.
- [ ] Backup, recovery, and deployment order are established before production execution.
