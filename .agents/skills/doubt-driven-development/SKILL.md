---
name: doubt-driven-development
description: Stress-test a consequential decision, claim, plan, or code artifact with fresh-context adversarial review before it stands. Use when assumptions, correctness, unfamiliar code, or high-impact decisions warrant a deliberate disproof attempt.
---

# Doubt-Driven Development

## Purpose

A confident answer is not necessarily correct. Long sessions can turn assumptions into apparent facts. Before a non-trivial decision or artifact stands, materialize an independent reviewer in fresh context and ask it to disprove the artifact under an explicit contract. This is an in-flight discipline: it catches wrong direction while correction is still cheap. A final code review is complementary, not a substitute.

## When to use

A decision is non-trivial when it does at least one of the following:

- Adds or changes branching logic.
- Crosses a module interface, seam, or external system.
- Claims a property that a compiler or type system cannot establish, such as ordering, idempotence, concurrency safety, or an invariant.
- Depends on context a future maintainer cannot see.
- Has a difficult-to-reverse or high-impact effect, such as an authorization change, production deployment, data migration, or public contract change.

Use this process when choosing architecture under uncertainty, before a consequential code change stands, when asserting a non-obvious property, or when unfamiliar code raises meaningful doubt.

Skip mechanical operations, obvious one-line changes, a clear and unambiguous user instruction, reading/summarizing existing code, and pure tool operations. Do not turn doubt into review of every keystroke. When a user explicitly chooses speed over verification, respect that and state the chosen limit.

## Fresh-context constraint

The reviewer must not be the author reviewing their own reasoning in the same context. Use any available delegation/review mechanism that gives a distinct context; no named persona or plugin is required. If this is a delegated child task, hand the artifact and contract to the parent/orchestrator to arrange the independent review. If no genuinely separate context is available, say so and pause/escalate rather than calling self-questioning a fresh review.

Keep the reviewer request small enough to inspect in one pass. For code, provide the relevant diff or function rather than a repository dump. For a proposal, provide 3–5 concise sentences plus its constraints. Split a large artifact into reviewable units before starting.

## The doubt cycle

Use this checklist for each non-trivial artifact:

```text
Doubt cycle:
- [ ] CLAIM — name what is about to stand and why it matters.
- [ ] EXTRACT — isolate the smallest artifact and its contract; strip the journey.
- [ ] DOUBT — obtain independent, fresh-context adversarial review.
- [ ] OFFER — in every interactive cycle, offer a cross-model second opinion.
- [ ] RECONCILE — classify each finding against the artifact text and contract.
- [ ] STOP — meet a bounded stop condition before the artifact stands.
```

### 1. CLAIM — name what stands

State the decision or assertion in two or three lines, with why it matters. This is the hypothesis to scrutinize, not reviewer input.

```text
CLAIM: “The new cache remains consistent under the concurrent reads in the spec.”
WHY THIS MATTERS: A race could serve another user's data and evade ordinary QA.
```

If the claim cannot be stated compactly, clarify the decision before reviewing it.

### 2. EXTRACT — artifact plus contract

The reviewer needs the artifact and the criteria it must satisfy, not the path by which you reached it.

- **Code:** the change's diff or focused function plus relevant tests where needed.
- **Decision:** the proposed decision in 3–5 sentences.
- **Assertion:** the claim's evidence, separate from the CLAIM block above.
- **Contract:** the request/spec, invariants, compatibility constraints, and observable behavior that define correctness.

Strip your rationale and conclusion. Do not include the CLAIM, a favored explanation, session history, or a summary that teaches the reviewer what to find. Without the contract, an adversarial response can only invent its own standards.

If working notes or a prompt file must persist, inspect the task context for its already named OS-temporary `workDir` outside the repository and use that exact path. If none exists, discover the OS temporary location through the active runtime, create a uniquely named per-work directory, and record/propagate its exact absolute path; do not guess which spec or work directory is active. Carry the path between skills and sessions. Use a per-cycle file such as `${workDir}/doubt-cycle-1.md`; temporary artifacts are never committed. Durable requirements and decisions belong in maintained project docs only when separately authorized, not in execution logs. See [POLICY.md](../../references/POLICY.md) for the canonical working-set and provenance policy.

