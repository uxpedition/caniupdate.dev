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

## Package metadata index

The approved dependency-resolution change adds a separate thirty-minute lifetime for successful package indexes. These indexes list published releases and distribution tags. They are not the per-version manifests covered by the original five-minute decision.

Hovering dependency lists must not start registry work. Explicit dependency-link activation resolves against the index in the existing per-package SQLite object. This shares successful lookups across users rather than relying on each browser's cache. Concurrent misses share one load; provider failures are not stored.

Thirty minutes trades freshness for fewer registry requests. New or removed releases and changed metadata can remain unseen during that window. This is a chosen window, not a measured optimum. Ordinary comparison range selection and the five-minute manifest cache remain unchanged. Reconsider if index freshness or registry traffic requires a different balance.

## Artifacts

- [Current cache keys, write rules, and storage behavior](../evidence.md#cache-keys-coalescing-expiry-and-storage-failures).
- [Collector constants and cache policy](../../../server/comparison/collect.ts) and [SQLite cache](../../../workers/evidence/store.ts): source evidence for the implemented behavior.
