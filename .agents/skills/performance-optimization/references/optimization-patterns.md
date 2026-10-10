# Optimization Patterns

Worked examples for the anti-patterns named in Step 3 of the `performance-optimization` skill. The skill states the rule and bottleneck signature; this file shows possible implementations. Read only the section that matches measured evidence. The code is illustrative—adapt query, runtime, and framework APIs to the actual repository and verify semantics.

Measurement commands, budgets, TTFB diagnosis, and broader caching strategies belong to the shared [`performance-checklist.md`](../../../references/performance-checklist.md).

## N+1 Queries (Backend)

```typescript
// BAD: one relation lookup per row
const tasks = await db.tasks.findMany();
for (const task of tasks) {
  task.owner = await db.users.findUnique({ where: { id: task.ownerId } });
}

// GOOD: fetch the relation in one database operation where the relation
// and authorization semantics allow it.
const tasks = await db.tasks.findMany({
  include: { owner: true },
});
```

The optimized query must preserve filtering, tenant/ownership checks, ordering, nullability, and result shape. A join that crosses authorization scope is a security regression, not an optimization.

## Unbounded Data Fetching

```typescript
// BAD: fetches every row into memory
const allTasks = await db.tasks.findMany();

// GOOD: bounded page with stable ordering
const tasks = await db.tasks.findMany({
  take: 20,
  skip: (page - 1) * 20,
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
});
```

Use a stable tie-breaker and the project's cursor/offset contract. Validate page bounds, preserve authorization filters, and avoid returning an unbounded total count if it is itself expensive.

## Queries That Ignore Their Index

“Add an index” is a guess. The query plan is the measurement. For a read-only query, inspect a representative plan; `EXPLAIN ANALYZE` executes the statement, so use a safe non-mutating query and a representative environment rather than running it blindly against production:

```sql
EXPLAIN ANALYZE
SELECT id, title FROM tasks
WHERE owner_id = 42 ORDER BY created_at DESC LIMIT 20;
```

The output helps distinguish different causes:

| Evidence                                                | Likely meaning                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Seq Scan` on a large table where an index was expected | No usable index for the predicate, or sequential scan is actually cheaper   |
| Estimated `rows=` differs greatly from actual           | Statistics may be stale; inspect/refresh statistics before changing indexes |
| A `Sort` node above the scan                            | The index may cover filtering but not the requested ordering                |

Index for the **shape of the query**, not the column in isolation. Equality columns generally precede range or sort columns in a composite index:

```sql
CREATE INDEX idx_tasks_owner_created ON tasks (owner_id, created_at DESC);
```

An index may not help in these cases:

| Situation                                                                         | Why                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Low-selectivity query on a dominant value (for example, 95% of rows are `active`) | Sequential scan can be cheaper; a partial index may fit a rare value instead.        |
| Leading wildcard search (`LIKE '%term'`)                                          | A B-tree cannot seek without a prefix; full-text/trigram methods may be appropriate. |
| Function applied to the column (`WHERE lower(email) = ?`)                         | A plain column index may not match; an expression index can.                         |
| Write-heavy table                                                                 | Every index adds insert/update/delete work; measure write cost as well as reads.     |

Re-run the plan and the workload after the change. If the plan and observed latency do not improve, the index has not paid for its ongoing write cost; revert it when it is yours and safe to change.

## Connection Pool Exhaustion

A common signature is many endpoints slowing at once, time spent waiting for a connection rather than executing, and mostly idle database sessions. Use one bounded pool per process, sized against the total number of processes and the database connection ceiling:

```typescript
// Illustrative Node/SQL client; exact options vary by driver.
const pool = new Pool({
  max: 10, // instances × max must fit the DB ceiling
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000, // fail in bounded time instead of queuing forever
});
```

Bigger is not automatically faster. A pool larger than the database can serve moves the queue into the database, where it is harder to see. When instance count is unbounded (serverless/autoscaling), investigate a compatible proxy that multiplexes connections rather than blindly raising the pool limit. Confirm that the proxy preserves transaction/session semantics required by the application.

## Missing Image Optimization (Frontend)

Declare intrinsic image dimensions to prevent layout shift. Serve suitable formats and responsive widths; prioritize the measured LCP image and lazy-load offscreen content. The example below demonstrates art direction (different crops) and resolution switching; the exact markup/framework should follow the project:

```html
<picture>
  <!-- Mobile portrait art direction with AVIF/WebP fallbacks. -->
  <source
    media="(max-width: 767px)"
    srcset="/hero-mobile-400.avif 400w, /hero-mobile-800.avif 800w"
    sizes="100vw"
    width="800"
    height="1000"
    type="image/avif"
  />
  <source
    media="(max-width: 767px)"
    srcset="/hero-mobile-400.webp 400w, /hero-mobile-800.webp 800w"
    sizes="100vw"
    width="800"
    height="1000"
    type="image/webp"
  />
  <!-- Desktop landscape crop with responsive resolution switching. -->
  <source
    srcset="/hero-800.avif 800w, /hero-1200.avif 1200w, /hero-1600.avif 1600w"
    sizes="(max-width: 1200px) 100vw, 1200px"
    width="1200"
    height="600"
    type="image/avif"
  />
  <source
    srcset="/hero-800.webp 800w, /hero-1200.webp 1200w, /hero-1600.webp 1600w"
    sizes="(max-width: 1200px) 100vw, 1200px"
    width="1200"
    height="600"
    type="image/webp"
  />
  <img
    src="/hero-desktop.jpg"
    width="1200"
    height="600"
    fetchpriority="high"
    alt="A useful text alternative for the hero image"
  />
