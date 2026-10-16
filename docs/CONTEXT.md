# Documentation organization

Organize documentation by the reader's question. `engineering/` is the technical umbrella: direct documents explain the current system, `adrs/` preserves significant decisions, and `ops/` contains engineering procedures for running and maintaining it.

| Location                              | Reader's question                               | Maintenance rule                                                                                                    |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [README](../README.md)                | What is this, and how do I try it?              | Keep the introduction, quick start, and entry-point links here.                                                     |
| `docs/product/`                       | What do the product and its results mean?       | Describe capabilities, limitations, and explicitly labelled intent.                                                 |
| `docs/engineering/<document-name>.md` | How does the implemented system work now?       | Update contracts, flows, ownership, and failure boundaries as implementation changes.                               |
| `docs/engineering/adrs/<adr-name>.md` | What significant choice did we make, and why?   | Preserve its context, tradeoffs, and evidence; mark it superseded and link the replacement if the decision changes. |
| `docs/engineering/ops/`               | How do I run, deploy, diagnose, and recover it? | Keep procedures and their prerequisites current; distinguish policies from implemented capabilities.                |
| `docs/engineering/rfcs/`              | What engineering changes are proposed?          | Record review status, alternatives, risks, and open questions; acceptance does not establish implementation.        |

An **ADR** is an Architecture Decision Record. The name describes the artifact, not a separate top-level architecture folder. Use descriptive Markdown filenames consistent with the existing documents.

## Current engineering documents

- [System overview](engineering/overview.md).
- [Evidence collection and storage](engineering/evidence.md).
- [Briefing architecture](engineering/briefing.md).

## Decision records

For a decision's rationale, constraints, and verification evidence, read its ADR:

- [Cache lifetimes](engineering/adrs/evidence-cache-lifetimes.md).
- [Briefing identity](engineering/adrs/briefing-evidence-identity.md).
- [Durable generation ownership](engineering/adrs/durable-briefing-ownership.md).
- [Native RPC lifecycle](engineering/adrs/native-rpc-lifecycle.md).
- [Managed rate limiting](engineering/adrs/cloudflare-rate-limiting.md).
- [Firefox startup](engineering/adrs/firefox-entry-import-map.md).
- [Drizzle database layer](engineering/adrs/drizzle-database-layer.md).

Keep decision status and rollout evidence in the owning ADR rather than caching them in this index.

## Engineering operations

- [Development](engineering/ops/development.md): local runtimes, configuration, and checks.
- [Deployment](engineering/ops/deployment.md): environments, resources, credentials, and deployment procedures.
- [Releases and recovery](engineering/ops/releases-and-recovery.md): release verification, stored-data changes, and incident recovery.

These are engineering operations, not general business operations. Procedures belong here rather than in current-system explanations or ADRs.

## Current behavior versus decisions

For example, the briefing document explains how the RPC result is validated and disposed today. Its ADR explains why native object RPC was chosen over JSON-text transport. Link these accounts instead of duplicating a full contract in the ADR.

ADRs and RFCs preserve decision and proposal history. All other published documents are living guidance: update them as the product, implementation, and procedures change, rather than append superseded instructions or dated investigation logs. A decision is a choice under the knowledge and constraints available when it was made, not a permanent ruling. Every expensive-to-reverse decision warrants a record, even when the choice seems obvious; surprisingness is not an additional eligibility requirement. Within ADRs and RFCs, distinguish source-backed behavior, historical reports or recollections, present-day choices, and unknowns. Accepting a proposal does not prove it has been implemented.

## Proposals and local agent work

Engineering proposals for durable review belong in `docs/engineering/rfcs/`. RFC statuses are draft, discussion, accepted, rejected, and withdrawn. Acceptance records agreement, not shipment. Keep rejected and withdrawn RFCs with their explicit status rather than treating them as current-system guidance.

Read the [Drizzle database-layer RFC](engineering/rfcs/0001-drizzle-database-layer.md) for proposal history and acceptance checks, and the [server module ownership RFC](engineering/rfcs/0002-server-module-ownership.md) for ownership rationale. Proposal status belongs in each RFC. For current database behavior, use the [database ADR](engineering/adrs/drizzle-database-layer.md) and [development procedures](engineering/ops/development.md#how-do-i-change-or-apply-the-database-schema); for current module ownership, use the [system overview](engineering/overview.md) and source.

AI idea briefs, specs, plans, and execution checklists are temporary working material, stored in a named OS-temporary directory outside the repository and never committed. They may snapshot commands and context for execution; published documentation must not depend on them. Extract important proposals, decisions, and implemented knowledge into the maintained RFC, ADR, current-system, or operations document rather than committing the agent's working artifact. Existing ignored `docs/superpowers/` material is not published documentation or a destination for new agent working artifacts.

## Retired material

Migrate still-needed procedures and decision context into the appropriate current documents before deleting competing reports and runbooks. Keep necessary historical observations explicitly labelled in decision records. Git preserves retired reports and execution checklists; do not create archive copies.

When moving a document, update incoming links and its own relative links. The [artifact-grilling output guidance](../.agents/skills/grill-with-artifacts/OUTPUTS.md) uses this organization.
