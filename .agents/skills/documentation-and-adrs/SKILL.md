---
name: documentation-and-adrs
description: Write or revise documentation, GitLab/glab issues, and other issue-tracker content. Use for public contract changes, consequential decisions, or docs that no longer match verified behavior.
---

# Documentation and ADRs

## Overview

Document decisions and durable knowledge, not just code. The highest-value records explain why a choice was made, which constraints mattered, what was not chosen, and what future change would invalidate it. Code shows what the implementation does; maintained documentation explains current contracts, operating procedures, and decision context that code alone does not preserve.

## When to use

- Making a significant technical, data, deployment, security, or operational decision
- Making a choice that would be expensive to reverse
- Adding or changing a public API or user-visible behavior
- Shipping a feature whose setup, limits, or operation future users need to know
- Changing current system behavior, support policy, or recovery procedure
- Repeatedly explaining a constraint or known gotcha to contributors or agents
- Writing or revising issue titles and descriptions, including through glab

**When not to use:** Do not write comments or documents that merely restate obvious code. Do not publish an exploratory prototype, unapproved decision, or temporary execution plan as maintained documentation.

## Plain language, including issues

Write for the human reader, even when an AI agent will implement the work. Use familiar words, short sentences, and one main idea per paragraph. Explain necessary technical terms on first use; preserve exact API names, commands, and safety constraints where they matter.

For issues, including GitLab issues created or edited through glab:
- Give the title a concrete action and outcome: “Decide whether to add usage measurement,” rather than “Review aggregate comparison-outcome instrumentation.”
- Lead with why the work matters in one or two plain sentences.
- State what to do and observable completion criteria. Use “Why,” “What to do” (or “What to decide”), and “Done when” when no required template exists.
- State timing and real dependencies separately. Distinguish a prerequisite to start work, a requirement before release, and optional work after launch.
- For decision issues, name the choices and current recommendation. Distinguish choosing an approach from authorizing implementation, data collection, or deployment.
- Put necessary technical detail below the plain-language explanation. Include only constraints that affect correctness, safety, scope, or verification; link to existing procedures instead of repeating boilerplate.

Before publishing, read the title and opening as someone unfamiliar with the plan. They must explain what is wanted and why without another ELI5 explanation. Check the remaining text tells that reader what action to take, how to recognize completion, and whether anything is actually blocked. Simplify wording without dropping requirements or changing issue state.

## Process

### 1. Discover the repository's documentation model

Before choosing a destination, inspect project instructions, the documentation index/map, existing ADRs/runbooks, naming and numbering patterns, related product/API docs, and documentation-specific tooling or configuration. Follow the existing location, format, heading set, status vocabulary, and links. Do not create a second ADR folder, numbering scheme, glossary, or runbook convention. If the evidence conflicts, surface the conflict instead of silently imposing a new structure.

Separate documents by the reader's question:

| Document kind                      | Reader's question                                                  | Maintenance rule                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| README / getting started           | What is this and how can I try or contribute?                      | Keep an accurate entry point and quick start; derive commands from the current project.                         |
| Current-system documentation       | How does the implemented system work now?                          | Update behavior, ownership, contracts, and failure boundaries when implementation changes.                      |
| ADR (Architecture Decision Record) | What significant choice was made, why, and with what consequences? | Preserve rationale; mark changed decisions superseded rather than rewriting history.                            |
| Issue / merge request              | What change is proposed, and what is still undecided?              | Discuss options in issues; review implementation and verification in merge requests. Agreement is not shipment. |
| Operations/runbook                 | How do I operate, diagnose, deploy, or recover safely?             | Keep prerequisites and commands current; distinguish implemented capability from policy or proposal.            |
| API/user documentation             | What contract or behavior can a consumer rely on?                  | Describe the public contract and examples accurately; update with the implementation.                           |
| Glossary/domain record             | What does a domain term mean here?                                 | Use `domain-modeling`; keep definitions separate from code-level implementation decisions.                      |

Current-system documents and ADRs serve different needs. A current-system document explains how the code works now; its ADR preserves why that design was selected. Link them instead of duplicating a full contract in both.

In this repository, proposals belong in issues and merge requests, not separate proposal documents. After a consequential choice, preserve its reasoning in an ADR and link the discussion when available. Publishing an issue or merge request still requires authorization; an in-chat draft is sufficient until then.

### 2. Separate temporary work from durable knowledge

AI-generated idea briefs, specifications, plans, task checklists, and design-execution material are temporary work products, not repository documentation. Before making one, read the working-set policy in [`../../references/POLICY.md`](../../references/POLICY.md). Keep them under the explicit named `workDir` in the operating system's temporary area, outside the repository; use the exact absolute path provided for this work and propagate it between skills and sessions. Do not guess an active specification or create a repository-local scratch file. A temporary specification may cache executable commands and verified context to avoid rediscovery, but remains outside version control.