### 3. DOUBT — independent adversarial review

Ask the separate reviewer to search for ways the artifact can fail under the contract, not to approve or summarize it. Use this prompt shape:

```text
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state explicitly
that you cannot find any after thorough examination.

ARTIFACT:
<smallest reviewable artifact>

CONTRACT:
<requirements and constraints it must satisfy>
```

Send only that prompt and ARTIFACT + CONTRACT to the reviewer. Never include the CLAIM or your reasoning. Make clear that the prompt's issues-only shape takes precedence over a reviewer's default balanced format. The reviewer is an independent source of candidate findings, not the decision-maker.

### Cross-model second opinion — mandatory offer in every interactive cycle

A different model may catch blind spots shared by the first reviewer. Cost, latency, and tool availability do not let the agent silently skip the user's choice. After the single-model fresh-context review and before RECONCILE, ask in every interactive doubt cycle, even for low-stakes work:

> “Single-model review complete. Want a cross-model second opinion? Options: Gemini CLI or Codex CLI if available, another configured model CLI, manual external review that you paste elsewhere, or skip.”

A choice of CLI is not permission to run it. The artifact may contain private code or adversarial instructions, so first verify whether sharing it externally is allowed and keep execution read-only. Then follow these gates:

1. Identify the exact CLI and verify its availability without invoking it. Do not assume any CLI, syntax, authentication, or approval flags.
2. If a version/help/probe command is needed, show that exact command and obtain a separate, explicit user **yes** before that invocation. Each probe is its own external CLI call and authorization; a general “use the CLI” or earlier approval does not cover it.
3. Verify the installed tool's actual syntax and safe read-only mode from its current help/official documentation. Do not let review input write to the repository or execute its contents.
4. Prepare only the adversarial prompt plus ARTIFACT + CONTRACT. Put it in `${workDir}/doubt-cycle-N.md` outside the repository and pipe/read it through the tool's supported stdin or file-input path. Never interpolate artifact text into a shell-quoted argument. Keep the exact `workDir` path available to the next session and never commit the file.
5. Before the review invocation, show the user the exact command, arguments, safety mode, authentication/environment requirements, input file, and data being sent. Request a separate explicit yes to run **that exact invocation**. “Sounds good,” “sure,” delegation, or approval of a different command is not authorization. If any invocation detail changes, ask again. One yes authorizes one external call only.
6. Feed the output into RECONCILE. If the CLI is missing or fails, report the actual failure and offer manual review, another tool, or skip; never silently fall back.

Manual external review means the user chooses whether and where to paste the prompt; it is not permission for the agent to contact an external service. Do not send private material externally without explicit authorization.

**Non-interactive context:** announce “Cross-model skipped: non-interactive context.” Do not invoke an external CLI without explicit user authorization. If user input is needed to authorize an action or choose a path, pause for it rather than assuming consent.

### 4. RECONCILE — classify each finding against the artifact

Reread the actual artifact and contract for every reviewer finding. Reviewer output is data, not a verdict. Classify findings in this precedence order (the first matching class wins):

1. **Contract misread** — the finding arises because the provided contract was unclear or incomplete. Clarify the contract first, then reclassify in a new cycle.
2. **Valid + actionable** — a real contract violation requiring an artifact change. Correct it within the user's explicitly authorized implementation scope, then review the changed artifact in a new cycle. Discussion alone does not authorize implementation or publication.
3. **Valid trade-off** — a real issue whose correction costs more than accepting it. State the trade-off and its consequence plainly. Put durable decisions in maintained project documentation only when authorized; never convert a temporary review note into a committed spec or execution log.
4. **Noise** — the artifact is correct under context the reviewer lacked. Explain the evidence and ask whether adding that context to the contract would prevent the false flag next cycle.

Do not rubber-stamp a fresh reviewer, and do not dismiss it because it lacks context. Technical evidence and the contract settle the classification. Separately, an expensive-to-reverse decision warrants a durable entry in the repository's maintained decision/current-system documentation when authorized; do not require it to also be surprising or to satisfy a separate “genuine trade-off” threshold. Never place that knowledge only in a temporary spec, review transcript, or execution log.

