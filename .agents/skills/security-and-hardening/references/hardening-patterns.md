# Hardening Patterns

Concrete examples and decision aids for the controls in `security-and-hardening`. The skill states the rule; this file shows one implementation pattern. Open only the relevant section for a boundary being changed. These examples use familiar TypeScript/Express/SQL tools, not a required stack—confirm the repository's runtime, framework, and trust model first.

Shared threat-model prompts, safe pre-commit review, headers/CORS, package-manager discovery, install-script controls, and OWASP quick-reference tables belong to the shared [`security-checklist.md`](../../../references/security-checklist.md).

## OWASP Top 10 Prevention Patterns

These are prevention examples, not a ranking. Use the shared [OWASP quick reference](../../../references/security-checklist.md#owasp-top-10-quick-reference) for category mapping.

### Injection

```typescript
// BAD: SQL injection through string interpolation
const query = `SELECT * FROM users WHERE id = '${userId}'`;

// GOOD: parameterized query
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// GOOD: ORM parameter binding (verify the ORM API's behavior)
const user = await orm.user.findUnique({ where: { id: userId } });
```

Parameterization applies to SQL/NoSQL templates and shell/process arguments. Shell escaping is not a substitute for avoiding shell interpretation; pass an argument array and validate allowed commands/values.

### Broken Authentication

Use an established password hashing library and current parameters, tuned for the deployment budget. The bcrypt work factor in this example is illustrative and must match the project's standard:

```typescript
import { hash, compare } from 'bcrypt';

const WORK_FACTOR = 12;
const passwordHash = await hash(plaintextPassword, WORK_FACTOR);
const isValid = await compare(candidatePassword, passwordHash);

// Illustrative session settings; use the framework's reviewed secure defaults.
app.use(
  session({
    secret: loadSessionSecretFromOwningSecretStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
```

Never log the secret or cookie. Authentication still needs authorization checks for each protected resource. Review session fixation, rotation, revocation, CSRF, and multi-factor/recovery behavior for the actual threat model.

### Cross-Site Scripting (XSS)

```typescript
// BAD: renders untrusted data as executable HTML
container.innerHTML = untrustedInput;

// GOOD: use the framework's escaping/text path
return <div>{untrustedInput}</div>;

// If rich HTML is required, use a maintained allowlist sanitizer.
const sanitized = sanitizer.sanitize(untrustedHtml, approvedHtmlPolicy);
```

Do not bypass the framework's safe rendering path for a cosmetic convenience. Sanitization policy must be appropriate to the output context.

### Broken Access Control

Check the authenticated actor's permission for the specific resource and operation; a hard-to-guess identifier is not authorization:

```typescript
app.patch('/api/resources/:id', authenticate, async (request, response) => {
  const resource = await resourceService.findById(request.params.id);
  if (!resource || !(await policy.canUpdate(request.user, resource))) {
    // Use the project's non-enumerating error policy where appropriate.
    return response.status(404).json({ error: { code: 'NOT_FOUND' } });
  }

  const updated = await resourceService.update(resource.id, request.validatedBody);
  return response.json(updated);
});
```

Apply the check at the owning service/interface too when other callers can bypass the HTTP handler. Check tenant, role, ownership, and state constraints before side effects.

### Security Misconfiguration

Use the framework's maintained security header mechanism and configure it for actual assets and connections. Start restrictive and test the deployed response:

```typescript
// Illustrative Express-style example.
app.use(
  securityHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'], // Narrow to actual required sources.
      connectSrc: ["'self'"],
    },
  }),
);

app.use(
  cors({
    origin: approvedOriginsFromConfiguration(),
    credentials: true,
  }),
);
```

Never combine wildcard origins with credentials. Treat CORS as a browser access policy, not server-side authorization. Use only required origins; keep real private configuration in the owning runtime secret/config store.

### Sensitive Data Exposure

Allowlist fields rather than returning a storage record wholesale:

```typescript
function toPublicAccount(record: AccountRecord): PublicAccount {
  return {
    id: record.publicId,
    displayName: record.displayName,
  };
}
```

Avoid serializing password hashes, reset tokens, private provider settings, internal runtime bindings, or raw errors. Load required secrets from the owning secret store and fail closed when a mandatory credential is absent; never print the value while diagnosing configuration.

## Server-Side Request Forgery (SSRF)

If the server fetches a user-influenced URL (webhook, import, image proxy, link preview), an attacker can aim it at internal services, including cloud metadata and loopback addresses.

```typescript
// BAD: fetch whatever URL arrives from an untrusted caller
await fetch(request.body.url);

// GOOD shape: allowlisted scheme/host, reject any private/reserved DNS result,
// and forbid redirects. Review against the actual runtime's DNS/connect behavior.
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const ALLOWED_HOSTS = new Set(['hooks.example.invalid']);

async function assertSafeUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('scheme not allowed');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('host not allowed');
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => ipaddr.parse(address).range() !== 'unicast')) {
    throw new Error('private or reserved address');
  }
  return url;
}

await fetch(await assertSafeUrl(untrustedUrl), { redirect: 'error' });
```

The `range() !== 'unicast'` check is an example covering non-global ranges in common IP libraries, including loopback, link-local `169.254.169.254`, private IPv4, and IPv6 unique-local ranges. Verify the selected library's actual range classification and IPv4-mapped IPv6 behavior. Resolve **all** records and reject if any are unsafe.

**TOCTOU caveat:** the fetch may resolve DNS again after validation, allowing DNS rebinding between check and connection. For high-risk surfaces, pin the verified IP while preserving correct TLS host validation, or use a reviewed filtering agent/transport. Revalidate every redirect if redirects are supported. Bound response bytes, time, and concurrency.

## Input validation patterns

### Schema validation at boundaries

```typescript
import { z } from 'zod';

const CreateResourceSchema = z
  .object({
    title: z.string().min(1).max(200).trim(),
    description: z.string().max(2000).optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    dueDate: z.string().datetime().optional(),
  })
  .strict();

app.post('/api/resources', async (request, response) => {
  const result = CreateResourceSchema.safeParse(request.body);
  if (!result.success) {
    return response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: result.error.flatten(),
      },
    });
  }
  // Only the validated value reaches domain logic.
  const resource = await resourceService.create(result.data);
  return response.status(201).json(toPublicResource(resource));
});
```

Use the repository's schema library and response contract; do not trust static types as runtime decoding. Do not expose secrets or raw internal validation details in the public error.

### File upload safety

```typescript
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

function validateUpload(file: UploadedFile): void {
  if (!ALLOWED_TYPES.has(file.reportedMimeType)) {
    throw new ValidationError('File type not allowed');
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError('File too large');
  }
  // The extension and reported MIME type are not content proof.
  // Inspect magic bytes and safely decode when the risk requires it.
}
```

Also bound pixel dimensions/decompression work, generate the storage name, prevent path traversal, isolate content from executable/public paths, and consider malware scanning/sandboxing for the use case.

### Destructive operations on derived paths

A delete, move, or overwrite is only as safe as the identity and ownership evidence for its target. A value from the kernel, a job payload, config, or sibling service proves where it arrived from—not who wrote it. A shape check such as “absolute path and one directory deep” is not authorization and can let a cleanup remove the root rather than the intended leaf.

Before a destructive call, require all three:

1. After resolving symlinks, the target is beneath an **allowlisted root**. Compare canonical paths, not the raw string.
2. The target is at least one directory level **below** that root; the root itself is never the target.
3. It has **ownership evidence read before the operation** and before teardown could erase the evidence. If absent and not-owned are indistinguishable, stop.

On refusal, record only a sanitized classification and stop. Never fall back to a wider default path.

Two limits matter:

- A marker inside the tree is self-attestation if a writer can create it. The expected owner must come from authenticated state; marker integrity needs restrictive ownership or a MAC before it counts as authorization.
- Resolving a path and later using its name can race if another process swaps an ancestor. On shared storage, hold the target by descriptor and use no-follow/beneath-root operations, or ensure the hierarchy cannot change during the operation.

See the shared [destructive-path checklist](../../../references/security-checklist.md#destructive-path-operations) for a concrete boundary review. Do not run destructive cleanup commands without explicit authorization and a verified target.

## Dependency Audit Triage

A package-manager audit reports known advisories; it does not prove reachability or package trust. First discover the authoritative package manager and lockfile from repository instructions, workspace layout, manifest pins, and CI. Stop if these disagree. Then run its native audit under the repository's and runtime's normal tooling permissions; do not confuse an audit with authorization for remediation, publication, or deployment.

```
The native package-manager audit reports a vulnerability
├── Critical/high
│   ├── Is vulnerable code reachable in runtime, build, test, or deploy paths?
│   │   ├── YES → Fix promptly: patched version, reviewed patch, or replacement
│   │   └── NO, confirmed across paths → Track and fix; record why it is not a release blocker
│   └── Is a fix available?
│       ├── YES → Preview the update, read its release notes, test it
│       └── NO → Find a mitigation/replacement; document any deferral and review date
├── Moderate
│   ├── Reachable in production? → Schedule a near-term fix
│   └── Dev-only? → Track and resolve during dependency maintenance
└── Low
    └── Track in regular dependency updates
```

For each finding, ask whether the vulnerable function is called, which runtime/build/test/deploy path includes it, and whether deployment conditions make the advisory exploitable. Never use a forced bulk upgrade as a substitute for triage: it may violate declared ranges or introduce breaking changes. When deferring any issue, state the evidence, owner, mitigation, and review date.

## Rate Limiting

The values below illustrate middleware shape, not a universal policy:

```typescript
// Illustrative local Express limiter; counters are process-local by default.
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(
  '/api/auth/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
  }),
);
```

Once multiple processes serve requests, local counters silently multiply the effective limit by the instance count; serverless instances may start at zero. Use a shared backend or a suitable hosted/HTTP limiter, with a defined failure mode and privacy-safe key. Example shape:

```typescript
// Illustrative shared HTTP-backed limiter; obtain credentials only from its
// owning private runtime secret store. Never print them in logs or CLI output.
const limiter = createSharedLimiter({
  endpoint: readPrivateLimiterEndpoint(),
  credential: readPrivateLimiterCredential(),
  policy: slidingWindow({ limit: 10, window: '15m' }),
});

const result = await limiter.check(`login:${approvedPseudonymousClientKey(request)}`);
if (!result.allowed) return response.status(429).end();
```

Limit authentication/expensive endpoints more strictly than general traffic when the threat model requires it. Include proxy trust, IPv6, account/tenant abuse, legitimate bulk use, distributed identity, and storage outage behavior in the design. Never put raw personal identifiers in telemetry labels.

## Secrets Management

A repository may commit a template, never real credentials:

```
.env.example  → committed placeholders only
.env          → ignored local values
.env.local    → ignored local overrides
runtime secret store → secrets owned by the specific runtime/environment
```

Check the repository's documented config ownership and ignore rules. Patterns such as `.env`, `.env.local`, `.env.*.local`, `*.pem`, and `*.key` may need to be ignored; do not assume they cover every provider or local-state file. Review the staged diff and use available secret scanning before commit. Do not echo secret values for debugging or place them in command-line arguments, build output, telemetry, screenshots, or artifacts.

If a secret is committed or reaches a remote, rotate/revoke it first. Then follow the approved history-cleanup process. Deleting the line or rewriting Git history does not un-compromise a key.

## Data Classification

Classify personal data as fields are added so retention, access, export, and deletion can reach each copy:

| Class              | Examples                                                                            | Handling                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Non-personal**   | Aggregates that cannot reasonably identify a person                                 | Normal handling; ensure aggregation is real and re-identification risk considered            |
| **Personal (PII)** | Name, email, IP, device/account identifiers                                         | Minimize, access-control, set retention, include in export/delete where required             |
| **Sensitive**      | Health, finance, precise location, biometrics, government identifiers, minors' data | Establish lawful/approved purpose, stricter access, protection, retention and audit controls |

The category and obligations vary by jurisdiction and context. Treat pseudonymous identifiers as personal when they can be linked back. Inventory backups, telemetry, caches, indexes, and derived copies.

## LLM Output Handling

Treat model output as data, not executable instruction or authority. Parse defensively, validate against a strict schema, limit actions to an allowlist, and encode for the output context:

```typescript
// BAD: model output becomes executable SQL or markup.
const sql = await model.generate(`Write a query for: ${untrustedQuestion}`);
await database.query(sql);
container.innerHTML = await model.reply(untrustedMessage);

// GOOD: validate a constrained intent, authorize in code, then execute an
// allowlisted operation. Use a text-safe rendering path for plain text.
let intent: AllowedIntent;
try {
  intent = AllowedIntentSchema.parse(JSON.parse(await model.replyJson(input)));
} catch {
  throw new ValidationError('Unexpected model output');
}
await authorizeAndRunAllowlistedAction(intent.action, intent.params, actor);
container.textContent = await model.reply(input);
```

The model must not decide authorization. Keep private prompts, credentials, other tenants' context, and raw provider responses out of logs and unauthorized tools. Bound tokens, recursion, rate, time, and tool permissions; require a human to confirm destructive or externally visible actions.
