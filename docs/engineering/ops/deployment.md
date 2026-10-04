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

| Configuration                  | Required relationship                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| `PACKAGE_EVIDENCE.script_name` | Exact deployed evidence Worker name                                |
| `BRIEFING_SERVICE.service`     | Exact deployed briefing Worker name                                |
| `BRIEFING_SERVICE.entrypoint`  | `BriefingSubmitter`                                                |
| D1 binding                     | `BRIEFINGS_DB`, with this target's database ID                     |
| Queue binding                  | `BRIEFING_QUEUE`, with this target's queue name                    |
| Job Durable Object binding     | `BRIEFING_JOBS`, class `BriefingJob`                               |
| `NUXT_PUBLIC_SITE_URL`         | Exact frontend origin, also supplied at build time                 |
| `BRIEFING_PUBLIC_URL`          | Reachable `wss` socket origin for this target                      |
| `BRIEFING_ALLOWED_ORIGIN`      | Exact allowed frontend origin or deliberately selected origin list |

Preserve the configured SQLite Durable Object migrations. Repeat environment-specific bindings explicitly rather than assuming Wrangler inherits them. If configs are relocated, resolve `main`, schema, and migration paths relative to their new locations. The built frontend config must come from the account-local frontend configuration, not silently retain the maintainer's bindings.

Do not commit operator keys or accidentally include account-specific changes in an unrelated contribution. Before publishing a fork deployment recipe, the account-local workflow must be exercised in an independent account. This document does not substitute guessed commands for that missing capability.

## Where do credentials and AI settings go?

Store Cloudflare deployment credentials outside app `.env`, Worker `.dev.vars`, and generated frontend output. For automation, use a least-privilege account-scoped token. Provisioning Workers, D1, Queues, and Access may require different permissions; grant only those used by the chosen procedure. Contributors use their own credentials, never the maintainers' token.

For a deployed instance:

- `GITHUB_TOKEN`, if used, is an evidence Worker secret.
- `AI_BRIEFING_API_KEY` is a briefing Worker secret.
- `AI_BRIEFING_ENDPOINT` and `AI_BRIEFING_MODEL` belong to the briefing Worker environment. They are not public frontend configuration.
- `NUXT_PUBLIC_SITE_URL` is public configuration, not a secret.
- Access automation credentials are separate from deployment and provider credentials.

Configure secrets for the exact Worker and environment. Do not put a real key in Wrangler `vars`, commit it, print it in a release record, or pass it as a visible command argument. See [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [local ownership](development.md#where-does-configuration-belong).

Production is intended to use OpenRouter at `https://openrouter.ai/api/v1/chat/completions`, with a dedicated key and an operator-configured spend limit. Budget amounts and reset intervals are operator choices, not prescribed here. Preview real-provider checks use a separate key. Default contributor checks and official preview configuration must not perform real inference.

Self-hosters may choose another provider implementing the supported OpenAI-compatible Chat Completions contract. HTTPS is required except for loopback fixtures. Endpoint query parameters are rejected. Model output must satisfy the application's strict JSON/citation contract; API compatibility does not guarantee every model produces valid output. See [provider behavior](../briefing.md#result-storage-and-generation-failures).

A spend cap does not protect Cloudflare quotas or guarantee fair access. Cached briefing success does not prove a valid provider key or a working new-generation path.

## How are resources provisioned and code deployed?

Separate first-time bootstrap from ordinary redeployment.

### First-time bootstrap

1. Verify the selected account, environment, resource names, and origins.
2. Create this target's D1 database and record its returned ID in the binding.
3. Create this target's Queue and use its name consistently in producer and consumer configuration.
4. Configure preview access before sharing a restricted environment.
5. Review and apply D1 migrations to the explicit remote target.
6. Deploy evidence, briefing, and built frontend in that order. The configured Durable Object class migrations are part of Worker deployment.
7. Verify the deployed surface and record evidence.

Do not put Queue creation into every redeployment sequence or interpret a failed provisioning command as permission to continue. An existing queue/database must be positively identified as belonging to the intended target.

### Redeploying the existing maintainer preview

The following commands are specific to the checked-in maintainer preview. They are not a fork-deployment recipe or a production recipe. Run only as an authorized maintainer, from the selected reviewed revision, after migration compatibility review. Stop a local built preview before rebuilding `.output`.

Build without deployment credentials:

```bash
NUXT_PUBLIC_SITE_URL=https://can-i-update-preview.caniupdate-dev.workers.dev nub run build
```

Then load the authorized external credentials in a subshell and deploy. The credentials file must not be committed; the documented maintainer convention is directory mode `700` and file mode `600`.

```bash
(
  set -e
  set -a
  . "$HOME/.config/can-i-update/cloudflare.env"
  set +a
  export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
  export CLOUDFLARE_INCLUDE_PROCESS_ENV=false
  nub exec wrangler d1 migrations apply BRIEFINGS_DB --remote --config workers/briefing/wrangler.jsonc --env preview &&
    nub exec wrangler deploy --config workers/evidence/wrangler.jsonc --env preview &&
    nub exec wrangler deploy --config workers/briefing/wrangler.jsonc --env preview &&
    nub exec wrangler deploy --config .output/server/wrangler.json --env preview
)
```

This sequence assumes the target D1 and Queue already exist. Keep `--env preview` on every target-specific remote operation. Build success and backend dry-runs do not establish deployment success. See [release checks](releases-and-recovery.md#verification-and-release-evidence).

## How is the official preview restricted?

The agreed policy is a restricted environment for a growing maintainer team, not access through one person's shared credential. Use Cloudflare Access policies for authorized people and separate Service Auth credentials for approved automation.

Cover both the frontend and briefing socket hostnames. Cloudflare documents that Worker-level Access does not support WebSockets; use hostname-based Access for the socket. A multi-domain application can cover both concrete hostnames, but verify the actual browser login and cross-host socket flow. Origin allowlisting does not replace Access. See [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) and [Access cookies](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).

An authenticated frontend-only check does not establish protection of both browser-facing hosts. Fresh access checks are required on both the frontend and socket host before treating the environment as restricted.

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
- General public request limiting before expensive evidence work.
- A stricter allowance before new generation acceptance, excluding D1 hits and pending-job joins. Explicit retries starting a new generation count again.
- Distinct rate-limit responses and verified browser behavior under rejection.
- Footer metadata and release versioning described in [release identity](releases-and-recovery.md#release-identity).

These are release requirements, not claims about current protections. This document adds none of them to runtime code.
