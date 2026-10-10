---
name: using-agent-skills
description: Use at the start of every task, before any response or action including clarifying questions, and when scope or development phase changes. Requires checking skill applicability and loading relevant skills before proceeding.
---

# Using Agent Skills

Select the process appropriate to the task. These skills integrate engineering workflows with local disciplines and apply the [shared policy and working-set contract](../../references/POLICY.md). Intent discovery lives in `grilling`; do not create or route to a second interviewing skill.

## Mandatory entry rule

Before any response or task action—including clarifying questions, planning, codebase exploration, or file changes—check this skill's routing guidance. Load relevant or explicitly requested skills before proceeding. Loading the router and candidate skills is the prerequisite, not an action that requires another routing check.

If a skill plausibly applies, read it to resolve applicability rather than dismissing it from its name alone. Once applicability is established, following its relevant instructions is mandatory. You cannot reason your way out of an applicable skill because the task seems simple, you remember the workflow, or another action feels more productive. Discard a candidate only after its instructions establish that it does not apply; respect user-only invocation restrictions when loading candidates.

Simple tasks may need no specialist workflow, but they still require the routing check. Reading a skill does not require running every branch or expanding the user's request. Process skills establish the approach before implementation skills carry it out; clear requirements do not require an interview or idea-refinement phase just because planning follows.

Reuse instructions already loaded in the current context; reload after context loss or known changes. Re-evaluate routing when scope or development phase changes. Subagents apply this rule to their assigned slice, using supplied context without restarting the parent's completed interview or approval process.

System and developer instructions remain authoritative. Within those boundaries, follow repository instructions and the user's authorized scope; skill invocation grants no additional permission.

### Stop rationalizing

These thoughts are signals to perform the routing check, not exceptions to it:

| Thought                                          | Required behavior                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| “This is just a simple question.”                | Questions are tasks. Check routing before answering; use only applicable workflows.            |
| “I need more context first.”                     | Check before clarifying or gathering context; skills may govern the investigation.             |
| “I'll just inspect one file or run one command.” | Check before task exploration or tool use.                                                     |
| “I remember this skill.”                         | Use its loaded instructions, not remembered habits; load it if absent from current context.    |
| “This skill is overkill.”                        | Read the plausible candidate and follow applicable steps; task size alone is not an exemption. |
| “I know what the skill means.”                   | Knowing the concept is not following its instructions and completion criteria.                 |
| “This feels more productive.”                    | Establish the required approach before acting; apparent speed does not waive the workflow.     |
| “The user confirmed the idea.”                   | Confirmation establishes understanding, not authorization for downstream work.                 |

## Discover and load

Read the chosen skill before acting, using the runtime's skill mechanism or its instructions at `../<name>/SKILL.md`. Do not assume a tool named `Skill`, a specific question tool, a slash command, or a persona exists. Runtime/tool permissions and repository instructions govern execution. Skills describe work; they do not grant additional tool, deployment, publication, or data-sharing permissions.

Model-invoked skills can be selected from their descriptions. User-only skills marked `disable-model-invocation: true` are suggested for the user to invoke, not automatically invoked. A skill may explicitly point to another skill's document as supporting reference; reading that reference is not claiming that a disabled skill was invoked. See [invocation mechanics](../writing-for-agents/SKILL-MECHANICS.md).

## Route by the actual need

