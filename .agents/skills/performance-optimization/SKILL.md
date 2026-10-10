---
name: performance-optimization
description: Measures and improves application performance without guessing. Use when performance budgets or latency requirements exist, users report slowness, a change may have regressed performance, Core Web Vitals miss targets, datasets/traffic grow, or profiling identifies a bottleneck.
---

# Performance Optimization

## Overview

Measure before optimizing. Performance work without measurement is guessing, and guesses often add complexity without improving the user-visible outcome. Establish a representative baseline, find the actual bottleneck, change one thing, and measure again. Keep only improvements that exceed noise without weakening correctness, privacy, or reliability.

## When to use

- The requirements include load-time budgets, latency targets, throughput, or resource limits
- Users or monitoring report slow behavior
- Core Web Vitals or another agreed user-facing metric are below target
- You suspect a change caused a performance regression
- A feature will handle a large data set, high traffic, or resource-intensive processing

**When not to use:** Do not optimize by intuition alone. If no measured problem or requirement exists, avoid micro-optimization and added complexity.

## Core Web Vitals

For user-facing web performance, Google's current Core Web Vitals “good” thresholds are LCP ≤ 2.5 seconds, INP ≤ 200 milliseconds, and CLS ≤ 0.1 at the 75th percentile. Recheck the official definition if targets or measurement guidance change: [web.dev: Web Vitals](https://web.dev/articles/vitals). Use product- and device-representative targets rather than treating these as a universal performance budget.

| Metric                              |    Good | Needs improvement |    Poor |
| ----------------------------------- | ------: | ----------------: | ------: |
| **LCP** (Largest Contentful Paint)  |  ≤ 2.5s |            ≤ 4.0s |  > 4.0s |
| **INP** (Interaction to Next Paint) | ≤ 200ms |           ≤ 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift)   |   ≤ 0.1 |            ≤ 0.25 |  > 0.25 |

## The optimization workflow

```
1. MEASURE  → Establish a representative baseline
2. IDENTIFY → Find the actual bottleneck, not the assumed one
3. FIX      → Change the smallest thing that addresses it
4. VERIFY   → Re-measure; keep or revert based on evidence
5. GUARD    → Add a meaningful budget or monitor to catch recurrence
```

### Step 1: Measure

Use complementary approaches when relevant:

- **Synthetic measurements** (browser performance traces, Lighthouse or equivalent, controlled load tests): repeatable, useful for isolating issues and detecting regressions before release.
- **Real-user monitoring** (RUM, field performance data): required to determine whether a change improved actual user experience across devices and networks.
- **Backend measurements** (profiler/APM, sampled timing, query plans, resource and queue metrics): locate latency and cost across service and storage boundaries.

Use the tools already available in the project and current runtime; do not assume a specific DevTools extension, MCP server, vendor, browser, or instrumentation stack. Follow the shared policy in [`../../references/POLICY.md`](../../references/POLICY.md): ordinary measurement commands follow runtime/repository permissions; obtain specific authorization for production load, paid provider work, shared-state mutations, and private-data export. Each external CLI invocation for cross-model review requires separate explicit authorization.

Frontend examples:

```text
Synthetic: record a browser performance trace on representative hardware/network.
Field: use the project's approved web-vitals/RUM instrumentation for LCP, INP, CLS.
Compare an adequate sample and relevant segment, not a single best run.
```

Backend examples:

```text
Profile the endpoint/worker with realistic input and concurrency.
Inspect dependency/database timings and trace spans for the same request.
Use query-plan tooling to test database hypotheses; do not infer from code shape alone.
```

Field performance collection is telemetry. Apply the project's consent, privacy, data-minimization, and retention policy; never attach credentials, raw URLs, prompts, or user-identifying fields to a measurement just to make it easier to group.

#### Choose the first measurement from the symptom

