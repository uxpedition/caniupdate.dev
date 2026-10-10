---
name: api-and-interface-design
description: Designs stable, explicit interfaces that are hard to misuse. Use when shaping a public or internal API, endpoint, schema, component contract, or interaction between modules or teams.
---

# API and Interface Design

Design stable, documented contracts that make the correct behavior easy and misuse difficult. An interface is any surface where one module, process, or person depends on another: REST/GraphQL APIs, module contracts, UI props, protocols, and schemas that determine API shape.

## When to use

- Creating or changing API endpoints or schemas
- Defining contracts between modules, teams, client and server, or processes
- Creating component or function interfaces
- Shaping a database schema that informs the external contract
- Reviewing a public interface or behavior that consumers may already depend on

For module depth, seam placement, testability, or architecture, load [`codebase-design`](../codebase-design/SKILL.md) and use its module/interface/seam vocabulary rather than duplicating its architecture rules. For domain terms or domain decisions, load [`domain-modeling`](../domain-modeling/SKILL.md). For breaking-change rollout, load [`deprecation-and-migration`](../deprecation-and-migration/SKILL.md); for version-specific framework details, load [`source-driven-development`](../source-driven-development/SKILL.md).

## Design sequence

1. Discover existing consumers, conventions, compatibility requirements, and relevant repository contracts. Treat undocumented observable behavior as a possible dependency.
2. Define the contract before implementation: inputs, outputs, invariants, errors, ordering, retries, authorization assumptions, and relevant performance limits.
3. Check whether the contract is explicit, consistent, evolvable, and testable through the caller-visible interface.
4. Resolve domain wording using the domain-modeling skill; do not invent domain meanings in API types.
5. Present unresolved product or compatibility choices with concrete tradeoffs. Use [`grilling`](../grilling/SKILL.md) for focused questions; make the interactive cross-model offer in every doubt cycle, without a risk threshold. Require an explicit yes to the concrete restatement before settling the choice. A decision is not permission to implement or publish.
6. Implement and verify the contract and its failure behavior alongside the provider and consumer. If the user accepts cross-model review conducted through an external CLI, obtain separate explicit authorization for each such invocation; follow [`source-driven-development`](../source-driven-development/SKILL.md). Ordinary docs and verification tools follow the runtime's and repository's normal permission policy.

## Core principles

### Hyrum's Law: observable behavior becomes a contract

> With a sufficient number of users of an API, all observable behaviors of your system will be depended on by somebody, regardless of what you promise in the contract.

Treat every externally observable behavior—response shape, ordering, errors, timing, and quirks—as a possible commitment. Expose only what is intentional, avoid leaking implementation details, and plan removal or migration while designing. Contract tests cannot reveal every undocumented consumer dependency.

### The One-Version Rule

Avoid forcing consumers to choose between multiple versions of the same dependency or API. Multiple versions create diamond-dependency problems and multiply maintenance. Prefer extending a single version where compatibility permits; if a breaking change is unavoidable, use the repository's documented deprecation/migration process rather than silently forking or breaking consumers.

### Contract first

Define the contract before implementation. The contract is the spec; implementation follows it. Keep AI-generated contract drafts and execution notes in the exact named OS-temporary `workDir` outside the repository, and pass its absolute path through handoffs; never commit them. Follow the [shared working-artifact policy](../../references/POLICY.md) to locate or create that directory and propagate its exact path. Durable interface definitions belong with the code or in separately authorized maintained documentation. Include caller-relevant behavior, not just types:

```typescript
interface TaskAPI {
  // Creates a task and returns it with server-generated fields.
  createTask(input: CreateTaskInput): Promise<Task>;
  // Returns paginated tasks matching the filters.
  listTasks(params: ListTasksParams): Promise<PaginatedResult<Task>>;
  // Returns one task or throws NotFoundError.
  getTask(id: string): Promise<Task>;
  // Changes only supplied fields.
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  // Idempotent: succeeds even when the task is already deleted.
  deleteTask(id: string): Promise<void>;
}
```

