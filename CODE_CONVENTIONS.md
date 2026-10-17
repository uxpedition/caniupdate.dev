# Code conventions

Use these conventions when writing or reviewing **Can I update?** They cover decisions that need judgment: module boundaries, data contracts, state ownership, and verification.

Tool configuration owns formatting, import order, type-safety rules, and size limits. Find check commands in `package.json` and procedures in [development operations](docs/engineering/ops/development.md).

## Cohesion before abstraction

- Start with the smallest design that meets the need. Add an abstraction for a real shared responsibility, runtime boundary, or test seam—not a possible future replacement.
- Keep files together when they change for the same reason. Share logic when callers share its meaning, not just similar syntax.
- Split modules by responsibility and the rules they must preserve. A short file can still mix unrelated concerns. Splitting only to meet a line limit can make the flow harder to follow.
- Export what callers need. Use direct imports rather than adding files that only re-export other modules.
- Name operations for what they do: compare, collect, or generate. Keep vendor-specific names in provider adapters.
- Use comments for constraints, ordering, or tradeoffs that names and types cannot explain. Put them beside the affected code.

## Ownership and dependencies

- Keep public handlers small: decode the request, call the workflow, and translate its result. Put provider I/O in adapters. Keep normalization, comparison, and presentation separately testable.
- Inject small services where I/O happens. Effect workflows own resource cleanup, concurrency, deadlines, and typed failures; runtime entrypoints run them.
- Add a wrapper only if it owns a policy or contract, not just to forward a call.
- Share cross-runtime contracts, but keep server and database implementations out of the browser. Keep route helpers with their route and domain logic with its domain.
- Keep Nuxt, evidence, and briefing responsibilities separate. A fallback must not silently move work or durable ownership to another runtime.

For ownership changes, trace the affected callers against the [architecture overview](docs/engineering/overview.md). For collection or job changes, consult [evidence](docs/engineering/evidence.md) or [briefing](docs/engineering/briefing.md) respectively.

## Contracts preserve meaning

- Derive types from shared Effect schemas at trust boundaries. TypeScript types describe decoded data; they do not validate network, storage, RPC, Queue, or socket payloads.
- Keep raw `unknown` values inside parsing and error inspection. Return decoded values from the owning operation.
- Combine JSON parsing with its domain schema when that preserves error categories and transport limits. A schema used only as a type alias, or an unrelated serializer generic, does not validate data.
- Separate object-category checks from domain validation. `Predicate.isObjectOrArray` accepts objects and arrays, not primitives or functions. `Schema.is(Schema.Struct({}))` does not prove that category. Use the owning schema to decode boundary data.
- Model states as discriminated unions: each named variant carries the evidence or reason its caller needs. Avoid combinations of booleans that callers must interpret.
- Preserve differences between a missing declaration, explicit `null`, an empty collection, and unavailable evidence through normalization, storage, and rendering.
- Normalize only where meaning stays the same. Conditional exports and `typesVersions` use order to decide precedence; sorting changes their meaning.
- When a contract changes, update producers, decoders, storage, and consumers together. Keep compatibility code only for a real deployed boundary, with a clear removal condition.

## Uncertainty is a result

- Keep unrelated facts when one evidence tier fails. Show partial or unavailable evidence as uncertainty, not zero advisories, “unchanged,” or approval to upgrade.
- Separate expected provider unavailability from infrastructure and protocol failures. Storage corruption is not a cache miss. Malformed service data is not an empty success.
- Explain how to fix invalid input. For system failures, state honestly what is unavailable. Keep public errors sanitized and useful diagnostic context private.
- Catch errors where code can classify them, recover, or add useful context. Recovery must preserve the contract and say what remains unknown.
- Keep AI notes optional and based on evidence. Render facts independently. Distinguish declarations, measurements, and interpretations; package facts do not prove compatibility with a user's project.

Review conclusions against [product meaning and limitations](docs/product/meaning-and-limitations.md), especially for advisory coverage, compatibility claims, and legal interpretation.

## State has one owner

