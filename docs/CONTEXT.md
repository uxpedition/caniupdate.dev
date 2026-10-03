# Documentation organization

Organize documentation by the reader's question. `engineering/` is the technical umbrella: direct documents explain the current system, `adrs/` preserves significant decisions, and `ops/` contains engineering procedures for running and maintaining it.

| Location                              | Reader's question                               | Maintenance rule                                                                                                    |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [README](../README.md)                | What is this, and how do I try it?              | Keep the introduction, quick start, and entry-point links here.                                                     |
| `docs/product/`                       | What do the product and its results mean?       | Describe capabilities, limitations, and explicitly labelled intent.                                                 |
| `docs/engineering/<document-name>.md` | How does the implemented system work now?       | Update contracts, flows, ownership, and failure boundaries as implementation changes.                               |
| `docs/engineering/adrs/<adr-name>.md` | What significant choice did we make, and why?   | Preserve its context, tradeoffs, and evidence; mark it superseded and link the replacement if the decision changes. |
| `docs/engineering/ops/`               | How do I run, deploy, diagnose, and recover it? | Keep procedures and their prerequisites current; distinguish policies from implemented capabilities.                |

An **ADR** is an Architecture Decision Record. The name describes the artifact, not a separate top-level architecture folder. Use descriptive Markdown filenames consistent with the existing documents.

## Current engineering documents

- [System overview](engineering/overview.md).
- [Evidence collection and storage](engineering/evidence.md).
- [Briefing architecture](engineering/briefing.md).

The five decision records are [cache lifetimes](engineering/adrs/evidence-cache-lifetimes.md), [briefing identity](engineering/adrs/briefing-evidence-identity.md), [durable generation ownership](engineering/adrs/durable-briefing-ownership.md), [native RPC lifecycle](engineering/adrs/native-rpc-lifecycle.md), and [Firefox startup](engineering/adrs/firefox-entry-import-map.md).

## Engineering operations

- [Development](engineering/ops/development.md): local runtimes, configuration, and checks.
- [Deployment](engineering/ops/deployment.md): environments, resources, credentials, and deployment procedures.
- [Releases and recovery](engineering/ops/releases-and-recovery.md): release verification, stored-data changes, and incident recovery.

These are engineering operations, not general business operations. Procedures belong here rather than in current-system explanations or ADRs.

## Current behavior versus decisions

For example, the briefing document explains how the RPC result is validated and disposed today. Its ADR explains why native object RPC was chosen over JSON-text transport. Link these accounts instead of duplicating a full contract in the ADR.

A decision is a choice under the knowledge and constraints available when it was made, not a permanent ruling. Distinguish source-backed current behavior, historical reports or recollections, present-day choices, and unknowns. Accepting a proposal does not prove it has been implemented.

## Other material

`docs/cloudflare-handoff.md`, `docs/optimization-plan.md`, and `docs/superpowers/` retain existing reports, designs, and plans. They can mix dated observations, current details, and superseded instructions; do not treat a plan or historical report as current implementation evidence. This organization does not move or endorse those documents wholesale.

Proposals belong in the relevant design format or `docs/rfcs/` when an RFC is needed. Retired material with unique useful context may belong in `docs/archive/`. Create those folders only when there is an actual artifact to put in them; neither is a second source of current guidance.

When moving a document, update incoming links and its own relative links. The [artifact-grilling output guidance](../.agents/skills/grill-with-artifacts/OUTPUTS.md) uses this organization.
