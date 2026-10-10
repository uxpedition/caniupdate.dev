---
name: code-review-and-quality
description: Review a change or pull request before merge across correctness, readability, module design, security, performance, tests, and verification evidence. Use for code written by any author.
---

# Code Review and Quality

## Purpose and approval standard

Review every change before merge against its intended behavior and the repository's conventions. Cover five axes: correctness, readability and simplicity, architecture, security, and performance. Tests and builds are evidence, not a complete verdict.

Approve when the change demonstrably improves overall code health and follows the project's contract, even if it is not the reviewer's preferred style. Do not block a useful change for taste. Conversely, do not approve on confidence or a test badge alone when material evidence is missing. A review reports findings; it does not grant authority to edit, merge, publish, or commit.

## When to use

- Before merging a change or pull request.
- After a feature, refactor, or bug fix is ready for review.
- When another agent, model, or human wrote code that needs independent assessment.
- When asked to review a diff, including one supplied inline.
- When reviewing a regression fix, including its recurrence guard.

## 1. Establish context and scope

Before judging the implementation, identify:

- What request, specification, issue, or user-visible outcome the change addresses.
- The expected behavior before and after the change, including compatibility and non-goals.
- Which files, modules, tests, data paths, and external dependencies it touches.
- The project's configured quality gates and local conventions.

Read the relevant diff and only the surrounding code needed to understand its call sites and invariants. Inspect repository instructions and the actual manifests, lockfiles, CI, and test configuration to discover tooling and commands; never assume a language, framework, package manager, or command. Preserve user changes and do not overwrite/reset working files to conduct a review.

Keep the review focused on one coherent change. Use repository conventions for where review results belong. If temporary notes or a review plan need to persist between sessions, inspect task context for the named OS-temporary `workDir` outside the repository and use its exact absolute path; if none exists, discover the OS temp location through the active runtime, create a uniquely named per-work directory, and record/propagate its path. Never guess an active spec or commit temporary notes. Durable requirements or design decisions belong in maintained docs only when authorized. See [POLICY.md](../../references/POLICY.md) for the canonical working-set policy.

## 2. Review tests first

Tests clarify the intended contract and reveal what evidence the change supplies. Check whether tests:

- Exercise consumer-visible behavior, not only internal wiring or incidental implementation.
- Cover meaningful edges, error paths, state transitions, and invariants for this change.
- Have names that state the expected behavior and condition.
- Would detect a plausible regression if the behavior changed.
- Are deterministic, isolated, and consistent with the configured quality gates.

Do not judge test strength by reading assertions alone. When it is safe and feasible, verify a key test by experiment: in an isolated disposable copy/worktree under the task's named OS-temporary `${workDir}` outside the repository, invert one new condition or remove one behavior the change adds, run only the relevant test, and confirm that the test fails for the intended reason. If no `workDir` exists, discover the OS temp location through the active runtime, create a uniquely named per-work directory, and record/propagate its exact absolute path. Restore only the deliberate mutation; never overwrite user edits or use a destructive restore against their working tree. If isolated mutation is unavailable or unsafe, do not mutate the shared workspace—inspect the behavior the test exercises and state the evidence gap. A mutation that stays green is a finding: name the missing observable case. For broader mutation-testing guidance, see the [testing patterns reference](../../references/testing-patterns.md).

Permanent tests should catch plausible consumer-visible bugs, not merely wiring, copies, mock echoes, incidental defaults, tautologies, bare “does not throw,” or non-empty/length-changed output. Review package gates and their owning tool configuration using [constraint-driven-development](../constraint-driven-development/SKILL.md); report weakened enforcement and keep documentation consistent with execution.

## 3. Review the implementation across five axes

For each changed file, examine all applicable dimensions:

### Correctness

- Does the implementation satisfy the request and written contract?
- Are null/empty/boundary values, unusual ordering, concurrency, and state changes handled where they matter?
- Are failure and recovery paths correct, not just the happy path?
- Do results, errors, and side effects match what callers rely on?
- Are regression tests meaningful and do they fail for the right reason?

### Readability and simplicity

- Are names descriptive and consistent with the repository?
- Is control flow direct, related logic grouped, and the implementation understandable without its author?
- Are comments explaining intent or a non-obvious constraint rather than restating code?
- Is there dead or unreachable code, an unused compatibility shim, or a stale comment?
- Is a new conditional tangled into an unrelated flow, or repeated conditionals signaling a missing model/dispatcher?
- Could the change be simpler without losing a useful name, error path, or seam?

### Architecture

