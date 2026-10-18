# Evidence collection and storage

This guide explains how the server collects package evidence and stores it for reuse. Evidence includes package metadata, archive contents, advisories, size estimates, and release notes.

The [architecture overview](overview.md) explains the wider system and request sequence. The [briefing guide](briefing.md) explains job submission and AI generation. See [meaning and limitations](../product/meaning-and-limitations.md) for what results do—and do not—mean.

## Identity, request boundary, and payloads

A **Durable Object** is a Cloudflare service with its own stored state. The server selects one with `PACKAGE_EVIDENCE.idFromName(packageName)`. Its identity is the validated package name, not the version pair. All versions of one package therefore share a `PackageEvidence` object and its SQLite storage.

The object has two internal POST paths: `/measurements` and `/briefing-evidence`. The Worker's ordinary `fetch` handler returns 404. See the [evidence client](../../server/api/package/[packageName]/compare/_internals/evidenceClient.ts), [object implementation](../../workers/evidence/index.ts), and [package-name schema](../../shared/comparison/package/package.defs.ts).

Both paths accept JSON with `packageName`, `from`, and `to`. The shared npm-name schema validates the package name. Each version/tag is trimmed and limited to 1–256 characters.

The object rejects:

- Unsupported methods or paths: 404.
- A present content type not beginning with `application/json`: 415.
- Bodies over 16 KiB, based on declared or measured UTF-8 size: 413.
- Malformed JSON or requests that fail schema decoding: 400.

The request-capacity check happens first, so it also covers requests that later fail validation.

The two paths return different data:

- `/measurements` returns the browser-facing `PackageMeasurementsResponse`: provider and advisory comparisons plus a tarball summary (`status`, reasons, URL, file count, and changelog count). A tarball is the package's compressed archive. File paths, hashes, link targets, and changelog bodies are removed. The Nuxt [measurements route](../../server/api/package/[packageName]/compare/measurements/index.get.ts) calls the binding; the [response types](../../shared/comparison/comparison.defs.ts) and [comparison page](../../app/components/comparison/ComparisonDetails.vue) use this compact result.
- `/briefing-evidence` returns an internal evidence packet, not the tarball object or rendered browser data. `getComparisonFacts` gives the builder full archive inventories and captured changelog text. The resulting packet is limited to 48 KiB of serialized data and 64 sources. It may include selected, bounded changelog prose, but never the file inventory. See the [packet builder](../../server/comparison/briefing/evidence/build.ts), [packer](../../server/comparison/briefing/evidence/packing.ts), and [shared packet schema](../../shared/comparison/briefing/briefing.defs.ts). [Briefing](briefing.md) covers the service and display of cited sources.

The client turns missing bindings, transport failures, upstream non-2xx responses, and malformed responses into a sanitized `PackageEvidenceClientError`. The public measurements handler returns a generic 503.

Measurement JSON must pass the complete shared `PackageMeasurementsResponseSchema`. The client rejects extra fields, including archive inventories, and checks package identity. For exact semantic-version requests, it also checks the exact requested versions. Measurement types come from these schemas and reuse existing manifest/provider contracts.

Briefing JSON must pass the bounded packet schema and package/version checks. The client enforces the 48 KiB body limit while reading. Measurement bodies have no equivalent client-side byte cap, although inventory fields are rejected. See [client implementation](../../server/api/package/[packageName]/compare/_internals/evidenceClient.ts) and [failure tests](../../server/api/package/[packageName]/compare/_internals/evidenceClient.unit.ts).

## Manifest sharing and collection fan-out

A **manifest** is the registry's metadata for one package version. The collector fetches each manifest from the fixed `https://registry.npmjs.org` origin. Version/tag URL segments are encoded. These requests use no registry credentials, proxy settings, or retries.