```
What is slow?
├── First page load
│   ├── Large bundle? → Measure compressed initial/route bundle and code split points
│   ├── Slow server response? → Measure TTFB and the network waterfall
│   │   ├── DNS/connection setup? → Check known origins, TLS, protocol, reuse
│   │   └── Server wait? → Profile request path, queries, caching, external calls
│   └── Render blocking? → Find blocking styles/scripts and asset priorities
├── Interaction
│   ├── UI freezes? → Profile main-thread long tasks (>50 ms is a useful browser signal)
│   ├── Input lags? → Check render work, state ownership, synchronous processing
│   └── Animation stutters? → Check layout thrashing, forced reflow, paint/compositing
├── After navigation
│   ├── Data waits? → Measure API latency and request waterfalls
│   └── Client work? → Profile render cost and repeated/N+1 fetches
└── Backend/API/job
    ├── One path slow? → Profile queries, indexes, serialization, dependency calls
    ├── All paths slow? → Check connection pools, memory, CPU, shared capacity
    └── Intermittent? → Check lock contention, garbage collection, queueing, dependencies
```

### Step 2: Identify the bottleneck

Use measurements to distinguish likely causes from root causes:

**Frontend**

| Symptom           | Common cause                                                      | Evidence to inspect                                   |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Slow LCP          | Oversized/late image, blocking resources, slow server             | Waterfall, LCP attribution, image dimensions/priority |
| High CLS          | Missing dimensions, late content, font shifts                     | Layout-shift attribution and stable viewport run      |
| Poor INP          | Long main-thread tasks, large DOM update, excess synchronous work | Interaction trace, task timing, render profile        |
| Slow initial load | Excess JS, requests, expensive initialization                     | Compressed bundle, transfer, parse/execute profile    |

**Backend**

| Symptom           | Common cause                                                         | Evidence to inspect                               |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Slow API response | N+1 query, missing/ineffective index, serialization, dependency wait | Query log/plan and distributed trace              |
| Memory growth     | Leaked references, unbounded cache, oversized payload                | Heap profile and bounded-size inputs              |
| CPU spikes        | Heavy synchronous computation, pathological regular expression       | CPU profile and representative input distribution |
| High latency      | Repeated work, missing appropriate cache, network hops               | Trace spans and cache hit/miss measurements       |

### Step 3: Fix the identified bottleneck

Change only the bottleneck identified in Step 2. The patterns below describe common signatures; open the worked example in [references/optimization-patterns.md](references/optimization-patterns.md) only when reaching the relevant code.

**Backend**