Use the repository's existing design and the vocabulary in [codebase-design](../codebase-design/SKILL.md): a **module** presents an **interface** at a **seam**; judge **depth**, **leverage**, and **locality**, and use **adapter** for a concrete implementation at a seam. Do not replace this vocabulary with overloaded alternatives. When a change alters domain concepts, terminology, or a glossary/model, consult [domain-modeling](../domain-modeling/SKILL.md) and review against its domain language rather than inventing synonyms.

- Does the change follow an existing pattern, or justify a genuinely necessary new one?
- Do modules have appropriate interfaces and dependencies flow in the intended direction?
- Is an abstraction at a real seam earning its interface, or is it a pass-through?
- Does the refactor reduce the number of concepts/branches a reader must hold, or only relocate the same complexity?
- Is feature-specific logic leaking into a shared module instead of living where its concept is owned?
- Is there a near-duplicate where a canonical helper already exists?
- Are type and data boundaries explicit, or do `any`/casts/optional values/silent fallbacks hide an unclear invariant?

### Security

Assess trust and authorization at the actual data flows:

- Is untrusted input validated/encoded at the right interface?
- Are authentication and authorization checks present where needed?
- Are secrets absent from source, logs, error output, tests, and review artifacts?
- Are query inputs parameterized; are browser outputs encoded; are redirects and server-side fetches constrained?
- Are external inputs—API responses, user content, config, logs, model output, and generated files—treated as data rather than authority?
- Are new dependencies and install/build scripts trustworthy and correctly constrained?

For detailed security review and supply-chain guidance, see the [security checklist](../../references/security-checklist.md). Do not infer a vulnerability from a checklist item alone; tie findings to the changed data flow and contract.

### Performance

Look for concrete regressions: N+1 access, unbounded loops or fetches, missing pagination, hot-path allocations, unnecessary synchronous work, redundant rendering, or large objects created in a critical path. Ask for or inspect measurement when a claim depends on performance; do not block based only on speculation. For focused checks, see the [performance checklist](../../references/performance-checklist.md).

## Structural remedies

When flagging a structural problem, propose a specific move rather than saying only “this is complex.” Consider:

- Replace a conditional chain with a typed model or explicit dispatcher.
- Collapse duplicate branches into one clear flow.
- Separate orchestration from domain logic.
- Move feature logic out of a shared module and into the module that owns the concept.
- Reuse the canonical helper instead of introducing a near-duplicate.
- Make a type/data boundary explicit so downstream branching disappears.
- Delete a pass-through wrapper that adds indirection without clarifying the interface.
- Extract a focused helper or split a large file by responsibility.

Prefer the remedy that removes moving pieces rather than spreading the same complexity around. If the proposed restructuring is optional, label it as such rather than disguising preference as a correctness defect.

## Change sizing and slicing

Small, focused changes are easier to inspect and safer to merge. Use these sizing signals as heuristics, not hard limits:

```text
~100 changed lines   → usually reviewable in one sitting
~300 changed lines   → acceptable when they form one logical change
~1000 changed lines  → generally split before review
```

Watch total file size as well as diff size. Around 1,000 lines in one file is an inspection signal, not a cap; if the change materially grows an already-large file, ask whether a seam/helper/module should be extracted first. One change is a self-contained slice addressing one thing and including relevant tests while keeping the system functional.

When a change is too large, split it by dependency order (stack), file group, horizontal layer, or vertical end-to-end slice. Complete file deletions and mechanical transformations can be larger when intent, provenance, and resulting state are simple to verify. Separate behavior-preserving refactoring from new behavior; a small obvious rename may stay with a change when it materially aids review.

When commits are authorized, keep one verified code/durable-documentation slice per commit and make the first line an imperative, standalone summary. Add why/context and relevant issue, benchmark, or design links in the body. Never put temporary specs, plans, test artifacts, or review notes in a commit. Do not create or publish a commit merely because a review request exists.

## Change descriptions

A version-control change description should stand on its own:

- **First line:** short, imperative, and specific enough to understand from history without the diff (for example, “Delete the legacy task export route”).
- **Body:** what changed and why; include relevant context, decisions, issue/benchmark/design links, and known shortcomings not visible in code.
- **Avoid:** “Fix bug,” “Fix build,” “Add patch,” “Moving code from A to B,” “Phase 1,” or “Add convenience functions.”

Use the repository's own convention and only write a description when a commit is authorized. This history description is not a home for temporary specs, plans, checklists, or review transcripts.

## Review process

### Step 1: Understand the change

Write down what the change is trying to accomplish, the contract/spec it implements, and the observable behavior that should change. Resolve relevant context from the repository instead of asking the user to repeat information available there.

### Step 2: Inspect tests and verification evidence

Review the tests first and perform the safe, focused mutation check above when feasible. Then identify what was actually run: relevant test, build/type check, browser/CLI/manual smoke, performance/security checks, and any screenshot or before/after evidence. Do not report a command or check as passed unless it was observed.

