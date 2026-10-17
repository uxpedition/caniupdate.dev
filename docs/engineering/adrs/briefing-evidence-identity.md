# Briefing identity follows evidence

**Decision:** Identify a briefing by the SHA-256 hash of its validated, size-limited evidence packet for a specific comparison. Reuse a stored successful result whenever that packet matches. The model, prompt, provider key, and retrieval time do not contribute to the identity.

## Why

The owner's rule is: unchanged evidence gives us no reason to regenerate the AI briefing. Different users submitting identical evidence should share an active job or stored success, not buy separate explanations. Changing AI settings alone does not invalidate that success.

D1 keeps the first validated successful result for a hash. If several writers succeed at once, they all use that row rather than overwrite it.

## Costs and limits

- Evidence for the same package/version pair can change. That produces a new hash and can require another generation.
- Matching evidence reuses the result even after a model or prompt change. First-writer-wins chooses one shared success, not the best possible wording.
- Permanent reuse means no automatic expiry. It does not guarantee the row will exist: if it disappears from D1, a later submission can generate again.
- This limits duplicate spending. It does not guarantee one lifetime charge per version pair or impose an account-wide spending budget.

Reconsider identity only if the product deliberately changes when to regenerate. For example, requiring existing results to use a revised prompt would be a policy change, not routine cache cleanup.

## Artifacts

- [Current identity and submission contract](../briefing.md#evidence-identity-and-private-submission).
- [Evidence hash](../../../server/comparison/briefing/generation.ts), [validated result store](../../../server/comparison/briefing/store.ts), and [D1 schema](../../../shared/db/briefingSchema.ts) and [generated migrations](../../../migrations/): source evidence for identity and first-writer-wins storage.
