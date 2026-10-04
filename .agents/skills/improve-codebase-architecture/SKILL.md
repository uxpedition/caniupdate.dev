---
name: improve-codebase-architecture
description: Use when the user wants an architecture review, help finding shallow modules, or opportunities to improve codebase testability and navigability.
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Required composition

Load `codebase-design` through the runtime's skill mechanism for **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**, and the deletion test. Do not assume a tool literally named `Skill` exists.

Use the project's domain glossary for domain names. If `GLOSSARY-MAP.md` exists, use it to locate the relevant context. Read repository documentation conventions and relevant ADRs before assessing candidates; here, `docs/CONTEXT.md` places ADRs under `docs/engineering/adrs/`.

After candidate selection, load `grill-with-artifacts`. It owns scope, interviewing, recommendations during the interview, completion, and artifact publication. `codebase-design` supplies design techniques; load `domain-modeling` when domain terms or decisions need sharpening. These supporting disciplines do not replace the wrapper's session contract.

## Process

### 1. Explore

**Scope before you scan: YAGNI.** Deepening pays off by making future changes easier. Put extra weight on areas that have recently changed:

- If the user named a module, subsystem, or pain point, use that scope.
- Otherwise, walk back a good stretch of commit history (`git log --oneline`) to find hot spots. If changes are scattered, widen the net.

Read the relevant glossary and ADRs first. Inspect enough code to establish the scope, then delegate exploration only when the runtime and task warrant it. Explore organically:

- Where does understanding one concept require bouncing between many small modules?
- Which modules are **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted for testability, while real bugs hide in how they are called (poor **locality**)?
- Where do tightly coupled modules leak across their seams?
- Which modules are untested or hard to test through their current interface?

Apply the **deletion test**: if deleting a module makes complexity vanish, it may be a pass-through; if complexity reappears across callers, it earns its keep. Deepening should concentrate meaningful behaviour, not merely reduce file count.

### 2. Present candidates in Markdown with Mermaid

Present the review directly in the conversation, using [REPORT.md](REPORT.md). Paseo renders fenced `mermaid` diagrams; no report file, browser launch, HTML, CSS, SVG, or CDN is needed.

For each numbered candidate include:

- **Files**: involved paths and modules.
- **Problem**: verified friction, with evidence; distinguish unknowns from observations.
- **Solution**: the proposed deepening in plain English, not a detailed interface yet.
- **Benefits**: gains in locality, leverage, and testing through the interface.
- **Before / After**: separate labeled Mermaid diagrams showing current and proposed structure.
- **Recommendation strength**: `Strong`, `Worth exploring`, or `Speculative`.
- **ADR conflict**, when applicable: identify the record and why observed friction warrants revisiting it. Do not list every theoretical refactor an ADR forbids.

Use domain names from the glossary and architectural vocabulary from `codebase-design`. Diagram shape illustrates structure, not quantitative depth.

End with **Top recommendation**: which candidate to explore first and why. Requesting an architecture review authorizes this candidate assessment; it does not authorize selecting an interface later.

Do not propose detailed interfaces yet. Ask: "Which of these would you like to explore?" If the user has already selected a candidate, carry that selection forward without asking again.

### 3. Hand off the selected candidate

Load `grill-with-artifacts` and its selected output guidance. Carry forward the candidate, evidence, glossary terms, ADR constraints, and unknowns into a brief:

- **Topic**: the selected deepening question.
- **Output**: usually explanation or design, following user intent; not automatically an RFC or ADR.
- **Boundary**: included concerns and explicitly deferred work.
- **Endpoint**: enough understanding or decisions to produce that output; selecting a winner is not always required.

Present the brief for confirmation unless the user's explicit brief already confirms it. Ask one focused question at a time in dependency order. Investigate facts yourself; recommendations during the interview require the user's request for advice. Complete the agreed slice, not every possible branch.

Use supporting skills within that brief:

- **New or sharper domain term?** Load `domain-modeling`, capture the resolved wording in the conversation, and propose a glossary edit for review. Write only with authorization.
- **Load-bearing reason for rejecting a candidate?** Offer an ADR only when the choice is hard to reverse, surprising without context, and involves a real trade-off. Skip ephemeral deferrals and self-evident reasons.
- **Alternative interfaces requested?** Use `codebase-design`'s `DESIGN-IT-TWICE.md` within the confirmed scope. Compare depth, locality, leverage, and seam placement; recommend only if asked.

At the endpoint, draft the selected output from established conclusions and visible unknowns. Get review before writing or publishing unless explicitly authorized already. Exploration and accepted advice do not authorize implementation, glossary writes, ADR publication, or unrelated migrations.

## Common mistakes

- Treating a file merge as proof of greater depth.
- Recommending an interface before its constraints are established.
- Restarting scope discovery after the user supplied a clear brief.
- Publishing artifacts because a decision or term was settled.
- Creating a second ADR directory instead of following repository conventions.
