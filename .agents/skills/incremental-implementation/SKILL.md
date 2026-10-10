---
name: incremental-implementation
description: Delivers multi-file changes in thin, complete, verifiable slices. Use when implementing a feature from a task breakdown, refactoring across files, rolling out behind a feature flag, or when the change is too large to prove in one pass.
---

# Incremental Implementation

Build a thin, complete slice, test and verify it, then carry its working state into the next slice. Each increment leaves the repository usable and reviewable; never defer proof until the end of the whole feature.

## When to use

Use for multi-file changes, task-breakdown work, refactors, staged rollouts, or any change that invites writing a large amount of code before checking it. A genuinely minimal single-file, single-function change may be done in one increment.

## Establish the working set

1. Read the confirmed task, acceptance conditions, repository guidance, and any existing plan. Discover the repository's language, conventions, tools, package manager, verification commands, and docs destinations from its files; do not assume a stack.
2. If temporary execution material is needed, use the exact named per-work `workDir` in the task or handoff. It MUST be an OS temporary directory outside the repository; discover the OS temporary location from the active runtime rather than assuming a fixed path. If no named `workDir` was supplied, create a uniquely named per-work directory there and pass its exact absolute path in every handoff and between sessions. Use standard basenames such as `intent.md`, `idea.md`, `spec.md`, `plan.md`, `todo.md`, and `handoff.md` under `${workDir}` as appropriate; do not guess an active spec or place these files in the repository. Temporary briefs, plans, task lists, and design-execution notes are never committed.
3. Read package quality gates and their owning tool configuration; follow [constraint-driven-development](../constraint-driven-development/SKILL.md) for missing or weakened enforcement. Fix code rather than weaken configured rules or thresholds. Persist important decisions, RFCs, current-system or operational knowledge only in maintained documentation and with authorization; do not turn execution notes into durable docs.
4. Convert the confirmed outcome into acceptance checks. Mark dependencies, unknowns, externally visible contracts, and costly risks. Slice design is an execution plan, not permission to expand the request.

When slice order depends on module depth, seam placement, or testability, load [`codebase-design`](../codebase-design/SKILL.md); when it depends on domain terminology or relationships, load [`domain-modeling`](../domain-modeling/SKILL.md). Use those specialists' vocabulary instead of duplicating their architecture or domain rules here.

If a product requirement or acceptance condition remains genuinely ambiguous after repository evidence is checked, use [`grilling`](../grilling/SKILL.md) rather than inventing it. Make the interactive cross-model offer in every doubt cycle, without a risk threshold; use the grilling skill's concrete restatement and explicit-yes gate before settling the choice. Clarification or delegation is not permission to implement or publish beyond the confirmed task.

## The increment cycle

For each slice:

1. **Choose** one smallest complete user-visible or maintainable outcome. Prefer a vertical slice through the stack; choose contract-first when work can proceed independently across a shared interface, and risk-first when one uncertainty could invalidate later work.
2. **Implement** only that slice. Keep it simple and focused.
3. **Test** at the smallest useful level, using the repository's own focused command and tests that exercise behavior. For behavior changes, follow `../test-driven-development/SKILL.md`'s red-green-refactor loop.
4. **Verify** the changed path in its actual runtime where possible; run relevant repository-defined checks. Tests passing alone do not prove a UI, CLI, or integration behaves as intended.
5. **Commit** each completed slice with a descriptive message, following the repository's atomic-commit guidance in `../git-workflow-and-versioning/SKILL.md` when available. Keep each commit focused and independently reviewable: include changed code and authorized durable docs, never temporary working artifacts.
6. **Continue** from the verified result, not from a reset or parallel pile of unintegrated changes.

If a user accepts cross-model review conducted through an external CLI, obtain separate explicit authorization for each such invocation; see [`source-driven-development`](../source-driven-development/SKILL.md). Ordinary repository verification commands follow the runtime's and repository's normal permission policy. Do not repeat an unchanged verification command after a clean run; rerun when a relevant change could affect its result.

## Slicing strategies

### Vertical slices (preferred)

Complete one end-to-end user capability before broadening the feature. For example:

```
Slice 1: Create a task (persistence + endpoint + essential UI)
        → verify a user can create one
Slice 2: List tasks (query + endpoint + UI)
        → verify a user can see them
Slice 3: Edit a task (update + endpoint + UI)
        → verify a user can change one
Slice 4: Delete a task (delete + endpoint + confirmation)
        → verify the full lifecycle
```

The actual layers and checks depend on this repository; the example is a shape, not a prescribed architecture.

### Contract-first slices

When client and server, or multiple modules, need to work independently, first define the shared contract (types, schema, protocol, or maintained API spec), then implement and test each side against it, then verify integration:

```
Slice 0: Define the contract
Slice 1a: Implement the provider against it and verify provider behavior
Slice 1b: Implement the consumer against the same contract
Slice 2: Integrate and verify the real end-to-end path
```