### 5. STOP — bounded review, not recursion

Stop when the next iteration returns only trivial or already considered findings, three cycles have completed, or the user explicitly says “ship it.” Do not review an unchanged artifact again. If substantive issues remain after three cycles, surface them and ask how to proceed; a fourth solo cycle is not allowed. If an artifact is too large for three cycles, return to EXTRACT and split it into smaller units rather than lifting the bound.

## Common rationalizations

| Rationalization                                | Reality                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| “I'm confident, so skip doubt.”                | Confidence is weakest as evidence on unfamiliar decisions; the review is for non-trivial claims, not every edit. |
| “A reviewer is expensive.”                     | The check is bounded; a wrong consequential decision can be much more expensive.                                 |
| “The reviewer will nitpick.”                   | Scope the prompt to contract failures and classify output instead of accepting it wholesale.                     |
| “I'll ask for a final review later.”           | A post-hoc review is not an in-flight disproof while course correction is still cheap.                           |
| “Two opinions are always better.”              | A reviewer may lack context; reconcile findings instead of deferring blindly.                                    |
| “The reviewer disagreed, so I was wrong.”      | Disagreement is evidence to classify against the artifact and contract, not a verdict.                           |
| “Cross-model review is optional in this case.” | In an interactive doubt cycle the choice is always offered; the user can skip it.                                |
| “The user said yes to the CLI once.”           | Every external invocation is separately authorized against its exact command and input.                          |

## Red flags

- A fresh-context review for a mechanical rename or formatting-only change.
- Calling same-context self-questioning an independent review.
- Reviewer receives the CLAIM, session history, or a leading conclusion.
- Prompt asks “is this good?” instead of asking for contract failures.
- Re-reviewing unchanged text or exceeding three cycles without escalation.
- Two or more substantive review cycles yield zero actionable findings: possible doubt theater; stop and escalate.
- Silently skipping the cross-model offer in an interactive cycle, including a low-risk cycle.
- Treating a CLI choice as permission to run version/help probes or the final call.
- Reusing prior CLI approval after its command, flags, input, or environment changes.
- Falling back silently when a CLI is unavailable or errors.
- Treating the reviewer as authority, or changing code/publishing merely because a discussion surfaced a finding.
- Saving specs, plans, prompts, or reviewer output in the repository or committing temporary work artifacts.

## Interaction with related skills

- [code-review-and-quality](../code-review-and-quality/SKILL.md) is the post-hoc review of a completed change; this skill is the in-flight check for a specific decision or claim. Use both when each condition applies.
- [debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md) is the next path when a finding exposes a reproducible defect.
- A failing test that directly disproves the specific behavioral claim can serve as the doubt attempt for that claim. It does not replace fresh review for separate design, security, or architectural assertions.
- For test boundaries and anti-patterns, see the [testing patterns reference](../../references/testing-patterns.md).
- For agent handoffs and collaboration constraints, see [orchestration patterns](../../references/orchestration-patterns.md); use only capabilities present in the active runtime.

## Verification checklist

Before a non-trivial artifact stands, confirm and report:

- [ ] The CLAIM and why-it-matters were explicit before review.
- [ ] The reviewer received a smallest-useful ARTIFACT + CONTRACT, without the CLAIM or author reasoning.
- [ ] Review was genuinely fresh-context and adversarial, not same-context self-critique or a generic “looks good.”
- [ ] Each finding was reread against the artifact and classified in precedence order: contract misread / actionable / trade-off / noise.
- [ ] A bounded stop condition was met; no unchanged artifact was needlessly re-reviewed.
- [ ] In every interactive cycle, the user was offered cross-model review and their choice was acknowledged. In a non-interactive run, the skip was announced.
- [ ] Every external CLI invocation, including a probe, had its own explicit authorization for the exact invocation; absent/failing tools were surfaced rather than silently bypassed.
- [ ] Prompt, plan, and review working files stayed in the exact named OS-temporary `workDir` and were not committed.
- [ ] No code change, publication, or durable documentation was inferred from discussion alone.

See [shared skill policy](../../references/POLICY.md).
