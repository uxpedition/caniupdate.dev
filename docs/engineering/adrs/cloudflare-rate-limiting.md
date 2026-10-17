# Cloudflare-managed request and generation admission

**Decision:** Use Workers built-in Rate Limiting bindings for general public request protection and a separate new-generation allowance. No application counter store or emergency pause control is introduced. Provider-side spend limits remain the monetary control.

## Why

Public package search and comparison can trigger provider requests and archive work before inference. New briefing generations require a stricter policy, but stored D1 success and joining accepted work must not spend that allowance. Checking at the HTTP submission boundary would charge cache hits and joiners; checking outside the job lock would charge simultaneous same-hash submissions repeatedly.

The private job acceptance owner therefore checks the generation binding after pending-job reuse and a reconciled D1 read, inside its existing lock. Refusal leaves durable identity, revision, leases and dispatch unchanged. Queue recovery and read-only sockets remain outside this control.

## Costs and limits

- [Cloudflare documents](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) approximate, permissive, eventually consistent counters per Cloudflare location, with 10- or 60-second windows. This is not an exact accounting system or a global monetary cap.
- The site has no accounts. IP-based limiting is a deliberate compromise against Cloudflare's recommendation to prefer stable user/account identity: shared-IP users share capacity, and address/location rotation evades it. Browser-selected identifiers would make the limit trivial to bypass; adding accounts is out of scope.
- Nuxt uses only the original platform-supplied connecting address and sends a transient SHA-256 key over private RPC. Hashing reduces raw address propagation, not identifiability. No additional visitor store, log field, cookie or provider data is introduced. Missing metadata shares one bucket; local Node ingress is not a security boundary.
- Binding failure fails closed rather than silently buying unprotected work. A consumed allowance cannot be refunded if later durable acceptance or dispatch fails. The built-in API does not offer transactional reservation/refund.
- Namespace IDs are unique within the account and separate local (`1001`/`1002`), stage (`2001`/`2002`), and production (`3001`/`3002`) counters. Wrangler bindings are non-inheritable, so each environment declares them explicitly. GitLab stage and production inputs override deployment binding configuration; no dashboard-only setting or public runtime flag owns policy.
- Initial 60 general requests and 3 new generations per minute allow modest browsing bursts while constraining sustained cold work. These are conservative starting points, not traffic-derived capacity measurements. Operators must review shared-network refusals alongside provider usage.
- The [connecting-address trust model](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip) depends on direct Cloudflare ingress and trusted code in the same zone. Same-zone Worker scripts can alter their subrequest address; cross-zone Worker subrequests share Cloudflare's fixed Worker address. Do not grant untrusted Workers same-zone forwarding or private submission bindings. A visitor-IP-removal transform collapses callers into the unidentified bucket rather than disabling protection.

## Artifacts

- [Current request protection and private identity contract](../overview.md#public-request-and-new-generation-protection).
- [Generation lifecycle](../briefing.md) and [configuration ownership](../ops/deployment.md#rate-limit-configuration).
- [Public admission](../../../server/request/rateLimit.ts), [job acceptance](../../../workers/briefing/job.ts), and [managed runtime regressions](../../../workers/briefing/jobs.unit/rateLimit.unit.ts).

Reconsider identity policy if accounts become a product requirement. Reconsider spend policy separately if provider-side limits no longer satisfy the operator's risk tolerance; approximate rate limits must not be promoted to a billing guarantee.
