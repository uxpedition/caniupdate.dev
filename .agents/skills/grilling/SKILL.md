---
name: grilling
description: Interview the user about ambiguous intent or stress-test a plan, decision, or idea. Use for interview/grill requests, missing audience or success criteria, conflicting goals, or unchecked assumptions before planning.
---

# Grilling

Extract what the user actually wants and stress-test decisions until you reach a shared understanding. A conventional request ("build a dashboard") is not evidence that the named solution solves the user's problem. This skill includes intent discovery; there is no separate interviewing skill.

## Scope and composition

Use for underspecified outcomes, competing values, or explicit interview/grill requests. Skip mechanical changes and self-contained information requests. An explicit request to stress-test a clear plan still needs its decision tree, not a redundant intent-discovery interview.

This needs a live user. In CI, scheduled work, or autonomous runs, surface missing intent as a blocker instead of inventing it. Runtime permissions and delegation rules still govern tools.

When composed with `grill-with-artifacts`, that wrapper bounds the topic and output, controls engineering recommendations, and authorizes publication. It retains the dependency-ready rounds and explicit-confirmation gate below; it does not turn independent questions into separate turns.

## Establish intent

Before substantive questions, state your best read in one sentence with an honest confidence number. Below approximately 70%, name what is missing:

```text
HYPOTHESIS: You need to see whether this week's work is on track; a dashboard may not be the actual requirement.
CONFIDENCE: ~40% — missing: audience, decisions this should support, and success criteria.
```

Surface assumptions rather than silently turning them into facts. Probe who benefits, why now, the desired outcome, success, binding constraints, and exclusions. Use existing context instead of asking the user to repeat settled facts.

For vague goals such as "scalable", "modern", or "the standard approach", ask what concrete outcome matters. When the answer sounds like what the user _should_ want, ask: "If you didn't have to justify this to anyone, what would you actually want?"

## Work the decision tree in rounds

Map decisions as a **design tree**. The **frontier** contains decisions whose prerequisites are settled: questions you can ask now without guessing earlier answers. Ask the whole relevant frontier together; wait for answers before expanding it. A question depending on another open question belongs in a later round.

Attach a best guess with its reasoning to intent questions. For standalone design grilling, give a recommended answer. A hypothesis about intent is not an adopted engineering decision. Be visibly willing to be wrong; don't let polite agreement disguise uncertainty. Under `grill-with-artifacts`, follow its recommendation policy while still exposing your intent hypotheses.

```text
❓ Q1 — Audience: Who needs this result?
➡️ GUESS: You personally, because you described checking the same packages repeatedly.

❓ Q2 — Deadline: Is there a release date this must support?
➡️ GUESS: No fixed date; you have not mentioned a release constraint.
```

Questions about team permissions wait until Q1 establishes whether a team is involved. Independent deadline questions need not wait.

Finding **facts** is your job; **decisions** are the user's. Investigate filesystem, tools, implementation, and documentation yourself. Delegate only when task and runtime rules warrant it. A running investigation is an unsettled prerequisite: defer its dependent questions, but ask the rest of the frontier now.

After answers, update the hypothesis, confidence, and tree. Approximately 95% confidence means you can predict reactions to the next three questions; it is a readiness check for restatement, not permission to skip explicit confirmation. After several rounds without increasing understanding, explain what is still missing and offer to reframe instead of grinding indefinitely.

Example: "a dashboard for our metrics" may become "a personal list of experiments" once the user explains that missing inventory, not missing charts, is the problem. Preserve the corrected outcome rather than the initially named solution.

## Confirm shared understanding

When the scoped frontier is empty, restate in the user's language:

- **Outcome:** what they actually want.
- **User:** who benefits.
- **Why now:** the reason this matters now.
- **Decisions:** the relevant adopted choices.
- **Success:** observable completion criteria.
- **Constraints:** the binding limits.
- **Out of scope:** explicit exclusions.

Ask for an explicit **yes** to this concrete restatement. Treat these responses as unresolved confirmation:

- **“Whatever you think is best.”** Delegation is not confirmation. Present concrete alternatives, ask the user to choose, then update the restatement.
- **“Sounds good” or “Sure, let’s go.”** Ask whether anything needs refining and request an explicit yes.
- **Silence or “Okay, let’s start” without confirmation.** Ask whether anything was missed; keep confirmation pending.

Fold corrections into the restatement and re-confirm. Completion requires the relevant frontier to be empty and an explicit yes to the concrete restatement, not a vague assent to an uncheckable summary.

Deliver the confirmed statement of intent and offer appropriate next paths: `idea-refine`, `spec-driven-development`, or the wrapper's selected output. End the interview turn; do not start downstream work or tools merely because intent was confirmed. Confirmation establishes understanding, not authorization to implement, publish, or write files.

If persistence is requested, keep the intent in the same OS-temporary working directory as the task's idea brief, spec, and plan. These working artifacts are never committed. Durable decisions belong in authorized project documentation, not copied interview transcripts. See [working-set policy](../../references/POLICY.md).

## Verification

- Initial hypothesis and confidence were visible; low confidence named the missing information.
- Independent frontier questions were batched; dependent questions waited.
- Retrievable facts were investigated, not assigned to the user.
- Conventional or aspirational answers were probed when they obscured intent.
- The concrete restatement includes exclusions and adopted decisions, not unaccepted advice.
- Explicit yes was obtained; ambiguous assent and delegation were not treated as confirmation.
- The confirmed output was delivered without automatically starting implementation or publication.
