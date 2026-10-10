# Definition of Done

A standing quality floor for changes in this repository. Acceptance criteria vary by task and answer “did we build the right thing?”; the Definition of Done answers “is this finished to the repository's standard?” Use it as a final gate alongside [`planning-and-task-breakdown`](../skills/planning-and-task-breakdown/SKILL.md), [`incremental-implementation`](../skills/incremental-implementation/SKILL.md), and [`shipping-and-launch`](../skills/shipping-and-launch/SKILL.md), where those local skills are available.

## Definition of Done vs. Acceptance Criteria

|         | Acceptance Criteria                      | Definition of Done                                                        |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Scope   | Specific to one task or request          | Applies to every increment                                                |
| Changes | Different for each item                  | Standing floor, tailored once to the repository                           |
| Answers | “Did we build _this thing_?”             | “Is it _ready_?”                                                          |
| Owner   | Defined when shaping the task            | Defined once for the project                                              |
| Example | “User can reset password via email link” | “Behavior is exercised, regressions considered, and durable docs updated” |

The two are complementary. A task is done only when its acceptance criteria are met **and** the applicable standing Definition of Done is satisfied. Skipping either leaves work that looks finished but is not.

## The Standing Checklist

Apply the relevant items to every change before declaring it done. Do not claim a check that was not performed.

### Correctness

- [ ] All acceptance criteria for the task are met
- [ ] Changed behavior is exercised at runtime where the environment permits; compilation or type-checking alone is not runtime evidence
- [ ] Tests cover changed behavior when they catch a plausible consumer-visible regression or contract failure; tests are focused, deterministic, isolated, and follow repository conventions
- [ ] Applicable existing tests/checks pass, and failures/regressions are understood
- [ ] Relevant edge cases and error paths are handled, not just the happy path

### Quality

- [ ] Code reveals intent through naming and structure; comments explain why, not merely what
- [ ] Duplicated business logic is avoided
- [ ] Dead code, debug output, and commented-out blocks introduced by the change are removed
- [ ] Changes stay in scope; unrelated refactors are not smuggled in
- [ ] Applicable configured linting/formatting checks are run when required by the task and project workflow

For deeper review, consult the local [`code-review-and-quality`](../skills/code-review-and-quality/SKILL.md) skill; for reducing complexity without changing behavior, consult [`code-simplification`](../skills/code-simplification/SKILL.md).

### Integration

- [ ] Change works with the surrounding system, not just in isolation
- [ ] Relevant database migrations, configuration changes, and feature flags are accounted for
- [ ] Backward compatibility is considered for public interfaces and APIs

### Documentation

- [ ] Public interfaces, APIs, and user-facing behavior are documented in the repository's maintained documentation destination
- [ ] Decisions worth preserving are recorded as durable documentation (see [`documentation-and-adrs`](../skills/documentation-and-adrs/SKILL.md)); an ADR is appropriate when reversal is costly
- [ ] Documentation describes the current state in timeless language, not change history
- [ ] Temporary AI-generated specs, plans, briefs, checklists, and execution material remain outside the repository in the named per-work OS-temp working set; they are never committed

### Ship-readiness

- [ ] Security implications are reviewed for untrusted input, authentication, authorization, or sensitive data handling (see [`security-and-hardening`](../skills/security-and-hardening/SKILL.md))
- [ ] Observability is considered for new critical paths (logs, metrics, traces; see [`observability-and-instrumentation`](../skills/observability-and-instrumentation/SKILL.md))
- [ ] A rollback path exists for risky changes, appropriate to their impact (see [`shipping-and-launch`](../skills/shipping-and-launch/SKILL.md))
- [ ] The human has reviewed and explicitly approved before merge, publication, or deployment when those actions are in scope

## How to Apply

- **Per task:** confirm the applicable Correctness and Quality sections before marking the task done.
- **Per feature:** confirm Integration and Documentation before calling the feature complete.
- **Per release:** use the full applicable checklist as the floor; [`shipping-and-launch`](../skills/shipping-and-launch/SKILL.md) adds deployment-specific gates.

Tailor this list to the project once, then reuse it. Discover required gates in `package.json` and their owning tool configuration; follow [constraint-driven-development](../skills/constraint-driven-development/SKILL.md) for enforcement gaps. Keep documentation consistent with execution.

## Red Flags

- “It's done, I just haven't run it yet”: unverified work is not done when runtime verification was possible.
- “Tests pass” used as a synonym for done while runtime behavior, regressions, or documentation are ignored.
- Applying a different quality bar under deadline pressure without an explicit decision.
- Treating acceptance criteria as the entire quality floor.
- Declaring a change ready for merge or deployment before required human review and approval.