- **N+1 queries.** A query per row scales work with result count. Fetch related data in one query/join where semantics allow. [Worked pattern](references/optimization-patterns.md#n1-queries-backend).
- **Unbounded fetches.** Every list endpoint should bound result size and use a stable ordering/cursor strategy suited to the data. [Worked pattern](references/optimization-patterns.md#unbounded-data-fetching).
- **Queries that ignore an index.** `EXPLAIN ANALYZE` is evidence; “add an index” is a guess. A `Seq Scan` on a large table may mean no usable index, an estimated-row mismatch may mean stale statistics, and a `Sort` above the scan may mean the index does not cover ordering. A `rows=` mismatch by an order of magnitude calls for checking statistics before adding an index. Put equality columns before range/sort columns in a composite index. A regular index does not help a low-selectivity dominant value, a leading wildcard search, or a function applied to the column unless it matches the query shape (partial, full-text/trigram, or expression index may fit). Every index taxes writes. Re-run the plan and measure the write cost. [Worked pattern](references/optimization-patterns.md#queries-that-ignore-their-index).
- **Connection-pool exhaustion.** Signature: many endpoints slow together, time is waiting for a connection, and the database shows idle sessions. Use a bounded pool per process and reason about `instances × max` against the database's connection ceiling. A bigger pool can move the queue into the database; when instance count is unbounded, use an appropriate multiplexing proxy rather than blindly raising `max`. [Worked pattern](references/optimization-patterns.md#connection-pool-exhaustion).
- **Missing caching.** Cache only expensive results that are read far more often than they change. Choose in-process, shared, or edge/CDN cache deliberately. Every response-affecting dimension—tenant, locale, permissions, flags—belongs in the key; omitting the viewer can leak one user's data to another. State acceptable staleness and choose one invalidation approach (TTL, event/tag, or versioned keys). Protect hot keys from stampedes with stale-while-revalidate or request coalescing. Never cache values whose staleness violates correctness, such as permissions or checkout inventory. [Worked pattern](references/optimization-patterns.md#missing-caching-backend); see the shared [performance checklist](../../references/performance-checklist.md#caching-strategies) for read/write, negative-cache, and request-coalescing strategies.

**Frontend**

- **Image delivery.** Provide intrinsic dimensions to prevent layout shift; serve appropriate modern formats and responsive `srcset`/`sizes`; prioritize the measured LCP image; lazy-load and asynchronously decode offscreen images. [Worked pattern](references/optimization-patterns.md#missing-image-optimization-frontend).
- **Unnecessary re-renders.** New objects/functions created during render can invalidate children. Hoist stable values; use memoization only for work a profile proves expensive, since memoization also adds cost and complexity. [Worked pattern](references/optimization-patterns.md#unnecessary-re-renders-react).
- **Large bundles.** Modern bundlers generally tree-shake ESM. Profile first; route-level splitting and lazy-loading genuinely heavy, rarely used features often matter more than changing import spelling. [Worked pattern](references/optimization-patterns.md#large-bundle-size).

### Step 4: Verify—keep or revert

An optimization is a hypothesis until re-measured.

- Re-measure with the same tool, dataset, hardware/network, cache state, concurrency, and fixed budget (wall time, sample count, or request count). Cold versus warm results do not isolate the change.
- Change one thing at a time. If multiple changes must ship together, measure each in isolation first.
- Repeat enough to compare the delta with run-to-run variance. A 3% improvement within ±5% noise is a different sample, not a win.
- Correctness gates the metric: all relevant behavior and tests stay valid. Do not win by dropping product work, bypassing validation, weakening consistency, or changing a test to hide regression.

| Result versus baseline                                       | Action                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Improvement exceeds noise and correctness gates remain green | Keep; record the exact before/after evidence.                    |
| No measurable improvement or within noise                    | Revert the optimization if it is yours and authorized to change. |
| Worse                                                        | Revert the optimization if it is yours and authorized to change. |
| Better metric but a correctness test fails                   | Treat it as a regression; restore correct behavior.              |

Neutral changes are not free: complexity must pay back in a measured improvement. Do not discard another contributor's work while reverting yours.

#### Record attempts without turning scratch work into permanent docs

Keep a concise record of optimization experiments so failed ideas are not repeated. Scratch measurements and AI-generated performance briefs belong in the named external `workDir` under the policy in [`../../references/POLICY.md`](../../references/POLICY.md), not in a committed execution log. Include measurement conditions, baseline/result, noise range, verdict, and why.

| Idea                    | Baseline → result | Verdict  | Evidence                                          |
| ----------------------- | ----------------- | -------- | ------------------------------------------------- |
| Memoize a list row      | INP 240ms → 235ms | Reverted | Within ±15ms noise; rows were not the bottleneck. |
| Virtualize a large list | INP 240ms → 90ms  | Kept     | Long tasks disappeared from the trace.            |
| Preconnect to an origin | LCP 2.8s → 2.8s   | Reverted | Same-origin; no measurable connection work.       |

A review description may carry authorized relevant evidence; only publish it with permission. A maintained performance document is for durable budgets and current operational guidance, not a scratch ledger of AI plans or reverted experiments. Do not commit temporary working artifacts.

### Step 5: Guard against regression

Guard the metric users feel and that justified the change (LCP, INP, p95 latency, throughput, or memory). Do not create a gate for every available number.

For user-facing systems, use complementary layers when appropriate:

- **Synthetic CI gate:** A reproducible performance budget that compares stable medians/trends or repeats noisy tests enough to avoid flaky failures.
- **Field monitoring:** Alert on a meaningful change in a representative p75 RUM measure. Use attributed web-vitals data to locate issues; rolling aggregates such as the [Chrome UX Report](https://developer.chrome.com/docs/crux/) are confirmation, not immediate incident alerting.

When a guard fires, return to Step 1 and establish a fresh baseline before proposing a fix.

Budgets must derive from product requirements and representative devices/network/service capacity. These are **illustrative starting points only**, not universal targets:

```
Initial JavaScript bundle: < 200KB gzipped
CSS: < 50KB gzipped
Above-the-fold images: < 200KB each
Fonts: < 100KB total
API response time: < 200ms at p95
Interactive readiness: < 3.5s on a representative constrained network
Lighthouse Performance score: ≥ 90
```

Choose and document only the budgets that map to user outcomes. Enforce them with the repository's existing bundle-size, load-test, or browser-budget tooling; discover the command from project config/CI rather than adding an assumed package:

```text
Run the repository's configured bundle-size budget check.
Run the repository's configured synthetic browser/performance check.
```

A performance gate should state the measured artifact, environment, threshold, noise/variance policy, and owner. Pair synthetic checks with field monitoring when the result must hold across real conditions.

## Common rationalizations

| Rationalization                                 | Reality                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| “We'll optimize later.”                         | Fix measured high-impact bottlenecks; avoid micro-optimizing without evidence.                             |
| “It's fast on my machine.”                      | Local hardware is not representative of all users. Measure on relevant devices, networks, and server load. |
| “The optimization is obvious.”                  | Profiling distinguishes a real bottleneck from a plausible story.                                          |
| “The framework handles performance.”            | Frameworks cannot fix every N+1 query, oversized payload, or blocking computation.                         |
| “The query is slow; add an index.”              | Read the query plan first; an unusable index adds write cost without fixing the read.                      |
| “Just cache it.”                                | A cache adds staleness and invalidation risk; cache only when cost and read/write pattern justify it.      |
| “Raise the pool size; we ran out.”              | First identify where connections wait and what holds them. A larger pool can move saturation downstream.   |
| “It didn't help much, but it doesn't hurt.”     | Unmeasured complexity is maintenance cost; neutral changes should be removed.                              |
| “We already wrote it, so keep it.”              | Sunk effort does not improve the measured outcome.                                                         |
| “The win is obvious; no re-measurement needed.” | The same measurement proves whether the change exceeded noise.                                             |

## Red flags

- Optimization without profiling/baseline evidence
- N+1 data access or unbounded lists on a measured path
- An index with no before/after query plan or write-cost consideration
- A cache key omitting a response-affecting user/tenant/permission dimension
- A cache without explicit stale window or invalidation plan
- Pool size increased without evidence about the wait and connection ceiling
- Images missing dimensions, loading priority, or responsive sizing where applicable
- Bundle growth without a measured budget or review
- Blanket `memo`/`useMemo`/equivalent use without profile evidence
- An optimization retained without a repeatable same-condition remeasurement
- Several optimizations bundled into one measurement so impact cannot be attributed
- A performance “win” that skips a test or weakens behavior
- The same failed experiment repeated because evidence was not retained
- Telemetry added without privacy/consent and data-retention review

## Verification

After performance work:

- [ ] A reproducible baseline and before/after measurements exist with actual values.
- [ ] Both measurements used comparable commands, inputs, caches, environment, load, and sample budget.
- [ ] Improvement exceeds measured run-to-run variance and all correctness gates remain intact.
- [ ] No neutral/worse optimization was kept solely because it was already implemented.
- [ ] The specific bottleneck has evidence and the changed code targets it.
- [ ] Web Vitals meet applicable official/product targets where the surface is web-facing.
- [ ] No unbounded fetch or N+1 pattern was introduced on the measured path.
- [ ] Index choice is justified by a plan and write cost; caches state key, staleness, and invalidation.
- [ ] The measured user-facing metric has a meaningful synthetic budget or field monitor when needed.
- [ ] Sensitive/private data is absent from measurements and telemetry.
- [ ] Scratch experiment data stays in the named external `workDir`; durable docs and publication are authorized.
