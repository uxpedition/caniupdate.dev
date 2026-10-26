# Deployment operations

This guide describes stage and production automation, operator prerequisites, and verification requirements. Deployment existence does not establish release provenance, migration state, or full production readiness.

See [development](development.md) for local commands and [releases and recovery](releases-and-recovery.md) for promotion, verification, and migrations.

## Which environment should I use?

| Environment                | Owner and purpose                      | Policy                                                                                       |
| -------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Local development          | Any contributor                        | No Cloudflare account or paid inference required                                             |
| Local built dev            | Any contributor                        | Real local Worker runtime, not a remote deployment                                           |
| Contributor demo           | Contributor's Cloudflare account       | Optional; contributor owns resources, visibility, provider configuration, costs, and cleanup |
| Official integration stage | Maintainer team                        | One persistent, restricted environment; maintainers deploy reviewed revisions                |
| Production                 | Maintainer account at `caniupdate.dev` | Maintainer-controlled release; separate resources and credentials                            |

The checked-in Wrangler files contain local defaults and the maintainer's remote `env.stage` and `env.production`. Their names, IDs, and hostnames are account-specific.

**Do not deploy these files unchanged into a contributor account. Never deploy the default local environment.** Production names, bindings, origins, and routes in source do not prove that remote resources or domain attachments exist.

Contributors can request an official stage in a PR without receiving deployment credentials. This guide establishes no automatic privileged fork-deployment workflow. Unreviewed code can steal stage secrets even when production is isolated.

## What does a complete deployment contain?

The system uses three Workers in the same account:

| Worker   | Public surface                      | Required resources                                                                                                        |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Site and comparison APIs            | External `PACKAGE_EVIDENCE` Durable Object binding and private `BRIEFING_SERVICE` entrypoint binding                      |
| Evidence | None in the checked-in remote stage | SQLite-backed `PackageEvidence` Durable Objects; optional GitHub token                                                    |
| Briefing | Read-only browser WebSocket route   | `BRIEFING_JOBS` Durable Objects, `BRIEFING_QUEUE`, `BRIEFINGS_DB`, provider configuration when real generation is enabled |

Private submission and the public socket have separate roles. The browser cannot request generation directly through the briefing Worker's public route. Allowing a socket Origin does not authenticate a user.

Sources: [frontend config](../../../wrangler.jsonc), [evidence config](../../../workers/evidence/wrangler.jsonc), [briefing config](../../../workers/briefing/wrangler.jsonc), and [briefing architecture](../briefing.md).

## How should an account-local configuration be prepared?

There is no account-local setup or configuration-generation command. A contributor deployment needs account-specific configuration with the inputs and checks below.

For each remote target, explicitly select:

- Cloudflare account and deployment environment.
- Frontend, evidence, and briefing Worker names.
- Frontend origin and browser socket origin.
- D1 database name and ID.
- Queue name, identical in producer and consumer configuration.
- Deployment credentials scoped to that account and the required operations.
- Optional provider settings and stage access policy.

Keep linked values consistent:

| Configuration                  | Required relationship                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `PACKAGE_EVIDENCE.script_name` | Exact deployed evidence Worker name                           |
| `BRIEFING_SERVICE.service`     | Exact deployed briefing Worker name                           |
| `BRIEFING_SERVICE.entrypoint`  | `BriefingSubmitter`                                           |
| D1 binding                     | `BRIEFINGS_DB`, with this target's database ID                |
| Queue binding                  | `BRIEFING_QUEUE`, with this target's queue name               |
| Job Durable Object binding     | `BRIEFING_JOBS`, class `BriefingJob`                          |
| `NUXT_PUBLIC_SITE_URL`         | Exact frontend origin, supplied to the Worker at runtime      |
| `BRIEFING_PUBLIC_URL`          | Reachable `wss` socket origin for this target                 |
| `BRIEFING_ALLOWED_ORIGIN`      | Derived from `NUXT_PUBLIC_SITE_URL`; no separate GitLab input |

Keep the configured SQLite Durable Object migrations. Declare bindings explicitly for each environment; do not assume Wrangler inherits them.

If you move configs, resolve `main`, schema, and migration paths relative to their new locations. The built frontend config must use the account-local frontend configuration, not silently keep the maintainer's bindings.

Do not commit operator keys or include account-specific changes in unrelated contributions. Before publishing a fork deployment recipe, exercise the workflow in an independent account. This guide does not fill that missing capability with guessed commands.

## Where do credentials and runtime settings go?

GitLab owns all stage and production runtime settings. Before activation:

1. Create project environments `stage`, `production`, and `release-tag` under **Operate → Environments**.
2. Scope runtime values and deployment credentials to their exact job environment. Never use `*`, `stage*`, or another broad wildcard. The origin-independent build has no GitLab environment.
3. Protect `release-tag` and `production` for Maintainer/Owner access. This restricts the manual release action and production deployment. The release API also checks the manual actor's project role.
4. Protect every variable. Turn **Expand variable reference** off (raw).
5. Use **Visible** for public values and **Masked and hidden** for private settings and credentials.

