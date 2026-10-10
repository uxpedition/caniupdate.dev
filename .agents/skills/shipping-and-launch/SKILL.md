---
name: shipping-and-launch
description: Prepares and verifies controlled production launches. Use when planning an authorized production deploy, releasing a significant feature, migrating live data or infrastructure, opening a beta, or deciding what must be in place before users receive a change.
---

# Shipping and Launch

## Overview

A safe launch is more than deployment: it has a known artifact and target, verified readiness, observability, a bounded rollout, and a tested recovery path. Every launch should be observable and incremental where possible. Never treat a plan, green CI, local preview, or discussion as authority to deploy.

## Authorization and environment safety

Before any production deployment, public release, remote migration, release publication, paid provider operation, or live flag/cohort change, obtain explicit authorization for that exact target and action. Ordinary preparation and verification commands follow runtime/repository permissions. Each external CLI invocation for cross-model review needs its own explicit authorization; release preparation does not authorize deployment or publication. Confirm the operator is authorized, identify the exact reviewed revision and environment, and state the external side effect and recovery boundary before execution.

Follow repository/environment ownership. Keep deployment credentials, private runtime settings, provider endpoints/keys, raw provider responses, and private operational details in their approved secret store and owner-only runbooks. Never print them in command output, logs, public changelogs, screenshots, release evidence, or artifacts. A successful local build is not deployment authorization; a preview is not automatically isolated or safe for unreviewed code.

## When to use

- Shipping a feature to production for the first time
- Releasing a consequential user-facing change
- Migrating live data, queues, schemas, or infrastructure
- Opening a beta or controlled early-access program
- Any deployment with meaningful user, data, security, availability, or cost risk

## Process

### 1. Discover release conventions and target ownership

Inspect repository instructions, release/deployment runbooks, environments and credentials ownership, CI artifacts, version/tag policy, migration history, feature flags, SLOs/error budgets, on-call coverage, and existing incident/rollback procedures. Identify the exact target, audience, and operator. Do not assume a framework, package manager, workflow provider, cloud account, release path, command, resource name, or `main`-to-production mapping.

Use `git-workflow-and-versioning` for source revision and version identity, `ci-cd-and-automation` for pipeline and protected gates, `deprecation-and-migration` for compatibility and data transitions, `observability-and-instrumentation` for telemetry and alert behavior, `performance-optimization` for measured budgets, and `security-and-hardening` for threat/privacy checks. Follow domain/codebase vocabulary already established in the project rather than inventing a second model.

### 2. Establish readiness before authorizing promotion

Adapt the checks below to the change and repository contract. A checklist is a risk review, not proof; link each item to actual exercised evidence or an explicit limitation.

#### Code quality and behavior

- [ ] Relevant unit, integration, and end-to-end checks pass, including changed and fallback/flag-off behavior.
- [ ] Build/package artifact succeeds from the reviewed source revision with expected warnings and immutable dependency inputs.
- [ ] Type/static checks and formatting/lint checks meet the repository's required quality contract.
- [ ] Change has review at the level required by repository policy.
- [ ] Launch-blocking errors and known issues are resolved or explicitly accepted by the authorized release owner.
- [ ] Debug logging, temporary diagnostic code, and unowned TODOs that affect launch are removed.
- [ ] Failure behavior is bounded and actionable; error handling does not disguise infrastructure/data corruption as success.

#### Security and privacy

- [ ] No credentials, private runtime/provider configuration, raw provider errors, prompts, or personal data are committed or exposed in artifacts/logs.
- [ ] The detected ecosystem's native dependency audit was reviewed against the authoritative lockfile; reachable critical/high findings have a fix or explicit mitigation, owner, and review date.
- [ ] External inputs are validated; authentication and resource-level authorization cover all protected paths.
- [ ] Security headers, CSRF, CORS, rate/size limits, upload/SSRF behavior, and error sanitization fit the actual threat model.
- [ ] Credentials are stored with the exact runtime/environment owner; test, preview, and production keys are separate and least-privileged.
- [ ] Telemetry/vendor data collection has its privacy, consent, access, retention, and deletion review.

#### Performance and capacity

