---
name: grill-with-artifacts
description: Use when the user requests an engineering interview or grilling session about understanding a system, a product change, actionable work, a design, a proposal, or a decision.
disable-model-invocation: true
---

# Grill with Artifacts

Build shared understanding of one engineering topic and produce the output the user needs. Start with scope, not a repository-wide interrogation.

## Required composition

Load `grilling` using the runtime's skill mechanism (or read `../grilling/SKILL.md`), then read [OUTPUTS.md](OUTPUTS.md) for the selected output mode. Before choosing a repository artifact destination, read [docs/CONTEXT.md](../../../docs/CONTEXT.md): current-system documents live directly under `docs/engineering/`, ADRs under `docs/engineering/adrs/`, and development, deployment, release, and recovery procedures under `docs/engineering/ops/`. Invoke skills by loading their instructions; do not assume a tool literally named `Skill` exists.

Use `grilling` for its decision tree, dependency-aware rounds, and separation of retrievable facts from user decisions. **This wrapper replaces its whole-frontier questioning, automatic recommendations, and whole-tree completion rules with the session contract below.** Facts are the agent's work; use available tools and delegate only when the runtime and task warrant it.

## 1. Set the scope

Assess the initial query before substantive engineering questions. A session has one coherent topic, one primary output, and a concrete endpoint. Broadness means multiple independently useful outcomes or unresolved prerequisites, not merely a long query.

If the goal, boundary, or output is unclear, the first round is scope-setting only:

1. State the ambiguity or why the request spans several topics.
2. Propose a small breakdown from available context.
3. Ask the user to select or clarify the slice and output; do not recommend a preferred engineering solution.

Resolve enough ambiguity to select a slice, not every ambiguity in the project. Inspect only context needed for this selection. When the query already supplies a clear scope, use it without a redundant discovery round.

Present a brief for confirmation before substantive interviewing:

- **Topic:** the question this session answers.
- **Output:** explanation, PRD, issue, system documentation, design, RFC, or ADR.
- **Boundary:** included concerns and explicitly deferred topics.
- **Endpoint:** what understanding or decisions make this slice ready to draft.

An explicit user-provided brief counts as confirmation. Output follows user intent, not request size. Explain alternatives when the desired output is unclear.

## 2. Interview within the brief

Ask one focused question at a time, in dependency order. There is no question quota. Number questions if useful, with enough context to answer and neutral alternatives where helpful.

For intent and trade-offs, hear the user's thinking first. **Recommendations are offered only when the user asks for advice or help.** An explanation of verified facts needs no such invitation. If the user does not know, investigate facts or explain consequences; keep undecided choices open. A help response contains the relevant facts, alternatives and consequences, and requested recommendation; the choice remains pending until the user adopts it. Return to that pending choice rather than drafting an artifact from unaccepted advice. Accepting advice now does not establish historical rationale.

Maintain a bounded decision tree: questions must serve the confirmed endpoint. Park independently useful new topics. If an outside dependency genuinely blocks the slice, explain it and obtain agreement on a revised brief instead of expanding silently. Clarify contradictions that affect the output, not every loose phrase.

## 3. Produce the selected output

At the endpoint, summarize established conclusions and unresolved points, then draft according to the selected mode in OUTPUTS.md. Completion is agreement on this slice, not visiting every branch of the original request. Future slices are optional, not an automatic next round.

Get review before writing or publishing artifacts unless explicitly authorized already. The interview does not authorize implementation or unrelated migrations.

## Common mistakes

- Starting technical questions before agreeing on a broad request's slice.
- Attaching recommended answers by habit after loading `grilling`.
- Treating every discovered concern as a required branch.
- Generating all artifact types instead of the selected output.
- Treating a proposal or accepted RFC as current implementation.
