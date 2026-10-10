# Performance Checklist

Quick reference checklist for web-application performance. Use alongside the local [`performance-optimization`](../skills/performance-optimization/SKILL.md) skill and the product's existing performance budgets. Treat numeric targets as starting points to validate against the supported product, devices, traffic, and SLO.

## Table of Contents

- [Core Web Vitals Targets](#core-web-vitals-targets)
- [TTFB Diagnosis](#ttfb-diagnosis)
- [Frontend Checklist](#frontend-checklist)
- [Backend Checklist](#backend-checklist)
- [Caching Strategies](#caching-strategies)
- [Measurement Workflows](#measurement-workflows)
- [Common Anti-Patterns](#common-anti-patterns)

## Core Web Vitals Targets

| Metric                          | Good    | Needs Work | Poor    |
| ------------------------------- | ------- | ---------- | ------- |
| LCP (Largest Contentful Paint)  | ≤ 2.5s  | ≤ 4.0s     | > 4.0s  |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms    | > 500ms |
| CLS (Cumulative Layout Shift)   | ≤ 0.1   | ≤ 0.25     | > 0.25  |

## TTFB Diagnosis

When Time to First Byte is slow (> 800ms), inspect each component of the network waterfall in an available browser's developer tools:

- [ ] **DNS resolution** slow → consider `<link rel="dns-prefetch">` or `<link rel="preconnect">` for known origins
- [ ] **TCP/TLS handshake** slow → enable HTTP/2 where supported, consider edge deployment, verify keep-alive
- [ ] **Server processing** slow → profile the backend, inspect slow queries, and evaluate caching

## Frontend Checklist

### Images

- [ ] Images use modern formats (WebP, AVIF) where supported
- [ ] Images are responsively sized (`srcset` and `sizes`)
- [ ] Images and `<source>` elements have explicit `width` and `height` (prevents CLS in art direction)
- [ ] Below-the-fold images use `loading="lazy"` and `decoding="async"` where appropriate
- [ ] Hero/LCP images use `fetchpriority="high"` and are not lazy-loaded

### JavaScript

- [ ] Initial bundle size meets the project's budget (200KB gzipped is a useful warning threshold, not a universal contract)
- [ ] Routes and heavy features use code splitting with dynamic `import()` where beneficial
- [ ] Tree shaking is enabled; verify dependencies ship ESM and mark `sideEffects: false` only when that declaration is accurate
- [ ] No blocking JavaScript in `<head>`; use `defer` or `async` where appropriate
- [ ] Heavy computation is offloaded to Web Workers when applicable
- [ ] `React.memo()` is used for expensive components only when profiling shows that repeated renders with identical props are costly
- [ ] `useMemo()` / `useCallback()` are used only where profiling shows a benefit
- [ ] Long tasks (> 50ms) are broken up to keep the main thread available — a main lever for INP
- [ ] A `yieldToMain` pattern is used inside long-running loops where input events need an opportunity to run between chunks
- [ ] Modern scheduling APIs are used where available: `scheduler.yield()` (preferred), `scheduler.postTask()` with priorities, and `isInputPending()` to yield only when needed
- [ ] `requestIdleCallback` is used for deferrable, non-urgent work (analytics flush, prefetch, warmup)
- [ ] Non-critical work is deferred out of event handlers (for example analytics or logging) so interaction response is not delayed
- [ ] Third-party scripts use `async` / `defer`, are audited for size, and use a facade when heavy (chat widgets, embeds)

### CSS

- [ ] Critical CSS is inlined or preloaded when appropriate
- [ ] Non-critical styles do not block rendering unnecessarily
- [ ] CSS-in-JS runtime cost is avoided in production where extraction or a lower-cost option is suitable

### Fonts

- [ ] Font families and weights are limited (2–3 families, 2–3 weights each is a useful starting point; every extra weight may add a request)
- [ ] WOFF2 is used where supported; avoid unnecessary WOFF/TTF/EOT copies
- [ ] Fonts are self-hosted when practical (third-party font CDNs add DNS + TCP + TLS round trips)
- [ ] LCP-critical fonts are preloaded: `<link rel="preload" as="font" type="font/woff2" crossorigin>`
- [ ] `font-display: swap` (or `optional` for non-critical fonts) avoids FOIT blocking render
- [ ] Fonts are subsetted with `unicode-range` to ship only needed glyphs
- [ ] Variable fonts are considered when multiple weights/styles are required (one file may replace many)
- [ ] Fallback font metrics use `size-adjust`, `ascent-override`, and `descent-override` when useful to reduce CLS on font swap
- [ ] A system font stack is considered before adding a custom font

### Network

- [ ] Static assets use long `max-age` with content hashing
- [ ] API responses are cached where appropriate (`Cache-Control`)
- [ ] HTTP/2 or HTTP/3 is enabled where supported
- [ ] Known origins are preconnected (`<link rel="preconnect">`) where it measurably helps
- [ ] `fetchpriority` is used on critical non-image resources (for example a key `<link rel="preload">` or above-the-fold `<script>`), not only on `<img>`
- [ ] Unnecessary redirects are removed

### Rendering

- [ ] No layout thrashing (forced synchronous layouts)
- [ ] Animations use `transform` and `opacity` where suitable (often GPU-accelerated)
- [ ] Long lists use virtualization (for example `react-window`) when the rendered list warrants it
- [ ] No unnecessary full-page re-renders
- [ ] Off-screen sections use `content-visibility: auto` with `contain-intrinsic-size` where useful to skip layout/paint of non-visible areas
- [ ] No `unload` event handlers or `Cache-Control: no-store` on HTML responses without a correctness/security reason; these can prevent back/forward cache (bfcache) eligibility

## Backend Checklist

### Database

- [ ] No N+1 query patterns (use eager loading / joins / batching)
- [ ] Queries have appropriate indexes
- [ ] List endpoints are paginated and request only needed columns, rather than unbounded `SELECT * FROM table`
- [ ] Connection pooling is configured for the process/deployment model
- [ ] Slow-query logging is enabled where appropriate

#### Query plans

- [ ] Capture `EXPLAIN ANALYZE` **before** the fix as the baseline
- [ ] Understand a `Seq Scan` on a large table: index missing, unusable, or genuinely not worthwhile
- [ ] Estimated vs actual `rows=` is within an order of magnitude; otherwise refresh statistics before changing indexes
- [ ] Check for a `Sort` node that a composite index could absorb
- [ ] Re-check the plan after the change; revert an index that did not change the plan unless it serves another demonstrated need

#### Index strategy

- [ ] Composite index column order is equality first, then range/sort
- [ ] Index covers the query shape (filter + sort), not only one column in isolation
- [ ] Consider a covering index for hot read paths (index-only scan avoids heap fetch)
- [ ] Avoid indexing low-selectivity columns for their dominant value; a partial index may still serve rare-value queries (`WHERE status = 'failed'`)
- [ ] Use an expression index where the query applies a function (`lower(email)`)
- [ ] Use full-text or trigram indexing for leading-wildcard search, not a B-tree
- [ ] Measure write cost on write-heavy tables (every index taxes every `INSERT`/`UPDATE`)
- [ ] Drop unused and duplicate indexes when their cost is not justified

#### Connection pooling

- [ ] Use one pool per process, not per request or module
- [ ] Keep `instances × pool max` below the database's `max_connections`
- [ ] Set `connectionTimeoutMillis` or the equivalent so exhaustion fails promptly instead of queueing indefinitely
- [ ] Diagnose exhaustion before resizing: find what holds connections (long transactions, missing `await`, leaked clients)
- [ ] Front serverless/autoscaling workloads with a multiplexing proxy (for example pgbouncer or RDS Proxy) rather than simply increasing each pool

### API

- [ ] Response times meet a measured target (200ms p95 is a useful reference, not a universal SLO)
- [ ] No synchronous heavy computation in request handlers
- [ ] Use bulk operations instead of loops of individual calls
- [ ] Response compression (gzip/brotli) is configured where beneficial
- [ ] Appropriate caching is selected (in-memory, Redis, CDN, or the established equivalent)

### Infrastructure

- [ ] CDN serves static assets where appropriate
- [ ] Server location is close to users or uses edge deployment where justified
- [ ] Horizontal scaling is configured when needed
- [ ] A health-check endpoint exists for the load balancer where applicable

## Caching Strategies

The decision material (which layer, which invalidation strategy, what never to cache) lives in the local [`performance-optimization`](../skills/performance-optimization/SKILL.md) skill. This section covers the read/write patterns and checklist.

### Read and write patterns

| Pattern                       | How it works                                           | Use when                                                    | Watch out for                                                                   |
| ----------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Cache-aside** (lazy)        | App checks cache, on miss reads origin and populates   | Default choice; read-heavy, tolerant of a cold first hit    | Every miss hits the origin, so it needs stampede protection                     |
| **Read-through**              | Cache layer itself loads on miss                       | You want the load path in one place, not at every call site | Hides origin latency; a slow origin looks like a slow cache                     |
| **Write-through**             | Write goes to cache and origin together, synchronously | Reads must never see a stale value after a write            | Adds cache latency to every write                                               |
| **Write-behind** (write-back) | Write hits cache, origin updated asynchronously        | Write-heavy workload where the origin is the bottleneck     | Data-loss window if the cache dies before flush; requires defensible durability |

### Negative caching

Cache the _absence_ of a result too. A key that misses on every lookup (a nonexistent user ID probed in a loop, a 404 asset) sends every request to the origin, so caching only the happy path does not protect it.

- Store an explicit “not found” sentinel with a **shorter** TTL than positive entries
- Keep the negative TTL short enough that a newly created record appears promptly
- Never turn an origin _error_ into a negative-cache entry, or one failing minute becomes many

### Request coalescing (stampede protection)

One recompute, N waiters. Prevent a hot key's expiry from sending the full concurrent load to the origin:

```typescript
const inFlight = new Map<string, Promise<unknown>>();

function loadOnce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fetcher().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
```

For a shared cache, the same idea needs a distributed lock or `stale-while-revalidate` so waiters can serve stale data instead of blocking.

### Cache checklist

- [ ] The cached call was measured as expensive first (caching a fast call adds a hop and buys nothing)
- [ ] Read/write ratio justifies the cache (read again far more often than written)
- [ ] Cache key includes every input the response varies on: tenant, viewer, locale, permissions, feature flags
- [ ] No per-user data is cached under a key that does not identify the user
- [ ] Choose one invalidation strategy (TTL, event/tag, or versioned keys), not an accidental mix
- [ ] Write down the acceptable staleness window; do not imply it from whatever TTL was typed
- [ ] Protect hot keys from stampedes (coalescing, lock, or `stale-while-revalidate`)
- [ ] Cache negative results with a shorter TTL; never cache origin errors as absence
- [ ] Set an eviction policy and memory ceiling (an unbounded cache is a memory leak)
- [ ] Monitor hit rate — a cache nobody measures is an assumption, and a low hit rate is pure overhead
- [ ] Do not cache data whose staleness is a correctness bug (balances, permissions, inventory at checkout)

## Measurement Workflows

Use field and local evidence before optimizing. First inspect the repository's configured measurement tools, scripts, package manager, and supported environments. Run only tools already available or explicitly authorized; command examples below describe possible workflows, not permission to install packages or invoke an external CLI. Ordinary measurement tools follow runtime/repository permissions; cross-model review CLI calls require separate explicit authorization.

### INP field data and browser workflow

1. **Field data first** — check [CrUX Vis](https://developer.chrome.com/docs/crux/vis) or the product's RUM tool for real-user INP before optimizing
2. **Identify slow interactions** — use an available browser's performance tooling to record representative interactions; inspect long tasks triggered by clicks/keystrokes
3. **Test on mid-range Android** — INP issues often surface only on slower hardware; use a real device or available CPU throttling (4×–6× slowdown)

When the matching tools are already installed and approved in a JavaScript project, typical equivalents include Lighthouse CLI for page audits, `webpack-bundle-analyzer` or `vite-bundle-visualizer` for bundle inspection, `bundlesize` for a bundle-size budget check, and the `web-vitals` package for in-app Core Web Vitals measurements. Use the exact versions and invocation configured by the repository; do not copy package-execution commands from another ecosystem or fetch tools implicitly.

The following are illustrative argument forms for tools already installed in the project, not permission to run or install them. Invoke them through the package manager and scripts the repository configures; do not assume that bare executables are on `PATH`. Ordinary measurement tools follow runtime/repository permissions; cross-model review CLI calls require separate explicit authorization.

```sh
lighthouse https://localhost:3000 --output json --output-path ./report.json
webpack-bundle-analyzer stats.json
vite-bundle-visualizer
bundlesize
```

```typescript
// If the repository already uses `web-vitals`:
import { onLCP, onINP, onCLS } from 'web-vitals';
onLCP(console.log);
onINP(console.log);
onCLS(console.log);

// With an installed attribution build, collect interaction-level detail:
import { onINP } from 'web-vitals/attribution';
onINP(({ value, attribution }) => {
  const { interactionTarget, inputDelay, processingDuration, presentationDelay } = attribution;
  console.log({ value, interactionTarget, inputDelay, processingDuration, presentationDelay });
});
```

## Common Anti-Patterns

| Anti-Pattern                      | Impact                                         | Fix                                                                                                  |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| N+1 queries                       | Linear DB load growth                          | Use joins, includes, or batch loading                                                                |
| Unbounded queries                 | Memory exhaustion, timeouts                    | Always paginate and bound result size                                                                |
| Missing indexes                   | Slow reads as data grows                       | Add indexes for filtered/sorted columns after reviewing the query plan                               |
| Indexing without reading the plan | Write cost paid, read gain unproven            | Capture `EXPLAIN ANALYZE` before and after; revert if the plan is unchanged and no other need exists |
| Redundant / unused indexes        | Every write pays for them                      | Audit usage stats and drop what nothing reads                                                        |
| Connection pool per request       | Exhausts `max_connections` under load          | One pool per process; use a proxy for serverless/autoscaling where appropriate                       |
| Cache key missing the viewer      | One user's data served to another              | Key on tenant, viewer, locale, permissions, and other varying inputs                                 |
| Unbounded cache                   | Memory leak wearing an optimization's clothing | Set an eviction policy and memory ceiling                                                            |
| Cache stampede on a hot key       | Origin takes full concurrent load at expiry    | Coalesce misses or use `stale-while-revalidate`                                                      |
| Layout thrashing                  | Jank, dropped frames                           | Batch DOM reads, then batch writes                                                                   |
| Unoptimized images                | Slow LCP, wasted bandwidth                     | Use modern formats, responsive sizes, and appropriate lazy loading                                   |
| Large bundles                     | Slow page load and interaction readiness       | Code split, tree shake, audit dependencies                                                           |
| Blocking main thread              | Poor INP, unresponsive UI                      | Chunk long tasks with `scheduler.yield()` / `yieldToMain`, or offload to Web Workers                 |
| Memory leaks                      | Growing memory, eventual crash                 | Clean up listeners, intervals, and references                                                        |
