---
name: spec-driven-development
description: Clarifies and approves requirements before coding. Use for a new project or significant feature, vague or conflicting requirements, a PRD with scope and acceptance criteria, or a request spanning several independently testable capabilities that needs a capability map.
---

# Spec-Driven Development

## Overview

Write a structured specification before writing code. The spec is the shared source of truth between the human and agent for what to build, why, and how to know it is done. Code without an agreed spec for consequential work is guessing.

The spec is a temporary execution artifact in the OS-temporary work set, outside the repository. It can be revised across sessions and passed explicitly through handoffs; it is never committed. Durable requirements or decisions belong in maintained project documentation only when the user separately authorizes that durable destination.

## When to use

- Starting a new project or significant feature
- Requirements are ambiguous, incomplete, or conflicting
- A change spans multiple files or modules
- An architectural decision needs explicit acceptance criteria
- The work is likely to take more than 30 minutes
- A single requirement bundles several independently testable capabilities and needs a capability map

**When not to use:** Single-line fixes, typo corrections, and changes with unambiguous, self-contained requirements.

## Work set and approval contract

Use the exact OS-temporary `workDir` supplied by the user or active handoff. Follow [`../../references/POLICY.md`](../../references/POLICY.md) for its naming/path contract, report the exact absolute path, and pass it to idea refinement, planning, context, and session handoffs. Never guess the active spec from a filename or most recent temporary directory. For a new effort, establish a distinct work set and use `${workDir}/intent.md` for an optional capability map, `${workDir}/spec.md` for a single-capability spec, and `${workDir}/spec-${module-id}.md` for each module spec when needed.

The spec, capability map, plan, task checklist, idea brief, and session handoff are temporary AI working artifacts. Keep them outside the repository and never commit or copy them into repository execution-artifact directories. Existing external spec systems may supply an artifact format, but their format does not override this storage boundary. If a required tool can only write its spec into the repository, pause and ask before using it. A spec may cache verified project commands/context to reduce rediscovery. Durable RFCs, decisions, and maintained requirements are different artifacts and need explicit authorization to write.

Follow the full [`grilling`](../grilling/SKILL.md) interview contract: surface the confidence hypothesis, discover facts from the repository first, ask independent dependency-ready questions together, defer dependent questions, offer an interactive cross-model perspective at every doubt cycle, and require an explicit yes to a concrete restatement. The interview's terminal turn remains an authorization gate; do not start downstream work merely because the user confirmed intent. "Sounds good", "sure", a delegation, or silence is not confirmation. Scope confirmation does not itself authorize file writes, implementation, external publication, or commits; obtain the relevant authorization separately if not already explicit. Follow repository/runtime permissions for ordinary tooling; obtain separate explicit authorization before each external CLI/model invocation for cross-model review.

## Gated workflow

Spec-driven development has four phases, preceded by a scope check (Phase 0) only when one request bundles several independently testable capabilities. Do not advance to the next phase until the current gate is validated.

```text
SCOPE CHECK → SPECIFY → PLAN → TASKS → IMPLEMENT
                  │        │       │          │
                  ▼        ▼       ▼          ▼
                Human    Human   Human      Human
                reviews  reviews reviews    reviews
```

For ordinary single-capability requests, skip Phase 0 and begin at Specify. It exists for the exceptional multi-capability request, not as a required hierarchy for every feature.

### Phase 0: Scope check

Decompose before specifying only when a single request bundles several independently testable capabilities. Signals include:

- Distinct capabilities with their own consumers or data, such as identity, billing, notifications, and reporting
- Acceptance criteria forming groups that could ship and be verified separately
- One capability that could be cut or replaced without rewriting the others' requirements

**Propose a small capability map before writing any module spec.** It is a module table plus build order, not a project plan:

```markdown
# Capability Map: [Initiative Name]

| Module id     | Responsibility            | Depends on             |
| ------------- | ------------------------- | ---------------------- |
| identity      | Accounts, sessions, SSO   | —                      |
| billing       | Plans, invoices, payments | identity               |
| notifications | Email and webhook fan-out | identity               |
| reporting     | Usage dashboards          | billing, notifications |

Build order: identity → billing, notifications → reporting
```

- **Stable module IDs:** Choose concise kebab-case IDs once; do not rename them mid-initiative. Use them in the map, module spec filenames, plans, and task references rather than guessing which spec is active.
- **Dependency direction:** Arrows point one way. If two modules each need the other, they are likely one module or need a clearer dependency seam.
- **Interfaces live at seams:** The map records that one module depends on another; the provider module's spec defines the contract at that seam. Use `codebase-design` for interface, depth, and seam choices.

The capability map is gated like every phase. The human must review module responsibilities, dependency direction, seam/interface placement, and build order before a module spec is written. Ten lines of review are cheaper than correcting a wrongly decomposed initiative later.

Save the approved map only at `${workDir}/intent.md`. Then recurse through Specify → Plan → Tasks → Implement for each module in dependency order. Give every module its own focused spec at `${workDir}/spec-${module-id}.md`, with objective, boundaries, and success criteria scoped to that module. The map, not filename guessing or a duplicate repository plan, indexes the initiative. This phase is complete when the map is explicitly approved and each module ID/order is stable.

### Phase 1: Specify

Begin from a high-level vision. Clarify until the scope, user, success criteria, and boundaries are concrete.

**Surface assumptions before writing spec content.** Verify claims from repository files where possible; label remaining assumptions explicitly and ask about decisions only the human can make. For example:

```text
ASSUMPTIONS TO CONFIRM:
1. This targets a web application, not native mobile.
2. Authentication follows the existing session-cookie approach.
3. The repository's current database is PostgreSQL, based on its schema/config.
4. The target browser support matches the project's existing policy.

Which assumptions are wrong or need a decision?
```

Do not silently fill ambiguity. The spec exists to surface misunderstandings before code; an assumption hidden as a fact defeats that purpose. Ask all independent questions that are currently ready in one round, defer questions that depend on unanswered decisions, and use `grilling`'s explicit restatement and yes gate. At each doubt cycle, offer an interactive cross-model view. Cite official sources inline for external facts, standards, or tool behavior. Follow repository/runtime permissions for ordinary tooling; obtain separate explicit authorization before each external CLI/model invocation for cross-model review.

Write a spec covering these six core areas:

1. **Objective:** What is being built and why? Who is the user? What does success look like?
2. **Commands:** Full executable project commands and meaningful flags for build, test, lint, development, and other relevant verification. Discover them from actual project manifests, scripts, and instructions. Do not assume `npm`, a framework, or any command from the examples. Record them in the temporary spec only as a rediscovery cache.
3. **Project Structure:** Where source, tests, and maintained docs belong, based on the actual repository. This describes durable project structure; it does not put the working spec there.
4. **Code Style:** One real code example beats three paragraphs. Include verified naming, formatting, and output conventions.
5. **Testing Strategy:** Existing framework, test locations, coverage expectations, and test levels appropriate to each behavior.
6. **Boundaries:** Three tiers:
   - **Always do:** project requirements such as tests, established naming, or input validation.
   - **Ask first:** changes such as schema changes, new dependencies, or CI modifications where consent is required.
   - **Never do:** hard limits such as committing secrets or deleting tests without approval.

Use this spec template and adapt it to the repository:

```markdown
# Spec: [Project or Feature Name]

## Objective

[What is being built, why, user, and acceptance criteria]

## Tech Stack

[Verified language, framework, and key dependencies/versions]

## Commands

[Verified build, test, lint, development, and relevant check commands]

## Project Structure

[Actual directory layout and maintained-doc destinations]

## Code Style

[One verified snippet plus conventions]

## Testing Strategy

[Framework, test locations, coverage expectations, test levels]

## Boundaries

- Always: [...]
- Ask first: [...]
- Never: [...]

## Success Criteria

[Specific, observable, testable conditions]

## Open Questions

[Unresolved matters that need a human decision]
```