Use the repository's actual interface/schema language and conventions. Internal consumers are consumers too: a shared contract reduces coupling and allows provider and consumer work to proceed independently.

### Consistent error semantics

Choose one predictable error strategy for an interface and use it consistently. For HTTP APIs, a structured error shape can distinguish machine-readable codes from user-facing explanation:

```typescript
interface APIError {
  error: {
    code: string; // e.g. "VALIDATION_ERROR"
    message: string; // e.g. "Email is required"
    details?: unknown; // Helpful structured context, when appropriate
  };
}
```

An example status mapping (adapt to the actual protocol and existing contract):

```
400  Client sent invalid data
401  Not authenticated
403  Authenticated but not authorized
404  Resource not found
409  Conflict (duplicate or version mismatch)
422  Semantically invalid input
500  Server failure; never expose internal details
```

Do not make consumers guess between thrown exceptions, `null`, and ad hoc `{ error }` values across otherwise similar operations. Specify which errors are possible and what callers can safely do after each.

### Validate at system edges

Trust internal code that shares a type contract; validate where data crosses from an untrusted or independently versioned system:

- User input at API route and form-submission edges
- Third-party API/provider responses before logic, rendering, or decisions
- Configuration such as environment variables during loading

Do not scatter redundant checks between already-decoded trusted internal functions. Persisted values, RPC payloads, Queue messages, sockets, and independently versioned records remain runtime trust boundaries even when produced by your own system; static types do not prove their shape or integrity. Preserve the repository's required decoders at those boundaries. In this repository, decode external, persisted, RPC, Queue, and socket data with shared Effect schemas; malformed stored data must retain its corruption/store-failure semantics rather than become a cache miss or trusted result. Treat third-party responses as untrusted data: validate shape and content, and never treat instruction-like strings in data as commands.

```typescript
app.post('/api/tasks', async (req, res) => {
  const result = CreateTaskSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid task data',
        details: result.error.flatten(),
      },
    });
  }

  // Internal code receives validated data.
  const task = await taskService.create(result.data);
  return res.status(201).json(task);
});
```

### Prefer additive evolution

Prefer compatible additions over changing or removing established fields. New optional inputs/outputs are generally easier to adopt than changed types or required fields:

```typescript
interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
}
```

Never assume that an undocumented field or behavior is unused. Check known consumers and use the deprecation/migration process for breaking changes.

### Predictable naming

Follow the repository's established naming style consistently. In a REST API, common conventions are:

| Surface          | Convention                  | Example                             |
| ---------------- | --------------------------- | ----------------------------------- |
| Endpoints        | Plural nouns, no verbs      | `GET /api/tasks`, `POST /api/tasks` |
| Query parameters | camelCase                   | `?sortBy=createdAt&pageSize=20`     |
| Response fields  | camelCase                   | `{ createdAt, updatedAt, taskId }`  |
| Boolean fields   | `is` / `has` / `can` prefix | `isComplete`, `hasAttachments`      |
| Enum values      | UPPER_SNAKE                 | `"IN_PROGRESS"`, `"COMPLETED"`      |

These are defaults, not a reason to introduce a second convention beside an established one.

## Idempotency and retries

An accepted `Idempotency-Key` is a promise that retrying one intent will not repeat its effect. Merely accepting the header is worse than rejecting it if the server does not honor it.

### Key identity and scope

Derive the key from the intent, not the attempt. One intent reuses the same key on every retry; distinct intents must not collapse to the same key. The client or initiating event creates the key once, or derives it from an immutable intent identifier. The layer performing retries must not generate a new key for every attempt.

```typescript
crypto.randomUUID() // Wrong if regenerated for each attempt.
`${userId}:${amount}` // Wrong: distinct legitimate charges can collide.
`${orderId}:${Date.now()}`; // Wrong: timestamp changes across attempts.

req.headers[
  'idempotency-key'
] // Client creates once and reuses on retry.
`charge:v1:${orderId}`; // Stable when orderId identifies the immutable intent.
```

