---
name: planning-and-task-breakdown
description: Breaks a clear, approved scope into ordered, verifiable tasks with explicit dependencies and a single authoritative status source. Use when work is too large to start safely, implementation order is unclear, or independent slices need coordination.
---

# Planning and Task Breakdown

Decompose work into small, verifiable tasks with explicit acceptance criteria. A useful task breakdown lets an agent implement, verify, and hand off a coherent slice rather than producing a tangled change.

## When to use

- An approved spec or otherwise clear requirements need implementation tasks.
- Work feels too large or vague to start.
- Implementation order or dependencies are not obvious.
- Work may span multiple sessions or be coordinated across contributors.
- Scope needs to be communicated for human review.

**When not to use:** Single-file changes with obvious scope, or a spec that already has well-defined tasks.

## Working artifact and approval contract

Planning is read-only analysis. Use the explicit OS-temporary `workDir` from the approved spec, user, or current handoff; do not guess which spec or plan is active. Keep `${workDir}/plan.md` and the one authoritative task-status file `${workDir}/todo.md` outside the repository. Apply the path and naming requirements in [`../../references/POLICY.md`](../../references/POLICY.md), report the exact absolute paths, and pass them to `context-engineering` and later skills. Temporary plans and checklists are never committed or copied into repository documentation. Durable decisions belong in maintained project docs only with authorization.

The user must approve the plan and its authoritative task-status source before implementation starts. Present them together as one review package, with task state recorded only in its one source, and wait for explicit approval in a later turn; a request to plan is not approval to code, publish, or commit. At doubt cycles, follow the full `grilling` contract: surface the confidence hypothesis, present independent dependency-ready questions together, defer dependent questions, offer an interactive cross-model perspective, restate the concrete decisions, and require an explicit yes. Keep the interview's terminal turn as an authorization gate; do not begin planning or downstream work in that turn merely because intent was confirmed. Obtain separate authorization for external publication or implementation when not already explicit. Follow repository/runtime permissions for ordinary tooling and tracker queries; tracker writes/publication require explicit authorization, and each external CLI/model invocation for cross-model review requires its own explicit authorization.

There is one active task-status source:

- By default, `${workDir}/todo.md` contains the detailed tasks, acceptance criteria, verification, dependencies, and checkboxes.
- The plan contains only an ordered index of task IDs/titles and dependency/phase grouping; it is not a second task checklist.
- If the user or repository convention designates an external tracker and the user authorizes writing there, the tracker is the sole task-status source. `${workDir}/todo.md` (if retained) is only an index of tracker IDs/links, never a duplicate task checklist. The plan likewise indexes the tracker without duplicating task status.

## The planning process

### Step 1: Enter plan mode

Before writing code, remain read-only:

- Read the approved spec and relevant repository sections.
- Identify existing architecture and conventions.
- Map dependencies between components.
- Note risks, unresolved questions, required approvals, and unknowns.
- Discover the repository's package manager, build/test/lint commands, documentation destinations, tracker conventions, and authorization boundaries from actual project files. Cache the verified commands in the temporary spec/plan only when that saves rediscovery; do not transplant examples from another stack.

Do not implement during planning. The outputs are a reviewable temporary plan and its one authoritative task-status source, not code. If a missing requirement blocks decomposition, check precedent and ask rather than inventing requirements. Ask independent decision questions together; dependent choices wait. This step is complete when scope, assumptions, constraints, and major unknowns are explicit enough to map dependencies.

### Step 2: Identify the dependency graph

Map what depends on what before choosing task order. For example:

```text
Database schema
    ├── API models and types
    │       ├── API endpoints
    │       │       └── Frontend API client → UI components
    │       └── Validation logic
    └── Seed data and migrations
```

Implementation order follows dependencies: foundations first, then consumers. Identify circular dependencies early; if two modules each require the other as a prerequisite, they may need to be one module or expose an explicit seam/interface between them. Record each module's interface and seam, and follow `codebase-design` for depth, leverage, locality, and interface decisions. This step is complete when every task has an understood predecessor or is explicitly independent.

### Step 3: Slice vertically

Prefer a thin, complete user-visible or behavior-visible path over building one horizontal layer at a time.

**Horizontal slicing (usually poor):**

```text
Task 1: Build the entire database schema
Task 2: Build all API endpoints
Task 3: Build all UI components
Task 4: Connect everything
```

**Vertical slicing (usually better):**

```text
Task 1: User can register (schema + API + UI for registration)
Task 2: User can log in (auth behavior through its user-visible path)
Task 3: User can create a task (data + API + UI for creation)
Task 4: User can view the task list (query + API + UI for listing)
```

