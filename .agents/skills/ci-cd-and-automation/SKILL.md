---
name: ci-cd-and-automation
description: Designs and modifies continuous integration, quality gates, test automation, and delivery pipelines. Use when setting up or changing CI/CD, automating verification, debugging pipeline failures, or designing previews, protected deployments, and rollout controls.
---

# CI/CD and Automation

## Overview

Automate the checks that protect every change and make failures feed back quickly. CI/CD is an enforcement mechanism for the repository's quality contract, not a replacement for sound design or human review.

**Shift left:** run cheap, deterministic checks early; run slower integration and end-to-end checks after their prerequisites. A defect found before merge is usually cheaper to diagnose than the same defect in production.

**Faster is safer:** small batches and frequent verified releases are easier to debug than large batches. Speed comes from useful parallelism, caching, and reliable feedback—not by silencing failures or removing coverage from the merge gate.

## When to use

- Setting up or changing CI, test runners, build verification, or deployment automation
- Automating a new quality gate or deciding which changes trigger checks
- Introducing preview deployments, feature flags, staged delivery, or rollback workflows
- Investigating a failing, flaky, or slow pipeline

## Process

### 1. Discover the repository contract before editing CI

Inspect repository instructions, current workflow files, project manifests, lockfiles, package-manager/runtime pins, test/build/lint/type-check commands, and environment/config ownership. Identify the CI provider and deployment topology from existing configuration rather than assuming GitHub Actions, a particular framework, or a JavaScript package manager. For a workspace, identify which root owns each lockfile and command; a nested package is independent only when repository structure confirms that it is.

If manifests, lockfiles, provider configuration, and existing workflow disagree, stop and surface the conflict before changing installation or build behavior. Preserve the authoritative lockfile and immutable/frozen install mode. Use project scripts and pinned tool versions; never copy an `npm`, `npx`, `yarn`, `pnpm`, `bun`, `pip`, or other command from an example without confirming the detected toolchain.

For this Node project, `package.json` owns quality-gate entry points and tool configuration owns rules and thresholds. CI invokes those package gates rather than defines competing rules. Follow [constraint-driven-development](../constraint-driven-development/SKILL.md) to inspect enforcement and repair authorized gaps; keep documentation consistent with execution.

### 2. Define useful quality gates

Select gates that protect real risks and can be run reproducibly. A typical pull-request pipeline includes:

```
change opened
   │
   ├── deterministic static checks (format check, lint, type/static analysis)
   ├── unit tests
   ├── integration tests with isolated services/fixtures
   ├── production build or packaging check
   ├── dependency/security checks against the committed lockfile
   ├── optional browser/end-to-end and performance budget checks
   └── required review and branch policy
```

Run independent checks in parallel when resource usage permits. Use dependency order where a later stage needs a built artifact, database, or deployed preview. Required gates must block merge on failure; do not disable a test, rewrite an assertion, or make a failure advisory just to get a green status. Fix or explicitly quarantine a genuinely flaky test under a tracked plan without removing the needed coverage. Path filters may avoid unrelated expensive work only when an always-on required check still reports a trustworthy result and every relevant path is covered.

A gate is complete when its scope and threshold are explicit, it runs on the right events, its failure blocks the intended promotion, and its output helps the owner fix the issue. The repository may not need every category above; record a deliberate justified exception rather than copying a universal pipeline.

### 3. Secure the pipeline and its supply chain

Treat workflow code, dependencies, artifacts, caches, and build runners as part of the production attack surface.

