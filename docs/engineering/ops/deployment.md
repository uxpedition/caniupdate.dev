# Deployment operations

**Status: reviewed.** This document separates current deployment mechanics from the agreed OSS deployment model. It is not evidence that production or portable fork deployment has been implemented.

See [development](development.md) for local commands and [releases and recovery](releases-and-recovery.md) for promotion, verification, and migrations.

## Which environment should I use?

| Environment                  | Owner and purpose                      | Policy                                                                                       |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Local development            | Any contributor                        | No Cloudflare account or paid inference required                                             |
| Local built preview          | Any contributor                        | Real local Worker runtime, not a remote deployment                                           |
| Contributor demo             | Contributor's Cloudflare account       | Optional; contributor owns resources, visibility, provider configuration, costs, and cleanup |
| Official integration preview | Maintainer team                        | One persistent, restricted environment; maintainers deploy reviewed revisions                |
| Production                   | Maintainer account at `caniupdate.dev` | Maintainer-controlled release; separate resources and credentials                            |

The checked-in Wrangler files currently define local defaults and the maintainer's remote `env.preview`. They contain account-specific names, IDs, and hostnames. **Do not deploy them unchanged into a contributor account, and never deploy their default local environment.** Production configuration is not present yet.

Contributors can request an official preview in a PR without receiving deployment credentials. No automatic privileged fork-deployment workflow is established by this document. Unreviewed code can exfiltrate preview secrets even when production is isolated.

## What does a complete deployment contain?

The system uses three Workers in the same account:

| Worker   | Public surface                        | Required resources                                                                                                        |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Site and comparison APIs              | External `PACKAGE_EVIDENCE` Durable Object binding and private `BRIEFING_SERVICE` entrypoint binding                      |
| Evidence | None in the checked-in remote preview | SQLite-backed `PackageEvidence` Durable Objects; optional GitHub token                                                    |
| Briefing | Read-only browser WebSocket route     | `BRIEFING_JOBS` Durable Objects, `BRIEFING_QUEUE`, `BRIEFINGS_DB`, provider configuration when real generation is enabled |

Private submission and the public socket are different boundaries. The browser cannot submit generation directly to the briefing Worker's public route. Socket Origin allowlisting is not user authentication.

Sources: [frontend config](../../../wrangler.jsonc), [evidence config](../../../workers/evidence/wrangler.jsonc), [briefing config](../../../workers/briefing/wrangler.jsonc), and [briefing architecture](../briefing.md).

## How should an account-local configuration be prepared?

Account-local configuration is an agreed requirement. The setup/generation workflow is not implemented yet. The inputs and consistency checks below define the deployment contract; they are not a claim that an account-local setup command exists.

For each remote target, explicitly select:

- Cloudflare account and deployment environment.
- Frontend, evidence, and briefing Worker names.
- Frontend origin and browser socket origin.
- D1 database name and ID.
- Queue name, identical in producer and consumer configuration.
- Deployment credentials scoped to that account and the required operations.
- Optional provider settings and preview access policy.

Keep linked values consistent:

| Configuration                  | Required relationship                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `PACKAGE_EVIDENCE.script_name` | Exact deployed evidence Worker name                           |
| `BRIEFING_SERVICE.service`     | Exact deployed briefing Worker name                           |
| `BRIEFING_SERVICE.entrypoint`  | `BriefingSubmitter`                                           |
| D1 binding                     | `BRIEFINGS_DB`, with this target's database ID                |
| Queue binding                  | `BRIEFING_QUEUE`, with this target's queue name               |
| Job Durable Object binding     | `BRIEFING_JOBS`, class `BriefingJob`                          |
| `NUXT_PUBLIC_SITE_URL`         | Exact frontend origin, also supplied at build time            |
| `BRIEFING_PUBLIC_URL`          | Reachable `wss` socket origin for this target                 |
| `BRIEFING_ALLOWED_ORIGIN`      | Derived from `NUXT_PUBLIC_SITE_URL`; no separate GitLab input |