Do not make a mock that drifts from the contract. Contract-first work does not mean committing a temporary AI brief; durable interface definitions belong with the code or authorized project documentation.

### Risk-first slices

Prove the riskiest or least-known dependency before investing in dependent work:

```
Slice 1: Verify that the required connection can be established
Slice 2: Build the core behavior on the proven connection
Slice 3: Add recovery or offline behavior if required
```

If the first proof fails, update the plan before the next investment. Do not use risk ordering to silently drop required outcomes.

## Implementation rules

### Simplicity first

Before coding, ask: what is the simplest correct implementation for the confirmed need? After coding, check whether each abstraction earns its complexity and whether a straightforward implementation would be clearer. Three similar lines are better than a premature generic framework; optimize only after correctness is proven.

```
✗ Generic event bus with middleware for one notification
✓ Direct function call

✗ Abstract factory for two similar components
✓ Two clear components sharing only real common utilities

✗ Config-driven form builder for three forms
✓ Three straightforward form components
```

### Scope discipline

Touch only what the task requires. Keep adjacent cleanup, unrelated modernization, speculative features, and unexplained comment changes out of the slice. Record unrelated observations separately without implementing them. Each slice has a clear in-scope outcome and explicit exclusions.

### One logical change at a time

Do not combine unrelated feature work, refactoring, and build-configuration changes in one increment. A reviewable increment changes one logical thing and delivers it completely.

### Keep the repository usable

After each increment, keep the project in the repository's normal working state: it must build and all existing tests must pass. Also run type checking and linting where the stack provides them and the change can affect them. If an incomplete feature must be merged before user-ready, gate it behind an appropriate feature flag defaulting to the safe/off state; do not expose incomplete behavior by default. Do not add a flag merely to disguise unfinished local work. Use the repository's actual flag/configuration mechanism; a stack-neutral sketch is:

```typescript
const enableTaskSharing = featureFlags.taskSharing ?? false;
if (enableTaskSharing) {
  // Expose the in-progress capability only when deliberately enabled.
}
```

### Safe defaults and rollback

New behavior defaults to the conservative choice unless the contract says otherwise. Keep modifications focused and each increment independently revertible. Provide rollback migrations where the repository's migration practice calls for them. Plan destructive replacement carefully so an intermediate state does not leave the repository unusable.

Example safe default:

```typescript
export function createTask(data: TaskInput, options?: { notify?: boolean }) {
  const shouldNotify = options?.notify ?? false;
  // ...
}
```

## Working with agents

Delegate only a bounded slice with its context, acceptance checks, exclusions, and the exact `workDir` path when temporary artifacts must be shared. Keep shared contracts explicit so independent work does not diverge. Ask contributors to use the repository's discovered test/build commands and report observed results; do not prescribe a framework or package manager from an example.

## Per-increment checklist

- [ ] One logical outcome is complete, not a placeholder or partial wiring.
- [ ] Scope stayed within the confirmed task.
- [ ] Relevant focused tests pass, then all existing tests pass using repository conventions.
- [ ] The changed path was exercised in its runtime when applicable.
- [ ] The build succeeds; type checking and lint checks pass where provided and affected by the slice.
- [ ] Feature behavior, failure states, and safe defaults match the contract.
- [ ] The slice has an accurate, focused commit.
- [ ] No temporary working artifact is included in a commit.

## Common rationalizations

| Rationalization                                     | Reality                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| “I'll test everything at the end.”                  | Bugs compound; prove the earliest slice before building on it.                   |
| “It is faster to do it all at once.”                | A failure among hundreds of changes costs more to isolate than a thin increment. |
| “These changes are too small to commit separately.” | Small, focused commits make review and rollback easier.                          |
| “I'll add the flag later.”                          | Incomplete behavior must remain safely hidden if it has to be merged.            |
| “This refactor is small enough to include.”         | Mixing refactors and features obscures both review and diagnosis.                |
| “I'll rerun the same check just to be sure.”        | Without a relevant code change, it adds no evidence.                             |

## Red flags

- More than roughly 100 lines changed without a relevant check
- Unrelated changes bundled into one increment
- Unverified accumulation of many slices
- Skipping tests or runtime verification to move faster
- Repository left broken between increments
- Premature abstractions before real variation exists
- Out-of-scope cleanup slipped in “while I'm here”
- A new utility created for one one-time operation
- Repeating a successful unchanged check
- Temporary plans/specs or other working artifacts entering a commit

## Completion

After all slices, check the feature end-to-end against every acceptance condition, run the repository's final required verification once, and review the final diff for scope, uncommitted changes, and temporary artifacts. For the project-wide final quality gate, use [the Definition of Done](../../references/definition-of-done.md).

See [shared skill policy](../../references/POLICY.md).