| Need                                                                          | Skill                                                                              | Result                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ambiguous audience, outcome, success, or constraints; interview/grill request | [grilling](../grilling/SKILL.md)                                                   | Confirmed intent or stress-tested decision tree; independent questions batched |
| Rough idea needs alternatives and convergence                                 | [idea-refine](../idea-refine/SKILL.md)                                             | Temporary idea brief, not automatically an RFC                                 |
| Feature or significant change lacks concrete requirements                     | [spec-driven-development](../spec-driven-development/SKILL.md)                     | Approved temporary spec; separate modules when capabilities warrant it         |
| Quality bar missing or checks being weakened                                  | [constraint-driven-development](../constraint-driven-development/SKILL.md)         | Package gate discovery and tool-configured enforcement                         |
| Approved spec needs implementable tasks                                       | [planning-and-task-breakdown](../planning-and-task-breakdown/SKILL.md)             | Temporary dependency-ordered plan and task state                               |
| Multi-file implementation or next planned task                                | [incremental-implementation](../incremental-implementation/SKILL.md)               | Small working, verified increments                                             |
| Stable public or internal contract design                                     | [api-and-interface-design](../api-and-interface-design/SKILL.md)                   | Typed contracts, errors, validation, compatibility and retry safety            |
| Module depth, interface shape, seam placement, testability                    | [codebase-design](../codebase-design/SKILL.md)                                     | Leverage, locality, and justified seams; existing vocabulary stays canonical   |
| Domain terms, overloaded concepts, or domain decisions                        | [domain-modeling](../domain-modeling/SKILL.md)                                     | Precise language and authorized consequential decision records                 |
| Frontend behavior and interface quality                                       | [frontend-ui-engineering](../frontend-ui-engineering/SKILL.md)                     | Complete accessible, responsive states and rendered verification               |
| Need relevant context or restartable task state                               | [context-engineering](../context-engineering/SKILL.md)                             | Just-in-time context and explicit temporary working-set path                   |
| Framework-specific implementation needs authoritative evidence                | [source-driven-development](../source-driven-development/SKILL.md)                 | Version-matched official sources and cited patterns                            |
| Non-trivial decisions need adversarial examination                            | [doubt-driven-development](../doubt-driven-development/SKILL.md)                   | Fresh artifact-plus-contract review; mandatory interactive cross-model offer   |
| Behavior implementation, modification, or bug guard                           | [test-driven-development](../test-driven-development/SKILL.md)                     | Failing behavioral test, minimal fix, refactoring and suite evidence           |
| Browser behavior needs runtime evidence                                       | [browser-testing-with-devtools](../browser-testing-with-devtools/SKILL.md)         | Live DOM, console, network, visual and performance evidence                    |
| Failure or incident                                                           | [debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md)           | Reproduction, localization, root-cause fix, regression guard                   |
| Review a change before merge                                                  | [code-review-and-quality](../code-review-and-quality/SKILL.md)                     | Correctness, readability, architecture, security and performance findings      |
| Reduce needless complexity while preserving behavior                          | [code-simplification](../code-simplification/SKILL.md)                             | Faster comprehension, preserved contracts and verification                     |
| Trust boundaries, hostile inputs, privacy, dependencies                       | [security-and-hardening](../security-and-hardening/SKILL.md)                       | Threat model, controls, abuse cases and observed enforcement                   |
| Measured slowness or performance regression                                   | [performance-optimization](../performance-optimization/SKILL.md)                   | Baseline, bottleneck fix, remeasurement; revert neutral complexity             |
| Branches, atomic commits, history or release versions                         | [git-workflow-and-versioning](../git-workflow-and-versioning/SKILL.md)             | Reviewable, reversible changes; temporary AI artifacts excluded                |
| Automated quality gates or deployment pipeline                                | [ci-cd-and-automation](../ci-cd-and-automation/SKILL.md)                           | Mandatory reproducible checks and safe deployment stages                       |
| Retire old behavior or migrate consumers/data                                 | [deprecation-and-migration](../deprecation-and-migration/SKILL.md)                 | Usage evidence, proven replacement, staged migration and recovery              |
| Durable documentation, public API docs or consequential decisions             | [documentation-and-adrs](../documentation-and-adrs/SKILL.md)                       | Maintained knowledge and rationale, not agent execution material               |
| Production logs, metrics, traces, alerts or runbooks                          | [observability-and-instrumentation](../observability-and-instrumentation/SKILL.md) | Queryable correlated signals answering on-call questions                       |
| Production release or launch                                                  | [shipping-and-launch](../shipping-and-launch/SKILL.md)                             | Observable staged rollout with recovery and explicit authorization             |
| Create/edit skills or agent-facing instructions                               | [writing-for-agents](../writing-for-agents/SKILL.md)                               | Clear pointers, disclosure, completion criteria and intentional authority      |

Existing user-invoked tools remain available; suggest rather than automatically invoke them:

| Explicit user purpose                                                                   | Skill                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Scoped engineering interview producing an explanation, design or authorized publication | [grill-with-artifacts](../grill-with-artifacts/SKILL.md)                   |
| Architecture review and deepening candidates                                            | [improve-codebase-architecture](../improve-codebase-architecture/SKILL.md) |
| Visual explanation in chat                                                              | [show-me](../show-me/SKILL.md)                                             |
| Coding-session retrospective                                                            | [retro](../retro/SKILL.md)                                                 |
| Temporary continuation document for another session                                     | [handoff](../handoff/SKILL.md)                                             |

