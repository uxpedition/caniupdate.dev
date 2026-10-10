# ADR Format

Follow repository documentation conventions for ADR location, naming, and templates. Here, `docs/CONTEXT.md` and `grill-with-artifacts/OUTPUTS.md` specify descriptive filenames under `docs/engineering/adrs/`. Do not introduce numbering beside unnumbered records or create a competing directory.

An ADR records a settled decision, not an undecided proposal. Show its draft and destination for review before writing unless explicitly authorized. Create a directory only when an authorized artifact needs it.

## Content

Use the repository's template. When composed with `grill-with-artifacts`, follow its ADR output contract: status, context, decision, considered alternatives, consequences, and evidence or related links. Keep each concise; avoid padding empty sections.

Distinguish historical rationale supported by records or recollection from present-day choices. If the original reason is unknown, say so. Advice accepted now is not historical intent, and an accepted decision is not proof that implementation shipped.

Keep superseded ADRs with their status and a link to the replacement. Follow existing naming rather than imposing a numbering scheme.

## When to offer an ADR

Every expensive-to-reverse decision deserves a record. Costly reversal alone is sufficient; surprisingness and competing alternatives are not additional prerequisites. Significant non-obvious choices, hidden constraints, and deliberate deviations can also warrant an ADR even when reversal is inexpensive.

Capture the context, rationale, consequences, and alternatives actually considered. An obvious choice can still carry lock-in worth explaining. If alternatives or historical reasoning are unknown, say so rather than inventing a trade-off. Cheap, self-evident choices usually need no separate record. Eligibility does not authorize publication.

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library: just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it; otherwise someone will suggest GraphQL again in six months.
