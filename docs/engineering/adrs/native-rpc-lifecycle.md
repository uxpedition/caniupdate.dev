# Native RPC with explicit lifecycle handling

**Decision:** Return a native object from the briefing Worker's private submission RPC (remote procedure call). At the built Nuxt Worker boundary, recognize Cloudflare's documented `Symbol.dispose` and call it in `finally`. Validate application data strictly and separately. Do not turn the submission envelope into JSON text just to avoid the runtime cleanup hook.

## Why

This product targets Cloudflare. Its documented RPC lifecycle is part of the platform contract, not an unexpected application field to reject.

`Symbol.dispose` names a cleanup method. Cloudflare adds it to object-valued RPC results so callers can release remote handles in the result. Disposing this submission envelope does not cancel its briefing job or delete its D1 result.

The owner reconsidered the earlier JSON-text workaround and chose native RPC with explicit cleanup. Strict application validation stays unchanged. The current checkout implements that choice.

## Costs and limits

- The built boundary requires the result's own callable disposer. It captures that method and calls it even if copying or decoding fails.
- Application data is copied from the object's own string-keyed data properties, including non-enumerable ones. Other symbols and accessors are rejected. The strict schema still rejects undeclared application fields. Runtime machinery does not reach the browser.
- Nuxt's Node development bridge hides symbols and omits descriptor values. A compile-time, development-only path reads live string-keyed values and strictly decodes them without requiring a disposer. This is not the built Worker's contract.
- Cleanup is platform-specific. Check future bridge/runtime changes in the real built Worker, not just mocks.

Reconsider if Cloudflare's documented lifecycle or the development bridge changes. Keep rejecting unknown response properties rather than broadly allowing them.

## Artifacts

- [Cloudflare RPC lifecycle documentation](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/#disposing-rpc-objects-disposes-stubs-that-are-part-of-that-object): authoritative purpose of disposal.
- [Current private submission contract](../briefing.md#evidence-identity-and-private-submission), [Worker return value](../../../workers/briefing/index.ts), and [Nuxt boundary](../../../server/api/package/[packageName]/compare/briefing/index.post.ts): source evidence for the current implementation.
- **Historical observation (built-Worker run, reported 2026-09-26):** Direct strict decoding originally rejected workerd's runtime-added own `Symbol.dispose`. The schema error produced a sanitized 503. JSON text was an intermediate workaround, not an architectural requirement. This reports that run; it is not a fresh reproduction.