Each slice should leave the system working and verifiable. Split where users can receive a coherent increment, not merely where directories or layers change. A task that changes multiple layers is not automatically oversized if the change is a single cohesive vertical path.

### Step 4: Write tasks

Each task, whether in the temporary checklist or an authorized external tracker, has this structure:

```markdown
## Task [N or stable ID]: [Short descriptive title]

**Description:** One paragraph explaining the outcome.

**Acceptance criteria:**

- [ ] [Specific, testable condition]
- [ ] [Specific, testable condition]

**Verification:**

- [ ] Focused tests: [verified repository command]
- [ ] Build/type/lint check: [relevant verified command]
- [ ] Manual check: [observable behavior, if applicable]

**Dependencies:** [Task IDs, or "None"]

**Files likely touched:**

- [Actual paths, where known]

**Estimated scope:** [XS/S/M/L; see sizing guide]
```

Acceptance criteria state consumer-visible behavior, boundaries, invariants, and expected errors where applicable. Verification describes a concrete command or observation grounded in the repository. Do not make a task depend on an unapproved assumption.

### Step 5: Order and checkpoint

Arrange tasks so that:

1. Dependencies are satisfied; build foundational pieces first.
2. Each completed slice leaves the system in a working state.
3. A verification checkpoint follows every two or three tasks, adjusted to risk and task size.
4. High-risk unknowns are addressed early to fail fast.
5. Human review/approval gates occur before irreversible or explicitly gated work.

Put task status and checkpoint checkboxes only in the authoritative task list. Example checkpoint content:

```markdown
## Checkpoint: After Tasks 1–3

- [ ] Focused tests and applicable checks pass
- [ ] Application builds without errors, where the project has a build
- [ ] Core user flow works end-to-end
- [ ] Human reviews before the next phase
```

Do not list the same task checkboxes in both `plan.md` and `todo.md`.

## Task sizing guidelines

| Size   | Typical files | Scope                            | Example                              |
| ------ | ------------: | -------------------------------- | ------------------------------------ |
| **XS** |             1 | Single function or config change | Add one validation rule              |
| **S**  |           1–2 | One module or endpoint           | Add one endpoint                     |
| **M**  |           3–5 | One feature slice                | Complete a registration path         |
| **L**  |           5–8 | Multi-module feature             | Search with filtering and pagination |
| **XL** |            8+ | Too large; split further         | —                                    |

Aim for XS–M focused tasks. An L-sized task is a warning to split; XL is too large. No task should normally require changing more than about five files. If a coherent slice genuinely needs more, explain why and reduce risk with smaller implementation steps rather than breaking it into horizontal fragments.

Break a task down further when:

- It needs more than one focused session (roughly two or more hours of agent work).
- Acceptance criteria cannot be stated in three or fewer concise bullets.
- It spans two independent subsystems (for example, authentication and billing).
- The task title contains "and" because it hides separate outcomes.
- Its dependencies or verification cannot be understood before implementation.

## Output and incomplete-plan protection

### Plan document

Save the architecture, rationale, dependency/order map, risks, and open questions in `${workDir}/plan.md`. Keep a **non-checklisted task index** that refers to the task IDs/titles and phases in the authoritative task list. The plan is always a markdown artifact because decisions and risks do not map cleanly to tracker fields.

### Task list

The default authoritative task list is `${workDir}/todo.md`, a checklist containing tasks and checkpoints. Use a user- or repository-designated external tracker instead only when that convention exists and the user authorized writing there. Map acceptance/verification into tracker fields and dependencies into the tracker's linking mechanism. Record checkpoints as tracker items or once in the plan if the tracker lacks a suitable representation. When using a tracker, mention its name and project in `plan.md`; use the plan's task index and, if useful, a `todo.md` index of tracker IDs/links, never a copied checklist. Tracker writes/publication require separate explicit authorization; ordinary tracker queries follow repository/runtime permissions.

Before writing or revising a plan/task list, inspect the **exact supplied `workDir`** for existing artifacts and unchecked work. Protect incomplete work:

- Same work being replanned because the user asked to revise or extend it: update the existing plan and status source in place, preserving completed work, open tasks, and history needed for safe continuation.
- A different work effort or an ambiguous active plan: stop and present the conflict. Ask the user to finish the old effort, explicitly discard it, or provide a distinct `workDir`.
- Never delete, overwrite, rename, or bulk-close another effort's unfinished checklist or tracker items to make room.
- Never guess an active path by searching for the newest `plan.md`, `todo.md`, or `spec.md`.

This is complete when the plan and status source are placed in the authorized work set, all pre-existing open work is accounted for, and task status appears in exactly one place.

## Plan document template