Masked values must be single-line, at least eight characters, and contain no spaces. See [GitLab CI/CD variable visibility and masking](https://docs.gitlab.com/ci/variables/#mask-a-cicd-variable).

| GitLab variable                    | Owner / exact environment scope                               | Stage / production value or requirement                                                                                                      | Variable settings                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_SITE_URL`             | Frontend Worker / `stage`, `production`                       | Stage `https://stage.caniupdate.dev`; production must be `https://caniupdate.dev`                                                            | Protected, Visible, Raw                                                                                                     |
| `NUXT_PUBLIC_TELEMETRY_ENABLED`    | Frontend Worker / `stage`, `production`                       | Required exact `true` or `false`; `true` requires the shared OTLP endpoint and controls frontend export only                                 | Protected, Visible, Raw                                                                                                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`      | Frontend and Briefing Workers / `stage`, `production` if used | Optional shared HTTPS OTLP base endpoint; omit if unused; no URL credentials, query, or fragment                                             | Protected, Masked and hidden, Raw when populated                                                                            |
| `OTEL_EXPORTER_OTLP_HEADERS`       | Frontend and Briefing Workers / `stage`, `production` if used | Optional shared JSON string-to-string map; omit if unused                                                                                    | Protected, Masked and hidden, Raw when populated                                                                            |
| `AI_BRIEFING_ENDPOINT`             | Briefing Worker / `stage`, `production`                       | Required HTTPS OpenAI-compatible Chat Completions URL ending in `/chat/completions`; no URL credentials, query, or fragment                  | Protected, Masked and hidden, Raw                                                                                           |
| `AI_BRIEFING_API_KEY`              | Briefing Worker / `stage`, `production`                       | Required dedicated provider key for each environment                                                                                         | Protected, Masked and hidden, Raw                                                                                           |
| `AI_BRIEFING_MODEL`                | Briefing Worker / `stage`, `production`                       | Required provider model identifier selected by the maintainer                                                                                | Protected, Masked and hidden, Raw when GitLab masking requirements allow; a short non-secret model name may be Visible, Raw |
| `BRIEFING_PUBLIC_URL`              | Briefing Worker / `stage`, `production`                       | Stage `wss://stage-briefing.caniupdate.dev`; production `wss://briefing.caniupdate.dev`                                                      | Protected, Visible, Raw                                                                                                     |
| `GITHUB_TOKEN`                     | Evidence Worker / `stage`, `production` if used               | Optional; omit when unused                                                                                                                   | Protected, Masked and hidden, Raw when populated                                                                            |
| `PUBLIC_RATE_LIMIT`                | Frontend binding deployment config / `stage`, `production`    | Optional positive safe integer; omission uses 60 requests per 60 seconds                                                                     | Protected, Visible, Raw                                                                                                     |
| `BRIEFING_GENERATION_RATE_LIMIT`   | Briefing binding deployment config / `stage`, `production`    | Optional positive safe integer; omission uses 3 new generations per 60 seconds                                                               | Protected, Visible, Raw                                                                                                     |
| `CLOUDFLARE_API_TOKEN`             | Deployment job / `stage`, `production`                        | Required CI-only deployment token                                                                                                            | Protected, Masked and hidden, Raw                                                                                           |
| `CF_ACCESS_CLIENT_ID`              | Deployed smoke job / `stage`                                  | Required Access service-token ID                                                                                                             | Protected, Masked and hidden, Raw                                                                                           |
| `CF_ACCESS_CLIENT_SECRET`          | Deployed smoke job / `stage`                                  | Required Access service-token secret                                                                                                         | Protected, Masked and hidden, Raw                                                                                           |
| `GITLAB_RELEASE_TAG_API_TOKEN`     | Release verification / `release-tag`                          | Read-only project API and repository access (`read_api`, `read_repository`) for pipeline, stage, membership, tag, and protected-tag evidence | Protected, Masked and hidden, Raw; exact `release-tag` scope only                                                           |
| `GITLAB_RELEASE_TAG_SSH_KEY`       | Protected tag creation / `release-tag`                        | File variable containing the dedicated project deploy key's multiline private SSH key                                                        | Protected, Visible, Raw, File                                                                                               |
| `GITLAB_RELEASE_TAG_DEPLOY_KEY_ID` | Protected tag creation / `release-tag`                        | Non-secret project deploy-key ID paired with the private-key file                                                                            | Protected, Visible, Raw                                                                                                     |

Validate `NUXT_PUBLIC_SITE_URL` against the target's frontend origin before each release. Canonical URLs in rendered HTML help check the public output, but do not establish that GitLab variables and Worker runtime settings agree.

`NUXT_PUBLIC_RELEASE_VERSION` is not a GitLab variable. Production derives it from the validated release receipt for the frontend runtime. Stage receives no release-version override.

`NUXT_INDEXING_ENABLED` is also derived, not a GitLab input. The deployment helper sends `true` only for a validated
production target and sends `false` for stage, clearing any previous managed value. Local and contributor-demo
runtimes default to `false`. Do not opt a demo into production indexing. The frontend's response policy sets
`X-Robots-Tag: noindex, follow` on nonproduction HTML, including publicly reachable pages; robots.txt disallow is
not the deindexing control. Keep Cloudflare Access and the existing origin/rate-limit controls in place.

On production, the [reviewed comparison policy](../overview.md#search-indexing-pilot) still decides which successful
HTML responses are eligible. Errors and unreviewed comparisons remain `noindex`. After changing inventory membership
or indexing policy, invalidate affected cached HTML before verifying headers: the static pages can remain at the edge
for one year and completed comparisons for twelve hours. Check both a reviewed and an excluded comparison, a failed
comparison, and stage static HTML. A local smoke run does not establish hosted cache invalidation or Access protection.

Enter `OTEL_EXPORTER_OTLP_HEADERS` as one-line JSON with string keys and values. Do not use OTLP shell syntax such as `Authorization=...` or comma-separated pairs.

For Basic authentication, encode the required space as `\u0020`: `{"authorization":"Basic\u0020<base64>"}`. Replace the placeholder with the generated credential. GitLab's raw setting preserves the escape; JSON parsing restores the space. **Never use Visible for an API key, Access credential, or authentication-header value.**

CI reads the shared OTLP pair and validates its header map once. It supplies only:

- Frontend: `NUXT_OTEL_ENDPOINT` and `NUXT_OTEL_HEADERS`.
- Briefing: `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.

The pair never reaches the build, Evidence Worker, or browser. Required `NUXT_PUBLIC_TELEMETRY_ENABLED` controls frontend export only. `true` requires an endpoint; briefing exports whenever its endpoint is configured.

There is no GitLab `BRIEFING_ALLOWED_ORIGIN` input. CI derives it from `NUXT_PUBLIC_SITE_URL`.

Configure both OTLP inputs together. When unused, omit both rather than entering blank or `{}` values. The helper still sends every allowed key:

- Missing OTLP inputs become endpoint `""` and headers `{}` for frontend and briefing, clearing old managed values.
- Missing `GITHUB_TOKEN` becomes `""` for evidence.

Wrangler retains secrets omitted from `--secrets-file`, so sending the complete list is necessary. The helper writes temporary JSON files under an OS directory with mode `700`; files use mode `600`. It removes them in `finally`.

CI deployment and Access credentials stay in their jobs. They never enter Worker secret files or the build. Encrypting a public setting as a Worker secret does not make a `NUXT_PUBLIC_*` value private.

### Deployment environment and resource identity

Use GitLab environment `stage` and Wrangler `--env stage` for staging. Runtime settings and credentials must match the exact scopes in the variable matrix.

Use the Worker names and resource identities from the `env.stage` sections of the [frontend](../../../wrangler.jsonc), [evidence](../../../workers/evidence/wrangler.jsonc), and [briefing](../../../workers/briefing/wrangler.jsonc) configurations. Preserve the configured Queue, D1, Durable Object namespaces, IDs, and bindings unless a resource migration is explicitly authorized.

**Before deployment, stop or wait for any pipeline targeting the same resources outside the current `stage` lock.** Different resource-group names do not coordinate deployments.

The credential-free `build-smoke` job has no GitLab environment. It receives build identity, not `NUXT_PUBLIC_SITE_URL` or stage/production runtime settings.

Site and runtime values use exact `stage` or `production` scopes and reach only their owning Worker. No runtime values remain in `env.stage.vars` or `env.production.vars`. Rate limits configure bindings through temporary deployment config, not Worker variables or secrets.

Use a fresh CI-only Cloudflare API token with these permissions:

- Account: **Workers Scripts: Edit**, **D1: Edit**, and **Queues: Edit**.
- Active `caniupdate.dev` zone only: **Zone → Zone: Read** and **Zone → Workers Routes: Edit**, for reconciling custom domains.

**Do not grant DNS Edit or Account Settings Read.** The newer [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) page calls the route action `Workers Routes: Write`. Choose `Edit` if that is the API-token editor's label. Creating domains in the dashboard does not bypass Wrangler's route reconciliation on later deployments.

These account permissions cover existing account resources, not just stage names. Contributors use their own credentials, never the maintainer token. See [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [local ownership](development.md#where-does-configuration-belong).

Production is intended to use OpenRouter at `https://openrouter.ai/api/v1/chat/completions`, with a dedicated key and operator-set spend limit. Operators choose budget amounts and reset intervals.

Stage real-provider checks need a separate key. The official stage requires its own real-provider configuration; checks that generate fresh briefings can incur charges. Default contributor checks use fixtures only.

Self-hosters can use another provider supporting the OpenAI-compatible Chat Completions contract. HTTPS is required except for loopback fixtures. Endpoint query parameters are rejected.

Model output must meet the strict JSON/citation contract. API compatibility alone does not guarantee valid output. See [provider behavior](../briefing.md#result-storage-and-generation-failures).

A spend cap does not protect Cloudflare quotas or guarantee fair access. A cached briefing does not prove the provider key or new-generation path works.

### Rate-limit configuration

The bindings use [Cloudflare's built-in Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), not application counters.

| Environment | Public namespace / limit            | New-generation namespace / limit      |
| ----------- | ----------------------------------- | ------------------------------------- |
| Local       | `1001` / 60 requests per 60 seconds | `1002` / 3 generations per 60 seconds |
| Stage       | `2001` / default 60 per 60 seconds  | `2002` / default 3 per 60 seconds     |
| Production  | `3001` / default 60 per 60 seconds  | `3002` / default 3 per 60 seconds     |

Local Wrangler config owns `PUBLIC_RATE_LIMITER` and `BRIEFING_GENERATION_LIMITER` defaults. Bindings are not inherited, so declare them in each environment. See [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/).

Namespace IDs must be account-unique positive integers. Reusing an ID across Workers/environments shares counters. **Check that production IDs are unused before deploying.** Fork operators must choose unused IDs in their own account.

GitLab's two optional environment-scoped variables override remote limits. Deployment validates them before changing state, then writes a temporary config for the selected `stage` or `production` target. It changes the binding's `simple.limit`; `simple.period` stays 60.

The helper preserves runtime/asset/migration paths, leaves the build artifact unchanged, and removes the config in `finally`. These are deployment settings, not browser runtime config or Worker secrets. Omission uses the documented default on the next authorized deployment. Changing GitLab alone does not change a running Worker.

The [runtime-settings schema](../../../scripts/deploy/runtimeSettings.ts) accepts positive base-10 integer strings that fit a safe integer. It rejects leading zeroes, whitespace, signs, fractions, and exponent notation. Defaults apply only to omitted variables.

The starting limits allow package typing, metadata, independent comparison tiers, and a small generation burst while restricting sustained evidence work and automated generation for new evidence hashes. They are conservative policies, not measured capacity. Review false-positive 429s and provider use before raising them.

There are no user accounts, so users sharing an IP share quotas. The general limit also covers stored-result reuse and pending-job joins. Those requests do not consume the stricter new-generation quota.

**Limits are approximate and per Cloudflare location, not global spend caps or exact daily accounting.** Rotating IPs/locations can evade them. Keep a separate provider-key spend limit. One accepted generation may make the bounded second call for invalid output.

Missing or failing bindings refuse requests; there is no process-local or D1 fallback counter. `Retry-After: 60` is advice, not an exact reset timestamp. No emergency pause control is implemented.

## How do I get the Grafana Cloud values?

1. In Grafana Cloud Portal, select your organization. Open **Security → Access Policies → Create access policy**. Set the realm to the target stack, not the whole organization. Grant only `logs:write` and `traces:write`; this app exports no metrics. See the [policy creation procedure](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/).
2. Select the policy, choose **Add token**, set an expiration, and create it. Save the token in a secure credential store; Grafana shows it once. This Cloud Access Policy token is the Basic-auth password, not a Grafana service-account or dashboard API token.

   To rotate it, create a replacement on the same policy, update the protected GitLab header variable, apply it in the next authorized stage deployment, then revoke the old token. Never share a production token with stage. See [token creation guidance](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/#create-tokens-for-an-access-policy).

3. In the [Grafana Cloud Portal](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/), open the target stack. Choose **Configure** on its **OpenTelemetry** tile. Copy the OTLP base endpoint and OTLP instance ID, which is the Basic-auth username.

   Base64-encode exactly `OTLP-instance-ID:policy-token` as UTF-8, with no trailing newline, using step 2's token. Do not use a Loki/Tempo instance ID or generate another token with broader permissions. If reusing a generated authentication header, first check its token's policy scopes and stack realm.

4. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the tile's base URL, normally ending in `/otlp`. Do not append `/v1/logs` or `/v1/traces`, or substitute a Grafana UI or Loki-/Tempo-specific URL. Signal paths are added automatically. See [endpoint path guidance](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/#configure-the-otlp-endpoint-path-for-each-signal).
5. Set `OTEL_EXPORTER_OTLP_HEADERS` to one-line JSON: `{"authorization":"Basic\u0020<base64>"}`, replacing the placeholder with the generated payload.

   If the portal shows `Authorization=Basic%20...`, remove `Authorization=` and replace `%20` with JSON `\u0020`. Do not paste shell `KEY=VALUE` or comma/equal-form OTLP headers.

   Make both GitLab variables protected, masked and hidden, raw, and scoped exactly to `stage` or `production`. Use separate credentials per environment. The endpoint must use HTTPS with no URL credentials, query, or fragment.

## How do I create the GitHub token?

The evidence Worker uses this optional token only for public GitHub REST API GETs for releases and changelog contents ([client](../../../server/httpDependencies/github/client.ts)). GitLab supplies no GitHub Actions `GITHUB_TOKEN`. Without a token, public requests still work at GitHub's unauthenticated rate limit.

1. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it for the stage or production evidence Worker. Choose an expiration you can maintain. Set **Resource owner** to your personal account and **Repository access** to **Public repositories (read-only)**. Fine-grained PATs always have read-only public-repository access. Do not select private repositories or grant extra account, organization, or repository permissions.
3. Add the generated token as GitLab `GITHUB_TOKEN`, with **Protected**, **Masked and hidden**, **Raw**, and exact scope `stage` or `production`. It belongs only to that environment's Evidence Worker. Do not create a classic `repo`/`public_repo` token or put the secret in commands, logs, or documentation.

See GitHub's [fine-grained token guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token). GitHub documents 60 unauthenticated REST requests/hour and 5,000 authenticated requests/hour for a personal access token. See [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## How are resources provisioned and code deployed?

Separate first-time bootstrap from ordinary redeployment.

### First-time bootstrap

Use this procedure only for a new, independent account-local target. **Do not bootstrap the official stage.** It already has persistent Workers, D1, Queue, and Durable Object resources.

1. Verify the selected account, environment, resource names, and origins.
2. Create this target's D1 database and record its returned ID in the binding.
3. Create this target's Queue and use its name consistently in producer and consumer configuration.
4. Configure stage access before sharing a restricted environment.
5. Review and apply D1 migrations to the explicit remote target.
6. Deploy evidence, briefing, and built frontend in that order. The configured Durable Object class migrations are part of Worker deployment.
7. Verify the deployed surface and record evidence.

Do not create a Queue on every redeployment or continue after failed provisioning. Positively identify any existing Queue/database as belonging to the intended target.

### Deploying the existing maintainer stage

**Use only the protected-main GitLab pipeline**, after reviewing the revision and migration compatibility. There is no workstation redeploy recipe. See [Automatic main-to-stage deployment](#automatic-main-to-stage-deployment).

The stage flow is:

1. Credential-free `build-smoke` builds without a GitLab environment or stage runtime settings. It records the CI commit/pipeline identity and puts all three Worker bundles in one `.output/` artifact.
2. Parent `stage:delivery` holds resource group `stage` through deployment and browser verification. The deploy job uses GitLab environment `stage`.
3. Before any migration or deployment, `deploy:stage` checks artifact identity and content hashes.
4. It applies existing D1 migrations and deploys all three exact bundles without rebuilding, using Wrangler `--env stage`.

GitLab runs `nub run deploy:stage`, backed by `scripts/deploy/deploy.ts`. Changed GitLab runtime values take effect on the next authorized stage deployment. See [release checks](releases-and-recovery.md#verification-and-release-evidence).

Do not copy operator credentials into a workstation build or bypass the allowed secrets-file path. Changing stage hostnames or runtime secrets does not rename/recreate Workers, D1, Queue, Durable Object namespaces, IDs, or migration history, and does not reset data.

Configure Cloudflare Access before the first deployment attaches custom domains. See [official stage access](#how-is-the-official-stage-restricted).

### Hosted frontend HTML caching

Nitro renders the homepage at runtime. Canonical and social URLs use the environment's `NUXT_PUBLIC_SITE_URL`, not a build-time origin. The homepage shares `/privacy` and `/about` response policy; it needs no static `_headers` rule.

Hosted stage and production enable Workers Cache through [`env.stage.cache.enabled` and `env.production.cache.enabled`](../../../wrangler.jsonc). [`responseCache.ts`](../../../server/plugins/responseCache.ts) sets these edge-cache lifetimes (TTLs):

- Successful homepage, `/privacy`, and `/about` HTML: one year.
- Comparison HTML: 12 hours, only when server-side rendering (SSR) has a validated stored briefing and successful measurements.
- Missing/pending/failed briefings, evidence or storage errors, APIs, other dynamic pages, and non-HTML responses: `no-store`.

Cacheable pages use `Cache-Control: no-cache` for browser revalidation and `Cloudflare-CDN-Cache-Control` with `must-revalidate` for edge freshness. Expired pages are not served stale.

Local requests can verify headers. An authenticated hosted request is needed to verify an edge `HIT`. Local root config and built dev do not enable this cache.

Workers Cache checks every HTTP request before the frontend entrypoint, even if the response later uses `no-store`. That directive prevents storage, not lookup.

Under current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), cache-served requests cost the same per request as Worker invocations. This includes static assets that otherwise receive separate free treatment. CPU is billed only when the Worker runs. Account for these cost and latency effects in both hosted environments.

Cached pages have the same public content for everyone. Stage is behind Cloudflare Access; production is public. **Personalized caching requires a separately reviewed cache-key and authorization design.**

Both hosted environments set `cross_version_cache` to `false`. The Worker version is part of the cache key, so every deployment starts cold. Cloudflare may evict entries before their TTL; one-year TTLs do not guarantee persistence. See [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/) and [cache examples](https://developers.cloudflare.com/workers/cache/examples/).

There is no explicit purge step in the checked-in deployment workflow. Version separation prevents a new Worker version from serving an older version's cached HTML; it does not physically purge old entries. Within one version, changed comparison evidence does not automatically invalidate already-cached HTML. See [release cache verification](releases-and-recovery.md#response-header-changes-and-cached-html).

### Search discovery and crawler access

Maintain one public HTTPS identity for each page intended for indexing. Keep its canonical URL, internal links, redirects, and sitemap entry consistent. Serve useful factual content in initial HTML without requiring user interaction or AI generation. Google can render JavaScript, but [recommends server rendering or pre-rendering](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) because not all crawlers can execute it. These are review requirements, not a claim that every comparison page already meets them.

Discovery uses the [bounded reviewed inventory](../overview.md#search-indexing-pilot), not every possible package/version pair. Production `/robots.txt` advertises `/sitemap.xml`; staging and local runtimes advertise no sitemap and return an empty URL set. A [sitemap helps new sites with few external links](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), but neither submission nor canonical markup guarantees indexing.

For an authorized discovery release, confirm the reviewed pages provide their promised initial HTML before exposing
them. Replace the frontend cache namespace through a new Worker version with `cross_version_cache: false`, then
verify cold and warm robots output and sitemap URLs. Include `/robots.txt` if an independent cache layer retained
its static response. Follow
[cache replacement and recovery](releases-and-recovery.md#response-header-changes-and-cached-html); local smoke
does not prove deployed invalidation. Deployment, cache purging, and search-engine submission require separate authorization.

For a new deployment:

1. Verify the production domain in [Google Search Console](https://support.google.com/webmasters/answer/34592) and [Bing Webmaster Tools](https://www2.bing.com/webmasters/help/add-and-verify-site-12184f8b). These tools provide diagnostics; accounts are not prerequisites for ordinary crawling.
2. Submit a sitemap only after its canonical URLs are public and the sitemap returns `200`. Inspect representative static, comparison, and invalid URLs. Record indexing status, selected canonicals, crawl failures, and the dates and filters used for clicks/impressions.
3. Use Bing's submission route for [Yahoo](https://help.yahoo.com/kb/SLN2217.html). [DuckDuckGo](https://duckduckgo.com/duckduckgo-help-pages/results/sources) largely sources traditional links from Bing and also maintains its own crawler and indexes. Bing inclusion does not guarantee placement in either service.
4. Check both `robots.txt` and Cloudflare controls. Verify crawler identity with Cloudflare's [verified-bot information](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/) or the operator's published verification method. Never bypass application limits based only on a claimed User-Agent.
5. Keep search crawling, user-directed retrieval, and model-training policy separate. Google's [AI search features](https://developers.google.com/search/docs/appearance/ai-features) use ordinary Search eligibility; no additional technical optimization is required. [PerplexityBot and Perplexity-User](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) have different discovery and retrieval roles, which Perplexity distinguishes from training. Do not change training policy to obtain search eligibility.

Check the target's current robots, sitemap, and Cloudflare settings before submission. Robots permission alone does not prove crawler access. Zero zone security or cache rules does not disable platform protections, Worker rate-limit bindings, or Workers Cache. Inspect legacy Page Rules separately where applicable.

Retain sanitized, dated baseline evidence in the issue or release record. Keep current procedures here, not raw dashboard exports or monthly market-share rankings. Record inaccessible metrics and settings as unavailable. New sites do not need to wait for traffic before recording a baseline.

### Automatic main-to-stage deployment

[GitLab CI](../../../.gitlab-ci.yml) validates MRs and main pushes. Only a **protected `main` push**, after required validation, can start `stage:delivery`. No MR or tag deploys stage.

`stage:delivery` starts the [delivery child pipeline](../../../scripts/deploy/ci-stage.yml): `deploy:stage`, then one `verify:stage` job that runs Chromium followed by Firefox.

`build-smoke` has no GitLab environment or stage runtime values. It receives no Cloudflare, Access, provider, or telemetry credentials. It retains `.output` for seven days with Maintainer access and embeds the full source SHA and repository URL for the footer.

`smoke:built` checks a separate copy. `deploy:stage` uses the original artifact and deploys all three verified bundles with `--no-bundle`. Browser smoke compares the rendered commit link with the expected CI SHA. There is no build-metadata endpoint.

The parent holds the `stage` resource-group lock until the whole child pipeline finishes. This uses GitLab's [resource-group downstream pipeline pattern](https://docs.gitlab.com/ci/resource_groups/#pipeline-level-concurrency-control-with-cross-projectparent-child-pipelines) with `strategy: mirror`. No child job acquires the lock. A newer deployment cannot replace the site between or during the two browser checks.

`deploy:stage` is non-interruptible and stops on any failure. Browser checks start only after it succeeds. It reads only `stage`-scoped runtime values and sends each complete allowed list through the owning Worker's temporary secrets file.

Stage deployments use Wrangler `env.stage` and `--env stage`. Immediately before the first state change, [the runner](../../../scripts/deploy/deploy.ts) checks artifact SHA/pipeline identity and the current remote `main`. A superseded or unverifiable revision fails before migration/deployment.

Newer deployments wait for the same lock. **Deployment is not atomic: completed steps stay applied if a later step fails. There is no automatic rollback.**

Use the variable matrix's exact scopes. Stage settings and credentials belong to `stage`; production settings and Cloudflare token to `production`; release API and SSH credentials only to their named release jobs.

Bootstrap rejects private values outside their dedicated environment before installing dependencies. `NUXT_PUBLIC_SITE_URL` is runtime-only; build identity is separate. Worker settings go only to their owning secret files, never the build or another Worker.

Allow the CI-only Access token through a **Service Auth** policy on both browser-facing hosts, alongside human Allow policies. Protect the socket by hostname. Keep provisioning and Access policy changes outside normal redeployments.

Protect `main`, retain fork-variable restrictions, and restrict stage deployment to Maintainers where GitLab protected environments are available.

`verify:stage` and `verify:production` use the same published browser image, pinned by digest in their child
pipeline configurations. Each job verifies the tool versions, restores and validates the dependency download
cache, and runs `nub ci` once. Chromium and Firefox then run sequentially in one smoke process, sharing
setup rather than running two jobs in parallel. This reduces duplicate runner work at the cost of waiting
for both browsers in sequence.

The staging job's environment action is `verify`, not a new deployment. Access and health checks run once.
Each browser checks search, version selection, declarations and measurements, rendered facts, direct reload,
and the staging commit link. One report and artifact archive contain both browsers' results and screenshots.

The submission POST is intercepted before it reaches the server, so these checks never trigger paid generation.
A browser failure stops the smoke process and fails both child and parent pipelines. The report retains completed
browser results and the failure stage. Retrying verification does not redeploy.

Stage smoke also checks unauthorized frontend/socket rejection, authenticated health, artifact SHA, and socket-host admission. It uses an unassigned sentinel job and expects application 404; this is not a subscription.

Production smoke checks the public socket route and exact package-version footer. It intercepts briefing POST before dispatch and supplies a schema-valid synthetic available fixture. Neither deployed smoke proves fresh generation, provider integration, or rate-limit behavior.

The HTTP proxy requests gzip, deflate, or Brotli only. Its Playwright fetch/fulfillment path cannot correctly decode Zstandard for Firefox. Native WebSocket handshakes bypass the proxy.

Local checks and dry-runs do not activate hosted automation. Before each live release, authorized operators must verify the credentials, protected environments/tags, Cloudflare resources, and runtime origins for that target.

### Browser CI image publication and activation

The [image maintenance procedure](development.md#browser-ci-image-maintenance) describes the build inputs
and local verification. Browser verification jobs select their published digest through
`ci-browser-bootstrap.yml`; deployment and validation jobs keep ordinary bootstrap. Do not select an image
tag or an unpublished digest.

Before enabling the image workflow, confirm an isolated amd64 runner supports rootless BuildKit user
namespaces and mounts. The workflow uses the pinned BuildKit rootless image, not privileged Docker-in-Docker
or a host Docker socket. [GitLab's rootless build instructions](https://docs.gitlab.com/ci/docker/using_buildkit/)
describe the runner requirements. The selected `--oci-worker-no-process-sandbox` mode weakens isolation
within the builder container; use a fresh disposable builder per job, never a shared daemon.
See the [versioned BuildKit security caveats](https://github.com/moby/buildkit/blob/v0.25.2/docs/rootless.md#docker).
If the runner blocks those operations, stop and arrange an approved runner rather than enabling privileged mode.

Publication requires separate operator authorization:

1. Enable this project's GitLab container registry. Protect GitLab environment `browser-image` for Maintainers.
   Keep all application and deployment secrets scoped to their existing environments; give this environment none.
   Protect registry tags matching `browser-*` with Maintainer minimum roles for push and deletion.
   [Registry tag protection](https://docs.gitlab.com/user/packages/container_registry/protected_container_tags/)
   is separate from environment protection; the manual job alone does not restrict other registry clients.
2. Run `browser-image` on a reviewed protected-default-branch pipeline. Input changes select it automatically;
   otherwise start its optional manual maintenance action. Its verification job builds and exercises both browsers.
3. After verification succeeds, an authorized Maintainer may start the child `browser-image:publish` job.
   It authenticates using GitLab's short-lived `CI_REGISTRY_USER` and `CI_REGISTRY_PASSWORD`, publishing to
   `CI_REGISTRY_IMAGE:browser-$CI_COMMIT_SHA-$CI_PIPELINE_ID`. No custom registry hostname or permanent push token is needed.
   It rebuilds from the same pinned inputs and reruns both fixture checks; MR pipelines cannot select publication.
4. Save `containerimage.digest` from the Maintainer-only `browser-image-metadata.json` artifact and the image's
   source commit. Verify a pull by that digest, tool versions, and both fixture checks on the intended runner.
   Confirm that CI can pull the private project image before any job script executes. Do not expose push
   credentials to MRs; use the runner's supported job-token pull authentication and project allowlist.
5. In a reviewed activation change, include `scripts/deploy/ci-browser-bootstrap.yml` from both
   `ci-stage.yml` and `ci-production.yml`, supplying its required `image` input as the actual
   `CI_REGISTRY_IMAGE` path followed by `@sha256:` and the verified digest. The input has no default and
   rejects unpinned tags. Extend `.browser-runtime` only from `verify:stage` and `verify:production`.
   Keep ordinary `ci-bootstrap.yml` for all other jobs. Each verification job runs both browsers sequentially;
   do not add a matrix or restore a browser-install step.
6. Keep the target decoding, private-key filtering, smoke invocation, and failure reporting in
   `scripts/smoke-deployed/ci-run.ts`. The smoke process runs Chromium followed by Firefox without a
   per-browser selector. The browser template checks image metadata against the repository pins before
   its frozen `nub ci`; it neither downloads Nub nor installs OS or browser packages.
7. Verify the resolved GitLab configuration and run authorized staging Chromium and Firefox checks.
   Confirm bootstrap uses the recorded digest, all versions match, and no browser or apt installation occurs.
   Only then use the same digest for production verification. Preserve the deployment locks and release gates.

The selected digest is recorded in the two child pipeline configurations. A published image and successful
build-time fixture checks do not prove that a consuming job can pull and start it. Verify authenticated
pulls and the combined browser job on the intended runner before treating the activation as verified.
For an update, repeat the same procedure with synchronized pins and a new digest. To roll back after activation,
restore the previously verified digest only when its tooling still matches the repository; otherwise revert
the matching tooling change too. Retain active and rollback digests in the registry cleanup policy.

### Effect runtime for deployment scripts

Deployment TypeScript entrypoints use Effect computations with typed failures for build hashing/verification, settings and receipt decoding, temporary Wrangler configs, Git checks, subprocesses, and sanitized reports.

The CLI supplies Effect's Node services at its runtime entrypoint. Pure bundle-path and deploy-argument helpers stay synchronous. See the [deployment orchestrator](../../../scripts/deploy/deploy.ts), [artifact identity](../../../scripts/deploy/buildArtifact.ts), [runtime settings](../../../scripts/deploy/runtimeSettings.ts), [rate-limit configuration](../../../scripts/deploy/rateLimitConfig.ts), and [Worker secret handling](../../../scripts/deploy/workerSecrets.ts).

Build identity and production receipt JSON use Effect's `Schema.fromJsonString` and `Schema.decodeUnknownEffect`. Malformed JSON and invalid fields produce sanitized domain failures. GitLab response decoding also uses Effect's error channel.

Secrets and generated Wrangler configs live in owner-only OS temporary directories; JSON files use mode `600`. Effect filesystem scopes retain the directories for the Wrangler command, then remove them on success, failure, or interruption.

This uses Effect's [filesystem service](https://effect.website/docs/v4/platform/file-system) and [scope resource lifetime](https://effect.website/docs/v4/resource-management/scope). Subprocesses use [child-process commands](https://effect.website/docs/v4/api/effect/process/ChildProcess).

The scripts preserve evidence → briefing → frontend order, recheck the protected `main` tip before state changes, and report completed/failed steps without rollback.

Dry-runs skip remote D1 migrations and pass Wrangler `--dry-run`. They write a sanitized report and need no Cloudflare deployment token.

### Manual protected-main release

Protected `main` pushes start validation and build gates. A newer commit can cancel superseded validation.
Pipelines that pass those gates continue to the stage child pipeline under its deployment lock. Stage deploys
the exact frontend build and checks it in Chromium and Firefox. Its footer keeps the full source commit link.
Started delivery and release operations remain non-interruptible.

Only after `build-smoke` and the complete stage child pass does blocking manual `release:tag` become available. A Maintainer or Owner must select a stable `MAJOR.MINOR.PATCH` version in GitLab's native [job inputs](https://docs.gitlab.com/ci/jobs/job_inputs/) form. The required default is empty, not a release version; the CLI rejects it before publication.

This creates no release branch, version commit, MR, package version change, or auto-merge.

Before writing a tag, the read-only GitLab API token verifies:

- The manual job belongs to this exact protected-main `push` pipeline.
- Its SHA is still the protected branch tip.
- Required parent checks, build, and smoke jobs succeeded.
- The successful stage bridge led to a successful `parent_pipeline` with the same `main` SHA, successful deployment, and passing Chromium/Firefox jobs.
- The manual job's API user has Maintainer or Owner project access.

Protected environments add a gate; they do not replace these checks.

The version must be stable SemVer and newer than the latest stable release tag. An existing tag is reusable only if its protected annotated-tag commit and version/tag/commit/pipeline metadata exactly match this pipeline. Conflicting, moved, or superseded tags are rejected, never overwritten.

Configure one protected `v*` rule allowing creation only by the dedicated project deploy key. Allow no overlapping matching rule or user/group/role grants. The job writes immutable receipt `.data/production-release/tag.json` with exactly `version`, `tag`, `commitSha`, and `pipelineId`.

`production:delivery` requires successful `release:tag`. It cannot start from a branch, title, MR, or arbitrary tag. The child fetches the receipt and original `build-smoke` `.output/` artifact, then checks:

- Receipt commit/pipeline identity against the build and immutable protected tag.
- Hashes of the complete output and all three Worker bundles.

It deploys those exact bundles with Wrangler `--no-bundle`; production never rebuilds. The receipt version becomes frontend runtime `NUXT_PUBLIC_RELEASE_VERSION`. Stage has no override and keeps its stage commit identity.

The production child holds resource group `production` through migration, deployment, and verification. It applies current D1 migrations, then deploys evidence, briefing, and frontend.

Chromium and Firefox check live health, search, comparison, and the receipt-derived `vX.Y.Z - <short-commit>` footer linked to the artifact commit. Smoke intercepts briefing POST before dispatch and returns a schema-valid fixture. It makes no paid call and proves neither provider integration nor rate limiting.

Reports retain partial step status. **Worker/database deployment is non-atomic; failure does not trigger rollback.**

Before activation:

- Create exact GitLab environments `release-tag` and `production`, protected for Maintainer/Owner access. Apply the variable matrix's exact scopes.
- Give `GITLAB_RELEASE_TAG_API_TOKEN` read-only Reporter-level access with `read_api` and `read_repository` for pipeline, job, membership, bridge, tag, and protected-tag evidence. It cannot create tags or change `main`.
- Set file-valued `GITLAB_RELEASE_TAG_SSH_KEY` to the private key for the only deploy key permitted by `v*`. Set `GITLAB_RELEASE_TAG_DEPLOY_KEY_ID` to that key's ID. The key must be protected, active, and allowed to push tags.
- Keep `main` protected against direct and force pushes.

Project access tokens require GitLab Premium/Ultimate. Otherwise use a scoped, expiring, read-only PAT for a dedicated Reporter account. Protected environments also require Premium/Ultimate. **Keep the workflow inactive if equivalent Maintainer/Owner restrictions cannot be enforced for `release-tag` and `production`.**

See [project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/), [CI/CD variable security](https://docs.gitlab.com/ci/variables/), [protected-tag settings](https://docs.gitlab.com/user/project/protected_tags/), [Protected Tags API](https://docs.gitlab.com/api/protected_tags/), and [deploy keys](https://docs.gitlab.com/user/project/deploy_keys/).

The production Cloudflare token needs only account Workers Scripts, D1, and Queue edit permissions, plus Zone Read and Workers Routes edit for the active `caniupdate.dev` zone.

Before activation, verify the configured production D1 database, Queue, Workers, Durable Object namespaces, and domain attachments in the target account. Source configuration does not establish their existence or migration state.

Set production `NUXT_PUBLIC_SITE_URL` to `https://caniupdate.dev` and `BRIEFING_PUBLIC_URL` to `wss://briefing.caniupdate.dev`.

If deployment or browser verification fails:

1. Inspect the partial deployment report.
2. If the release SHA is still the protected `main` tip, retry only that pipeline/receipt. The tag job reuses only its exact immutable tag.
3. If `main` advanced, the old SHA is rejected and its tag is never replaced. Use a new protected-main push with passing checks and stage browsers, then select a higher stable version in that pipeline's manual `release:tag`.
4. Deploy forward, accounting for Worker/migration steps already completed.

Never deploy a production branch, hand-edit `package.json`, manually push a release tag, or assume failure rolled back completed work.

## How is the official stage restricted?

The official stage admits authorized maintainers and approved automation only. Do not share a person's Access credential. **Create Access protection before the first deployment attaches either custom domain.**

1. In Cloudflare Zero Trust, add hostname-based **Self-hosted** Access protection for `stage.caniupdate.dev` and `stage-briefing.caniupdate.dev` in the active `caniupdate.dev` zone. Prefer one multi-domain application; otherwise use one per hostname.

   Complete both hosts' protection and policies before attaching public routes. Keep protection on every reachable Worker-development hostname until deployment disables those endpoints and checks confirm they are unreachable.

2. Add a human **Allow** policy for authorized maintainer groups and a separate **Service Auth** policy for the CI token. Both policies must cover both hosts, whether in one application or two.

   Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as protected GitLab variables with exact scope `stage`, as in the matrix.

3. Only after protection exists, deploy the reviewed configuration through protected `main`. Wrangler `env.stage` attaches `stage.caniupdate.dev` to the configured staging frontend Worker and `stage-briefing.caniupdate.dev` to the staging briefing Worker, using `custom_domain: true`. Worker-development endpoints are disabled.

   Keep the staging evidence Worker private, with no public/custom hostname. Preserve all Worker names, resource IDs, bindings, D1, Queue, DO namespaces, and migration history. Do not create/rename Workers, recreate resources, or reset databases.

   Cloudflare Custom Domains creates the DNS record and certificate; add no separate DNS route. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and the [frontend](../../../wrangler.jsonc) / [briefing](../../../workers/briefing/wrangler.jsonc) configs.

4. Check human admission separately from CI Service Auth. Sign in through Access at `https://stage.caniupdate.dev`. Start a cold comparison that produces a pending briefing. Confirm its native read-only WebSocket connects to `wss://stage-briefing.caniupdate.dev` without an Access login redirect and receives job events.

   Do not assume cross-host cookie sharing, even with a multi-domain application. Observe this flow. CI proves only Service Auth, not human cookies. **Cold generation can incur provider charges.** A cached result or authenticated frontend-only check does not satisfy this step.

Worker-level Access does not support WebSockets, so the socket needs hostname-based protection. The briefing Worker's exact Origin check is separate and does not replace Access. Keep provisioning and Access policy changes outside ordinary redeployments. See [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) and [Access cookies](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).

Verify unauthenticated rejection and authorized admission on both hostnames. A frontend login redirect alone does not prove protection of the briefing socket path or successful authenticated cross-host access.

## What is known about production readiness?

Production serves `https://caniupdate.dev` using three isolated Workers:

- `can-i-update-production`
- `can-i-update-production-evidence`
- `can-i-update-production-briefing`

Frontend bindings target only those production Workers. Briefing uses a separate production D1 database and Queue. Verify migration state and release-pipeline provenance for each release; resource existence does not establish either.

Stage and production use separate rate-limit namespaces. Default limits are 60 public requests and 3 new generations per 60 seconds, with environment-scoped overrides. Verify the deployed binding values and exercise refusal and browser recovery separately.

Each separately authorized production pipeline must apply the target's current D1 migrations, deploy evidence → briefing → frontend, and check Chromium and Firefox. It copies neither migration history nor DO state from stage.

Required runtime values are `NUXT_PUBLIC_SITE_URL=https://caniupdate.dev` for frontend and `BRIEFING_PUBLIC_URL=wss://briefing.caniupdate.dev` for the socket. Builds are origin-independent. Revalidate runtime settings before release.

**Never reuse stage databases, job state, queues, provider keys, or deployment credentials.** Live binding values establish configured limits, not successful enforcement or a global spend cap.

Cloudflare documents Free support for Workers, SQLite Durable Objects, D1, and Queues. This does not establish sustained suitability for this app. Measure deployed Worker CPU and separate request/storage/Queue quotas under representative workloads.

Queues Free currently includes 10,000 operations/day and 24-hour retention. A successful small message normally uses three operations. Before release, check current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/).

Paid is compatible if measured needs exceed Free. A smoke response or client latency sample is not Cloudflare CPU accounting.

Staging uses separately deployed Workers with its own bindings, Queue, database, and Durable Object state. Keep these resources isolated from production.

## Outstanding setup and verification

- Portable account-local configuration and an exercised self-hosting workflow.
- Production migration history, release provenance, and complete hosted verification. Check these for each release rather than inferring readiness from a reachable frontend.
- Production telemetry destination and hosted verification. Frontend/briefing endpoints and authentication are separate Worker secrets. No hosted Collector is required by the implementation.

  Gateway acceptance and browser intake do not prove Loki/Tempo query visibility or export of platform crashes. Gateway authentication belongs only in frontend/briefing Worker secrets, never browser-visible or public configuration.

  [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) remains enabled as an independent safeguard for escaped exceptions. Per-request invocation logs stay disabled because their metadata includes client IPs. Only exception and console records remain. No outstanding platform setting may reintroduce request-level IP records.

- Hosted rate-limit behavior and browser recovery. Confirm the deployed bindings and any environment-scoped overrides, then exercise refusal and recovery through a separately authorized check.
- Production release provenance and footer rendering. Deployment existence does not prove that the protected-tag promotion workflow or browser checks ran.

These outstanding requirements are not claims of production readiness. Keep configuration evidence separate from exercised behavior.