### Step 3: Inspect implementation

Walk every changed file through correctness, readability, architecture, security, and performance. Trace important call sites and data flow far enough to confirm the change's contract. Do not review beyond the supplied scope unless a concrete dependency or security issue requires it; state any boundary of the review.

### Step 4: Categorize and order findings

Use a clear severity so the author can distinguish blockers from preferences:

| Label                         | Meaning                                                                   | Expected action                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Critical:**                 | Security exposure, data loss, or broken core behavior; blocks merge.      | Resolve before merge.                                                  |
| No prefix / **Required**      | A material contract or quality issue that must be addressed before merge. | Resolve before merge or explicitly defer with justification and owner. |
| **Optional:** / **Consider:** | A worthwhile improvement that is not required for this change.            | Author decides whether it is in scope.                                 |
| **Nit:**                      | Minor, optional style preference.                                         | May be ignored.                                                        |
| **FYI**                       | Informational context only.                                               | No change required.                                                    |

Order findings by leverage: correctness and security first, then structural regressions and missed simplifications, then other concerns. A few high-confidence findings are more useful than a long list of cosmetic nits. Include the affected file/location, observed evidence, consequence, and a concrete remedy. Do not soften a real bug or state a preference as a blocker.

### Step 5: Verify the verification

Check whether the evidence supports the author's claim:

- What focused tests and broader checks were actually run, with what result?
- Did a build/type check complete when relevant?
- Was the changed user path manually exercised where tests do not cover it?
- For browser/UI changes, is there visual evidence? Use [browser-testing-with-devtools](../browser-testing-with-devtools/SKILL.md) to verify the actual page; do not assume a Chrome MCP tool.
- For performance claims, are measurements comparable and relevant?
- What was not run, and why?

A missing check is a finding only when it leaves a material risk unverified. State the risk rather than making a blanket requirement for every test/build/tool in every repository.

## Multi-model perspectives

A separate model or reviewer can provide a different perspective, but only if the runtime actually offers an independent context. A generic fresh-context reviewer is sufficient; no named persona is required. The model that authored a change can address findings, and the human retains the final decision. For an in-flight non-trivial decision, follow [doubt-driven-development](../doubt-driven-development/SKILL.md), which requires offering a cross-model choice each interactive cycle and separate explicit authorization for each external CLI invocation. Do not assume that a review request authorizes external sharing or an external tool call.

```text
Authoring context: supplies the smallest useful diff + contract
        ↓
Independent reviewer: returns evidence-based findings
        ↓
Authoring context: reconciles and addresses authorized feedback
        ↓
Human: decides whether the change is ready to merge
```

Portable review prompt shape:

```text
Review this ARTIFACT against the CONTRACT. Inspect correctness, security,
architecture, and adherence to the repository's conventions. Flag only issues
that matter under this contract. Label findings Critical, Required, Optional,
or Nit, and give the affected location, evidence, impact, and a concrete remedy.
If no material issue is found, state what you inspected and any limits.

ARTIFACT:
<diff or focused code>

CONTRACT:
<request, expected behavior, and constraints>
```

## Dead-code hygiene and review scope

Look for unreachable code, unused imports, stale comments, redundant wrappers, and obsolete compatibility paths. Verify call sites and any public/extension contract before calling something dead. In review-only mode, report a well-supported cleanup recommendation; do not silently edit, delete, or publish code. If the user authorized implementation and cleanup is in scope, remove proven dead weight as part of the focused change. Ask for a decision only when a compatibility contract or ownership cannot be established from the repository.

## Dependency discipline

Prefer the standard library and existing project utilities over a new dependency. Before recommending a dependency, check whether the existing stack solves the need, the project's installation boundary and dependency graph, maintenance/provenance, license, security status, and material size/runtime cost. Use the actual package manager and security tooling discovered from the repository—never assume a particular ecosystem command.

For an upgrade, read the actual changelog/migration notes, especially for major changes. Isolate upgrades by dependency or small related group so failures can be attributed and reverted. Review the lockfile diff generated by the manager; never hand-edit a lockfile or accept an unexplained rewrite. Verify before and after with the project's relevant tests. If behavior coverage is inadequate, identify that gap. For vulnerability/supply-chain findings, use the [security checklist](../../references/security-checklist.md) and authoritative package-manager documentation; an audit report alone is not the complete verdict.

## Review pace

Respond promptly enough to unblock the author; the outer bound is one business day, not a target to wait for. For a typical change, early findings allow focused follow-up rounds in the same day. Prioritize a fast, precise first response over an unnecessarily delayed blanket approval. Ask to split a change that cannot be reviewed adequately as one unit rather than letting size stall the queue.

