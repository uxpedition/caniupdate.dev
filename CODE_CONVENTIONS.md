# Code conventions

Judgment-based conventions for implementing and reviewing **Can I update?** Runtime ownership and product meaning guide design and review decisions.

Read this document when reviewing code or choosing module boundaries, contracts, state ownership, or verification scope. Formatting, import sorting, type-safety restrictions, and size limits belong to the existing tooling configuration. Check commands live in `package.json`; operational recipes live in [development operations](docs/engineering/ops/development.md).

## Cohesion before abstraction

- Start with the smallest design that solves the current requirement. Introduce an abstraction for an actual shared responsibility, runtime boundary, or testing seam—not hypothetical replacement or scale.
- Keep files that change for the same reason together. Extract shared logic when consumers share meaning, not merely similar syntax. A generic helper should have a clearer contract than the code it replaces.
- Split modules around responsibilities and invariants. A file below the linter's size limit can still mix unrelated concerns; splitting solely to satisfy a line count can hide the flow.
- Give each module a clear public surface. Export what callers need; use the existing direct-import conventions rather than adding barrel files by default.
- Name domain operations by intent. Keep provider-specific names in adapters where they explain the dependency; domain logic should describe comparison, collection, or generation rather than a vendor.
- Comments explain a constraint, ordering requirement, or tradeoff that names and types cannot express. Keep the explanation beside the code it constrains.

## Ownership and dependencies

- Keep public handlers thin: decode the request, invoke the owning workflow, and translate its result. Keep provider I/O in adapters and normalization, comparison, and presentation independently testable.
- Inject narrow services at I/O seams. Effect workflows own resource lifetimes, concurrency, deadlines, and typed failures; runtime entrypoints execute them. A wrapper earns its place by owning policy or a contract, not merely forwarding calls.
- Share cross-runtime contracts without importing server or database implementation into the browser. Route-local helpers stay with their route; domain logic stays with its domain.
- Preserve the separate Nuxt, evidence, and briefing responsibilities. A fallback must not silently move collection, generation, or durable ownership into another runtime.

For ownership changes, trace the affected callers against the [architecture overview](docs/engineering/overview.md). For collection or job changes, consult [evidence](docs/engineering/evidence.md) or [briefing](docs/engineering/briefing.md) respectively.

## Contracts preserve meaning

- Derive types from shared Effect schemas where data crosses a trust boundary. Static types describe decoded data; they do not validate network, storage, RPC, Queue, or socket payloads.
- Keep raw `unknown` local to parsing and error inspection; the owning operation returns decoded values. Compose JSON text with its domain schema when that preserves error classification and transport bounds. A schema used only for a type alias, or an unrelated serializer generic, does not establish validation.
- Distinguish a shallow object-category gate from domain validation. `Predicate.isObjectOrArray` retains arrays and rejects primitives and functions; `Schema.is(Schema.Struct({}))` does not establish that category. Use the owning schema for actual boundary decoding.
- Model meaningful states as discriminated unions. Each variant should carry the evidence or reason its consumer needs, rather than requiring combinations of booleans to reconstruct state.
- Choose absence semantics per contract. Missing declarations, explicit `null`, empty collections, and unavailable evidence can mean different things. Preserve those distinctions through normalization, persistence, and rendering.
- Normalize only what the domain permits. Conditional export and `typesVersions` order affects precedence; sorting it for convenience changes meaning.
- Treat contract changes as cross-file changes: update producers, decoders, persistence, and consumers together. Adopt a compatibility path only when a real deployed boundary requires it, with an explicit retirement condition.

## Uncertainty is a result

- Degrade within the affected evidence tier, retaining unrelated facts. Partial or unavailable evidence should remain visible as uncertainty—not become zero advisories, an unchanged result, or upgrade approval.
- Distinguish expected provider unavailability from infrastructure or protocol failure. Storage corruption is not a cache miss; malformed private-service data is not an empty successful response.
- Give users actionable feedback for invalid input and honest availability states for system failures. Public errors remain sanitized; internal diagnosis retains useful context without exposing secrets or raw payloads.
- Catch errors where the code can classify, recover, or add useful context. Recovery must preserve the contract's meaning and identify what remains unknown.
- Keep AI notes supplementary and evidence-backed. Facts render independently; copy distinguishes declarations, measurements, and inference. Package-level evidence does not establish compatibility with a consumer project.