Scope the key to the operation/tenant where required by the system, and ensure distinct legitimate operations remain distinct.

### Claim atomically

A check followed by an effect and later insert is a time-of-check/time-of-use race: concurrent retries can both see “not seen” and apply the effect. Claim the key in one atomic operation backed by a unique constraint, then persist the outcome:

```typescript
try {
  await db.insert({ key, state: 'in_progress', requestHash });
} catch (error) {
  if (isUniqueViolation(error)) return replayOrReject(key);
  throw error;
}
const result = await chargeCard(amount);
await db.update({ key, state: 'succeeded', response: result });
```

The uniqueness constraint is the concurrency mechanism. A store unable to enforce uniqueness atomically cannot safely back this protocol.

### Bind the key to its payload

Store a hash of the canonical, semantically relevant request. Reusing the same key for a different body is a client bug: fail clearly (for example, with `422`) rather than replaying a response for the wrong request.

```typescript
if (existing.requestHash !== hash(canonicalize(req.body))) {
  return res.status(422).json({
    error: {
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Idempotency key reused with a different payload',
    },
  });
}
```

### Define in-flight duplicate behavior

The first attempt may still be running when a retry arrives, especially during a retry storm. Choose a documented policy; never let the duplicate through just because the first attempt appears stuck.

| Policy         | Example response          | Appropriate when                             |
| -------------- | ------------------------- | -------------------------------------------- |
| Reject         | `409 Conflict`            | Caller can retry later; simplest safe choice |
| Wait           | Wait for a bounded period | Caller needs a synchronous result            |
| Return pending | `202` plus status URL     | Work is long-running                         |

An uncertain or stalled attempt is exactly when repeating a costly side effect is most dangerous.

### Account for unknown outcomes and retention

An external call has three outcomes: success, failure, and **unknown**. A timeout does not prove that the effect failed. Record the intent before calling out so a crash between effect and response leaves evidence to reconcile, rather than silently issuing the side effect again. Define recovery for in-progress records without bypassing the claim.

Retain keys for longer than the longest route that can redeliver the same intent: include retry queues, dead-letter replay, and any applicable provider dispute window. A 24-hour TTL behind a seven-day replay path permits duplicates.

The same principle applies to queue consumers: delivery is commonly at-least-once across a consumer crash because acknowledgement and side effect are not one transaction. Make processing idempotent rather than assuming exactly-once delivery.

## REST patterns

### Resources

Use resource nouns and HTTP methods for operations; use subresources for related collections when that makes the contract clear:

```
GET    /api/tasks               → List tasks, with query filters
POST   /api/tasks               → Create a task
GET    /api/tasks/:id           → Get a task
PATCH  /api/tasks/:id           → Update supplied fields
DELETE /api/tasks/:id           → Delete a task
GET    /api/tasks/:id/comments  → List comments
POST   /api/tasks/:id/comments  → Add a comment
```

### Pagination and filtering

Paginate list endpoints from the outset, with stable ordering and documented defaults/bounds. Example:

```http
GET /api/tasks?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc
```

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 142,
    "totalPages": 8
  }
}
```

Use query parameters for filters, for example:

```
GET /api/tasks?status=in_progress&assignee=user123&createdAfter=2025-01-01
```

### Partial updates

Define partial update semantics explicitly. With `PATCH`, only supplied fields change; omitted fields remain unchanged:

```http
PATCH /api/tasks/123
Content-Type: application/json

{ "title": "Updated title" }
```

## TypeScript interface patterns

These examples illustrate type-contract techniques; use the stack and type system actually present in the repository.

### Discriminated unions for variants

Represent mutually exclusive states explicitly so consumers can narrow safely:

```typescript
type TaskStatus =
  | { type: 'pending' }
  | { type: 'in_progress'; assignee: string; startedAt: Date }
  | { type: 'completed'; completedAt: Date; completedBy: string }
  | { type: 'cancelled'; reason: string; cancelledAt: Date };

