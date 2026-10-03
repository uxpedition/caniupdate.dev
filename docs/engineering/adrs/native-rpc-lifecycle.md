# Native RPC with explicit lifecycle handling

**Decision:** Return a native object from the briefing Worker's private submission RPC. At the built Nuxt Worker boundary, recognize Cloudflare's documented `Symbol.dispose`, invoke it in `finally`, and strictly validate the application data separately. Do not serialize the submission envelope to JSON text merely to avoid the runtime hook.

## Why

This product targets Cloudflare. Its documented RPC lifecycle is part of the platform contract, not an unexpected application field to reject.

`Symbol.dispose` names a cleanup method. Cloudflare adds it to object-valued RPC results so callers can release remote handles contained in a result. Disposing this submission envelope is not a request to cancel its briefing job or delete its D1 result.

The owner reconsidered the earlier JSON-text workaround in favor of native RPC with explicit lifecycle handling and unchanged strict application validation. The current checkout implements that choice.

## Costs and limits

- The built boundary requires a callable own disposer, captures it, and invokes it even if copying or decoding fails.
- Application data is copied from own string-keyed data properties, including non-enumerable ones. Other symbols and accessors are rejected; the strict schema continues rejecting undeclared application fields. Runtime machinery does not reach the browser.
- Nuxt's Node development bridge hides symbols and omits descriptor values. A compile-time development-only path reads the live string-keyed values and strictly decodes them without requiring a disposer. It is not the built Worker's contract.
- Lifecycle handling is platform-specific. Future bridge/runtime changes should be checked in the real built Worker, not inferred from mocks.

Reconsider if Cloudflare's documented lifecycle or the development bridge changes. Do not solve such changes by broadly allowing unknown response properties.

## Artifacts

- [Cloudflare RPC lifecycle documentation](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/#disposing-rpc-objects-disposes-stubs-that-are-part-of-that-object): authoritative purpose of disposal.
- [Current private submission contract](../briefing.md#evidence-identity-and-private-submission), [Worker return value](../../../workers/briefing/index.ts), and [Nuxt boundary](../../../server/api/package/[packageName]/compare/briefing.post.ts): source evidence for the current implementation.
- **Historical observation (built-Worker run, reported 2026-09-26):** The earlier direct strict decode rejected workerd's runtime-added own `Symbol.dispose` with a schema error, producing a sanitized 503. JSON text was an intermediate workaround; it was not an architectural necessity. This is a report of that run, not a fresh reproduction.
