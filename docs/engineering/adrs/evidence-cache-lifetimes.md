# Evidence cache lifetimes

**Decision:** Cache provider evidence that can change for five minutes. Keep successful or partial verified archive inspections without expiry. Their keys include the integrity policy and inspector revision. Do not store failed provider results or partial results affected by temporary failures.

## Why

Repeated comparisons should reuse collected evidence rather than repeat external requests and archive inspections. The owner chose five minutes as a reasonable freshness window; it is not a measured optimum.

Verified archive content can be reused while its integrity policy and inspection rules stay the same.

## Costs and limits

- Advisories and release evidence can change for existing versions without a new npm release. The mutable cache can delay those changes by its freshness window. Browser caching is a separate layer.
- The cache lives in Durable Object SQLite. TTL (time to live) controls freshness, not memory or storage size. Expired mutable entries are cleaned up when the cache is accessed.
- Archive inspections accumulate indefinitely; there is no eviction policy. Reuse is limited to a package's object, not shared across packages.
- Failed results are not kept, so later requests can repeat unsuccessful external work.

Reconsider if freshness requirements or observed storage/workload costs change. Changing the inspector revision already gives archive inspections new keys.

## Artifacts

- [Current cache keys, write rules, and storage behavior](../evidence.md#cache-keys-coalescing-expiry-and-storage-failures).
- [Collector constants and cache policy](../../../server/comparison/collect.ts) and [SQLite cache](../../../workers/evidence/store.ts): source evidence for the implemented behavior.