Each successful HTTP response must decode as a `RegistryVersionManifest`. Transport, status, JSON, or schema failure becomes `RegistryRequestError`, not an unavailable measurement. Both manifests are required for a comparison. Registry requests have a five-minute timeout. See [registry transport](../../server/httpDependencies/npm/registry.ts) and [comparison facts](../../server/comparison/collect.ts).

Within a request, each manifest is fetched once and shared across declarations, measurements, and release notes. The from/to manifests resolve concurrently.

- If both requested strings are exact semantic versions, OSV and Bundlephobia can start before manifests finish. Otherwise they wait and use the resolved `version` values.
- Each tarball inspection waits for its own manifest.
- For measurements, tarball, OSV, and Bundlephobia branches run concurrently. The two tarballs run concurrently, as do the two per-version bundle calls.
- Complete briefing facts also collect declarations, measurements, and GitHub release evidence concurrently.

An independent provider's unavailable result does not discard another successful side or provider result.

`getComparisonMeasurements` returns the page's compact results. Only the briefing pipeline calls `getComparisonFacts`, which keeps full inventories and changelog bodies and adds GitHub release/changelog data before packet construction.

See [collector assembly](../../server/comparison/collect.ts), [declaration derivation](../../server/comparison/declarations/compare.ts), and [measurement derivation](../../server/comparison/measurements/compare.ts).

## Provider behavior and preservation boundaries

### npm archive inspection

The inspector downloads only tarball URLs on the public npm HTTPS registry origin, with no user information or fragment. An invalid URL immediately returns `unavailable` without a download.

Downloads reject redirects, non-success responses, and responses without a body. Compressed data is limited to 10 MiB, checked against both `Content-Length` and the bytes read. Buffering stays within that bound.

Before inspecting any bytes, the inspector verifies integrity: that the download matches the registry's expected digest.

- Registry SRI (Subresource Integrity), when present, is authoritative. Supported algorithms are tried in order: SHA-512, SHA-384, SHA-256. A token must match.
- Malformed or unsupported SRI, or a mismatch, never falls back to SHA-1.
- SHA-1 is used only when SRI is absent and the registry shasum is a valid 40-hex digest.

Download and gzip/tar processing have a 10-second end-to-end deadline. The decompressed archive is limited to 32 MiB, checked at gunzip creation and while reading output. Compressed input uses 64 KiB chunks. A one-chunk output queue slows decompression when the reader falls behind.

A complete archive must have valid tar structure and trailer. Bad gzip/tar data, checksums, truncated entries/archives, exceeded limits, timeout, or download errors return `unavailable` with empty inventory/changelog lists.

External Effect interruption is different: cleanup runs, then the interrupted exit propagates. It returns neither an unavailable tarball nor a usable comparison. The timeout's abort signal reaches the download and stream reader. On failure or interruption, stream/parser tasks are stopped and joined. See [tarball fetching and validation](../../server/httpDependencies/npm/tarball.ts) and [stream lifecycle](../../server/httpDependencies/npm/tarballStreaming.ts).

Download and streaming adapters convert caught failures to `Error` before passing them to Effect's error channel. Existing Error objects keep their identity. Other rejected values are kept in `.cause`, with message `Tarball inspection failed`. The unavailable-result fallback does not expose those raw values. Interruption remains separate from typed failure.

Archive entries must meet all these rules:

- Types: file, directory, hard link, or symlink only.
- Paths: unique, under one consistent top-level directory: `package` or the manifest's unscoped package basename (for example, `is-number` for `@types/is-number`). The directory is removed from inventory paths. Paths are at most 4,096 characters, with no empty, `.` or `..` component, control character, DEL, or backslash. Mixed roots and unrelated directory names are rejected.
- Link targets: at most 4,096 characters, non-absolute, and resolving inside the root. Hard links resolve from the archive root; symlinks from their containing directory. Links are recorded, never followed.
- Entry sizes: nonnegative safe integers, no larger than 32 MiB. Non-file entries must have zero size.
- Entry count: at most 10,000.