**External spec systems:** The workflow is format-agnostic. If the project already uses OpenSpec or another specification system, preserve its artifact semantics/format when possible, but store the working spec in `${workDir}`. Do not create a competing repository `SPEC.md` or silently let a tool publish temporary work into the repository. The skill owns clarification, content, and approval gates; the external tool may own the representation. If its required storage conflicts with the OS-temporary boundary, stop and ask before proceeding.

**Reframe instructions as success criteria.** Turn vague requirements into concrete conditions and ask whether the targets are right:

```text
REQUIREMENT: "Make the dashboard faster"

REFRAMED SUCCESS CRITERIA:
- Dashboard LCP ≤ 2.5 seconds on the agreed connection profile ([official LCP guidance](https://web.dev/articles/lcp))
- Initial data load completes in ≤ 500 ms
- No layout shift during load (CLS ≤ 0.1; [official CLS guidance](https://web.dev/articles/cls))

Are these the right targets and measurement conditions?
```

Treat values as a draft until the user confirms them and cite the official source for external standards. Make measurement conditions explicit so a vague adjective does not become a guessed threshold.

**Stop after writing the spec (critical).** After writing the authorized draft to `${workDir}/spec.md` (or its module-specific path):

1. Summarize it and list all Open Questions.
2. Ask the human to approve it or request changes using a concrete restatement.
3. **Stop the turn immediately.** Do not start Phase 2, invoke `planning-and-task-breakdown`, write implementation code, or publish the spec in the same turn. Planning starts only in a later turn, after explicit approval of this spec.

This completion criterion is reached when the complete authorized draft is saved at the exact temporary path, the open questions are visible, the user is asked to approve, and the turn ends without moving forward.

### Phase 2: Plan

Only after spec approval in a later turn, create a technical implementation plan by following [`planning-and-task-breakdown`](../planning-and-task-breakdown/SKILL.md) in the same `workDir`:

1. Identify major modules and dependencies.
2. Determine implementation order from the dependency graph.
3. Note risks and mitigations.
4. Identify work that can run in parallel versus work that must be sequential.
5. Define verification checkpoints.

That skill is the canonical source for task-size guidance, vertical slicing, the single task-status source, protection of incomplete plans, and plan/template details. `plan.md` contains decisions, risks, dependency order, and a **non-checklisted task index**; `${workDir}/todo.md` (or an explicitly authorized external tracker) is the sole task-status source. Do not repeat its checkboxes in the plan. The plan is reviewable: the human can confirm the approach or request changes. Save only in the temporary work set and wait for explicit plan approval before implementation.

### Phase 3: Tasks

Use `planning-and-task-breakdown` for the full task template, sizing, dependency order, checkpoint, and conflict behavior. Each task must:

- Be completable in one focused session where practical.
- Have explicit, observable acceptance criteria.
- Include a concrete verification step using commands discovered in the repository.
- Be ordered by dependency, not perceived importance.
- Usually touch no more than about five files; split oversized tasks without resorting to horizontal layer-only slices.

A compact task entry looks like:

```markdown
- [ ] Task [ID]: [Description]
  - Acceptance: [What must be true]
  - Verify: [How to observe it]
  - Files: [Likely paths]
  - Depends on: [Task IDs or none]
```

Task status appears only once in `${workDir}/todo.md` or the authorized tracker. The plan can index task IDs but must not reproduce the checklist. Protect unchecked tasks from other work; see the task-breakdown skill before overwriting any active plan.

### Phase 4: Implement

Implement only after the spec is approved, the plan and single authoritative task-status source have been presented together and explicitly approved, and the user has authorized implementation. Execute one task/slice at a time using `incremental-implementation` and `test-driven-development`. Use `context-engineering` to load only the relevant spec section and source files. Keep changes incremental, verify each slice, and update the single status source only with observed results. At a session boundary, persist the exact `workDir`, artifact paths, completed/next task, changed files, repository state, verification evidence, unresolved questions, and approvals in `${workDir}/handoff.md` as defined by `context-engineering`.