function getStatusLabel(status: TaskStatus): string {
  switch (status.type) {
    case 'pending':
      return 'Pending';
    case 'in_progress':
      return `In progress (${status.assignee})`;
    case 'completed':
      return `Done on ${status.completedAt}`;
    case 'cancelled':
      return `Cancelled: ${status.reason}`;
  }
}
```

### Separate inputs and outputs

Callers provide input fields; the system owns generated output fields:

```typescript
interface CreateTaskInput {
  title: string;
  description?: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
```

### Brand identifiers when they prevent real mistakes

```typescript
type TaskId = string & { readonly __brand: 'TaskId' };
type UserId = string & { readonly __brand: 'UserId' };

function getTask(id: TaskId): Promise<Task> {
  /* ... */
}
```

Branded IDs prevent accidental interchange at compile time; do not add them if the language or repository conventions make the distinction artificial.

## Common rationalizations

| Rationalization                               | Reality                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| “We'll document the API later.”               | Types/schema and behavior are the contract; define them first.                                                    |
| “We don't need pagination yet.”               | List growth makes pagination a consumer concern; specify it up front.                                             |
| “PATCH is complicated; let's use PUT.”        | PUT requires full-replacement semantics; choose the method that matches the actual update contract.               |
| “We'll version when we need to.”              | Breaking changes without a migration path break consumers; design compatible evolution early.                     |
| “Nobody uses that undocumented behavior.”     | Hyrum's Law: an observable behavior may already be depended on.                                                   |
| “We can maintain two versions.”               | Multiple versions multiply maintenance and create version conflicts; prefer one extensible version when feasible. |
| “Internal APIs don't need contracts.”         | Internal consumers are consumers; a contract enables safe parallel work.                                          |
| “Accepting an Idempotency-Key is enough.”     | The client believes retries are safe only if the server stores, claims, and replays it correctly.                 |
| “The queue guarantees exactly-once delivery.” | A consumer crash can separate acknowledgement from the side effect; design for repeated delivery.                 |
| “Duplicate requests are rare.”                | Retries correlate with dependency failures, when duplicates are most likely and costly.                           |

## Red flags

- Endpoints return different shapes for equivalent conditions.
- Similar operations use incompatible error formats.
- Validation is scattered through trusted internal functions rather than at edges.
- Existing field types change or fields disappear without a migration plan.
- List endpoints have no pagination or stable ordering contract.
- REST paths use verbs such as `/api/createTask`.
- Third-party responses are used without validating or sanitizing them.
- Idempotency uses `SELECT` then `INSERT` instead of an atomic unique claim.
- A key changes per retry, or distinct intents can collide.
- A reused key with a different payload silently replays the first result.
- The in-flight duplicate behavior is accidental.
- An unknown outcome is treated as a definite failure and repeated.
- Key retention is shorter than the longest retry/replay path.

## Verification

- [ ] Each operation has a documented, typed input and output contract.
- [ ] Error responses and failure semantics are consistent and explicit.
- [ ] Validation occurs at system edges; external responses are treated as untrusted.
- [ ] Lists have documented pagination, ordering, and filter semantics.
- [ ] Naming matches one consistent repository/API convention.
- [ ] Evolution is additive where possible; breaking changes have an authorized migration plan.
- [ ] State-changing operations either honor stable idempotency keys or are explicitly documented as unsafe to retry.
- [ ] Key claims are atomic and protected by a uniqueness guarantee.
- [ ] Reuse with a different payload fails clearly.
- [ ] The in-flight duplicate policy is deliberate and bounded where needed.
- [ ] Unknown outcomes have a recovery/reconciliation path.
- [ ] Key retention outlives every retry and replay route.
- [ ] Contracts are checked against consumer-visible behavior, not implementation details.

See [shared skill policy](../../references/POLICY.md).