Package scripts are never executed. Regular-file contents are hashed with SHA-256. The path-sorted inventory records type, size, digest, and any link target.

Shipped changelogs are captured only from file basenames `changelog`, `changes`, or `history`, with no extension or `.md`, `.markdown`, `.txt`, or `.rst`. Each capture is limited to 256 KiB; all captures together to 1 MiB. The full entry is still consumed and hashed.

Truncated text is kept with `truncated: true`; invalid UTF-8 text is omitted. Either adds a reason and makes an otherwise successful inventory `partial`, without discarding it. With no such reasons, it is `available`. Structural or integrity failure is always `unavailable`, never a partial inventory.

Coverage includes [archive tests](../../server/httpDependencies/npm/tarball.unit.ts), [stream lifecycle tests](../../server/httpDependencies/npm/tarballStreaming.unit.ts), and a [workerd parser smoke test](../../workers/evidence/tarballStreaming.workerd.unit.ts).

For unpacked size, the comparison uses a valid nonnegative registry `dist.unpackedSize` first. Otherwise it sums regular-file sizes from an available/partial inventory. If inspection is unavailable, that fallback size is unavailable too. This measures the package archive, not an application bundle.

Only the archive summary reaches the measurements response. Full inventories and per-file hashes stay internal. Selected changelog paths may appear as briefing source labels; bounded excerpts may reach the browser when cited. The [changelog source builder](../../server/comparison/briefing/evidence/changelog.ts), [briefing source selection](../../server/comparison/briefing/evidence/build.ts), and [source panel](../../app/components/comparison/EvidencePanel.vue) preserve and display those fields.

### OSV advisories

OSV supplies security advisories. The collector sends one `/v1/querybatch` request for both resolved versions, then fetches details once per unique advisory ID across the pair. At most five detail requests run concurrently.

Each HTTP call has a five-second timeout. One 30-second deadline covers the batch and all details. There are no retries or follow-up pagination requests.

Results preserve the difference between no findings and missing evidence:

- A batch failure, including bad HTTP or schema data, makes both sides `unavailable` with `count: null`, not zero.
- A missing batch result makes only that side unavailable. A present empty result is `available` with count zero.
- A `next_page_token` makes that side `partial`, keeping IDs already returned.
- A failed or mismatched detail keeps its ID with `detailsStatus: unavailable` and makes that side partial. A clean opposite side stays intact.
- Withdrawn details are omitted.
- If the overall 30-second deadline expires, both sides become unavailable, even if some details finished.

Partial/unavailable OSV results are not saved in the mutable cache. See [OSV collection](../../server/comparison/measurements/vulnerabilities.ts), [OSV transport](../../server/httpDependencies/osv/client.ts), and [branch tests](../../server/comparison/measurements/vulnerabilities.unit.ts).

Comparison groups match advisory identities and aliases. A one-sided match stays uncertain unless both sides have complete coverage. Missing evidence does not prove an advisory was fixed. See [comparison logic](../../server/comparison/measurements/compare.ts) and [result limitations](../product/meaning-and-limitations.md).

### Bundlephobia

Bundlephobia supplies bundle-size estimates. Each resolved version is requested separately, with both requests running concurrently. Each request and its response decoding share a 30-second deadline. There are no retries.

Network, status, or decoding failure makes that side `unavailable`, with `size` and `gzip` null. So does a response with the wrong package name/version. The other side is kept. Successful results record the provider retrieval time and can be cached.

If either successful build reports ignored missing dependencies, the size comparison is partial/non-comparable. Those estimates are not treated as like-for-like.

See [Bundlephobia transport](../../server/httpDependencies/bundlephobia/client.ts), [per-version collector](../../server/comparison/measurements/bundleSize.ts), [comparison logic](../../server/comparison/measurements/compare.ts), and [tests](../../server/comparison/measurements/bundleSize.unit.ts).

### GitHub release and changelog evidence

