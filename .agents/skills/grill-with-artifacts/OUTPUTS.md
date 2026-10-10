# Output guidance

Read the selected mode before the engineering interview. Follow existing repository templates and naming conventions for PRDs, issues, and designs. For system documentation, use the structure below unless the user explicitly chooses another. Choose destinations from actual repository context; do not create an entire directory tree upfront.

## Evidence and ownership — every mode

Keep these categories distinct:

- **Current behaviour:** verified against implementation or observed execution. Cite relevant paths, symbols, or commands. A plan is not proof of implementation.
- **Historical intent:** supported by contemporaneous records or the user's recollection. Name the source and flag uncertainty.
- **Present-day choice:** explicitly adopted during this discussion. Advice accepted now is not historical rationale.
- **Unknown:** an unanswered question, contradiction, or unverified claim. Keep it visible; investigate retrievable facts rather than asking the user to guess.

User explanations establish intent, not automatically implementation facts. Check claims against code when relevant. Surface meaningful contradictions without silently choosing a version. An unfamiliar term warrants clarification when it affects the artifact, not a mandatory glossary debate.

For an interview, reach the agreed endpoint, obtain `grilling`'s explicit yes, deliver confirmed understanding, and end that turn before downstream drafting. Apply artifact templates when the user subsequently requests the output. An explicit standalone request to draft from already-established material needs no new interview. A request for advice is an interview turn, even when its eventual output is a PRD or another artifact. Its response consists of facts, alternatives and consequences, requested advice, and the pending choice—not an artifact draft or proposed requirements.

Draft from established material. Show the proposed destination and request review before writing or migrating files, posting issues, or publishing documents. Explicit permission to write a settled artifact is sufficient; unresolved content must remain labelled rather than filled with invented answers. An interview does not authorize code changes.

AI idea briefs, specs, plans, and execution checklists are temporary working material, stored outside the repository in the task's named OS-temporary working directory and never committed. They may cache commands and context for execution. A durable RFC, ADR, product requirement, issue, or current-system document is a separately authorized publication: extract the important proposal, decision, requirement, or implemented knowledge into the repository's maintained format rather than committing the working artifact. Temporary design exploration is not automatically an RFC.

## Quick routing

| User's purpose                          | Mode                 | Usual artifact                                   |
| --------------------------------------- | -------------------- | ------------------------------------------------ |
| Understand or explore                   | Explanation          | In-chat synthesis                                |
| Define a product change                 | PRD                  | Repository's PRD format                          |
| Specify actionable work                 | Issue                | Repository issue template or in-chat issue draft |
| Explain the current system              | System documentation | Relevant document under `docs/`                  |
| Work out an engineering solution        | Design               | Repository's design format                       |
| Propose a change for discussion         | RFC                  | `docs/engineering/rfcs/`                         |
| Preserve a settled significant decision | ADR                  | `docs/engineering/adrs/`                         |

Intent determines the mode, not request size. One session has one primary output. Related artifacts can be linked or parked as later work; do not automatically turn a PRD into an issue backlog, RFC, and ADR.

## Explanation

Give a concise evidence-backed account of the selected topic, the user's clarified understanding, limitations, and unresolved questions. No file is required. If the user needs an explanation before deciding, teach the relevant facts and consequences rather than inventing a decision for them.

## PRD

Define the product need, not an implementation plan. Cover:

- Problem and intended users.
- Goals, non-goals, and key user scenarios.
- Requirements and observable acceptance criteria.
- Success criteria or measures; avoid unsupported numerical targets.
- Constraints, dependencies, and unresolved product decisions.

Use technical detail only where it constrains the product contract. A broad product idea may need several scoped interviews before a complete PRD is possible; keep that distinction explicit.

## Issue

Make the work actionable without silently enlarging it:

- Problem, desired behaviour, and relevant evidence.
- Reproduction and actual versus expected behaviour for a bug, when known.
- In-scope and out-of-scope work.
- Observable acceptance criteria and verification expectations.
- Dependencies, constraints, and unresolved blockers.

Inspect available issue templates. If no template exists, use these headings in an in-chat draft; do not invent a repository convention. Posting an issue requires user authorization. A known blocker is not a completed acceptance criterion.

## System documentation

Organize by reader question, not by implementation file:

```text
README.md                 What is this, and how do I try it?
docs/
  CONTEXT.md              Why are the documents organized this way?
  product/                What does the product/result mean? What are its limits?
  engineering/
    <document-name>.md    How does the implemented system work now?
    adrs/<adr-name>.md    What significant decisions were made, and why?
    ops/                  How do I run, deploy, diagnose, and recover it?
    rfcs/                 What engineering changes are proposed for discussion?

OS temporary directory    AI idea briefs, specs, plans, and execution checklists; never committed
```

Read [docs/CONTEXT.md](../../../docs/CONTEXT.md) before choosing destinations. In this repository, current-system explanations use `docs/engineering/<document-name>.md`; settled decision records use `docs/engineering/adrs/<adr-name>.md`; development, deployment, release, and recovery procedures use `docs/engineering/ops/<document-name>.md`. Engineering is the technical umbrella: explain current contracts in direct documents, preserve decision history in ADRs, and maintain executable procedures in ops, linked rather than duplicated. Use descriptive filenames consistent with the existing documents. Folder organization is explained in `docs/CONTEXT.md`, not a second documentation README.

Inspect relevant existing docs and notes before drafting. Classify sections, not only files: a document can mix current instructions, old plans, and useful rationale. Present source, status (current, superseded, mixed, or unverified), and proposed destination for material affected by the session. Do not inventory the whole repository for a narrowly scoped topic.

Document behaviour, rationale where supported, limitations, and open questions. Create only useful documents. README remains an introduction and quick start, not a duplicate architecture manual. ADRs and RFCs preserve historical decisions and proposals; all other published documentation is living guidance updated as behavior and procedures change. Do not append obsolete commands or investigation logs to current-system or operations documents.

Migrate only after replacement content is approved. Update affected links and remove competing current guidance. Retain context needed to understand current decisions in the relevant documents, labelled as historical where appropriate; delete retired reports and redundant execution material. Git preserves their history; do not create an archive copy. Keep AI working artifacts in the task's OS-temporary directory outside the repository; never commit them. Extract proposals needing durable review into `docs/engineering/rfcs/`, leaving execution checklists temporary. Implementation problems discovered during documentation are findings, not permission to fix code.

## Design

Describe the selected engineering solution: problem, goals and non-goals, current constraints, relevant interfaces or data flow, alternatives and trade-offs, failure behaviour, verification, and unresolved decisions. Match the level of detail to the topic. A design is proposed behaviour until implementation evidence establishes otherwise. Do not start implementing it as a consequence of completing the interview.

## RFC

Use `docs/engineering/rfcs/` for proposals. Follow existing numbering; otherwise use `0001-short-proposal-title.md` and continue the sequence.

Include status, motivation, goals and non-goals, proposed design, alternatives, trade-offs and risks, rollout or compatibility considerations where relevant, and open questions. Status progresses from draft to discussion and then accepted, rejected, or withdrawn through explicit decisions.

Acceptance establishes agreement, not shipment. Keep rejected and withdrawn RFCs here with their status. Link resulting ADRs or current system docs when relevant, without automatically creating them.

## ADR

Use `docs/engineering/adrs/` for settled decisions worth preserving. Every expensive-to-reverse decision warrants a record, even when obvious; significant non-obvious choices and hidden constraints can also qualify. Follow `domain-modeling`'s decision-record guidance. Otherwise record the conclusion in the primary artifact.

Use descriptive filenames matching the existing repository convention, such as `evidence-cache-lifetimes.md`; do not introduce numbering alongside the existing unnumbered records. Include status, context, decision, considered alternatives, consequences, and evidence or related links. State whether rationale is historical or a present-day explanation when that distinction matters. If the original reason is unknown, say so.

An undecided proposal belongs in an RFC or design, not an accepted ADR. Keep superseded ADRs here, mark their status, and link the replacement. Current engineering documents describe the implemented system; an ADR preserves the decision even when the system later changes.

## Examples

- “Help me understand what a comparison establishes” → explanation; documentation only if requested. Verified evidence collection does not justify claiming compatibility.
- “Define who needs comparison history and why” → PRD; do not turn the interview into a database-schema design.
- “Propose changing the worker coordination model” → RFC; accepted does not mean implemented.
- “Record why we chose queue-based coordination yesterday” → ADR if the trade-off is significant; cite the user's account rather than claiming code proves their motivation.