- Let Vue Query own server data and its lifecycle. Use `ref` for local interaction, `computed` for derived state, and keyed Nuxt `useState` for shared form/UI state. Use a scoped provider for temporary state shared only within a subtree.
- Make query identity describe the comparison and evidence tier. Use it consistently for hydration, route changes, cancellation, and stale data. Do not mirror query data in another store.
- Let components own rendering and interaction, and composables coordinate reusable reactive work. Keep general UI primitives independent of API clients and comparison state. Reuse tokens and variants before adding exceptions.
- Let independent evidence tiers load and fail separately. Facts must remain usable without an AI briefing.
- Store Worker correctness state durably. Sharing in-flight work in memory is an optimization, not ownership of a job or result.
- Check retries, restarts, late completions, and concurrent writes against generation IDs, revisions, fencing, and first-writer-wins success.
- Keep subscriptions and reconnects read-only. Leaving a page does not cancel shared durable work.

## Bounded and diagnosable I/O

- Treat provider URLs, package selectors, and archives as untrusted. Keep requests on fixed origins, encode scoped package names exactly once, verify archive integrity, and enforce download limits and deadlines.
- Enforce capacity limits, cancellation, and cleanup where the work is owned. Say whether a limit covers a request, an object, or the service. A local limit is not an account-wide guarantee.
- Keep credentials, prompts, evidence packets, archive inventories, and raw provider errors private. Log bounded metadata and existing job/request identities, not payloads.
- Keep enough diagnostic context to tell provider failure, invalid data, storage failure, and stale work apart. Add instrumentation to answer a specific question, not just to introduce a tracing system.

## Persistence and operations

- Use reviewed, versioned migrations for D1 and Durable Object SQLite. Change generated history and its runtime files together. Preserve applied history and validate data when reading it.
- Recover through the actual durable owner; do not assume a process stays alive. For affected storage paths, verify restart behavior, concurrent writes, and reuse of existing results.
- Make configuration ownership clear across the three runtimes. Verify with isolated state and fixture credentials. Routine checks must not change shared environments or user-owned secrets.
- Document the authorized environment and recovery effects of infrastructure changes. Local builds and built dev runs verify behavior; they do not authorize deployment.

For database changes, read the [database ADR](docs/engineering/adrs/drizzle-database-layer.md). For deployment or recovery changes, read [deployment operations](docs/engineering/ops/deployment.md) and [release/recovery operations](docs/engineering/ops/releases-and-recovery.md).

## Evidence-driven review

- Keep each change focused on one outcome. Explain the reason and important tradeoffs. Record lasting architecture decisions in ADRs, not only in chat or a pull request.
- Match verification to risk. Check pure comparisons through behavior. Use real runtimes for storage, queues, alarms, and sockets when platform behavior matters. Stub external providers, not the platform being checked.
- Judge lint fixes against the original contract, not just the warning count. See [Lint diagnostic detail](#lint-diagnostic-detail) for local rule wording and limits.
- Preserve callback order, indexes, sparse-array behavior, and property presence when simplifying transformations. Combining passes can interleave callbacks that previously ran separately. Verify equivalence before optimizing.
- Keep permanent tests focused on behavior users can observe: boundaries, precedence, uncertainty, cancellation, and recovery. Prefer deterministic, isolated tests over checks of private structure or mocked forwarding.
- Verify UI behavior in the rendered interface, including hydration and navigation. Successful API requests or server-rendered HTML do not prove that controls work. Check frontend/framework changes in Chromium and Firefox.
- For each acceptance criterion, identify exercised evidence, a concrete defect, or an explicit verification gap. Base claims on traced execution or observed results, not names or code shape alone.
- Review every affected owner and caller during a migration. Extra review or checks should resolve a named risk, not repeat work without a question.
- Put recurring syntax and filesystem checks in tools. Keep cross-file consistency and domain tradeoffs here. Tooling owns automated policy; do not repeat its rules in prose.

### Lint diagnostic detail

Partial assertion and match patterns are not constructed tagged values. Naming an exact anonymous contract clarifies ownership; it does not add runtime evidence. Diagnostics must distinguish these cases and suggest fixes that preserve behavior.

Use a short problem headline, then unindented `help:` lines with concrete fixes. Add `note:` lines only for relevant meaning or limitations.

Describe what the detector proves, not a defect inferred from it. Keep rule descriptions focused on purpose. Check library-specific fixes against the pinned API.