- [ ] User-facing performance targets are defined for representative device/network/service conditions.
- [ ] Measured Core Web Vitals or applicable latency/throughput/resource budgets meet the agreed target.
- [ ] Critical paths have no known N+1 queries or unbounded input/result growth.
- [ ] Query/index changes have plan evidence; cache keys, staleness, and invalidation preserve correctness and user separation.
- [ ] Bundles/assets and resource use stay within the project's measured budget.
- [ ] Load, queue, or quota risk was assessed where the change increases concurrency or external work.

#### Accessibility and usability

- [ ] Keyboard operation works for interactive controls and focus transitions.
- [ ] Screen readers convey labels, roles, state, and dynamic content.
- [ ] Text contrast meets the project's applicable accessibility standard ([WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) uses 4.5:1 for typical text; check the official standard and text size/context).
- [ ] Modal/dynamic-content focus management and reduced-motion behavior work where applicable.
- [ ] Validation/error messages are descriptive and programmatically associated with inputs.
- [ ] Automated accessibility checks were run as a supplement to manual interaction, not as the only evidence.

#### Infrastructure and data

- [ ] Runtime configuration, environment variables, DNS/TLS, routing, and private bindings are owned by the intended production environment.
- [ ] Database schema/data changes have an approved, rehearsed sequence and compatibility/recovery plan; an application rollback does not silently rewind data.
- [ ] Queues, caches, Durable Object/state stores, third-party dependencies, and service capacity are understood.
- [ ] Health/readiness checks exist where appropriate and distinguish dependency failure from success.
- [ ] Production secrets are provisioned without exposing them to untrusted builds or client output.

#### Documentation and communication

- [ ] Maintained setup, API, operations, and user-facing documentation reflect the changed behavior.
- [ ] Required ADRs record expensive-to-reverse decisions; changelog/version follows repository conventions.
- [ ] Rollout owner, operator/on-call coverage, notification plan, and user support path are known.
- [ ] Durable documentation was explicitly authorized; temporary AI ideas/specs/plans/task checklists remain outside the repository in the named `workDir`.

### 3. Plan the flag/rollout and define stop thresholds

Feature flags can separate deploy from release when the system supports a safe off state. Use them to deploy inactive code, verify with an authorized internal cohort, canary the real experience, and disable quickly if it harms users. A flag is not a rollback for incompatible writes or irreversible side effects.

Every flag needs an owner, purpose, test coverage for off/on states, expiry/removal condition, and a safe default. The default is to remove flags and dead paths within two weeks of full rollout; use a shorter or longer approved window only when actual dependency requires it. Avoid nested flags unless a specific tested state space justifies them.

A typical lifecycle:

```
1. Deploy reviewed artifact with flag OFF.
2. Verify deployment health while user behavior remains unchanged.
3. Enable for a controlled internal cohort after explicit authorization.
4. Canary a small, measurable audience; compare with baseline.
5. Advance only if every agreed metric and business invariant passes.
6. Expand gradually with a hold/rollback decision at every stage.
7. At full rollout, monitor the agreed bake period, then remove flag and old code.
```