</picture>

<img
  src="/content.webp"
  width="800"
  height="400"
  loading="lazy"
  decoding="async"
  alt="A useful text alternative for the content image"
/>
```

Do not mark every image high priority; prioritize the image that the trace identifies as LCP. Ensure alternative text, layout, and responsive selection remain correct.

## Unnecessary Re-renders (React)

The following applies only to React-style rendering. Use the equivalent component profile for the actual UI framework.

```tsx
// BAD: a new object each render can invalidate children
function TaskList() {
  return <TaskFilters options={{ sortBy: 'date', order: 'desc' }} />;
}

// GOOD: stable data when the shared option really is constant
const DEFAULT_OPTIONS = { sortBy: 'date', order: 'desc' } as const;
function TaskList() {
  return <TaskFilters options={DEFAULT_OPTIONS} />;
}

// Memoization is justified only when a profile shows meaningful work.
const TaskItem = React.memo(function TaskItem({ task }: Props) {
  return <div>{/* render task */}</div>;
});

function TaskStats({ tasks }: Props) {
  const stats = useMemo(() => calculateStats(tasks), [tasks]);
  return (
    <div>
      {stats.completed} / {stats.total}
    </div>
  );
}
```

Stable references help only if they affect a measured render path. Memoization can cost memory, invalidation complexity, and maintenance; do not spread it mechanically.

## Large Bundle Size

Modern bundlers commonly tree-shake ESM named imports when dependencies expose ESM and side-effect metadata is accurate. Profile before changing import style. Route-level splitting and lazy-loading heavy, rarely used capabilities may produce a meaningful reduction:

```typescript
// Illustrative React code; use the project's own lazy-loading mechanism.
const ChartLibrary = lazy(() => import('./ChartLibrary'));
const SettingsPage = lazy(() => import('./pages/Settings'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <SettingsPage />
    </Suspense>
  );
}
```

Measure the initial and route bundles, loading waterfall, and parse/execute work. Splitting a module can add network round trips or loading complexity; check user-visible behavior and caching.

## Missing Caching (Backend)

Cache only values that are expensive to produce and read far more often than they change. Caching an already-fast query adds a network hop, stale results, an eviction policy, and an invalidation bug for no measured benefit.

Choose the layer deliberately:

| Layer                      | Visible to                           | Use when                                                       | Cost                                                                               |
| -------------------------- | ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| In-process cache (map/LRU) | One process                          | Small hot value and per-instance staleness is acceptable       | Instances diverge; invalidation reaches only one process                           |
| Shared cache               | All application instances            | Values must be shared or expensive to recompute                | Network dependency, operations, and availability to monitor                        |
| CDN/edge cache             | Public requests grouped by cache key | Response is public and identical for all callers with that key | Invalidation is difficult; stale or incorrectly keyed content can reach many users |

Illustrative examples (adapt to the cache owner and data semantics):

```typescript
// Only for public or correctly scoped data with an explicit staleness budget.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedConfig: AppConfig | null = null;
let cacheExpiry = 0;

async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;
  cachedConfig = await db.config.findFirst();
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
}

// For versioned immutable static assets, not mutable content under the same URL.
app.use(
  '/static',
  serveStatic('public', {
    maxAge: '1y',
    immutable: true,
  }),
);
```

**Key design decides correctness.** Every input that changes a response belongs in its key: tenant, locale, permissions, feature flags, and any other caller scope. A key that omits the viewer can serve one user's data to another.

Choose one invalidation strategy unless a measured need justifies composing them:

| Strategy        | Trade-off                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| TTL             | Simple; state the maximum acceptable staleness.                                         |
| Event/tag based | Fresh after writes but every writer must know cache topology and handle missed events.  |
| Versioned keys  | Avoid active invalidation by changing the key; old values consume space until eviction. |

**Guard against stampedes.** An expired hot key can cause every concurrent request to hit the origin. Serve stale while one request recomputes, or coalesce concurrent misses behind one in-flight operation. Test concurrent misses and failure behavior.

**Do not cache** values whose staleness violates correctness—such as permissions, account balances, or inventory at checkout—or user-scoped data under a key that does not identify its scope. See the shared [`performance-checklist.md#caching-strategies`](../../../references/performance-checklist.md#caching-strategies) for request coalescing, write strategies, negative caching, and the cache review checklist.
