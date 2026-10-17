# Cloudflare-managed request and generation admission

**Decision:** Use Workers' built-in Rate Limiting bindings to protect general public requests. Use a separate allowance for new briefing generations. Do not add an application counter store or an emergency pause control. Provider-side spend limits remain the control on monetary spending.

## Why

Public package search and comparison can trigger provider requests and archive work before AI generation starts. New briefing generations need a stricter limit. Reading a stored D1 success or joining accepted work must not use that allowance.

Checking at the HTTP submission boundary would charge cache hits and users joining an existing job. Checking outside the job lock would charge simultaneous submissions with the same evidence hash more than once.

The private job acceptance code checks the generation binding inside its existing lock. It first reuses any pending job and reconciles the D1 result. A refusal leaves durable identity, revision, leases, and dispatch unchanged. Queue recovery and read-only sockets are not subject to this limit.

## Costs and limits

- [Cloudflare documents](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) approximate counters at each Cloudflare location, with 10- or 60-second windows. Updates take time to become consistent, so counters can permit extra requests. They are not exact accounting or a global spending cap.
- The site has no accounts, so it deliberately uses IP addresses despite Cloudflare's recommendation to prefer stable user/account identities. Users sharing an IP share capacity. Changing address or location can evade the limit. Browser-selected identifiers would be trivial to bypass; adding accounts is out of scope.
- Nuxt uses only the original connecting address supplied by the platform. It sends a temporary SHA-256 key over private RPC (remote procedure call). Hashing reduces where raw addresses travel; it does not make visitors unidentifiable. This adds no visitor store, log field, cookie, or provider data. Requests with missing metadata share one bucket. Local Node ingress is not a security boundary.
- If the binding fails, work is refused rather than bought without protection. An allowance cannot be refunded if durable acceptance or dispatch later fails. The built-in API has no transactional reservation/refund operation.
- Namespace IDs are unique within the account. Local (`1001`/`1002`), stage (`2001`/`2002`), and production (`3001`/`3002`) counters are separate. Wrangler bindings are non-inheritable, so each environment declares them explicitly. GitLab stage and production inputs override deployment binding configuration. Policy is not owned by a dashboard-only setting or public runtime flag.
- The initial limits are 60 general requests and 3 new generations per minute. They allow modest browsing bursts while limiting sustained work without cached results. These are conservative starting points, not measured traffic capacity. Operators must review refusals on shared networks alongside provider usage.
- The [connecting-address trust model](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip) depends on direct Cloudflare ingress and trusted code in the same zone. Same-zone Worker scripts can change their subrequest address. Cross-zone Worker subrequests share Cloudflare's fixed Worker address. Do not give untrusted Workers same-zone forwarding or private submission bindings. A visitor-IP-removal transform puts callers in the unidentified bucket; it does not disable protection.

## Artifacts

- [Current request protection and private identity contract](../overview.md#public-request-and-new-generation-protection).
- [Generation lifecycle](../briefing.md) and [configuration ownership](../ops/deployment.md#rate-limit-configuration).
- [Public admission](../../../server/request/rateLimit.ts), [job acceptance](../../../workers/briefing/job.ts), and [managed runtime regressions](../../../workers/briefing/jobs.unit/rateLimit.unit.ts).

Reconsider identity policy if accounts become a product requirement. Review spending policy separately if provider-side limits no longer meet the operator's risk tolerance. Approximate rate limits must not become a billing guarantee.