Publish only durable, authorized material: requirements/contracts that govern future quality, a significant decision, current system behavior, or an operational procedure. Package scripts and owning tool configuration define executable quality gates. Document rationale and operations without duplicating discoverable commands or thresholds. Surface discrepancies and keep current-system docs consistent with execution; approved requirements not yet enforced are implementation gaps.

Discussion, an interview, a draft plan, an ADR proposal, or a green check is not authorization to implement, write durable docs, publish, or deploy. Follow the repository's authorization process; make proposed edits and their destination reviewable before writing unless that exact work is already authorized. When content includes external factual claims, add an inline link to the relevant official or primary source beside the claim; distinguish sourced facts, verified local behavior, adopted decisions, historical recollection, inference, and unknowns. Never cite a URL or present a claim as verified when it was not checked.

### 3. Decide whether an ADR is warranted

An ADR is the record of a consequential choice and its reasoning. **A meaningful cost of reversing a decision is sufficient on its own to warrant an ADR.** Do not require the decision to be surprising and a three-way trade-off at the same time. Decisions about foundational dependencies, data models and migration strategy, authentication, public contracts, deployment topology, durable ownership, or security boundaries often qualify because changing them later has substantial cost, risk, or migration impact.

Also consider an ADR when several credible options were compared and the rationale will help future maintainers avoid re-deciding. Avoid an ADR for routine local implementation detail, a temporary experiment, or a choice whose cost and consequences are genuinely trivial. The threshold here governs durable decision records; use `domain-modeling` to clarify domain terms and `codebase-design` vocabulary for module/interface/seam decisions. Use `grilling` when the user asks for an interview or stress test; this documentation skill does not conduct an interview or choose on the user's behalf.

### 4. Match the existing ADR convention

Inspect existing ADRs, project instructions, and ADR tooling (such as an ADR-directory setting) before writing. An established convention overrides any template below. Match:

- **Location and format:** directory, extension, markup, and any required frontmatter.
- **Numbering and naming:** continue the current sequence and filename pattern; do not restart numbering or add a second scheme.
- **Headings and status:** reuse the repository's section names and status lifecycle.
- **Links:** update the documentation map and incoming/outgoing links where that convention expects it.

If no convention exists, agree on a durable destination and format before writing. Do not assume a generic `docs/decisions/` path when the repository may already have a different model.

### 5. Write an ADR that future readers can evaluate

Record the context and constraints that made a choice necessary, the decision actually adopted, and the material consequences. Distinguish a proposal from an accepted decision; never invent a decision date, user consent, measured outcome, or implementation status. Alternatives are useful when they were genuinely considered, but do not fabricate a balanced comparison to fill a template. Link the implemented behavior's maintained document and relevant primary sources.

Illustrative template only; adapt it to the repository's existing format:

```markdown
# <Existing identifier and concise decision title>

## Status

Proposed | Accepted | Superseded by <identifier> | Deprecated

## Context

State the need, constraints, affected consumers, verified current behavior,
important unknowns, and why the choice matters.

## Decision

State the authorized choice precisely. Separate it from any unapproved follow-up.

## Alternatives considered

For each alternative actually considered, record relevant benefits,
constraints, and why it was or was not selected.

## Consequences

Record benefits, costs, operational/security implications, migration work,
new constraints, and evidence needed to revisit the decision.
```

The normal lifecycle is `Proposed → Accepted → Superseded` or `Deprecated`, but follow the local status model. Do not delete an accepted ADR just because the system changes: update its status, link the replacement, and preserve the historical reasoning. The ADR describes the decision at the time it was made; it is not proof the decision remains good or that the implementation shipped.

### 6. Document code intent, public APIs, and current behavior

#### Comments and known gotchas

Comments explain **why**, constraints, ordering, or a non-obvious invariant—not what the next line already says.

```typescript
// Weak: repeats the expression
// Increment the counter.
counter += 1;

// Useful: records the correctness constraint
// Reset at the sliding-window boundary; a fixed clock reset permits a burst
// that straddles the boundary.
if (now - windowStart > WINDOW_SIZE_MS) {
  counter = 0;
  windowStart = now;
}
```

Put a durable gotcha beside the code it constrains and link to the existing decision record when helpful. Delete commented-out code; history already records it. Resolve a TODO that is part of the current task rather than adding an unowned promise. Keep future work in an authorized issue or temporary `workDir` artifact, not in code comments masquerading as a plan.

#### Public API documentation

For public interfaces, explain parameter meaning and limits, return value, errors, authorization requirements, compatibility, and examples. Prefer documentation attached to the type or interface when that is the repository's convention:

```typescript
/**
 * Creates a resource for the authorized caller.
 *
 * @param input - Validated creation data; title is required and limited to 200 characters.
 * @returns The created resource with its server-assigned identity.
 * @throws ValidationError for invalid input; AuthorizationError if the caller
 *   cannot create a resource in the selected scope.
 *
 * @example
 * const item = await createResource({ title: 'Example' });
 */
export async function createResource(input: CreateResourceInput): Promise<Resource> {
  // ...
}
```

