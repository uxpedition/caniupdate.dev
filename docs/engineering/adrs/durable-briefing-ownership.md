# Durable jobs own briefing generation

**Decision:** A Durable Object job owns generation for one evidence hash. The Queue wakes the job; the browser subscribes to its state through a read-only socket. Accepted work continues independently of the browser. Lease recovery does not automatically regenerate after an uncertain provider outcome; a later explicit submission can retry a failed job.

## Why

Leaving or refreshing the page should not discard accepted work. Multiple users can share a pending job and subsequently reuse its stored success. Reconnecting to watch that job must not buy another generation.

A provider timeout or process loss may leave billing unknown. Automatically repeating the call could charge again, so recovery first checks D1 and otherwise settles the failed attempt rather than regenerating it.

## Costs and limits

- Durable state, Queue delivery, alarms, D1 persistence, and socket subscriptions add lifecycle complexity.
- Work can finish after its viewer leaves; closing the subscription does not cancel generation.
- A later explicit POST can retry when there is no reusable result and configuration is valid. A refresh or another user's visit matters only if it causes that submission.
- There is no exactly-once billing guarantee. A later attempt might receive a provider-cache discount, but the application neither controls nor guarantees that discount.
- Queue dispatch recovery is distinct from repeating inference. Invalid model output also has its own bounded retry policy.

Reconsider if cancellation or automatic regeneration becomes an explicit product requirement; either would need a deliberate spending policy.

## Artifacts

- [Current job lifecycle and recovery](../briefing.md#durable-job-lifecycle-and-recovery) and [generation failures](../briefing.md#result-storage-and-generation-failures).
- [Job implementation](../../../workers/briefing/job.ts), [Queue and socket entrypoints](../../../workers/briefing/index.ts), and [browser follower](../../../app/composables/packageBriefingQueryOptions.ts): source evidence for ownership boundaries.
- **Historical observation (local fixture, reported 2026-09-26):** The recorded smoke scenario submitted a job, received a terminal socket result, restarted the local runtime, reused the stored D1 result, and reconnected without another fixture-provider call. This describes that isolated local scenario; it does not establish production behavior or exactly-once billing.