Preserve the configured SQLite Durable Object migrations. Repeat environment-specific bindings explicitly rather than assuming Wrangler inherits them. If configs are relocated, resolve `main`, schema, and migration paths relative to their new locations. The built frontend config must come from the account-local frontend configuration, not silently retain the maintainer's bindings.

Do not commit operator keys or accidentally include account-specific changes in an unrelated contribution. Before publishing a fork deployment recipe, the account-local workflow must be exercised in an independent account. This document does not substitute guessed commands for that missing capability.

## Where do credentials and runtime settings go?

GitLab owns every stage runtime setting. In **Operate → Environments → New environment**, create project environments named `stage` and `stage-build` if they do not already exist. `stage` is the deployment environment and resource-group name; `stage-build` is the credential-free build environment with action `prepare`. Add project variables under **Settings → CI/CD → Variables** with the exact scopes below—never `*` or `stage*`. Only `NUXT_PUBLIC_SITE_URL` belongs in both `stage-build` and `stage`; every other variable, including credentials, belongs in `stage` only. Protect every variable and turn **Expand variable reference** off (raw). Use **Visible** for public values and **Masked and hidden** for populated private settings and credentials. GitLab requires masked values to be single-line, at least eight characters, and contain no spaces; see [GitLab CI/CD variable visibility and masking](https://docs.gitlab.com/ci/variables/#mask-a-cicd-variable).

| GitLab variable                 | Owner / exact environment scope                            | Stage value or optional default                                                                                              | Variable settings                                                                                                           |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_SITE_URL`          | Build and Frontend Worker / `stage-build` **and** `stage`  | `https://stage.caniupdate.dev` in both scopes                                                                                | Protected, Visible, Raw                                                                                                     |
| `NUXT_PUBLIC_TELEMETRY_ENABLED` | Frontend Worker / `stage`                                  | Required exact `true` or `false`; `true` requires the shared OTLP endpoint and this flag controls frontend export only       | Protected, Visible, Raw                                                                                                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | Frontend and Briefing Workers / `stage` only if configured | Optional shared HTTPS OTLP base endpoint; omit if unused, then CI supplies `""`; no URL credentials, query, or fragment      | Protected, Masked and hidden, Raw when populated                                                                            |
| `OTEL_EXPORTER_OTLP_HEADERS`    | Frontend and Briefing Workers / `stage` only if configured | Optional shared JSON string-to-string map; omit if unused, then CI supplies `{}`                                             | Protected, Masked and hidden, Raw when populated                                                                            |
| `AI_BRIEFING_ENDPOINT`          | Briefing Worker / `stage`                                  | Required: HTTPS OpenAI-compatible Chat Completions URL ending in `/chat/completions`; no URL credentials, query, or fragment | Protected, Masked and hidden, Raw                                                                                           |
| `AI_BRIEFING_API_KEY`           | Briefing Worker / `stage`                                  | Required dedicated stage provider key                                                                                        | Protected, Masked and hidden, Raw                                                                                           |
| `AI_BRIEFING_MODEL`             | Briefing Worker / `stage`                                  | Required provider model identifier selected by the maintainer                                                                | Protected, Masked and hidden, Raw when GitLab masking requirements allow; a short non-secret model name may be Visible, Raw |
| `BRIEFING_PUBLIC_URL`           | Briefing Worker / `stage`                                  | `wss://stage-briefing.caniupdate.dev`                                                                                        | Protected, Visible, Raw                                                                                                     |
| `GITHUB_TOKEN`                  | Evidence Worker / `stage` only if configured               | Optional; omit when unused, then CI supplies `""`                                                                            | Protected, Masked and hidden, Raw when populated                                                                            |
| `CLOUDFLARE_API_TOKEN`          | Deployment job / `stage`                                   | Required CI-only deployment token                                                                                            | Protected, Masked and hidden, Raw                                                                                           |
| `CF_ACCESS_CLIENT_ID`           | Deployed smoke job / `stage`                               | Required Access service-token ID                                                                                             | Protected, Masked and hidden, Raw                                                                                           |
| `CF_ACCESS_CLIENT_SECRET`       | Deployed smoke job / `stage`                               | Required Access service-token secret                                                                                         | Protected, Masked and hidden, Raw                                                                                           |

Enter `OTEL_EXPORTER_OTLP_HEADERS` as one-line JSON with string keys and string values—not OTLP shell syntax such as `Authorization=...` or comma-separated pairs. For a Basic authorization header, encode its required space as `\u0020`, for example `{"authorization":"Basic\u0020<base64>"}`; replace the placeholder with the generated credential value. GitLab's raw setting preserves the JSON escape, and JSON parsing restores the space. Never use **Visible** for an API key, Access credential, or authentication-header value.

The shared OTLP pair is read and its headers are validated once as a JSON string-to-string map. CI maps it to the Frontend Worker's runtime names `NUXT_OTEL_ENDPOINT` and `NUXT_OTEL_HEADERS`, and to the Briefing Worker's existing names `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. It reaches only those two Worker secret allowlists—never the build, Evidence Worker, or browser. `NUXT_PUBLIC_TELEMETRY_ENABLED` remains required and controls the Frontend Worker only: `true` requires an endpoint, while the Briefing Worker exports whenever an endpoint is configured. There is no GitLab `BRIEFING_ALLOWED_ORIGIN` input; that runtime value is derived from `NUXT_PUBLIC_SITE_URL`.

Configure `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` together as one shared pair; when OTLP is unused, omit both rather than entering blank or `{}` values. The deploy helper still sends every allowlisted key: absent OTLP inputs become endpoint `""` and headers `{}` for both Frontend and Briefing Workers, clearing previously managed values; an absent `GITHUB_TOKEN` becomes `""` for Evidence. Wrangler keeps secrets omitted from a `--secrets-file`, so the helper must send the complete allowlist. It creates the JSON files in an OS temporary directory with directory mode `700` and file mode `600`, and removes them in `finally`. CI deployment and Access credentials are used only by their jobs and are never copied into a Worker secrets file or forwarded to the build. Encrypting a public setting as a Worker secret does not make a `NUXT_PUBLIC_*` value private.

### Migrating from the old GitLab scopes

Before the first new stage pipeline:

1. Stop starting pipelines that can still run the old `build:preview` / `deploy:preview` jobs. Wait until every queued or running `deploy:preview` has finished before starting `build:stage` / `deploy:stage`. The old `preview` resource-group lock and new `stage` lock are distinct and do not coordinate; deployments can otherwise overlap against the same remote Workers and database.
2. Create GitLab environments `stage` and `stage-build` if needed. Set `NUXT_PUBLIC_SITE_URL` to `https://stage.caniupdate.dev` under each exact scope.
3. Move the remaining runtime variables and credentials to the exact `stage` scope in the matrix. Remove any old `preview`-scoped copies; `stage-build` must contain no runtime values or credentials.
4. Delete the obsolete GitLab variables `BRIEFING_ALLOWED_ORIGIN`, `NUXT_OTEL_ENDPOINT`, and `NUXT_OTEL_HEADERS`. Keep only the shared OTLP input pair under `stage`; use the site URL to supply the briefing Origin and use the documented mappings for the two Worker runtime names.
5. Review the final variable list against the matrix: no `preview`, `preview-build`, wildcard, or `stage*` scopes remain for current variables. This migration changes GitLab scopes and job/resource-group names only; keep all Cloudflare Worker names, IDs, and Wrangler `env.preview`/`--env preview` unchanged. Keep the existing local commands `nub run preview` and `nub run smoke:preview` unchanged.

This is an operator procedure only; this documentation update does not change GitLab or any hosted configuration.

The build receives only `NUXT_PUBLIC_SITE_URL` from the `stage-build` scope; it has no runtime/provider/telemetry or Cloudflare/Access credential. The same public URL is scoped to `stage` for the frontend Worker and must match the build-time value. All other runtime values are available only under `stage` and are passed as secrets to their owning Worker; no runtime values remain in `env.preview.vars`.

Use a fresh CI-only Cloudflare API token with **Workers Scripts: Edit**, **D1: Edit**, and **Queues: Edit** for the account. Add **Zone → Zone: Read** and **Zone → Workers Routes: Edit**, each scoped only to the active `caniupdate.dev` zone, for custom-domain reconciliation. Do not grant DNS Edit or Account Settings Read. Cloudflare's newer [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) page calls the route action `Workers Routes: Write`; select the `Edit` permission in the API-token editor when that is the displayed label. Pre-creating the custom domains in the dashboard does not bypass Wrangler's route reconciliation on later deployments. See [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [local ownership](development.md#where-does-configuration-belong). These account-scoped deployment permissions apply to existing resources in the account, not only the preview resource names. Contributors use their own credentials, never the maintainers' token.

Production is intended to use OpenRouter at `https://openrouter.ai/api/v1/chat/completions`, with a dedicated key and an operator-configured spend limit. Budget amounts and reset intervals are operator choices, not prescribed here. Preview real-provider checks use a separate key. Default contributor checks remain fixture-only. The official integration preview is a staging target and requires its separate real-provider configuration; deployed smoke checks that exercise fresh generation can incur inference charges.

Self-hosters may choose another provider implementing the supported OpenAI-compatible Chat Completions contract. HTTPS is required except for loopback fixtures. Endpoint query parameters are rejected. Model output must satisfy the application's strict JSON/citation contract; API compatibility does not guarantee every model produces valid output. See [provider behavior](../briefing.md#result-storage-and-generation-failures).

A spend cap does not protect Cloudflare quotas or guarantee fair access. Cached briefing success does not prove a valid provider key or a working new-generation path.

## How do I get the Grafana Cloud values?

1. Sign in to the Grafana Cloud Portal, select your organization, then open **Security → Access Policies → Create access policy**. Set its realm to the target stack—not the whole organization—and grant only `logs:write` and `traces:write`; this application exports logs and traces, not metrics. See Grafana's [policy creation procedure](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/).
2. Select the policy, choose **Add token**, set an expiration, create it, and copy the token into a secure credential store; Grafana shows it only once. This Cloud Access Policy token is the Basic-auth password; do not use a Grafana service-account or dashboard API token. Rotate it by creating a replacement token on the same policy, updating the protected GitLab header variable, applying it through the next authorized stage deployment, then revoking the old token. Do not share a production token with stage. See [token creation guidance](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/#create-tokens-for-an-access-policy).
3. In the [Grafana Cloud Portal](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/), open the target stack and choose **Configure** on its **OpenTelemetry** tile. Copy the OTLP base endpoint and OTLP instance ID (Basic-auth username). Form the Basic-auth payload by Base64-encoding exactly `OTLP-instance-ID:policy-token` as UTF-8 with no trailing newline, using the token from step 2. Do not use a Loki/Tempo instance ID or accidentally generate a second token with broader permissions. If you already have the tile's generated authentication header, check its token's policy scopes and stack realm before reusing it.
4. Store the endpoint from the OpenTelemetry tile as `OTEL_EXPORTER_OTLP_ENDPOINT`. Use its base URL (normally ending in `/otlp`); do not append `/v1/logs` or `/v1/traces`, or substitute the Grafana UI URL or a Loki-/Tempo-specific URL. The OTLP base endpoint adds per-signal paths itself; see Grafana's [endpoint path guidance](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/#configure-the-otlp-endpoint-path-for-each-signal).
5. Store the authentication header in `OTEL_EXPORTER_OTLP_HEADERS` as a one-line JSON object, e.g. `{"authorization":"Basic\u0020<base64>"}` with the actual generated payload replacing the placeholder. If the portal displays `Authorization=Basic%20...`, remove the `Authorization=` prefix and represent `%20` as JSON `\u0020`; do not paste shell `KEY=VALUE` or comma/equal-form OTLP headers into the JSON variable. Set both GitLab variables protected, masked and hidden, raw, and scoped exactly to `stage`. Keep the endpoint HTTPS-only and free of URL credentials, queries, and fragments.

## How do I create the GitHub token?

The evidence Worker uses the optional token only for public GitHub REST API GETs to repository releases and changelog contents ([client](../../../server/httpDependencies/github/client.ts)). GitLab does not provide a GitHub Actions `GITHUB_TOKEN`; without a token, these public requests still work at GitHub's unauthenticated rate limit.

1. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it for the stage evidence Worker, select an expiration you can maintain, and set **Resource owner** to your personal account. Set **Repository access** to **Public repositories (read-only)**. GitHub says fine-grained PATs always have read-only access to public repositories; do not select private repositories, or grant additional account, organization, or repository permissions.
3. Generate the token and add it as `GITHUB_TOKEN` in GitLab with **Protected**, **Masked and hidden**, and **Raw** enabled and exact environment scope `stage`. It is optional and belongs only to the Evidence Worker. Do not create a classic `repo`/`public_repo` token or paste the secret into commands, logs, or documentation.

See GitHub's [fine-grained token guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token). GitHub documents 60 unauthenticated REST requests per hour versus 5,000 authenticated requests per hour for a personal access token; see [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## How are resources provisioned and code deployed?

Separate first-time bootstrap from ordinary redeployment.

### First-time bootstrap

This procedure is for a new, independent account-local target only. The official preview already has its persistent Workers and bound D1, Queue, and Durable Object resources; do not apply bootstrap creation steps to it.

1. Verify the selected account, environment, resource names, and origins.
2. Create this target's D1 database and record its returned ID in the binding.
3. Create this target's Queue and use its name consistently in producer and consumer configuration.
4. Configure preview access before sharing a restricted environment.
5. Review and apply D1 migrations to the explicit remote target.
6. Deploy evidence, briefing, and built frontend in that order. The configured Durable Object class migrations are part of Worker deployment.
7. Verify the deployed surface and record evidence.

Do not put Queue creation into every redeployment sequence or interpret a failed provisioning command as permission to continue. An existing queue/database must be positively identified as belonging to the intended target.

### Deploying the existing maintainer stage

There is no workstation-driven redeploy recipe for the official integration preview. Use only the protected-main GitLab pipeline in [Automatic main-to-stage deployment](#automatic-main-to-stage-deployment), after reviewing the selected revision and migration compatibility. The credential-free build runs under environment `stage-build` with action `prepare`; it receives only public `NUXT_PUBLIC_SITE_URL=https://stage.caniupdate.dev`. The deploy job uses GitLab environment `stage`, while its parent `stage:delivery` holds resource group `stage` across deployment and browser verification. Deployment runs the existing D1 migrations, and deploys the existing evidence, briefing, and frontend Workers with Wrangler `--env preview`. The GitLab package command remains `nub run deploy:stage`, backed by the existing `scripts/deploy-preview/deploy-preview.ts` implementation. Changes to GitLab runtime variables take effect on the next authorized stage deployment. See [release checks](releases-and-recovery.md#verification-and-release-evidence).

Do not copy an operator credential file into a workstation build or bypass the allowlisted secrets-file path. The preview already has its Workers, D1 database, Queue, Durable Object namespaces, IDs, and migration history; changing the stage hostnames or runtime secrets does not recreate or rename those resources or reset their data. Configure Cloudflare Access before the first deployment that attaches the custom domains, as described in [official preview access](#how-is-the-official-preview-restricted).

### Hosted frontend HTML caching

The prerendered homepage bypasses Nitro and uses [`public/_headers`](../../../public/_headers) for its one-year Cloudflare edge TTL and browser revalidation. Keep this source rule when changing the Nitro policy; [Cloudflare static-asset headers](https://developers.cloudflare.com/workers/static-assets/headers/) are configured separately from Worker-generated responses. Rebuild to merge it with Nitro's generated asset rules; never edit `.output/public/_headers` directly. Local asset serving can verify the headers, but only authenticated hosted requests can verify an edge `HIT`.

The frontend's [`env.preview.cache.enabled`](../../../wrangler.jsonc) enables Cloudflare Workers Cache for hosted stage only. [`responseCache.ts`](../../../server/plugins/responseCache.ts) assigns a one-year edge TTL to successful homepage, `/privacy`, and `/about` HTML, and a 12-hour TTL to comparison HTML only when SSR has a validated stored briefing and successful measurements. Both use `Cache-Control: no-cache` for browser revalidation and `Cloudflare-CDN-Cache-Control` for edge freshness with `must-revalidate`, so expired pages are not served stale. Missing/pending/failed briefings, evidence or storage errors, APIs, other dynamic pages, and non-HTML responses receive `no-store`.

Workers Cache is checked before the frontend Worker's entrypoint for each HTTP request, not only requests that the app later marks cacheable. `no-store` prevents a response from being stored, but does not skip the cache lookup. Under Cloudflare's current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), cache-served requests are billed at the same request rate as Worker invocations, including static assets that otherwise have separate free treatment; CPU is billed only when the Worker runs. Include this stage cost/latency behavior when considering any other environment. Cached pages contain the same public content for every authorized visitor; Cloudflare Access remains the authentication gate before Worker execution. Do not cache personalized content without a separate reviewed cache key and authorization design.

`cross_version_cache` is explicitly `false`, so the Worker version is part of the cache key and each deployment starts cold. Cloudflare may evict entries before their TTL, so the one-year home, privacy, and about TTLs are not persistence guarantees. The local root Worker config and production have no Workers Cache setting; a local built preview does not verify hosted cache behavior. See Cloudflare's [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/) and [cache examples](https://developers.cloudflare.com/workers/cache/examples/).

### Automatic main-to-stage deployment

[GitLab CI](../../../.gitlab-ci.yml) validates merge requests and main pushes. Only a **protected `main` push** can continue to `build:stage` and `stage:delivery`; no MR or tag deploys. `stage:delivery` starts the [delivery child pipeline](../../../scripts/deploy-preview/ci-stage.yml), which separates `deploy:stage` from the Chromium and Firefox `verify:stage` jobs. `build:stage` uses GitLab environment `stage-build` with action `prepare`, has no Cloudflare, Access, provider, or telemetry credentials, and receives only the public `NUXT_PUBLIC_SITE_URL` value. It retains its `.output` artifact for seven days, accessible to Maintainers, and embeds the full source SHA and repository URL for the footer. Browser smoke checks compare the rendered commit link directly with the expected CI SHA; no build-metadata endpoint is exposed.

The parent `stage:delivery` holds the `stage` resource-group lock until the entire child pipeline finishes, using GitLab's [resource-group downstream pipeline pattern](https://docs.gitlab.com/ci/resource_groups/#pipeline-level-concurrency-control-with-cross-projectparent-child-pipelines) with `strategy: mirror`. No child job acquires that lock. This prevents a newer deployment from replacing the site during verification while allowing both browsers to run concurrently. `deploy:stage` uses GitLab deployment environment `stage`, is non-interruptible, and stops on any failure; browser jobs start only after it succeeds. It reads only `stage`-scoped runtime values and emits each complete allowlist to the owning Worker through the temporary secrets-file path. The frontend, evidence, and briefing Workers keep their existing names, IDs, and Wrangler `env.preview`; the deploy command continues to use `--env preview`. [The runner](../../../scripts/deploy-preview/deploy-preview.ts) checks artifact SHA/pipeline identity and the current remote `main` immediately before the first mutation. A superseded or unverifiable revision fails without migrating/deploying. Newer commits arriving during a deployment wait for the same lock; these deployments are not atomic and failures never trigger automatic rollback.

Create project variables exactly as specified in the matrix above. Bootstrap rejects deployment credentials and private runtime variables outside their permitted job/environment scopes before dependency installation. `NUXT_PUBLIC_SITE_URL` is the only value available to `stage-build`; runtime settings go only to their owning Worker secret files, and deployment/Access credentials never enter those files. GitLab runtime-setting changes are applied by the next authorized protected-main deployment.

Allow the CI-only Access service token through a **Service Auth** policy on both browser-facing hosts, alongside human Allow policies. Configure hostname-based protection for the socket. Keep resource provisioning and Access policy changes outside ordinary redeployments. Protect `main`, preserve fork-variable restrictions, and restrict stage deployment access to Maintainers where GitLab protected environments are available.

Each `verify:stage` job installs only its selected pinned Playwright runtime and runs `nub run smoke:deployed` with `PREVIEW_BROWSER=chromium` or `PREVIEW_BROWSER=firefox`. The jobs use environment `stage` with action `verify`, not a new deployment. Runner concurrency determines whether they execute simultaneously. Without `PREVIEW_BROWSER`, the smoke command still exercises both browsers; unsupported values fail before network requests. Access and health checks run in each shard. Deployment does not launch browsers, and a browser failure does not change the successful deployment job's status; the child and parent pipelines still fail. Retrying a browser job does not redeploy. Each browser job retains its own sanitized report and screenshots in `.data/preview-verification/`; `deploy:stage` retains only `.data/preview-deployment/report.json`, including failure/partial-success steps, artifact digest, target migration filenames, and deployed Worker version IDs. All artifacts have 30-day retention and Maintainer-only access. Target migration filenames describe the checked-in history, not a claim that every file was newly applied. Raw Wrangler receipt files, browser traces, cookies, credentials, and provider payloads are not uploaded. A failed smoke leaves the deployed revision in place: diagnose and restore compatible code or forward-fix deliberately.

The smoke checks unauthorized frontend/socket rejection, authenticated health and artifact identity, and authenticated socket-host admission using an upgrade for an unassigned sentinel job (expected application 404, not a successful subscription). Chromium and Firefox exercise package search, version selection, comparison APIs, rendered facts, and direct reload. A pending briefing must complete through its real read-only socket; an already-stored result is recorded as cached and does not prove fresh generation or that browser's socket lifecycle. Checks never force a new evidence identity or manually retry failed generation. Local mode accepts loopback origins only and grants Chromium local-network access only to the fixture frontend origin; staging browser permissions are unchanged.

The browser smoke HTTP proxy requests only gzip, deflate, or Brotli responses because its Playwright fetch/fulfillment path does not decode Zstandard correctly for Firefox. Native WebSocket handshakes remain unproxied.

Local builds, dry-runs, and CI Lint simulations do not establish hosted automation. Activation requires merging this pipeline through ordinary review and observing the first protected-main deployment and its verification artifacts. Production remains unconfigured and cannot deploy through this pipeline.

## How is the official preview restricted?

The official preview is restricted to authorized maintainers and approved automation; do not share one person's Access credential. Create the Access application **before the first deployment attaches either custom domain**, so a hostname cannot become reachable without its gate:

1. In Cloudflare Zero Trust, configure hostname-based **Self-hosted** Access protection for both `stage.caniupdate.dev` and `stage-briefing.caniupdate.dev` in the already-active `caniupdate.dev` zone. A single multi-domain application is preferred; if that is unavailable, create a separate application for each hostname. Both host protections and policies must be complete before the protected deployment attaches public routes. Keep any existing Access protection on the old Worker preview hostnames until `workers_dev` and `preview_urls` are disabled by deployment and those endpoints are no longer reachable; only then may the old hostname protection be retired.
2. For each Access application, add a human **Allow** policy for the authorized maintainer group(s) and a separate **Service Auth** policy for the CI service token. In a single multi-domain application, ensure both policies cover both hostnames; with separate applications, configure both policies on each. Configure `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as protected project variables scoped exactly to `stage` as shown in the table above.
3. Only after the Access application and policies exist, deploy the reviewed configuration through the protected `main` pipeline. Its Wrangler `env.preview` attaches `stage.caniupdate.dev` to existing Worker `can-i-update-preview` and `stage-briefing.caniupdate.dev` to existing Worker `can-i-update-preview-briefing`, with `custom_domain: true`; both `workers_dev` and `preview_urls` are disabled. Preserve evidence Worker `can-i-update-preview-evidence` as a private service target with no custom/public hostname. Keep all existing Worker names, resource IDs, bindings, D1, Queue, Durable Object namespaces, and migration history. Do not create or rename Workers, recreate resources, reset databases, or add a public hostname for the evidence Worker. Cloudflare Custom Domains creates the required DNS record and certificate; do not add a separate DNS route. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and the checked-in [frontend](../../../wrangler.jsonc) and [briefing](../../../workers/briefing/wrangler.jsonc) configurations.
4. Verify human browser admission separately from CI's Service Auth smoke: sign in through Access at `https://stage.caniupdate.dev`, start a cold comparison that produces a pending briefing, and confirm the browser's native read-only WebSocket connects to `wss://stage-briefing.caniupdate.dev` without an Access login redirect and receives the job events. A multi-domain Access application is preferred, but do not assume or claim cross-host cookie sharing without this observed flow. The CI service-token smoke proves only the Service Auth path, not human cookie admission. A cold generation can incur provider charges; a cached result does not satisfy this check. An authenticated frontend-only check is insufficient.

Cloudflare documents that Worker-level Access does not support WebSockets, so the briefing socket needs hostname-based protection. The briefing Worker's exact Origin check remains a separate control and does not replace Access. Keep resource provisioning and Access policy changes outside ordinary redeployments. See [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) and [Access cookies](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).

The hostname declarations and this runbook do not establish remote activation. No authorization to mutate Cloudflare was provided for this repository update, and no dashboard or hosted resource was changed; treat the new Access application, route attachment, and cross-host browser verification as unverified until an authorized deployment and check are recorded.

## What remains necessary for production?

Production at `https://caniupdate.dev` is an agreed target, not an existing environment in these configs. Before its runbook can be executable, establish production-specific Worker configuration, domain routing, D1, Queue, Durable Object namespaces, provider secrets, and abuse controls. Choose a reachable production socket hostname or route and configure its exact allowed frontend origin.

Build-time and deployed `NUXT_PUBLIC_SITE_URL` must both be `https://caniupdate.dev`. Do not reuse preview databases, job state, queues, keys, or a preview-origin build. Domain/route setup must also account for alternate public entrypoints, so abuse controls cannot be bypassed through an overlooked hostname.

Cloudflare documents Free support for Workers, SQLite Durable Objects, D1, and Queues. Availability is not proof of this application's sustained suitability. Ordinary Worker CPU and separate request/storage/Queue quotas need representative deployed checks. Queues Free currently includes 10,000 operations/day and 24-hour retention; a successful small message normally uses three operations. Check current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/) before release.

Paid is a compatible target if observed requirements exceed Free. A successful smoke response or client latency sample is not Cloudflare CPU accounting.

### Remaining performance work

Separate from platform quota verification, the open performance work is to reduce comparison-page SSR work and measure its CPU separately; assess whether per-file SHA-256 values are still needed before removing that inspection cost, while preserving whole-archive integrity verification; and investigate filtering redundant Effect HTTP response-header trace attributes without dropping business headers, spans, or propagation. These are investigation targets, not established causes or quantified savings. Representative deployed checks still need to include cold and warm work, SSR CPU, concurrency/memory pressure, and relevant quotas.

Cloudflare branch Previews are not a drop-in isolated three-Worker deployment: service bindings target production deployments and branch Previews cannot consume Queues. Use separately deployed resources for this topology unless deliberately redesigning it. See [Preview resource limitations](https://developers.cloudflare.com/workers/previews/resources/).

## Agreed requirements not yet implemented

- Portable account-local configuration and an exercised self-hosting workflow.
- Production environment and domain/socket routing.
- Production telemetry configuration and hosted verification. Stage can export sanitized OTLP directly to the destination selected in GitLab, with frontend/briefing endpoints and authentication provisioned separately as Worker secrets; no endpoint is selected by checked-in preview vars, and no hosted Collector is required. Gateway acceptance and browser intake do not establish Loki/Tempo query visibility or platform-crash export coverage. Gateway authentication belongs to frontend/briefing Worker secret configuration and is never browser-visible or public. The [platform's Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) capture stays enabled as the independent net for escaped exceptions, with per-request invocation logs disabled because their request metadata includes client IPs; only exception and console records remain, and no outstanding platform setting may reintroduce request-level IP records.
- General public request limiting before expensive evidence work.
- A stricter allowance before new generation acceptance, excluding D1 hits and pending-job joins. Explicit retries starting a new generation count again.
- Distinct rate-limit responses and verified browser behavior under rejection.
- Production footer version and release versioning described in [release identity](releases-and-recovery.md#release-identity); preview commit identity is implemented.

These are release requirements, not claims about current protections. This document adds none of them to runtime code.
