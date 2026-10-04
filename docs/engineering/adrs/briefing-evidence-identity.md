# Briefing identity follows evidence

**Decision:** Identify a briefing by SHA-256 of its validated bounded evidence packet for a specific comparison. Reuse a stored successful result whenever that packet matches. Model, prompt, provider key, and retrieval time are not identity inputs.

## Why

The owner's rule is: unchanged evidence gives us no reason to regenerate the AI briefing. Identical evidence submitted by different users should share an active job or stored success instead of buying separate explanations. Changing AI settings alone is not a reason to invalidate that success.

D1 retains the first validated successful result for a hash; concurrent successful writers converge on that row rather than overwrite it.

## Costs and limits

- The same package/version pair can acquire changed evidence, produce a new hash, and require another generation.
- Matching evidence reuses the existing result even after a model or prompt change. First-writer-wins selects a canonical success, not the best possible wording.
- Permanent reuse means no automatic expiry, not guaranteed existence: if the D1 row disappears, a later submission can generate again.
- This is duplicate-spend control, not one lifetime charge per version pair or an account-wide monetary budget.

Reconsider identity only if the product deliberately changes what warrants regeneration, such as requiring existing results to reflect a revised prompt. That would be a policy change, not incidental cache cleanup.

## Artifacts

- [Current identity and submission contract](../briefing.md#evidence-identity-and-private-submission).
- [Evidence hash](../../../server/comparison/briefing/generation.ts), [validated result store](../../../server/comparison/briefing/store.ts), and [D1 schema](../../../migrations/0001_package_briefings.sql): source evidence for identity and first-writer-wins storage.
