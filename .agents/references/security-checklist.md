# Security Checklist

Quick reference for web-application security. Use alongside the local [`security-and-hardening`](../skills/security-and-hardening/SKILL.md) skill and the repository's threat model. Apply controls at the actual trust and authorization boundaries in the current system; framework snippets are examples, not drop-in policy. Ordinary security checks follow runtime/repository permissions; cross-model review CLI calls require separate explicit authorization.

## Table of Contents

- [Threat Modeling (Start Here)](#threat-modeling-start-here)
- [Pre-Commit Checks](#pre-commit-checks)
- [Authentication](#authentication)
- [Authorization](#authorization)
- [Input Validation](#input-validation)
- [Security Headers](#security-headers)
- [CORS Configuration](#cors-configuration)
- [Data Protection](#data-protection)
- [Dependency Security](#dependency-security)
- [AI / LLM Security](#ai--llm-security)
- [Error Handling](#error-handling)
- [OWASP Top 10 Quick Reference](#owasp-top-10-quick-reference)
- [OWASP Top 10 for LLMs Quick Reference](#owasp-top-10-for-llms-quick-reference)

## Threat Modeling (Start Here)

Before reaching for controls, spend five minutes thinking like an attacker:

- [ ] Map trust boundaries (requests, uploads, webhooks, third-party APIs, LLM output, and local values written by processes you do not control)
- [ ] Name assets (credentials, PII, payment data, admin actions, money movement)
- [ ] Run STRIDE per boundary (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege)
- [ ] Write abuse cases next to use cases (“how would I misuse this?”)

## Pre-Commit Checks

- [ ] Check staged changes for secrets using the repository's secret-scanning tool or an appropriately scoped local review (a text search is only a rough warning, not proof)
- [ ] Confirm ignore rules cover local secret material appropriate to the project (for example `.env`, `.env.local`, `*.pem`, `*.key`)
- [ ] Confirm `.env.example` or equivalent uses placeholders, not real secrets

## Authentication

- [ ] Passwords use a suitable password-hashing algorithm (for example bcrypt with ≥12 rounds, scrypt, or argon2), per current framework guidance
- [ ] Session cookies use appropriate flags (`httpOnly`, `secure`, `sameSite: 'lax'` where suitable)
- [ ] Session expiration is configured with a reasonable maximum age
- [ ] Login endpoints have rate limiting (≤10 attempts per 15 minutes is a useful starting point to assess against abuse and lockout risks)
- [ ] Password-reset tokens are time-limited (≤1 hour is a useful bound) and single-use
- [ ] Account lockout after repeated failures is considered, with notification and denial-of-service tradeoffs understood
- [ ] MFA is supported for sensitive operations where appropriate

## Authorization

- [ ] Every protected endpoint checks authentication
- [ ] Every resource access checks ownership/role to prevent IDOR
- [ ] Admin endpoints verify the required admin role
- [ ] API keys have the minimum necessary permissions
- [ ] JWT tokens are validated for signature, expiration, and issuer
- [ ] Authorization is enforced in the application at the actual boundary; a prompt, UI control, or client-provided claim alone is not an authorization check

## Input Validation

- [ ] Validate all user input at system boundaries (API routes, form handlers)
- [ ] Prefer allowlists to denylists
- [ ] Constrain string lengths (minimum and maximum)
- [ ] Validate numeric ranges
- [ ] Validate email, URL, and date formats with suitable libraries
- [ ] Restrict file-upload type, limit size, and verify content
- [ ] Parameterize SQL queries; do not concatenate untrusted values into query text
- [ ] Encode HTML output (use framework auto-escaping correctly)
- [ ] Validate URLs before redirecting to prevent open redirects
- [ ] Allowlist server-side URL fetch targets and block private/reserved IPs to prevent SSRF
- [ ] Before destructive path operations (delete/move/overwrite), resolve symlinks, check containment under an allowlisted root, enforce minimum depth, and read ownership evidence before the call

### Destructive Path Operations

Containment for a target named by data. Resolve first, then decide — and treat the result as a candidate, not as authorization:

```typescript
import { realpath, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';

const ALLOWED_ROOTS = ['/var/lib/myapp/sessions']; // an allowlist, not a pattern
const MIN_DEPTH = 1; // so a root is never the target

async function resolveDeletable(candidate: string, expectedOwner: string) {
  const target = await realpath(resolve(candidate)); // symlinks resolved BEFORE the check
  const inRoot = ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, target);
    // `rel === '..'` / `'../'` only — a plain `startsWith('..')` would also
    // reject a legitimate child named `..cache`.
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
    return rel.split(sep).length >= MIN_DEPTH;
  });
  if (!inRoot) throw new Error(`refusing: outside allowed roots (${target})`);

  const owner = await readFile(join(target, '.owner'), 'utf8').catch(() => null);
  if (owner?.trim() !== expectedOwner) throw new Error(`refusing: unproven owner (${target})`);
  return target;
}
```

What this does not do, and must be said where the snippet is copied from:

- **The marker is self-attestation.** Anything that can write inside the root can write `.owner`. `expectedOwner` has to come from authenticated state, and the marker needs integrity protection (restrictive ownership, or a MAC) before it is authorization rather than a consistency check against a misderived target.
- **Returning a path leaves a check/use race.** Where an untrusted process can swap an ancestor between the check and the call, operate on a descriptor with no-follow, beneath-the-root semantics, or guarantee the hierarchy is immutable for the duration.

## Security Headers

Select headers to fit the application and deployment; validate that policies do not break required functionality.

```
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0  (disabled, rely on CSP)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## CORS Configuration

```typescript
// Restrictive (recommended): use the exact trusted application origins
cors({
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Do not use for a credentialed production application:
cors({ origin: '*' }); // Allows any origin
```

## Data Protection

- [ ] Sensitive fields are excluded from API responses (`passwordHash`, `resetToken`, etc.)
- [ ] Sensitive data is not logged (passwords, tokens, full credit-card numbers)
- [ ] PII is encrypted at rest where required by policy or regulation
- [ ] HTTPS is used for external communication
- [ ] Database backups are encrypted
- [ ] Personal data is classified, collected for a stated purpose, and minimized
- [ ] Personal data has a retention limit and a working deletion path (including backups, caches, and indexes)
- [ ] Data-subject export/delete requests are supported where required; third-party sharing has consent and an appropriate data-processing agreement

## Dependency Security

First locate the **installation boundary**. If the package is matched by a parent `workspaces` declaration, use that workspace root; otherwise use the nearest project root that owns both its manifest and dependency graph. At that boundary, corroborate `packageManager` (when present), the lockfile, and CI commands. Stop if they disagree or competing manager lockfiles exist there. A nested project is independent only when outside the parent workspace; independent subprojects may legitimately use different managers.

| Manager/version signal                             | Frozen/immutable CI install      | Known-advisory audit   |
| -------------------------------------------------- | -------------------------------- | ---------------------- |
| npm (`package-lock.json` or `npm-shrinkwrap.json`) | `npm ci`                         | `npm audit`            |
| pnpm                                               | `pnpm install --frozen-lockfile` | `pnpm audit`           |
| Yarn 2+                                            | `yarn install --immutable`       | `yarn npm audit -A -R` |
| Yarn 1                                             | `yarn install --frozen-lockfile` | `yarn audit`           |

For an unlisted manager or version, consult its official documentation; do not substitute another manager's commands or newer defaults. These are reference commands only: inspect project configuration first and follow runtime/repository permissions for ordinary security tooling.

### Install-Script Gate

Never discover dependency lifecycle scripts by first executing an ordinary install on a client whose defaults have not been verified.

1. Bootstrap with dependency scripts disabled, or with a documented default-deny policy plus fail-closed enforcement.
2. Inspect the exact script source and package version before approval.
3. Record the narrowest native allow/deny policy at the installation boundary and commit it.
4. Run a clean frozen/immutable install with that policy and verify the required packages still build.

**Point-in-time snapshot:** Package-manager defaults and command names change quickly. Verify this matrix against the pinned client's current official documentation before relying on it.

| Manager version                         | Native policy                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm without verified granular approvals | Bootstrap with `npm ci --ignore-scripts`, or persist `ignore-scripts=true` when project-wide blocking is intended. Keep scripts disabled or deliberately upgrade before allowing any reviewed dependency script.                                                       |
| npm 11.18.x (verified on 11.18.0)       | Unreviewed dependency scripts run with a warning by default. Enforce `strict-allow-scripts=true` before a normal install, then use the workspace-unaware `npm install-scripts ls` from the installation boundary; keep approvals version-pinned and denials name-wide. |
| npm 12.x (verified on 12.0.1)           | Unreviewed dependency scripts are skipped by default; `strict-allow-scripts=true` makes their presence fail the install before execution. Use the same `npm install-scripts` review and approval flow.                                                                 |
| pnpm 11+                                | Use `pnpm approve-builds` and commit `allowBuilds` decisions; `strictDepBuilds` defaults to `true`, so unreviewed builds fail.                                                                                                                                         |
| pnpm 10.26–10.x                         | Configure `allowBuilds` explicitly, or use `pnpm approve-builds` with the legacy `onlyBuiltDependencies` / `ignoredBuiltDependencies` lists. Set `strictDepBuilds: true`; its v10 default is `false`.                                                                  |
| pnpm 10.1–10.25                         | `pnpm approve-builds` records the legacy lists; enable `strictDepBuilds` where supported (10.3+).                                                                                                                                                                      |
| Older or unknown pnpm                   | Bootstrap with `pnpm install --frozen-lockfile --ignore-scripts`. Keep scripts disabled unless the pinned version documents an enforceable policy.                                                                                                                     |
| Yarn 4.14+                              | Dependency postinstalls are disabled by default. Grant only required exceptions with top-level `dependenciesMeta.<package>.built: true`.                                                                                                                               |
| Yarn 2–4.13                             | Set `enableScripts: false` in `.yarnrc.yml`, then grant only required exceptions with top-level `dependenciesMeta.<package>.built: true`; do not enable scripts globally.                                                                                              |
| Yarn 1                                  | Bootstrap with `yarn install --ignore-scripts`; keep scripts disabled unless each required exception is reviewed under the pinned client's documented workflow.                                                                                                        |

Authoritative checks: [npm install-scripts](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/), [npm install policy](https://docs.npmjs.com/cli/v11/commands/npm-install/), and [npm CLI releases](https://github.com/npm/cli/releases); [pnpm approve-builds](https://pnpm.io/cli/approve-builds) and [pnpm build settings](https://pnpm.io/settings#allowbuilds); [Yarn security](https://yarnpkg.com/features/security) and the [Yarn manifest](https://yarnpkg.com/configuration/manifest#dependenciesMeta).

**Supply-chain hygiene** (advisory audits do not catch newly malicious packages):

- [ ] Exactly one authoritative lockfile per project/workspace root is committed and CI never rewrites it
- [ ] Critical/high findings are triaged for reachability; deferrals have a reason and review date
- [ ] Forced audit remediation (`npm audit fix --force` or equivalent) is never automatic; remediation diffs and changelogs are reviewed
- [ ] Registry signatures/provenance are verified where the manager supports it
- [ ] Dependency lifecycle scripts are blocked before first execution and approved only through the pinned manager's native policy
- [ ] New dependencies are reviewed for ownership, maintenance, release age, provenance, transitive graph, and typosquatting

## AI / LLM Security

For any feature that calls an LLM (chatbots, summarizers, agents, RAG):

- [ ] Model output is treated as untrusted — never passed into `eval`/SQL/shell/`innerHTML`/file paths without safe, context-specific handling
- [ ] Prompt injection is assumed; permissions are enforced in code, not in a system prompt
- [ ] Secrets, cross-tenant data, and full system prompts are kept out of the context window
- [ ] Tool/agent permissions are scoped; destructive or irreversible actions require explicit human confirmation
- [ ] Token, rate, and recursion/loop limits bound consumption

## Error Handling

```typescript
// Production: generic error, no internals
res.status(500).json({
  error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
});

// Do not expose internals in production:
res.status(500).json({
  error: err.message,
  stack: err.stack, // Exposes internals
  query: err.sql, // Exposes database details
});
```

## OWASP Top 10 Quick Reference

| #   | Vulnerability             | Prevention                                                                                                          |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Broken Access Control     | Auth checks on every endpoint, ownership verification                                                               |
| 2   | Cryptographic Failures    | HTTPS, strong hashing, no secrets in code                                                                           |
| 3   | Injection                 | Parameterized queries, input validation                                                                             |
| 4   | Insecure Design           | Threat modeling, requirements-driven development                                                                    |
| 5   | Security Misconfiguration | Security headers, minimal permissions, dependency audits                                                            |
| 6   | Vulnerable Components     | The ecosystem's dependency audit (`npm audit`, `pip-audit`, etc.), keep dependencies updated, minimize dependencies |
| 7   | Authentication Failures   | Strong passwords, rate limiting, session management                                                                 |
| 8   | Data Integrity Failures   | Verify updates/dependencies, signed artifacts                                                                       |
| 9   | Logging Failures          | Log security events, do not log secrets                                                                             |
| 10  | SSRF                      | Validate/allowlist URLs, restrict outbound requests                                                                 |

## OWASP Top 10 for LLMs Quick Reference

For applications with LLM features, see the [OWASP GenAI Security Project](https://genai.owasp.org/llm-top-10/).

| ID    | Risk                             | Prevention                                                                        |
| ----- | -------------------------------- | --------------------------------------------------------------------------------- |
| LLM01 | Prompt Injection                 | Do not trust the system prompt as a boundary; enforce permissions in code         |
| LLM02 | Sensitive Information Disclosure | Keep secrets/PII out of prompts; filter outputs                                   |
| LLM03 | Supply Chain                     | Vet models, datasets, and plugins like any dependency                             |
| LLM04 | Data and Model Poisoning         | Use trusted model sources, verify integrity; vet fine-tuning and RAG data         |
| LLM05 | Improper Output Handling         | Treat model output as untrusted; validate, parameterize, encode                   |
| LLM06 | Excessive Agency                 | Scope tool permissions; require confirmation for destructive actions              |
| LLM07 | System Prompt Leakage            | Assume the system prompt can leak; put no secrets in it                           |
| LLM08 | Vector and Embedding Weaknesses  | Partition RAG embeddings per tenant; validate documents before indexing           |
| LLM09 | Misinformation                   | Ground answers with citations; validate critical claims; keep a human in the loop |
| LLM10 | Unbounded Consumption            | Cap tokens, request rate, and loop/recursion depth                                |