For HTTP APIs, maintain the repository's OpenAPI/GraphQL/other contract source instead of creating a competing hand-written copy. Example OpenAPI shape:

```yaml
paths:
  /api/resources:
    post:
      summary: Create a resource
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateResourceInput'
      responses:
        '201':
          description: Resource created
        '422':
          description: Validation error
```

Do not document a contract that code or tests do not establish. Keep internal errors and credentials private; public examples use fake values and sanitized error shapes.

#### README and setup information

A useful README helps a reader understand the project, start it, and find its detailed architecture and contribution guidance. Follow the existing structure and avoid duplicating longer maintained docs. A common outline is:

```markdown
# Project Name

What this project does and who it serves.

## Quick start

Prerequisites and the verified setup/run steps.

## Commands

Commands discovered from the current manifest and project instructions.

## Architecture

Short overview with links to maintained system and decision documents.

## Contributing

Link to current contributor and verification procedures.
```

Discover the package manager, runtime versions, scripts, service requirements, and commands from project configuration; do not paste generic `npm install`, `.env`, framework, or test-runner instructions into a different project. Keep credentials out of README examples. If setup has sensitive or environment-specific steps, link to the authorized operations procedure rather than publishing private runtime/provider details.

#### Changelog

For a consumer-facing release, maintain the existing changelog convention. A useful entry describes the impact, not internal mechanics, and groups changes as the project's format expects (often Added, Changed, Fixed, Deprecated, Removed, Security). Update entries with the behavior change while its impact is known; the raw commit log is not a substitute. A versioned entry should match the release identity and migration notes.

### 7. Update agent instructions without duplicating environment truth

Project agent instructions, skill pointers, and rules are documentation too. State durable conventions, ownership, boundaries, and high-value gotchas; point to existing detailed docs when only some tasks need them. Keep temporary work plans outside the repository. Use `writing-for-agents` when creating or editing agent-facing documents, and keep pointers sharp about the branches that require their target.

Do not cache facts that are cheap to discover from one authoritative file—such as current package scripts, a version, or a file listing—unless the lookup is expensive or the repository has an unwritten convention worth preserving. Update stale links and instructions when behavior changes; do not add a second prose rule where existing deterministic tooling already owns the policy.

## Common rationalizations

| Rationalization                                   | Reality                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| “The code is self-documenting.”                   | Code shows behavior, not all rationale, constraints, rejected options, or operator consequences.                          |
| “We will write the docs when the API stabilizes.” | Writing the contract exposes gaps while they are still cheap to resolve.                                                  |
| “Nobody reads docs.”                              | Consumers, maintainers, operators, and agents rely on accurate guidance.                                                  |
| “ADRs are overhead.”                              | A concise rationale prevents future archaeology and costly re-decision, especially for hard-to-reverse choices.           |
| “Comments become stale.”                          | Explain stable reasons and invariants; update them when those reasons change.                                             |
| “The generated plan is useful, so commit it.”     | Temporary AI execution material belongs in the external named work directory; repository docs are durable and authorized. |
| “The check script passed, so the policy changed.” | A green run does not authorize weaker rules; review changes in owning tool configuration and keep docs consistent.        |

## Red flags

- Expensive-to-reverse decisions with no durable rationale
- A draft or proposed decision written as though it were approved or implemented
- A second ADR location, numbering scheme, glossary, or current-system manual
- A README with unverified setup commands or secrets in examples
- Public interfaces with no discoverable contract or compatibility notes
- Comments that narrate obvious code, commented-out implementation, or stale TODOs
- A current-system doc that describes an old implementation or an ADR that duplicates the full current contract
- AI-generated ideas/specs/plans/checklists committed as documentation or indexed by maintained docs
- Quality-gate documentation contradicting package scripts or tool configuration
- External factual claims without inline primary-source citations, or unknown behavior presented as verified

## Verification

After documentation work:

- [ ] Repository instructions and documentation map were checked; each file uses the existing location, format, naming, and status convention.
- [ ] Hard-to-reverse choices have an ADR regardless of whether they are surprising or fit a multi-option trade-off story.
- [ ] Proposed, accepted, superseded, and implemented states are accurate and distinct; no decision or date was invented.
- [ ] Current-system docs match observed code/operations; ADRs preserve rationale without duplicating the whole contract.
- [ ] Public API docs, examples, setup commands, error behavior, and links match the current implementation and project tooling.
- [ ] Comments explain reasons/invariants; dead code and stale comments were removed where in scope.
- [ ] Inline official/primary-source citations support external claims, and private configuration/credentials/data remain private.
- [ ] Temporary AI work stays in the explicitly named external `workDir`; only authorized durable documentation is in the repository.
- [ ] Quality-gate documentation matches package scripts and owning tool configuration without establishing a second source of truth.