```markdown
# Implementation Plan: [Feature or project name]

## Overview

[One paragraph summary of the approved scope]

## Architecture Decisions

- [Decision and rationale; link to durable ADR only when authorized and warranted]

## Dependencies and Build Order

[Dependency graph, boundaries, and implementation order]

## Task Index

| Order | Task ID/title  | Depends on | Task-status source           |
| ----- | -------------- | ---------- | ---------------------------- |
| 1     | [ID and title] | —          | [todo entry or tracker link] |
| 2     | [ID and title] | [ID]       | [todo entry or tracker link] |

## Phases and Checkpoints

[Phase boundaries and checkpoint locations; checkbox status lives only in the task-status source]

## Risks and Mitigations

| Risk   | Impact         | Mitigation |
| ------ | -------------- | ---------- |
| [Risk] | [High/Med/Low] | [Strategy] |

## Open Questions

- [Question requiring human input]
```

The task index is an ordered reference, not a second plan-state ledger. If tasks live in an external tracker, use its stable IDs/links in the index.

## Parallelization opportunities

- **Safe to parallelize:** Independent feature slices, tests for already-implemented behavior, or documentation with no shared edit surface.
- **Must be sequential:** Database migrations, shared-state changes, dependency chains, and tasks whose contracts are unsettled.
- **Needs coordination:** Features sharing an API or data contract. Define and approve that contract first, then split ownership.

Use only delegation mechanisms available in the runtime and follow its authorization/coordination rules. If parallel execution is unavailable or unsafe, describe the same independent work as sequential slices. Never parallelize across an unresolved product decision.

## Implementation handoff

After the plan is approved in a later turn, implement one task at a time using `incremental-implementation` and `test-driven-development`; use `context-engineering` to load the relevant spec sections and source files. Update the single status source only after a task meets its acceptance criteria and verification is observed. Preserve safe incremental workflow: complete a focused vertical slice, verify it, review it, then continue. If the user authorizes commits, keep each completed slice reviewable and commit only code and authorized durable documentation; never commit temporary specs, plans, task checklists, idea briefs, or handoffs. Do not commit or publish without authorization.

For a session boundary, follow the restartable contract in [`context-engineering`](../context-engineering/SKILL.md): persist exact `workDir`, status, changed files, verification evidence, and unresolved approvals in `${workDir}/handoff.md`.

## Common rationalizations

| Excuse                                                 | Reality                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| "I'll figure it out as I go"                           | A short dependency map prevents hidden rework.                                             |
| "The tasks are obvious"                                | Writing them exposes forgotten boundaries and edge cases.                                  |
| "Planning is overhead"                                 | Planning is part of the work when scope or order is uncertain.                             |
| "I can hold it all in my head"                         | Temporary plans survive session boundaries without becoming repository history.            |
| "The old plan is stale; I'll replace it"               | Unchecked tasks may be active work. Protect them and ask before replacing.                 |
| "I should copy tasks into both the plan and checklist" | That creates conflicting active-plan state. Keep one status source and index it elsewhere. |

## Red flags

- Implementation begins without an approved task list for work that needs planning.
- A different work effort's unchecked tasks are overwritten without explicit user direction.
- Tasks are recorded in both an external tracker and a second checklist.
- The plan duplicates task statuses/checklists from `todo.md`.
- A task says only "implement the feature" and has no behavioral acceptance criteria.
- Verification commands are invented or copied from another stack.
- All tasks are XL or one task spans unrelated subsystems.
- There are no verification checkpoints or dependency ordering.
- A task list or tracker is created without authorization.
- Temporary planning artifacts enter the repository or a commit.

## Verification

Before implementation begins, confirm:

- [ ] The plan's scope traces to a clear, approved spec or explicit requirements.
- [ ] Every task has observable acceptance criteria and a repository-grounded verification step.
- [ ] Dependencies and implementation order are correct; independent work is identified.
- [ ] Task status is recorded in exactly one authoritative source, default `${workDir}/todo.md`.
- [ ] The plan's task index is non-checklisted and does not duplicate task state.
- [ ] The exact work set contains no different effort's incomplete work overwritten without approval.
- [ ] Tasks are appropriately sized; XL work is split, and any >5-file slice has a reason.
- [ ] Checkpoints exist between major phases and high-risk work is early.
- [ ] The human explicitly approved the plan before implementation.
- [ ] The exact `workDir` and artifact paths are passed to context/handoff.
- [ ] Tracker writes/publication were explicitly authorized; any external cross-model CLI/model invocation had separate explicit authorization; ordinary tools followed repository/runtime permissions.
- [ ] Temporary planning artifacts will not be committed; per-slice commits contain only authorized code/durable docs.

## See also

The task list target is defined here; other skills defer to this source. Behavior-focused acceptance criteria sit on top of the project's durable [Definition of Done](../../references/definition-of-done.md), if one exists.
