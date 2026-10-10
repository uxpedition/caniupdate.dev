---
name: constraint-driven-development
description: Use to discover, run, or repair quality gates in this Node project, when required package scripts are missing, or when checks or tool configuration are being weakened. Package scripts and tool configuration own enforcement.
---

# Constraint-Driven Development

Quality gates live in the codebase, not in an agent-selected set of thresholds or a separate prose contract. `package.json` owns the entry points; Vitest, Oxlint, Oxfmt, and TypeScript configuration own their respective rules. CI and hooks invoke those gates rather than define competing rules. Documentation explains rationale and operations; it does not override executable configuration.

## 1. Discover the gates

Read `package.json` first. Inspect the package-manager/runtime pins and the configuration or local scripts reached by its quality commands. Follow workspace scripts to their owning packages where applicable.

At minimum, identify these three gate roles:

| Role           | Owner                        | Required behavior                                                                                                                           |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Test           | Vitest and its configuration | Run discovered tests once, return a failing exit status for failures, and enforce configured coverage thresholds when coverage is required. |
| Lint           | Oxlint and its configuration | Check the intended source scope and fail on configured violations.                                                                          |
| Format (`fmt`) | Oxfmt and its configuration  | Check formatting without writing files and fail on differences.                                                                             |

Use existing script names rather than add aliases for spelling alone: `format:check` can satisfy the `fmt` role, and `lint:check` can be the non-fixing counterpart of `lint`. Inspect script bodies; a name does not prove that a gate exists. Watch mode, auto-fix mode, an echo, or a command that swallows failure is not a verification gate.

Also identify existing type-check, build, migration-consistency, and other project-specific checks. Required gates come from repository instructions and configured automation, not from an agent's guess about which checks are worth running.

**Complete when:** each required role has an identified package script, owning configuration, checked scope, and execution mode, or a precise missing-gate finding. Keep this inventory in the response or active temporary task state; do not create a policy document.

## 2. Verify enforcement, not just script names

Inspect the actual configuration reached by each script:

- **Vitest:** test discovery, exclusions, and coverage settings. A plain test run does not enforce coverage unless coverage is enabled by configuration or the package command. If coverage is required, verify its provider, included source scope, thresholds, and failure behavior in Vitest configuration. Report missing enforcement; do not select a percentage or infer that an absent threshold means coverage is satisfactory.
- **Oxlint:** enabled rules, severity, ignored paths, and any referenced configuration. Use the project's Oxlint configuration rather than introduce another linter or a regex-based substitute.
- **Oxfmt:** formatter configuration, ignored paths, and check versus write mode. Check the files affected by the task, including agent Markdown when changing skills; an ignored file was not verified.
- **Other gates:** follow the existing TypeScript, build, migration, or scanner configuration. Check that package scripts and CI preserve failures and cover the required packages/runtimes.

Configured gates remain authoritative. If documentation describes a different command or threshold, surface the discrepancy and correct stale documentation when in scope. An explicitly approved new requirement that configuration does not yet enforce is an implementation gap, not a passing gate.

**Complete when:** gate ownership and any enforcement gaps are explicit. Do not invent coverage targets, performance budgets, time budgets, exceptions, or new tools.

## 3. Repair gaps only within authorized scope

If the task authorizes configuring quality gates, reuse installed Vitest, Oxlint, Oxfmt, and the project's native package scripts. Put coverage policy in Vitest configuration, lint policy in Oxlint configuration, and formatting policy in Oxfmt configuration. Wire required automation to the same package entry points.

If the request is only to implement a feature or run verification, report missing gates without expanding it into a tooling migration. Ask only for genuinely missing policy decisions, such as a coverage threshold requested by the user but not specified anywhere. Read version-matched official documentation before changing tool options; follow repository permissions for dependency installation and external access.

Preserve existing thresholds, rules, discovery scope, and failure behavior while fixing code. A deliberate policy change must be explicitly authorized and implemented in its owning configuration. Removing a meaningful test, adding a suppression, widening an ignore, or swallowing an exit status to obtain green is not a repair.

Use normal review of changes to scripts, configuration, and tests. This workflow does not introduce a floor-guard, prose-threshold parser, ignore-file exception system, or separate quality-contract document.

**Complete when:** every authorized gap is repaired in its owning code/configuration, or the exact unresolved prerequisite is reported. No unrelated aliases, tools, or policies are added.

## 4. Run the package gates

Use the pinned package manager and repository procedures. Run non-fixing verification commands; use auto-fix or formatter write commands intentionally when edits are authorized, then check the result.

Run the required test, lint, formatting, and applicable project-specific gates for the task. Targeted tests support iteration but do not replace a required full gate. If the coverage gate is required, execute the package command that actually enables it. Reuse successful results for unchanged inputs rather than repeat checks without a reason.

When changing a gate itself, exercise its failure behavior in an isolated temporary fixture outside the repository: a failing test, coverage below the configured threshold, a configured lint violation, or an incorrectly formatted file must produce a nonzero exit status. Preserve the user's working tree. A successful run alone does not establish that a changed gate rejects bad input.

Tests and configuration checks do not replace runtime smoke verification of changed application behavior. Report separately which gates ran, which passed or failed, and which could not run. A missing gate, skipped scope, or failed invocation is not a pass.

## Completion

- Required package gate roles are accounted for; existing names are reused.
- Rules and thresholds are enforced by their owning tool configuration, not duplicated in prose.
- Authorized configuration changes preserve scope and propagate failure; changed gates have demonstrated rejection behavior.
- Required checks were run through project scripts, with observed outcomes and precise gaps reported.
- Application behavior changed by the task has runtime evidence.
- Documentation matches execution; no separate quality contract or floor-guard was generated.

## Related workflows

- [ci-cd-and-automation](../ci-cd-and-automation/SKILL.md): integrate the existing gates into CI.
- [test-driven-development](../test-driven-development/SKILL.md): implement and verify behavior.
- [code-review-and-quality](../code-review-and-quality/SKILL.md): review changes to code, tests, and enforcement.