GitHub is used for complete briefing facts, not browser measurements. Both manifests' optional npm repository metadata must point to the same supported GitHub repository and directory. Unsupported hosts/types, malformed metadata, unsafe directories, or mismatched repositories/directories return unavailable release evidence without GitHub calls.

An unsafe fallback ref (a commit or tag reference) prevents its Contents lookup. The release listing may still be needed to discover that ref. An optional GitHub token is sent as a bearer token. Redirects are not followed. Each API request has a five-second timeout and a 1 MiB response-body limit.

Release listings request 100 releases per page, up to 10 pages. A failed first page fails the listing. A later failure or reaching the cap keeps collected releases but marks pagination incomplete.

The collector keeps non-draft semantic-version tags in `(from, to]`: after `from`, through and including `to`. Prereleases are included. Monorepos require package-specific tags. Missing release prose or no matching tags adds a partial-evidence reason.

Changelog lookup uses these rules:

- A valid 40-hex npm `gitHead` pins the commit. Lookup starts alongside the release listing and does not wait for it.
- Without `gitHead`, fallback needs a complete release listing and one safe, unambiguous tag for the exact target version. A repository-wide monorepo tag must also prove the package name/version from `package.json`.
- At the chosen ref, one Contents API request lists the repository/package directory; this lookup is not paginated. The collector selects one file using the configured changelog/changes/history name and extension priority, then fetches its body at that ref.

Release/changelog failures do not discard npm, OSV, bundle, or archive results. Release-note status is:

- `available`: no reasons remain.
- `partial`: at least one source exists, but a reason remains.
- `unavailable`: neither listing nor changelog yielded evidence.

A successful but empty/unmatched listing can be partial. A failed listing with a usable pinned changelog is also partial. See [release-note policy](../../server/comparison/evidence/releaseNotes.ts), [GitHub transport and page bounds](../../server/httpDependencies/github/client.ts), and [release-note branch tests](../../server/comparison/evidence/releaseNotes.unit.ts).

## Cache keys, coalescing, expiry, and storage failures

The [cache lifetime decision](adrs/evidence-cache-lifetimes.md) explains the freshness/reuse tradeoff. A time-to-live (TTL) controls expiry, not total storage size.

The object supplies cache and capacity-check services to the collector; the collector has no process-global cache. Keys are SHA-256 digests of JSON-serialized scope inputs. Each package object's SQLite cache reuses that package's provider results and archive inspections. It is not a separate global cache.

| Evidence             | Key inputs                                                                                                                | Expiry and write rule                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| npm manifest         | `comparison-evidence-v1`, package name, requested version/tag                                                             | 300,000 ms; every schema-valid manifest          |
| OSV pair             | `comparison-evidence-v1`, package name, resolved from/to versions                                                         | 300,000 ms; only when both sides are `available` |
| Bundlephobia version | `comparison-evidence-v1`, package name, resolved version                                                                  | 300,000 ms; only `available`                     |
| GitHub release notes | `comparison-evidence-v1`, package name and both full resolved manifests                                                   | 300,000 ms; only `available`                     |
| Inspected archive    | `archive-inspector-v3`, package name, and integrity policy (exact SRI string when present, otherwise SHA-1 shasum policy) | No expiry; `available` and `partial` only        |

Mutable entries expire after five minutes and are deleted on cache access. Errors and non-cacheable partial/unavailable results are not saved. Later requests retry them instead of keeping a failed refresh.

Archive keys follow verified content identity and package identity, not a version or tarball URL. Package identity constrains the accepted archive root. Matching integrity policies within a package can share a successful/partial inspection; the returned value gets the caller's manifest URL. Failed inspections are retried. SRI and SHA-1 policies cannot collide. A changed inspector revision creates a new key for changed inspection rules.

Archive cache revisions do not invalidate stored AI briefings. Briefings remain tied to the evidence packet used to generate them; fresh measurements can contain evidence that a stored briefing does not describe.

