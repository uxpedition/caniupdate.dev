---
name: security-and-hardening
description: Threat-models and hardens software, data, runtime configuration, and dependencies. Use when handling untrusted input, authentication/authorization, storage, external services, uploads, webhooks, secrets, private provider/runtime data, dependency supply-chain risk, or personal information and privacy obligations.
---

# Security and Hardening

## Overview

Security is a constraint on every path touching user data, identity, credentials, or external systems—not a final checklist. Treat data according to who wrote it, secrets as private, and authorization as mandatory on every protected operation. Design the trust boundary first; controls added without a threat model are guesses.

## When to use

- Building a feature that accepts user-controlled or externally supplied data
- Implementing authentication, authorization, sessions, or privileged actions
- Storing, transforming, or transmitting sensitive or personal data
- Adding a third-party API, provider, webhook, callback, file upload, or remote fetch
- Handling credentials, runtime configuration, deployment tokens, or raw provider errors
- Auditing dependencies, package-manager behavior, lockfiles, or build scripts
- Reviewing privacy, retention, consent, export, or deletion behavior

## Authorization and safe execution

Some security decisions change who can access data or create new external trust. Ask the authorized human before adding/changing authentication flows, collecting a new category of sensitive data, adding an external integration, changing CORS/permissions/rate limiting, accepting uploads, granting elevated roles, or enabling paid/provider behavior. A discussion or approved design is not authorization to implement, publish, or deploy it.

Ordinary security tools and package-registry queries follow runtime/repository permissions. Obtain explicit authorization for new integrations, paid provider work, production mutations, and private-data sharing; do not infer these permissions from a local check. Each external CLI invocation for cross-model review requires separate explicit authorization. Keep command arguments, terminal output, logs, artifacts, and context passed to other tools free of credentials and private runtime/provider details. Prefer read-only isolated checks and scoped tokens. Production/deployment authority is never implied by test approval.

## Process: threat model first

Before writing controls, identify trust boundaries and abuse paths:

1. **Map trust boundaries.** Find where untrusted or less-trusted data enters: HTTP requests, forms, uploads, webhooks, third-party responses, queues, sockets, files, environment/process metadata, command-line arguments from another process, shared-volume paths, and **LLM output**. Internal-looking values remain untrusted if another actor could have written them. Trust follows the writer, not the transport.
2. **Name assets.** Identify credentials, personal data, payment data, admin actions, business-critical state, queues, and money movement worth stealing, changing, or exhausting.
3. **Apply STRIDE at each boundary** as a focused threat lens:

| Threat                     | Ask                                         | Typical control                                                  |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| **S**poofing               | Can an actor impersonate a user or service? | Authentication and signature verification                        |
| **T**ampering              | Can data change in transit or storage?      | Integrity checks, parameterized queries, authenticated transport |
| **R**epudiation            | Can an actor deny an action?                | Appropriate, privacy-safe security audit events                  |
| **I**nformation disclosure | Can data or configuration leak?             | Encryption, field allowlists, generic errors, access control     |
| **D**enial of service      | Can bounded capacity be exhausted?          | Rate and size limits, deadlines, concurrency limits              |
| **E**levation of privilege | Can a caller gain rights they lack?         | Resource-level authorization and least privilege                 |

4. **Write abuse cases next to use cases.** Ask “how could this be misused?” and turn the highest-risk case into a behavior test before hardening. Consider replay, malformed input, cross-tenant access, stale authorization, duplicate side effects, partial failure, and resource exhaustion.