## Handling disagreement and author response

Resolve disagreement in this order:

1. Technical evidence and the written contract override opinion.
2. Project style guides govern style matters.
3. Evaluate design on depth, locality, testability, and overall complexity, not personal preference.
4. Codebase consistency is valuable unless it degrades system health.

Do not accept “I'll clean it up later” as resolution of a required issue. If a correction is explicitly out of scope or an emergency trade-off is accepted, state the remaining risk and the authorized follow-up owner/path. When the author has relevant context, reconsider the finding; defer to evidence, not status. Comment on the code and its effects, never the person. The review itself does not implement feedback or authorize a merge.

## Honesty in review

- Do not rubber-stamp: explain what was inspected and what evidence supports the verdict.
- Do not minimize a production-impacting defect as a vague concern.
- Quantify impact when measurements support it; otherwise distinguish estimate from observation.
- Push back on a clearly harmful approach and propose a viable alternative.
- Accept a well-supported correction or user override without turning a technical disagreement personal.

## Common rationalizations

| Rationalization                          | Reality                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| “It works, so it's good enough.”         | Working code can still be unreadable, insecure, or architecturally harmful.                                      |
| “I wrote it, so I know it is correct.”   | Authors share their own assumptions; verify against the contract and tests.                                      |
| “We'll clean it up later.”               | Deferred cleanup commonly persists; resolve material issues before merge or state an explicit accepted deferral. |
| “AI-generated code is probably fine.”    | Plausible output still needs evidence across the five review axes.                                               |
| “The tests pass, so the change is good.” | Tests do not establish security, design, performance, or every user-visible behavior.                            |
| “The refactor is cleaner.”               | Moving complexity is not removing it; prefer the version where branches/concepts disappear.                      |
| “It's a small addition to this file.”    | Judge the resulting file and control flow, not only the diff size.                                               |
| “It's just a version bump.”              | An upgrade can change behavior; inspect release notes and lockfile changes.                                      |
| “I'll upgrade everything in one change.” | Bulk upgrades obscure regressions and make attribution/revert harder.                                            |

## Red flags

- A change is merged without an independent review.
- Review checks only whether tests pass.
- “LGTM” appears without evidence of inspection.
- Security-sensitive changes have no security-focused reasoning.
- A change is too large to inspect adequately and was not split.
- A bug fix lacks a meaningful regression guard or explanation for its absence.
- Findings have no severity or mix cosmetic preferences with blockers.
- A refactor relocates complexity instead of reducing it.
- A change materially grows an already-large file without considering decomposition.
- New conditionals spread through unrelated flows, duplicate a canonical helper, or put feature logic in a shared module.
- A silent fallback obscures an unclear invariant.
- A bulk dependency bump has no release-note review or attributable verification.
- A lockfile was hand-edited, rewritten without explanation, or not reviewed.
- The reviewer claimed a test/build/browser check passed without exercising it.

## Review report template

```markdown
## Review: [change title]

### Context

- [ ] I understand the request and expected behavior.

### Correctness

- [ ] Contract, important edges, and error paths checked.
- [ ] Tests exercise behavior and meaningful regressions.

### Readability and architecture

- [ ] Names/control flow fit local conventions.
- [ ] Module interfaces/seams are appropriate; complexity is reduced, not relocated.

### Security and performance

- [ ] Changed data flows and authorization were checked.
- [ ] Performance claims/findings are evidence-based.

### Verification

- [ ] Exact relevant tests/build/smoke checks and results are stated.
- [ ] Browser changes include inspected visual evidence where applicable.
- [ ] Unrun checks and review limits are explicit.

### Verdict

- [ ] **Approve** — evidence supports merge.
- [ ] **Request changes** — named material issues remain.
- [ ] **Needs context** — contract/evidence is insufficient to decide.
```

## Final checklist

Before closing a review, ensure:

- [ ] All Critical issues are resolved before merge.
- [ ] Required findings are resolved or explicitly deferred with justification and ownership.
- [ ] Optional/Nit/FYI findings are clearly distinguished from blockers.
- [ ] Focused tests and relevant build/manual evidence are reported accurately.
- [ ] Dependency upgrades, if any, have changelog, package-manager, lockfile, and test evidence.
- [ ] The result identifies review scope, residual risks, and what was not verified.
- [ ] No code, durable documentation, commit, or publication was changed/created without authorization.

**Presumptive structural blockers:** surface and propose a simpler design first; classify as Required only when the change actively worsens structure, such as relocating rather than reducing complexity, materially growing an already-large file with no decomposition, adding feature logic to a shared module, duplicating a canonical helper, or hiding an unclear invariant behind a silent fallback.

See [shared skill policy](../../references/POLICY.md).
