# Documentation organization

Start with the question you want answered. Product docs explain what results mean. Engineering docs explain how the system works and how to run it.

| Location                              | Reader's question                              | What to keep here                                                                                                 |
| ------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [README](../README.md)                | What is this product, and what does it show?   | Brief product overview, limits, and links to more detail.                                                         |
| [Contributing](../CONTRIBUTING.md)    | How do I develop and contribute?               | Local setup, contribution guidance, and links to engineering and operations details.                              |
| `docs/product/`                       | What do the product and its results mean?      | Features, limits, and clearly labelled intent.                                                                    |
| `docs/engineering/<document-name>.md` | How does the system work now?                  | Current contracts, flows, ownership, and failure handling.                                                        |
| `docs/engineering/adrs/<adr-name>.md` | What did we choose, and why?                   | Context, tradeoffs, and evidence. If a choice changes, mark the old decision superseded and link its replacement. |
| `docs/engineering/ops/`               | How do I run, deploy, diagnose, or recover it? | Procedures and prerequisites. Separate policy from implemented capability.                                        |

An **ADR** (Architecture Decision Record) explains a decision whose complexity, consequences, or cost of reversal make its reasoning worth preserving. A long discussion is not required. Use descriptive Markdown filenames that match the existing docs.

## Current engineering documents

- [System overview](engineering/overview.md).
- [Evidence collection and storage](engineering/evidence.md).
- [Briefing architecture](engineering/briefing.md).

## Decision records

Read an ADR for the reasons, constraints, and evidence behind a choice:

- [Cache lifetimes](engineering/adrs/evidence-cache-lifetimes.md).
- [Briefing identity](engineering/adrs/briefing-evidence-identity.md).
- [Durable generation ownership](engineering/adrs/durable-briefing-ownership.md).
- [Native RPC lifecycle](engineering/adrs/native-rpc-lifecycle.md).
- [Managed rate limiting](engineering/adrs/cloudflare-rate-limiting.md).
- [Firefox startup](engineering/adrs/firefox-entry-import-map.md).
- [Drizzle database layer](engineering/adrs/drizzle-database-layer.md).

Keep each decision's status and rollout evidence in its ADR, not in this index.

## Engineering operations

- [Development](engineering/ops/development.md): local runtimes, configuration, and checks.
- [Deployment](engineering/ops/deployment.md): environments, resources, credentials, and deployment procedures.
- [Releases and recovery](engineering/ops/releases-and-recovery.md): release verification, stored-data changes, and incident recovery.

These guides cover engineering tasks, not business operations. Keep procedures here, separate from system explanations and decision records.

## Current behavior versus decisions

The briefing guide explains how the system validates an RPC result and releases its remote handles today. RPC (remote procedure call) lets one Worker call another. The ADR explains why we chose native objects rather than JSON text.

Link the two accounts instead of repeating the full contract.

Published docs describe current behavior, decisions in force, or operating procedures. Replace outdated explanations rather than appending audit findings, dated measurements, change narratives, or former-name explanations. Only ADRs and Git history serve as historical records. Use current terminology according to [repository guidance](../AGENTS.md#documentation-style).

ADRs preserve decision history: what we chose, why, and under which constraints. A decision can change later. Record choices that would be costly to reverse, even when they seem obvious.

In these records, distinguish:

- Facts supported by sources.
- Historical reports or recollections.
- Current choices.
- Things we do not know.

An accepted proposal is not proof that the change has shipped.

## Proposals and local agent work

Use **issues** to explore problems, compare options, and gather opinions. Use **merge requests** to review implementations and verification evidence.

Keep proposals and their discussion there rather than maintaining a separate proposal-document workflow. Agreement on a proposal is not proof of implementation or permission to deploy.

After a consequential decision, preserve its reasoning in an ADR and link the relevant issue or merge request when available. Keep current behavior and procedures in the system and operations guides.

### Agent working material

AI idea briefs, specs, plans, and task checklists are temporary. Store them in a named OS-temporary directory outside the repository; never commit them.

They may copy commands and context to help with a task. Published docs must not depend on them. Put proposals in issues or merge requests, and lasting decisions and system knowledge in the appropriate ADR, system guide, or operations guide.

Ignored `docs/superpowers/` material is not published documentation. Do not use it for new agent working files.

## Retired material

Before deleting an old report or runbook, move any still-useful procedures and reasoning into the appropriate maintained docs. Label historical observations clearly in decision records.

Git keeps the old files; do not make archive copies.

When moving a document, update links to it and relative links inside it. The [artifact-grilling output guidance](../.agents/skills/grill-with-artifacts/OUTPUTS.md) follows this organization.