- Grant each workflow the minimum repository, cloud, and artifact permissions it needs; make read-only the default.
- Pin third-party CI actions/plugins/tasks to reviewed immutable revisions where the platform supports it. Review upgrades, provenance, scripts, and workflow permission changes as supply-chain changes.
- Use clean isolated runners and immutable/frozen installs from the committed lockfile. Avoid caches that can be written by an untrusted pull request and later restored into a privileged deployment job.
- Do not make production secrets available to pull-request verification. Untrusted fork code must not receive privileged tokens or publish reusable artifacts into a trusted release path. Avoid privileged event patterns that check out and execute attacker-controlled revisions with write credentials.
- Keep test credentials and fixture data separate from preview and production. Put necessary credentials in the platform's secret manager and scoped protected environment; never write keys into workflow files, artifacts, output, command lines, or logs.
- Keep private runtime configuration, provider endpoints/keys, prompts, raw provider bodies, evidence/data payloads, and personal information out of job output and release artifacts. Pass only the minimum sanitized fields needed by a check.
- Run the detected ecosystem's native dependency audit against the committed lockfile and apply the `security-and-hardening` supply-chain triage. Known-advisory audits do not prove a package is trustworthy; review new dependencies and install-script policy.

A CI job that can deploy or publish is privileged. Use protected environments, narrow scoped credentials, auditable identity, and a human approval gate. Prefer short-lived identity federation (such as OIDC) where the provider supports it, with minimum permissions and environment scoping. A build or a green test run never authorizes production deployment. Preview deployments also contact external services and require explicit authorization; untrusted contributor code must not receive credentials for them. Obtain explicit authorization for each external CLI invocation (including package-manager, registry, cloud, and provider commands) under the shared policy in [`../../references/POLICY.md`](../../references/POLICY.md); do not infer approval for a second call from the first.

### 4. Implement checks with the detected provider and tools

The following is an intentionally provider-specific **GitHub Actions sketch**, not a copy-paste default. Use the repository's actual CI provider, pin all action references to reviewed immutable commit SHAs, replace every placeholder with a discovered command, and preserve the same security properties in another provider's syntax:

```yaml
# .github/workflows/ci.yml — illustrative GitHub Actions structure
name: CI
on:
  pull_request:
  push:
    branches: [<default-branch>]
permissions:
  contents: read
jobs:
  quality:
    runs-on: <maintained-runner-image>
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
      - name: Install pinned runtime and package manager
        run: <repository-pinned-runtime-and-manager-setup>
      - name: Install exactly from the lockfile
        run: <immutable-or-frozen-install-command>
      - name: Static checks
        run: <repository-static-check-command>
      - name: Type or static analysis
        run: <repository-type-check-command>
      - name: Tests
        run: <repository-test-command>
      - name: Build/package
        run: <repository-build-command>
      - name: Native dependency audit
        run: <repository-manager-audit-command>
```

The labels in angle brackets are placeholders, not shell commands. Derive the real commands from the project manifest and documented checks. Do not let the workflow silently use a globally installed tool or a drifting runtime when the repository pins one.

#### Isolated integration tests

Add an ephemeral local service/container only when the test requires it. Use disposable databases, test-only credentials, health checks, and a clean teardown. Apply reviewed migrations to that test instance and pass its URL only to the job step that needs it. Example shape:

```yaml
# Provider-specific job fragment; service image and syntax must match the project.
services:
  database:
    image: <pinned-database-image-and-digest>
    env:
      TEST_DATABASE: testdb
      TEST_USER: test_user
      TEST_PASSWORD: test_only_value
    options: <provider-health-check-options>
steps:
  - run: <detected-migration-command>
    env:
      DATABASE_URL: <ephemeral-test-database-url>
  - run: <detected-integration-test-command>
    env:
      DATABASE_URL: <ephemeral-test-database-url>
```

A constant that exists only inside an ephemeral isolated test service is not a production credential; never reuse it elsewhere. For remote/shared test services, use dedicated secrets with least privilege and explicit teardown/retention policy. Never put production credentials in an integration test job.

#### Browser/end-to-end checks

Run browser tests against a build and fixture environment, not production. Install browser binaries using the repository's pinned tooling, wait for readiness, and retain a failure report only if it is sanitized and access-controlled. Exercise user-visible behavior; a successful compilation is not an end-to-end test. Never upload cookies, tokens, private provider payloads, or trace data containing personal information.