Review conclusions against [product meaning and limitations](docs/product/meaning-and-limitations.md), especially for advisory coverage, compatibility claims, and legal interpretation.

## State has one owner

- Vue Query owns server data and its lifecycle; local interaction belongs in `ref`, derived state in `computed`, and shared form/UI state in keyed Nuxt `useState`. Share subtree-only ephemeral state through a scoped provider when needed.
- Query identity must describe the selected comparison and evidence tier. Keep hydration, route changes, cancellation, and stale-data rendering consistent with that identity instead of mirroring query data into another store.
- Components own rendering and interaction; composables own reusable reactive orchestration. Domain-unaware UI primitives remain independent of API clients and comparison state. Reuse existing tokens and variants before adding visual exceptions.
- Independent evidence tiers load and fail independently. Factual rendering must remain usable without a successful briefing.
- Worker correctness state is durable. In-memory coalescing is an optimization, not ownership of a job or result. Review retries, restarts, late completions, and concurrent writers against generation IDs, revisions, fencing, and first-writer-wins success.
- Read-only subscription and reconnect observe existing jobs; they do not initiate generation. A browser leaving a page does not imply cancellation of shared durable work.

## Bounded and diagnosable I/O

- Treat provider locations, package selectors, and archive contents as untrusted. Preserve fixed-origin requests, exact-once scoped-name encoding, archive integrity checks, and download/deadline limits.
- Put admission, cancellation, and resource cleanup at the owner that can enforce them. Explain whether a bound applies to one request, one object, or the whole service; do not present a local limit as an account-wide guarantee.
- Keep credentials, prompts, evidence packets, archive inventories, and raw provider errors within their private boundaries. Diagnostic logs should use bounded metadata and existing job/request identities rather than dumping payloads.
- Preserve enough context to distinguish provider failure, invalid data, storage failure, and stale work. New observability should answer a concrete diagnostic question, not introduce a tracing platform by convention.

## Persistence and operations

- Use reviewed, versioned migrations for both D1 and Durable Object SQLite. Treat generated history and its runtime artifacts as one change; preserve applied history and validate stored data when reading it.
- Design recovery around the actual durable owner, not assumptions about a long-lived process. Persistence changes need evidence for restart behavior, concurrent writes, and reuse of existing results where affected.
- Keep configuration ownership explicit across the three runtimes. Verification uses isolated state and fixture credentials; routine QA must not mutate shared environments or user-owned secrets.
- Infrastructure changes document the authorized environment and recovery implications. Local builds and previews are verification, not deployment authorization.

For database changes, read the [database ADR](docs/engineering/adrs/drizzle-database-layer.md). For deployment or recovery changes, read [deployment operations](docs/engineering/ops/deployment.md) and [release/recovery operations](docs/engineering/ops/releases-and-recovery.md).

## Evidence-driven review

- Keep a change focused on one outcome. Include the reason and material tradeoffs; record durable architecture decisions in the existing ADR structure rather than relying only on a chat or PR.
- Match verification to the risk. Pure comparisons need behavioral checks; persistence, queues, alarms, and sockets need real runtime evidence where their semantics matter. Stub external providers, not the platform behavior under examination.
- Review lint remediation against the original contract, not just the remaining warning count. Partial assertion and match patterns are not constructed tagged values; naming an exact anonymous contract improves ownership, not runtime evidence. Diagnostics should distinguish those cases and give behavior-preserving help.
- Transformation cleanup preserves callback ordering, indexes, sparse-array behavior, and property presence. A fused pass can interleave callbacks that previously ran in separate phases; verify equivalence before optimizing.
- Permanent tests protect consumer-visible behavior, boundaries, precedence, uncertainty, cancellation, and recovery. Prefer deterministic, isolated tests over assertions tied to private structure or mock forwarding.
- UI verification exercises the rendered surface, including hydration and navigation. A successful API request or SSR HTML response is not evidence that controls work; frontend/framework changes need Chromium and Firefox checks.
- For every acceptance criterion, the reviewer identifies exercised evidence, a concrete defect, or an explicit verification gap. Claims about behavior follow traced execution or observed results, not naming or code shape alone.
- Review all affected owners and callers in a migration. Additional review or verification should resolve a named risk rather than repeat the same checks without a question.
- Classify recurring findings: fixed syntactic or filesystem patterns belong in deterministic checks; cross-file consistency and domain tradeoffs belong here. Keep automated policy authoritative instead of duplicating its rules in prose.