Illustrative code-level gate (adapt it to the project's flag client and privacy model):

```typescript
const flags = await getFeatureFlags({ cohortKey: approvedCohortKey });

if (flags.newWorkflow) {
  return renderNewWorkflow(input);
}
return renderExistingWorkflow(input);
```

Keep the off-state fully supported until retirement, avoid exposing raw identifiers to flag analytics, and test both paths. A flag cannot reverse writes or side effects that already occurred.

Before rollout, record a baseline, minimum sample/observation window, metric owner, hold threshold, rollback threshold, feature-flag action, and data-state caveat. The sample thresholds below provide starting guidance, not a universal SLO; calibrate them to historical variance, traffic, severity, and service objectives:

| Metric          | Advance (green)        | Hold and investigate (yellow)   | Roll back (red)                 |
| --------------- | ---------------------- | ------------------------------- | ------------------------------- |
| Error rate      | Within 10% of baseline | 10–100% above baseline          | More than 2× baseline           |
| p95 latency     | Within 20% of baseline | 20–50% above baseline           | More than 50% above baseline    |
| Client errors   | No new error types     | New errors in <0.1% of sessions | New errors in >0.1% of sessions |
| Business metric | Neutral or positive    | Decline <5% (may be noise)      | Decline >5%                     |

Roll back or stop expansion immediately for data-integrity failure, a material security issue, a user-report spike, error rate above 2× baseline, p95 latency more than 50% worse, or a business invariant breach. A high error-budget burn is a hold signal even if point-in-time metrics appear green.

### 4. Deploy in controlled stages

A common sequence is staging → production inactive → internal cohort → canary → gradual expansion → full release. Adapt it where the platform or product has a better safe process. For each stage:

1. Select and verify the immutable artifact/revision and exact target.
2. Confirm the operator's explicit authorization before remote commands, migrations, flag changes, or publication.
3. Deploy only with protected credentials and the minimum permission scope.
4. Verify health, logs/metrics/traces, critical user behavior, and data invariants at the target—not only a build or config dry run.
5. Compare the cohort to baseline for the required observation period.
6. Advance only when all green thresholds pass; hold and investigate yellow; use the prepared recovery path on red.

The original sizing guidance uses internal verification in production followed by a 5% canary, then 25% → 50% → 100%, with 24-hour internal monitoring, a 24–48-hour canary window, and a one-week full-rollout observation. These are example windows, not fixed facts: choose durations and cohort sizes from exposure, traffic, time-to-detect, SLO, business cycles, and reversibility. Keep the ability to return to the previous percentage at each step.

### 5. Monitor the right signals

Choose signals that tell the team whether users and operations are healthy:

```
Application: errors by route/operation, p50/p95/p99 latency, request rate,
             queue age/depth, completion outcomes, approved business metrics
Infrastructure: CPU/memory, connection-pool use, storage, network, saturation
Client: Core Web Vitals, client errors, user-visible API failure rate, load time
```

Avoid metric labels or error reports containing raw identifiers, private provider/runtime configuration, credentials, prompts, or request bodies. Use bounded route/error classes and privacy-safe correlation. See `observability-and-instrumentation` for RED/USE, alerting, and telemetry verification.

An error-reporting integration should preserve diagnosis without exposing internals to users or telemetry vendors:

```typescript
// Framework-neutral pseudocode; report only sanitized, bounded context.
reportError(sanitizeError(error), {
  requestId,
  routeTemplate,
  operation: 'resource_update',
  errorClass: classifyError(error),
});

return publicErrorResponse({
  code: 'INTERNAL_ERROR',
  message: 'The request could not be completed.',
});
```

Do not include `userId`, raw URL, component stacks that may reveal private data, provider bodies, or environment variables unless an approved privacy review establishes an allowed minimal representation. The telemetry system's presence does not prove ingestion, access, or retention behavior; verify the actual target.

### 6. Apply the error-budget release gate

Use the service's stated SLO/error budget to choose release pace rather than renegotiating after every failed deploy. Preserve the starting policy unless the service's authorized SLO says otherwise:

```
Budget remaining > 20%  → ship at normal pace and monitor closely
Budget remaining 0–20%  → slow rollout; avoid high-risk changes
Budget exhausted        → pause feature work; focus on reliability
Budget recovers          → resume normal pace and preserve the learning in the fix
```

A high burn rate during canary is a **hold** signal even when a single error-rate threshold looks green. If no service SLO/error budget exists, do not invent one at launch; escalate the missing release criterion to the owner.

### 7. Prepare a change-specific rollback/recovery plan

Every deployment needs a plan before it happens. “Revert the code” is incomplete when migrations, queued work, side effects, or provider state may have changed. Identify what is reversible and who can do it.

```markdown
## Recovery plan for <feature/release>

### Trigger conditions

- Error/latency threshold and observation window
- Data-integrity, security, or user-impact condition

### Immediate containment

- Disable a verified safe feature flag or stop cohort expansion
- State who can authorize and perform this action

### Application recovery

- Identify the last known compatible immutable artifact/revision
- Give the repository-approved redeploy/revert procedure and owner
- Verify health, error rate, and the affected user flow afterwards

### Data and external side effects

- Migration/state changes and the actual compatible recovery path
- Treatment of data written by the new code, queued work, and provider actions
- Any irreversible action, backup location/access, and approver

### Communications and timing

- Operator/on-call, user/team notification, escalation path
- Estimated containment/recovery time based on a rehearsal, not a guess
```

Prefer disabling a safe flag or redeploying a known-compatible artifact over rewriting shared history. Verify the old version can read the current schema and persisted payloads. If not, use an approved forward fix or a rehearsed state recovery; do not silently rewind data. Key revocation does not reverse a charge already incurred, and a database restore can erase valid work. Keep records sanitized and access-controlled.

### 8. Verify immediately after launch

For the first hour or the change's appropriate time-to-detect window:

1. Check the actual health/readiness endpoint and expected response.
2. Compare error/latency/queue/capacity signals with baseline; watch new error types.
3. Exercise the critical user flow using a permitted test identity/data set.
4. Confirm logs and traces arrive with useful structure and no private payloads.
5. Verify the current flag/cohort and exact revision/artifact.
6. Confirm the recovery control and operator path are ready; use a safe dry run if available.
7. Communicate observed success, limitations, and any hold/rollback decision.

An authorized real-provider or paid launch check must be deliberate, use the intended environment's dedicated credentials, and have a known cost/stop limit. Do not silently retry it. A fixture path, cached response, or dry run does not prove new production-provider integration.

## Shared launch checklists

Use the shared [definition of done](../../references/definition-of-done.md), [security checklist](../../references/security-checklist.md), [performance checklist](../../references/performance-checklist.md), and [accessibility checklist](../../references/accessibility-checklist.md) where applicable. They supplement, not replace, the repository's current contract and release runbook. For alert/SLO details, use `observability-and-instrumentation`.

## Common rationalizations

| Rationalization                               | Reality                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| “It worked in staging.”                       | Production has different data, traffic, configuration, and edge cases; observe the actual release.         |
| “A feature flag is unnecessary.”              | A safe off switch can limit impact, but it must preserve correctness and not replace a data recovery plan. |
| “Monitoring is overhead.”                     | Without verified telemetry, user reports become the first signal.                                          |
| “We can add monitoring after launch.”         | The first incident is the most expensive time to discover missing evidence.                                |
| “Rollback means failure.”                     | A timely rollback protects users and gives the team evidence to fix the cause.                             |
| “The error rate is fine; keep increasing.”    | Check SLO/error-budget burn and other user/business invariants, not one isolated metric.                   |
| “Green CI means deploy.”                      | CI verifies a candidate; production promotion requires a separate authorized decision.                     |
| “The old version is always safe to redeploy.” | Current data, schema, queue messages, or external effects may be incompatible with it.                     |

## Red flags

- Production or live-provider action without explicit target-specific authorization
- Deploying an unidentified revision or unprotected artifact
- No working rollback/recovery path or no first-hour/on-call owner
- No monitoring/alert route verified in the actual target
- Big-bang rollout where a safe staged path is available
- Flag has no owner, expiry, off-state test, or cleanup plan
- Release proceeds while a required threshold is red or error budget is exhausted
- Database migration and code switch make the old/new overlap invalid
- Production config is entered from memory or private credentials are copied into a build/log
- Provider/raw user data appears in telemetry or public release evidence
- A test fixture, cached result, build, or dry run is described as production validation
- Deployment is automated from untrusted PR code or ordinary green CI with no protected approval

## Verification

Before deployment:

- [ ] Repository release conventions, target ownership, selected revision, artifact identity, and data compatibility were checked.
- [ ] The appropriate code, security/privacy, performance, accessibility, integration, and user-flow checks passed with observed evidence.
- [ ] Flag/rollout states, cohort thresholds, observation window, SLO/error budget, and stop conditions are explicit.
- [ ] Recovery plan covers application, persisted data/schema, queued work, and external side effects; compatibility or restore path is verified.
- [ ] Telemetry/alerts and responsible operator are ready; no credentials/private provider/runtime values are exposed.
- [ ] Remote deployment, publication, paid provider work, and production mutations have explicit authorization for the exact target; external cross-model review CLI calls have per-call authorization.
- [ ] Required durable docs/changelog were authorized and updated; temporary AI execution artifacts remain outside the repository.

After deployment:

- [ ] Actual health and critical user flow were exercised in the target environment.
- [ ] Error rate, tail latency, capacity, business invariants, logs, and traces were compared to baseline.
- [ ] Rollout advanced only when thresholds passed; hold/rollback actions are available and understood.
- [ ] Recovery control was verified ready without falsely claiming an untested rollback.
- [ ] Release identity, measured evidence, omissions, and follow-up state were recorded without secrets or private payloads.
- [ ] For every shipped service, an error-budget policy defines action below 20% remaining and when exhausted.