This reduces duplicate evidence work. It is not a fixed spending cap, a lifetime inference limit per version pair, or a replacement for external provider budgets. It does not share data across package objects.

Complete measurement responses and briefing packets are not cached. They are assembled from component caches. **Coalescing** means callers share matching work already in progress:

- The DO keeps one promise per identical `(path, decoded request)`, removing it after success or failure.
- The SQLite cache shares loads by evidence key.
- Collector branches share request-local manifest effects.

Versions with matching archive content can share inspection within one package object. Unrelated request paths remain separate.

SQLite uses the [declared `evidence_records` and `evidence_chunks` tables](../../shared/db/evidenceSchema.ts). Drizzle is the typed database layer. The cache builds its client from the full real Durable Object `ctx.storage`. Synchronous `get`/`all`/`run` queries and Drizzle transactions preserve `transactionSync` boundaries for replacement, deletion, and cleanup.

The evidence schema has its own committed DO migration history. It is bundled into the Worker and applied synchronously by Drizzle when the cache is constructed. Only the initial bootstrap is safe to repeat: it preserves existing tables/data while adopting `__drizzle_migrations`. Later migrations are strict. There is no handwritten constructor DDL or DO reset. Wrangler's D1 history stays separate.

Metadata and payload rows are replaced together in one synchronous transaction. JSON is split into UTF-8-safe chunks of at most 128 KiB. Reads check stored byte length, chunk count, index order, JSON decoding, metadata, and the provider's value schema. A null expiry means an archive has no expiry. Cleanup deletes expired records and chunks together.

Storage failures are not cache misses:

- The DO constructor remembers table/index initialization failure. Valid object paths then return 503 `Evidence storage unavailable`, with no uncached fallback.
- SQL cleanup/read/delete/write or serialization failures become `EvidenceStorageError`.
- Invalid metadata, missing/out-of-order chunks, wrong byte length, invalid JSON, or provider-schema failure become `EvidenceStorageCorruptionError`.

These errors reject collection. They do not silently refresh data or return partial results. A failed write also prevents the request from returning the newly collected value. All non-capacity backend failures are exposed only as generic 503 `Evidence service unavailable`.

See [SQLite implementation](../../workers/evidence/store.ts), [error types](../../server/comparison/evidence/errors.ts), [cache storage tests](../../workers/evidence/store.workerd.unit.ts), and [cache policy tests](../../server/comparison/collect.unit.ts).

## Admission, deadlines, and disconnect behavior

Three capacity checks reject excess work immediately rather than queueing callers:

- Up to 16 active incoming object requests, including body read/validation. Excess requests return 503 with `Retry-After: 1`.
- Up to 2 active distinct evidence response collections. Identical in-flight requests share work before taking a permit. Saturation returns the same temporary 503.
- Up to 2 active archive inspections. Cache hits need no permit; safe-URL cache misses do. Capacity failure propagates through the cache bridge as temporary 503 with `Retry-After: 1`.

These module-level limits apply within a Worker isolate, not per package or across the fleet. Permits are released on success, typed failure, defect, or Effect interruption. Other backend failures return generic 503 without the capacity retry header. See [admission implementation](../../workers/evidence/admission.ts) and [permit tests](../../workers/evidence/admission.unit.ts).

There is no deadline for the whole evidence request. Child deadlines are:

| Work                                    | Deadline               |
| --------------------------------------- | ---------------------- |
| npm manifest request                    | 5 minutes              |
| Tarball download and inspection         | 10 seconds             |
| Each Bundlephobia request               | 30 seconds             |
| Each OSV request / whole OSV collection | 5 seconds / 30 seconds |
| Each GitHub request                     | 5 seconds              |

Neither the object handler nor binding client connects the caller's disconnect signal to a collection-wide interruption. The explicit abort path is the tarball's own timeout/interruption signal.

