# Durable jobs own briefing generation

**Decision:** A Durable Object job owns generation for one evidence hash. The Queue wakes the job. The browser watches its state through a read-only socket, but accepted work continues if the browser leaves. Recovering an expired lease does not automatically generate again when the provider outcome is uncertain. A later explicit submission can retry a failed job.

## Why

Leaving or refreshing the page should not discard accepted work. Multiple users can share a pending job and later reuse its stored success. Reconnecting to watch that job must not buy another generation.

A provider timeout or process loss may leave billing unknown. Repeating the call automatically could charge again. Recovery therefore checks D1 first. If no result is stored, it marks the attempt failed rather than generating again.

## Costs and limits

- Durable state, Queue delivery, alarms, D1 persistence, and socket subscriptions make the job lifecycle more complex.
- Work can finish after its viewer leaves. Closing the subscription does not cancel generation.
- A later explicit POST can retry if there is no reusable result and configuration is valid. A refresh or another user's visit matters only if it causes that submission.
- Billing is not guaranteed to happen exactly once. A later attempt might receive a provider-cache discount, but the application neither controls nor guarantees it.
- Recovering Queue dispatch is different from repeating AI inference. Invalid model output has a separate, bounded retry policy.

Reconsider if cancellation or automatic regeneration becomes an explicit product requirement. Either needs a deliberate spending policy.

## Artifacts

- [Current job lifecycle and recovery](../briefing.md#durable-job-lifecycle-and-recovery) and [generation failures](../briefing.md#result-storage-and-generation-failures).
- [Job implementation](../../../workers/briefing/job.ts), [Queue and socket entrypoints](../../../workers/briefing/index.ts), and [browser follower](../../../app/composables/briefingSubscription.ts): source evidence for ownership boundaries.
- **Historical observation (local fixture, reported 2026-09-26):** The recorded smoke scenario submitted a job and received a final socket result. It then restarted the local runtime, reused the stored D1 result, and reconnected without another fixture-provider call. This was an isolated local scenario, not proof of production behavior or exactly-once billing.
