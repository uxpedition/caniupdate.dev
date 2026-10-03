# Evidence cache lifetimes

**Decision:** Cache mutable provider evidence for five minutes. Retain successful or partial verified archive inspections without expiry, keyed by integrity policy and inspector revision. Do not persist failed provider results or transiently failed partial results.

## Why

Repeated comparisons should reuse collected evidence rather than repeat external requests and archive inspection. Five minutes is the owner's chosen reasonable freshness window, not a measured optimum. Verified archive content can be reused while its integrity policy and inspection semantics remain the same.

## Costs and limits

- Advisories and release evidence can change for existing versions without a new npm release. The mutable cache can delay those changes by its freshness window; browser caching is a separate layer.
- The cache lives in Durable Object SQLite. TTL is a freshness policy, not a memory or storage cap; expired mutable entries are cleaned up on cache access.
- Archive inspections accumulate indefinitely. There is no archive eviction policy, and reuse is within a package's object, not global across packages.
- Failed results are not preserved, so later requests can repeat unsuccessful external work.

Reconsider the policy if freshness requirements or observed storage/workload costs change. A changed inspector revision already gives archive inspections new keys.

## Artifacts

- [Current cache keys, write rules, and storage behavior](../evidence.md#cache-keys-coalescing-expiry-and-storage-failures).
- [Collector constants and cache policy](../../../server/utils/packageComparisonFacts.ts) and [SQLite cache](../../../workers/evidence/store.ts): source evidence for the implemented behavior.
- [Optimization plan cache policy](../../optimization-plan.md#cache-policy): earlier design rationale, not a current deployment runbook.