## Operating behaviors

### Surface assumptions and resolve confusion

Before a non-trivial change, name requirements, architecture, and scope assumptions. Investigate retrievable facts yourself. If an unresolved interpretation affects behavior, name the conflict, explain alternatives and consequences, and wait for the user's decision rather than guessing. Clear requirements do not need another ceremonial interview.

`grilling` owns intent confirmation: concrete restatement, explicit yes, batched independent frontier questions, and no automatic downstream work after the interview. Understanding, approval of a proposal, authorization to edit, and authorization to publish or deploy are distinct.

### Push back with evidence

Name concrete disadvantages and propose alternatives when a plan is unsafe or inefficient. Technical disagreement is more useful than false agreement. Accept the user's informed decision when permitted by governing safety rules. Distinguish verified behavior, historical rationale, adopted choices, and unknowns; a proposal is not proof of shipment.

### Enforce simplicity and scope

Prefer the boring, clear solution; abstractions must earn their cost. Use `codebase-design`'s depth-as-leverage rather than line count alone. Touch only the requested work: no unrelated renovation, invented feature, or deletion of code whose purpose is unknown. Preserve existing conventions unless changing them is part of the task.

### Preserve configured quality gates

`package.json` owns quality-gate entry points; Vitest, Oxlint, Oxfmt, and other owning tool configuration enforce rules and thresholds. Follow [constraint-driven-development](../constraint-driven-development/SKILL.md) to discover required gates and report enforcement gaps. Documentation explains rationale rather than overrides configuration. Fix code instead of silently weakening checks, deleting meaningful assertions, skipping tests, or introducing stubs; policy changes require explicit authorization.

### Keep working material temporary

Follow [the working-set contract](../../references/POLICY.md). Use an explicitly named OS-temporary directory outside the repository and carry its exact path between skills and sessions. Intent, idea briefs, specs, plans, task checklists, and handoffs are never committed, even after completion. Temporary specs may cache commands and context. Don't create a second task-state source or overwrite another work item's incomplete plan.

Durable requirements or quality contracts, important decisions, proposals for lasting review, current-system explanations, and operations procedures belong in authorized maintained project docs. Extract that knowledge; do not commit the working artifact. Every expensive-to-reverse decision warrants documentation without an additional surprisingness test.

### Verify, don't assume

Per-skill verification is required, and [Definition of Done](../../references/definition-of-done.md) supplies the shared bar. Tests, builds and actual runtime observations are evidence; "seems right" is not. Browser changes need rendered interaction and visual evidence, not only unit tests. Repeating a successful check on unchanged code adds no confidence.

## Compose without duplicating ownership

A complete feature may use:

```text
grilling → idea-refine → spec-driven-development → planning-and-task-breakdown
  → context-engineering + source-driven-development
  → incremental-implementation + test-driven-development
    + observability-and-instrumentation + relevant frontend/API/design skills
  → doubt-driven-development for non-trivial decisions in flight
  → code-review-and-quality + code-simplification
  → git-workflow-and-versioning + documentation-and-adrs
  → deprecation-and-migration when needed → shipping-and-launch
```

Run instrumentation alongside implementation, not after launch. Discover configured package quality gates before autonomous work; report missing enforcement without inventing policy. Do not turn this sequence into a requirement to use every skill: a bug fix may only need debugging, TDD and review; a clear one-line change needs neither a spec nor a full planning pipeline.

Load each skill's relevant steps/reference rather than the full collection. User approval gates persist across handoffs; temporary task state is not deployment authorization. Skill invocation never expands the original user request.

## Verification

- Every supported workflow has a route; intent discovery goes to `grilling`.
- Existing design/domain/writing disciplines are reused rather than shadowed by new conventions.
- User-only tools are distinguished from model-discoverable workflows.
- The chosen process matches the task, scope and authorization, without unnecessary phases.
- Temporary artifact path and approval/task state survive a restart without entering Git.
- Tool-configured quality enforcement, explicit confirmation and observed verification remain intact.