If the trust boundaries for a feature are unclear, pause implementation and clarify them. This is a design weakness, not merely a missing validation call. The [OWASP Top 10](https://owasp.org/www-project-top-ten/) describes common web risks; use it as a check, not a substitute for system-specific analysis.

## Three-tier boundary system

### Always enforce

- Validate every external input at the system boundary and use only the parsed, typed value downstream.
- Parameterize database queries; never concatenate input into SQL, NoSQL, shell, template, or query languages.
- Encode output through the framework's safe path. Sanitize with a strict allowlist if raw markup is truly required.
- Use authenticated encrypted transport for external communication.
- Hash passwords with a current password-hashing algorithm and safe parameters; never store plaintext or reversible password encryption.
- Set security headers appropriate to the application, including CSP/HSTS/frame/content-type protections where applicable.
- Use secure session cookies and server-side session controls; protect state-changing requests from CSRF.
- Enforce authorization for every protected resource and action; authentication alone is not permission.
- Run the detected ecosystem's native audit against the committed authoritative lockfile before release and triage reachability.
- Keep credentials, private runtime/provider settings, and raw provider/request data within their owning runtime and access boundary.

### Ask an authorized human first

- Adding authentication or changing identity/session semantics
- Collecting a new class of personal, financial, health, location, biometric, or otherwise sensitive data
- Introducing a new external provider, analytics/advertising/LLM service, or data-sharing path
- Changing CORS, trust roots, access policy, permission scope, rate limits, or throttling
- Adding file-upload or remote-fetch handling
- Granting elevated permissions or roles
- Enabling paid production behavior, deployment credentials, or non-test provider calls

### Never do

- Commit credentials or private runtime/provider configuration, even temporarily
- Log passwords, tokens, keys, raw prompts, full payment data, or unredacted personal payloads
- Treat client-side validation or a UI-hidden control as a security boundary
- Disable security controls for convenience without an approved risk decision
- Evaluate or render untrusted content as code/HTML (`eval`, unsafe `innerHTML`, unsafe shell construction)
- Store authentication tokens in client-accessible persistence when a secure session design is appropriate
- Expose stack traces, raw provider responses, or internal error details to users
- Reuse production secrets for CI, local tests, or contributor previews

## Hardening controls

Concrete examples for these rules are in [`references/hardening-patterns.md`](references/hardening-patterns.md). Read only the pattern for the boundary being changed.

### Injection, XSS, and access control

Parameterize every query; never construct SQL, shell, or document queries from user input. Encode output using the framework's safe rendering. If raw HTML is unavoidable, sanitize with a reviewed allowlist. Check authorization on every operation and every resource—not merely at login. An authenticated user must own or have explicit permission for the selected object and action; prevent IDOR/cross-tenant access.

Patterns: [injection](references/hardening-patterns.md#injection), [XSS](references/hardening-patterns.md#cross-site-scripting-xss), [access control](references/hardening-patterns.md#broken-access-control).

### Authentication and sessions

Use a current password hash such as Argon2id, scrypt, or bcrypt with an appropriate work factor. Session secrets come from the secret owner, never source code or a public variable. Cookies should be `httpOnly`, `secure`, and appropriately `sameSite` (`lax`/`strict` where compatible), with bounded lifetime and rotation/revocation behavior. `SameSite=None` sends cookies cross-site and requires a deliberate CSRF design. See [authentication patterns](references/hardening-patterns.md#broken-authentication).

### Headers, CORS, and responses

Set security headers on all relevant responses using the framework's mechanism. Start CSP from a restrictive `default-src 'self'` policy and tighten it to observed needs; do not loosen it to “make scripts work” without investigating. Restrict CORS to exact configured origins and never combine wildcard origins with credentials. Remove sensitive fields before serialization. Return generic public errors; keep sanitized diagnostic context in authorized server logs only.

Patterns: [misconfiguration](references/hardening-patterns.md#security-misconfiguration), [sensitive data exposure](references/hardening-patterns.md#sensitive-data-exposure). See the shared [security checklist](../../references/security-checklist.md) for headers and CORS review.

### Input validation and uploads

Validate an allowlisted shape, types, lengths, enums, formats, and cross-field constraints at the boundary. Reject malformed input with a structured, non-sensitive client error; business code consumes only validated data. Unknown fields should be rejected or deliberately handled according to the public contract.

For uploads, allowlist media types, bound byte size and dimensions/processing time, and inspect file contents (magic bytes) where risk warrants. A filename or MIME header is not proof of type. Store outside executable/public paths, use generated object names, and scan or sandbox content according to risk.

Patterns: [schema validation](references/hardening-patterns.md#schema-validation-at-boundaries), [uploads](references/hardening-patterns.md#file-upload-safety).

### Server-side request forgery (SSRF)

Any user-influenced URL—webhook destination, import-from-URL, image proxy, link preview—can target internal services. Prefer a strict scheme/host allowlist. Resolve **all** DNS records and reject any private or reserved address, including loopback, link-local `169.254.169.254`, private IPv4, and IPv6 unique-local ranges. Forbid redirects or revalidate every redirect target. A DNS check followed by a second resolution still has a time-of-check/time-of-use rebinding gap; for high-risk surfaces pin the verified destination or use a reviewed filtering transport. Bound response size, time, redirects, and concurrency.

Pattern: [SSRF](references/hardening-patterns.md#server-side-request-forgery-ssrf).

### Destructive operations on derived paths

A delete, move, overwrite, or cleanup action is only as safe as the identity and ownership evidence for its target. A path from a queue, config, local process, or sibling service is as attacker-controlled as a form field if another actor can write it. A shape check proves well-formedness, not authorization.

Before the destructive call, require all three: the resolved target (including symlinks) is under an **allowlisted root**; it is at least one level **below** that root; and the target has **ownership evidence read before the operation**. On refusal, log a sanitized rejected-target classification and stop—never fall back to a broader default path.

A marker inside the target tree can be self-attestation if the same actor can write it. Expected ownership must come from authenticated state; marker evidence needs integrity protection. Path resolution followed by a name-based destructive call can race if another process swaps an ancestor. On shared storage, hold a descriptor and use no-follow/beneath-root operations or ensure the hierarchy cannot change. Detailed worked guidance: [destructive paths](references/hardening-patterns.md#destructive-operations-on-derived-paths) and shared [security checklist](../../references/security-checklist.md#destructive-path-operations).

### Rate limiting and resource limits

Apply general request limits and stricter controls on authentication, password reset, expensive search, generation, or other abuse-sensitive paths. A value such as roughly ten authentication attempts per fifteen minutes is a starting point, not a universal policy; derive limits from threat model, user impact, and legitimate traffic. Bound body size, parser work, file processing, deadlines, concurrency, queue age, and expensive provider operations.

In-memory counters do not enforce a global limit across multiple processes or fresh serverless invocations. Once more than one process handles requests, use an appropriate shared store or managed limiter, and confirm failure mode. See [rate limiting](references/hardening-patterns.md#rate-limiting).

### Secrets and private runtime/provider configuration

Keep each secret with the runtime/platform that needs it, following the project's documented configuration ownership. Separate local fixtures, CI credentials, preview secrets, and production credentials. `.env.example` and public config contain placeholders or intentionally public values only; real env files/key material stay ignored and outside repository artifacts. Do not pass secrets as visible CLI arguments or print environment/config state while debugging. Do not surface private worker/service names, provider endpoint/model/key, raw provider body, prompts, or internal runtime configuration in browser output, commit history, public docs, or unapproved tools.

Review the exact staged diff before committing. If a real secret reaches a remote, assume it was compromised: revoke/rotate it first, then follow the approved history cleanup and incident process. Removing a line or rewriting history alone does not revoke a key.

Pattern: [secrets management](references/hardening-patterns.md#secrets-management).

### Dependencies and supply-chain security

Native audit output covers known advisories, not trustworthiness, reachability, or safety of install-time code. Before an audit/install change:

1. **Find the installation boundary and package manager.** Inspect project instructions, workspace roots, `packageManager` or equivalent runtime/version pin, lockfiles, and CI. A nested package is independent only when repository structure confirms it. Stop on competing lockfiles or disagreement; never guess which lockfile is authoritative. Pin the package manager/runtime and install immutably from its committed lockfile.
2. **Control dependency scripts before first execution.** Bootstrap with scripts disabled or a documented fail-closed policy when supported. Inspect pending install/postinstall scripts, approve only the minimum required, commit the intentional policy, then verify with a clean frozen/immutable install. Never blanket-approve arbitrary scripts.
3. **Run the detected manager's native audit against the committed lockfile before every release.** Triage critical/high findings by reachability through runtime, build, test, and deploy paths and fix available exposures. Do not apply a forced remediation automatically: it may cross declared ranges or introduce breaking behavior. Preview the update, read release notes, test it, and document each deferral with reason and review date.
4. **Review for malicious or typosquatted packages too.** Audits miss newly malicious packages and lookalike names. Review new dependencies, lockfile diffs, provenance/signatures where supported, owner and maintenance history, release age, transitive graph, and install-script changes together. Signature absence is a signal to investigate, not proof of compromise. Follow the [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) where package/build automation includes model-generated code or tool execution.

Triage decisions: [dependency audit triage](references/hardening-patterns.md#dependency-audit-triage). Package manager, lockfile, install-script, and audit matrix: shared [security checklist](../../references/security-checklist.md#dependency-security).

### Personal data and privacy

Security asks whether an attacker can access data. Privacy asks whether the system should collect or retain it at all. Data never collected cannot be breached, subpoenaed, or missed by a deletion process.

- **Classify fields when adding them** (non-personal, personal/PII, sensitive) and identify every storage, log, cache, index, and analytic copy.
- **Collect only for a stated purpose.** “Might be useful later” is not a purpose. Keep personal data out of telemetry by default; `observability-and-instrumentation` covers operational signals.
- **Set retention before collection and implement deletion.** Each personal-data store needs a retention rule and working deletion path that accounts for backups, caches, search, analytics, and derived state.
- **Support applicable data-subject rights** such as access/export, correction, and deletion. Design data so a subject's information is findable and erasable rather than smeared irreversibly across unrelated records.
- **Gate consent and third-party sharing.** Sending personal data to analytics, advertising, LLM, or other vendors is sharing. Confirm approved purpose, consent where required, processor terms, and region policy before enabling it. Keep region an explicit policy rather than a hard-coded assumption.

Classification: [data classification](references/hardening-patterns.md#data-classification). A privacy incident may trigger legal notification timelines; preserve evidence and follow the authorized incident-response procedure.

### AI/LLM features

LLM features add attack surface. Treat model output and retrieved content as untrusted data and map relevant controls to the [OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/llm-top-10/):

- **Model output is untrusted input (LLM05).** Never pass it directly to `eval`, SQL, shell, unsafe HTML, file paths, or privileged actions. Parse, validate against a schema, constrain to an allowlist, and encode before use.
- **Prompts can be hijacked (LLM01).** User messages, fetched pages, PDFs, and other context may carry instructions. A system prompt is not an authorization boundary; enforce permissions in code.
- **Minimize context (LLM02/LLM07).** Keep secrets, other tenants' data, private runtime/provider configuration, and full system prompts out of context where possible. Do not send sensitive content to a model/vendor without explicit authorization and privacy review.
- **Constrain tools and side effects (LLM06).** Scope tool permissions, validate every argument, and require human confirmation for destructive or externally visible actions.
- **Bound cost and recursion (LLM10).** Cap tokens, request rate, retries, recursion depth, deadlines, and concurrency.
- **Partition retrieval (LLM08).** Enforce tenant boundaries in embeddings/indexes and validate source documents before indexing.

Pattern: [LLM output handling](references/hardening-patterns.md#llm-output-handling).

## Review checklist

Before sign-off, walk the shared [`security-checklist.md`](../../references/security-checklist.md), which covers threat modeling, input boundaries, authentication/authorization, private data, headers/CORS, dependency and install-script policy, AI/LLM risk, errors, and release checks. The shared checklist is an aid, not a substitute for local architecture or threat analysis.

## Common rationalizations

| Rationalization                             | Reality                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| “It's an internal tool.”                    | Internal systems are compromised too; trust boundaries still need authentication and authorization. |
| “We'll add security later.”                 | Identity, data ownership, and trust are structural; retrofitting them is a migration.               |
| “No one would exploit this.”                | Automation finds unexpected inputs and exposed paths. Design for misuse rather than obscurity.      |
| “The framework handles security.”           | Frameworks provide mechanisms, not correct use or resource-level authorization.                     |
| “It's only a prototype.”                    | Prototypes often become production. Don't leak real secrets or data into them.                      |
| “Threat modeling is overkill.”              | A short boundary/abuse review catches design flaws controls cannot repair.                          |
| “It's just LLM text.”                       | Text can become SQL, markup, shell input, or an unauthorized action. Validate and constrain it.     |
| “The audit passed, so the package is safe.” | Audits miss newly malicious packages and unreviewed install scripts.                                |
| “Collect it now; we may need it.”           | Data without purpose expands breach and deletion scope.                                             |
| “We'll handle deletion manually.”           | Manual erasure misses backups, caches, and analytics copies; design a full data path.               |
| “Compliance is legal's problem.”            | Consent, retention, deletion, and export are implemented in schemas and code as well as policy.     |

## Red flags

- User input reaches database queries, shell commands, paths, or HTML without boundary validation/encoding
- Destructive path chosen from a payload/config/process argument and guarded only by shape validation
- Credentials or private runtime/provider settings in source, logs, history, or public artifacts
- Protected route checks only authentication, not ownership/authorization
- Wildcard CORS with credentials, missing security headers, or raw internal errors sent to clients
- No rate limiting on abuse-sensitive paths, or a per-process limiter presented as a global limit
- Dependency has known reachable critical/high advisories; ambiguous competing lockfiles; mutable installs; blanket-approved scripts
- User-supplied server URL fetched without SSRF checks or redirect validation
- LLM output passed to execution/markup/privileged operations or given cross-tenant data
- Personal data has no purpose, retention rule, or end-to-end deletion/export path
- Data sent to analytics/advertising/LLM vendor without consent/processor review
- Account deletion changes a flag but leaves data in stores, logs, backups, caches, or indexes

## Verification

After security-relevant implementation:

- [ ] Trust boundaries, assets, STRIDE threats, abuse cases, and authorization owners are explicit.
- [ ] Every external value is validated at the boundary; every protected operation checks resource-level authorization.
- [ ] Queries, output rendering, sessions, headers, CORS, errors, uploads, remote fetches, and destructive paths follow the relevant hardening controls.
- [ ] Dependency audit used the detected package manager and authoritative lockfile; reachable high-risk findings have a fix or documented owner/review date.
- [ ] Install scripts and third-party build actions are reviewed; untrusted code cannot access deployment or publishing secrets.
- [ ] Credentials, private runtime/provider values, raw bodies, prompts, and unredacted personal data are absent from source, logs, artifacts, browser responses, and release evidence.
- [ ] Personal data is classified, purpose-limited, retained only as needed, and discoverable for export/deletion across dependent stores.
- [ ] Any new provider, sensitive data category, auth/CORS/rate-limit change, elevated permission, remote CLI call, or paid operation has the required explicit authorization.
- [ ] The scoped checks exercise real boundary behavior; no security claim is based only on naming, configuration presence, or a passing audit.