Provider deadlines and archive cleanup are defined. Cancellation of evidence work after a browser disconnect is not; these handlers do not specify that runtime behavior. The binding client cancels unread upstream bodies after non-2xx or protocol-size rejection, not as a caller-disconnect policy.

## Outcome diagnostics

Diagnostics report outcomes without changing them. A refusing capacity check emits `evidence.admission.refused` with `operation` `request`, `collection`, or `archive`, `outcome` `failure`, and `reason` `capacity`. The existing checks still own permits, 503 messages, and `Retry-After: 1`.

The evidence Worker exports as `can-i-update-evidence` only when its private `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `OTEL_EXPORTER_OTLP_HEADERS` also stays in that Worker's configuration. The [public operation helper](../../server/api/package/[packageName]/compare/_internals/telemetry.ts) sends only a formatted `traceparent` to the private evidence binding. External npm, OSV, Bundlephobia, archive, and GitHub requests receive no caller tracing headers.

Every handled object request emits one `evidence.request.completed`, including malformed input and capacity/storage refusals. It records a fixed outcome/reason, HTTP status class, and decimal-string duration.

A **span** describes one timed operation; a trace links related spans. The request span follows a validated incoming `traceparent`. Missing or malformed context starts a new root without changing the response.

Shared in-flight work has an independent `evidence.collection` root, not the first caller as parent. Initiators and joiners link to it, including failed work, through `linkedTraceId` / `linkedSpanId` and OTLP span links. A join emits `evidence.cache.decision` with `operation` `collection`, `outcome` `joined`, and `relationship` `shared-collection`. This descriptor is temporary and never saved. Joining changes neither evidence values nor provider work.

Component caches report fixed provider names and `hit`, `miss`, or `coalesced` once per logical lookup, not per SQL row. A lookup that fails before deciding emits no decision.

The [cache bridge](../../server/comparison/evidence/cacheLookup.ts) runs loaders in the caller's Effect context, so provider logs/spans reach the same runtime. Without a cache, the provider runs directly. [Archive ownership](../../server/comparison/evidence/tarball.ts) keeps integrity, capacity checks, and immutable reuse separate from assembly.

Provider `evidence.collection.completed` records summarize degraded states: all sides unavailable means `unavailable`; any other degradation means `partial`. Fully available sides emit no degradation. OSV, bundle, tarball, and release-note summaries are separate from request-wide collection failures.

Collection `success` means facts were assembled. It does not mean every provider was complete or that an update is safe.

The cache bridge reports observed storage errors as `evidence.storage.failed`, using fixed initialize/read/write/delete/serialize/corruption reasons. Expired-row cleanup counts as delete. Corruption remains failure, never a miss.

Diagnostics exclude SQL, rows, keys, hashes, inventories, evidence, provider prose, and requested selectors. Observer exceptions cannot replace fresh, cached, or shared values/errors, or poison shared work.

## Behavior references

The related test suites are:

- Manifests, cache keys, and provider scheduling: [collect.unit.ts](../../server/comparison/collect.unit.ts).
- Provider outcomes: [bundleSize.unit.ts](../../server/comparison/measurements/bundleSize.unit.ts), [vulnerabilities.unit.ts](../../server/comparison/measurements/vulnerabilities.unit.ts), and [releaseNotes.unit.ts](../../server/comparison/evidence/releaseNotes.unit.ts).
- Archive validation and limits: [tarball.unit.ts](../../server/httpDependencies/npm/tarball.unit.ts) and [tarballStreaming.unit.ts](../../server/httpDependencies/npm/tarballStreaming.unit.ts).
- Binding protocol and failures: [evidenceClient.unit.ts](../../server/api/package/[packageName]/compare/_internals/evidenceClient.unit.ts).
- Capacity and cache-storage failures: [admission.unit.ts](../../workers/evidence/admission.unit.ts) and [store.workerd.unit.ts](../../workers/evidence/store.workerd.unit.ts).