If the user authorizes commits, keep each completed vertical slice reviewable and commit only code or explicitly authorized durable documentation. Temporary ideas, specs, capability maps, plans, task lists, and handoffs are never committed. A spec or plan approval is not commit authorization. Do not implement, publish, or commit automatically from discussion.

## Keeping the spec alive

The spec is a living **temporary** document during the work, not a one-time prompt:

- **Update when decisions change:** If the data model or behavior must change, revise the spec and get approval before implementing the changed requirement.
- **Update when scope changes:** Additions and cuts must be reflected and approved before implementation changes.
- **Pass it across sessions:** Preserve the exact `workDir` and spec path in the handoff; never infer which is current.
- **Do not commit the spec:** Keep it in the OS-temporary work set. If a requirement, quality contract, or decision needs to endure, propose the appropriate maintained project document and obtain separate authorization.
- **Reference durable sources in review:** A PR should link to the authorized durable issue/requirement/decision when one exists. A temporary spec path may be included only in a private handoff accessible to the team; do not publish a local temp path as if it were a durable source.

## Common rationalizations

| Rationalization                                           | Reality                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "This is simple; I don't need a spec"                     | Simple tasks do not need long specs, but significant work still needs clear acceptance criteria.                            |
| "I'll write the spec after coding"                        | That is documentation after the fact, not requirements clarification before implementation.                                 |
| "The spec will slow us down"                              | A focused spec prevents misunderstanding and rework.                                                                        |
| "Requirements will change anyway"                         | Revise the living temporary spec before implementing changed scope.                                                         |
| "The user knows what they want"                           | Even clear requests have implicit assumptions that need exposure.                                                           |
| "It's one big feature; splitting is overhead"             | Independent capability clusters need a reviewed map before module specs.                                                    |
| "I'll decompose during planning"                          | Planning slices work inside a spec; module boundaries and dependency direction must be decided before writing module specs. |
| "I'll plan and code in the same turn"                     | The spec approval gate exists so that plans and code build on a reviewed contract.                                          |
| "I'll save it under docs so the next session can find it" | The exact temporary `workDir` and handoff preserve continuity without committing working material.                          |

## Red flags

- Code starts before written requirements exist for work that needs a spec.
- An architectural choice is implemented without user review where the choice is consequential.
- A feature/task has no approved success criteria.
- The spec was written and planning or code began in the same turn.
- One spec covers independent capability clusters without an approved map.
- Module boundaries or build order were decided implicitly during implementation.
- A temporary spec, plan, checklist, or design brief is saved or committed inside the repository.
- The active spec path was inferred instead of passed explicitly.
- A plan duplicates task status or overwrites another effort's incomplete work.
- Implementation, external publication, or commit was inferred from approval of the spec.

## Verification

Before implementation, confirm:

- [ ] The spec covers all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.
- [ ] The human explicitly approved the spec in a later turn; the turn that wrote the spec stopped without planning/code.
- [ ] Success criteria are specific, observable, and testable.
- [ ] Boundaries (Always/Ask first/Never) are defined.
- [ ] The spec is at its authorized OS-temporary path, with exact `workDir` passed forward; no repository copy exists.
- [ ] If the request bundles independent capabilities, a capability map with stable IDs, dependencies, and build order was approved before any module spec.
- [ ] Every module spec traces to an approved module ID.
- [ ] The plan and authoritative task-status source were created only after spec approval and were explicitly approved together before implementation.
- [ ] `plan.md` is an index, while one task-status source contains the only live checklist.
- [ ] Incomplete plans/task lists were protected; no different work was overwritten.
- [ ] Handoffs preserve exact paths, status, changed files, verification outcomes, and pending approvals.
- [ ] Only code and authorized durable docs can be committed; temporary working artifacts are excluded.