Illustrative GitHub Actions job shape (pin provider actions to reviewed full commit SHAs and replace each command with the repository's detected tooling):

```yaml
jobs:
  e2e:
    runs-on: <maintained-runner-image>
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
      - name: Install pinned runtime/package manager
        run: <repository-pinned-runtime-and-manager-setup>
      - name: Install from lockfile
        run: <immutable-or-frozen-install-command>
      - name: Install browser runtime
        run: <repository-browser-install-command>
      - name: Build fixture-targeted application
        run: <repository-build-command>
      - name: Run browser checks
        run: <repository-e2e-command>
      - name: Upload sanitized report on failure
        if: failure()
        uses: actions/upload-artifact@<reviewed-full-commit-sha>
        with:
          name: browser-report
          path: <sanitized-report-directory>
```

Keep the report access-controlled and retention-bounded. Do not use production user data or upload browser state that contains authentication cookies, provider secrets, or private payloads.

### 5. Feed failures into a safe repair loop

When CI fails, capture the exact failing job, command, revision, relevant error, and environment summary with secrets and private payloads redacted. Pass only that evidence into an authorized debugging task:

```
CI failure → identify the failing gate and revision → reproduce with repository commands
→ fix the underlying cause → rerun the relevant checks → update the workflow only if its contract is wrong
```

Use `debugging-and-error-recovery` for failures whose cause is unclear. Do not blindly retry until green, suppress the error, skip the failing test, or change a threshold without evidence. A one-time retry can distinguish infrastructure flakiness only when the retry is visible and the original failure remains recorded; repeated nondeterministic failure needs a fix. An agent may prepare a repair, but committing, pushing, publishing artifacts, or deploying needs its own explicit authorization.

### 6. Separate CI from delivery

CI validates a candidate. CD moves an authorized artifact to an environment. Keep these permissions and stages distinct.

#### Preview deployments

A preview can provide valuable manual verification, but it is still an external deployment. First inspect the repository's preview support, data isolation, credential boundaries, retention, and cleanup path. Use public or synthetic data and restricted access where appropriate. Require explicit authorization for each external preview action. Never expose production secrets or privileged tokens to fork-originated workflows or unreviewed code. Do not treat a build preview or untrusted branch deployment as production-equivalent authorization.

A protected, manually dispatched preview is one pattern when the repository's provider supports it; pin actions to reviewed full commit SHAs and scope credentials to the protected preview environment:

```yaml
on:
  workflow_dispatch:
    inputs:
      reviewed_revision:
        description: Full revision already approved for preview
        required: true
        type: string
permissions:
  contents: read
  id-token: write # Only if short-lived deployment identity requires it.
jobs:
  preview:
    environment: <protected-preview-environment-with-required-approval>
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
        with:
          ref: ${{ inputs.reviewed_revision }}
      - name: Verify the selected revision is eligible
        run: <repository-check-that-rejects-unreviewed-or-untrusted-revisions>
      - name: Deploy only to the isolated preview target
        run: <repository-approved-preview-deployment-command>
```

Do not expose a deployment credential to code that has not passed the required review; a manual form alone does not make an arbitrary revision trustworthy. Never let fork-originated code use this protected credential.

#### Feature flags

Flags decouple deployment from user release. Use them only where they reduce real rollout risk:

- Deploy code inactive; enable for controlled internal verification.
- Gradually expose the feature or use a kill switch only if disabling it preserves data and correctness.
- Compare behavior under both flag states where both can reach users.
- Assign an owner and cleanup condition/date when the flag is introduced.
- Remove the flag and obsolete branch after rollout; flags that live forever become compatibility debt.

Illustrative TypeScript pattern; use the project's flag client and ensure the selected cohort is authorized:

```typescript
if (featureFlags.isEnabled('new-workflow', { cohortId })) {
  return runNewWorkflow(input);
}
return runExistingWorkflow(input);
```

Do not create nested flags or combinatorial states without a concrete need. Tests should cover both flag states, the transition, and rollback behavior—not only the default. Give every flag an owner and cleanup condition; after rollout, remove the flag and obsolete branch.

#### Staged rollout and rollback

A typical path is:

```
reviewed change → isolated staging verification → explicitly approved production deploy
→ health and error checks → controlled cohort/canary → threshold decision → expand or hold/rollback
```

Define success and stop thresholds from the existing SLO, baseline, business invariant, and measurement noise before rollout. Use a canary/percentage progression only when the platform can reliably scope cohorts. Monitor at every stage; do not advance merely because the timer elapsed. If thresholds breach, stop promotion and use the tested kill switch or recovery plan. See `shipping-and-launch` for rollout decisions, error budgets, and recovery evidence.

A rollback workflow must target an identified known-compatible artifact and require the same protected approval as deployment. Check database, persisted data, queued work, and API compatibility before restoring older code. Roll back application behavior only when the old version can read current state; otherwise prefer an approved forward fix. Never automate a database rewind as an ordinary deployment rollback.

Illustrative manual workflow shape; require protected environment approval, validate the immutable artifact identity, and have the operator authorize the exact recovery target and action; ordinary verification commands follow runtime/repository permissions:

```yaml
name: Rollback
on:
  workflow_dispatch:
    inputs:
      artifact_digest:
        description: Immutable digest of the previously verified artifact
        required: true
        type: string
permissions:
  contents: read
  id-token: write # Only if the deployment provider requires federation.
jobs:
  rollback:
    environment: <protected-production-environment-with-required-approval>
    steps:
      - name: Validate compatible artifact and current data state
        run: <repository-rollback-preflight-for-artifact-and-migrations>
      - name: Restore the approved application artifact
        run: <repository-approved-rollback-command-using-the-validated-digest>
      - name: Verify health and the affected user flow
        run: <repository-post-rollback-smoke-command>
```

The placeholder commands must be replaced with the repository's reviewed rollback procedure; never interpolate unvalidated free-form shell input or expose a long-lived production token.

### 7. Manage environments and recurring automation

- Keep committed environment examples as placeholders only. Real local, CI, preview, and production secrets belong to their respective secret owners and do not cross environments by default.
- Use separate test credentials and fixtures; CI should not have production secrets.
- Automated dependency update tools (the provider's native bot or an equivalent such as Renovate) should target the correct workspace/lockfile, produce reviewable changes, and run the same required gates. Limit open updates to keep the queue reviewable.

Illustrative Dependabot example **only if** the repository uses GitHub Dependabot and the detected installation boundary is a root npm project; adapt the ecosystem/directory to the actual workspace and do not add a second updater:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: '/'
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

Dependency update PRs are untrusted code until reviewed. They receive no production credentials and must pass the ordinary lockfile, audit, compatibility, and test gates.

- Designate a rotating build owner or other clear responsibility for restoring a red default branch. Fix or safely revert only the known offending slice; do not normalize an intermittently broken mainline.
- Require reviews, passing required status checks, and branch protection appropriate to project risk. Do not permit force-pushes to shared branches. Auto-merge is appropriate only after required review, checks, and protected policy have all been satisfied; it is not a deployment authorization.

### 8. Optimize CI without weakening the contract

If the pipeline exceeds roughly 10 minutes for its test suite, treat that as a prompt to measure where time goes, not a universal service-level target. Measure queue time, setup/install, each gate, and artifact/deploy time before changing it. Apply optimizations in this order, validating that results remain equivalent:

```
Slow pipeline?
├── Remove duplicate setup; cache dependencies safely by lockfile/toolchain
├── Parallelize independent lint, type, test, and build jobs
├── Reuse a verified immutable build artifact instead of rebuilding it
├── Select affected work only when dependency graphs and required-check semantics are correct
├── Shard deterministic suites when startup/sharding overhead is lower than the saved time
├── Improve test fixtures and teardown; move truly non-blocking exhaustive checks to a schedule
└── Use larger or self-hosted runners only when measurement justifies their cost and isolation risk
```

Never remove required coverage or turn a required status into a skip merely to meet a time target. Safe caches are keyed by lockfile and runtime/tool versions; avoid sharing writable caches between untrusted PRs and privileged jobs. Re-measure wall-clock and failure rate after optimization. A faster pipeline that produces nondeterministic or less secure artifacts is a regression.

A GitHub Actions-shaped example of parallel checks follows. Pin actions to reviewed full commit SHAs, use the detected runtime/package manager, and keep a shared verified setup only if it preserves isolated job state:

```yaml
jobs:
  lint:
    runs-on: <maintained-runner-image>
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
      - run: <pinned-runtime-and-package-manager-setup>
      - run: <immutable-install-command>
      - run: <repository-lint-check-command>
  typecheck:
    runs-on: <maintained-runner-image>
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
      - run: <pinned-runtime-and-package-manager-setup>
      - run: <immutable-install-command>
      - run: <repository-typecheck-command>
  test:
    runs-on: <maintained-runner-image>
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<reviewed-full-commit-sha>
      - run: <pinned-runtime-and-package-manager-setup>
      - run: <immutable-install-command>
      - run: <repository-test-command>
```

If using the provider's dependency cache, key it by the authoritative lockfile, runtime and package-manager versions, and relevant platform; measure cache benefit and keep untrusted writers away from privileged jobs. Parallel jobs should report required checks independently and must not create duplicate external deployments.

## Common rationalizations

| Rationalization                                | Reality                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| “CI is too slow, so skip checks.”              | Measure setup and gate cost, then optimize the pipeline without weakening the quality contract.                   |
| “This change is trivial.”                      | Small changes can break shared configuration; run the required checks.                                            |
| “The test is flaky; rerun until green.”        | Preserve the first failure, reproduce the flake, and repair its cause rather than training the team to ignore it. |
| “We will add CI later.”                        | Each unverified change increases the cost of restoring a known-good state.                                        |
| “Manual testing is enough.”                    | Manual checks are useful for exploratory behavior but are not repeatable merge gates.                             |
| “The PR preview needs production credentials.” | Untrusted code can exfiltrate them. Isolate the environment and use least privilege.                              |
| “Green CI means production is approved.”       | Verification and deployment authorization are separate decisions.                                                 |

## Red flags

- No reproducible CI gate for changes that affect production behavior
- Workflow contradicts repository instructions, package manager, lockfile, or configured package quality gates
- Failures are ignored, silently retried, or suppressed by disabling tests
- A required check can report success after skipping relevant paths
- Privileged secrets are available to untrusted PR code
- Workflow actions, extensions, build images, or caches are mutable/unreviewed
- Production deployment is triggered by an ordinary PR or green CI without explicit protected approval
- Preview deployments expose credentials, private runtime/provider data, or user data
- Deploy or rollback job has broad permissions or no known artifact target
- CI is slow but no one has measured its stages or the risk of proposed shortcuts

## Verification

After setting up or changing CI/CD:

- [ ] The detected provider, package manager, pinned runtime, lockfile, and command set agree with repository instructions and configuration.
- [ ] An immutable/frozen install and relevant quality gates run on every required event; real failures block the intended merge/promotion.
- [ ] CI invokes package quality gates and preserves their configured scope and failure behavior without contradictory rules.
- [ ] Integration/E2E checks use isolated services, fixtures, bounded credentials, and reliable cleanup.
- [ ] Workflow permissions, third-party actions, caches, artifacts, dependency audits, and secret paths were reviewed.
- [ ] Untrusted PR code cannot read secrets or publish into a trusted/release path.
- [ ] Deployments and previews require explicit authorization and have protected environment/rollback controls.
- [ ] Logs and artifacts contain no credentials, private runtime/provider details, raw sensitive payloads, or unredacted personal data.
- [ ] Failure feedback contains the actual failing evidence; flaky behavior is fixed rather than normalized.
- [ ] Any pipeline optimization was measured and did not remove required coverage or security; the normal test suite aims for roughly 10 minutes or less where the repository's verified gates make that feasible.
