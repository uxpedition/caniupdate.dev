# Can I npm update? — Product plan

**Date:** 2026-09-16
**Status:** Product proposal with the SLC data flow agreed on 2026-09-17 (see §5). This document records what to build, how to present it, and where the evidence comes from. It does not authorize implementation.

## 1. Product promise

Search for an npm package, choose the version currently used and the version to upgrade to, and receive a concise, evidence-backed upgrade briefing:

> What changes, what could affect me, and what should I check before upgrading?

The product combines measurable package differences with maintainer release notes and AI-assisted interpretation. A user should not have to read a raw diff to understand the important changes, but must be able to inspect the evidence behind a claim.

Without the user's application, imports, runtime, and lockfile, the product cannot guarantee compatibility or calculate the application's actual bundle-size change.

## 2. Scope and decision status

### Requested capabilities

- Search public npm packages.
- Select a current version and a target version of the same package.
- Compare size, dependency declarations, and published package contents.
- Review changelog and release-note changes relevant to that upgrade.
- Use AI to explain the implications succinctly, rather than merely display diffs.
- Use the local npmx clone as inspiration; keep it excluded from this repository's commits.

### Proposed defaults

These make the plan concrete without pretending that every detail has already been approved.

| Topic | Proposed choice | Reason |
| --- | --- | --- |
| Experience | A web page with a shareable comparison URL | Easy to inspect and share an upgrade before changing a project |
| Comparison scope | One public package, two exact published versions | Does not require access to a user's project |
| Bundle metric | Estimated cost of a defined package import in isolation, including dependencies incorporated by the measurement tool | More useful than treating archive size as browser cost |
| Additional size metric | The package's own unpacked published size, labeled separately | Directly measurable and useful even when bundling is unsupported |
| Dependency scope | Direct runtime, peer, and optional requirement changes | Exact transitive resolutions need installation context |
| Release-note coverage | GitHub releases and version-matched published/repository changelogs initially | Other repository providers can be supported explicitly rather than silently guessed |
| Summary | A short evidence-backed briefing, not a safety score | Avoids implying compatibility knowledge we do not have |

**SLC decision (2026-09-17):** use Bundlephobia's standalone package bundle estimate, including dependencies incorporated by its build, alongside the package's own unpacked published size. These remain separate metrics. Include OSV known-advisory comparison for the two selected versions; this is not project-wide security scanning. See §5 for the agreed call order, API contracts and initial-release exclusions.

### Outside this scope

- Uploading or connecting application repositories, manifests, or lockfiles.
- Private registries and authenticated private packages.
- Predicting the user's resolved dependency tree or actual application bundle delta.
- Automatically editing dependencies, generating pull requests, or applying migrations.
- Exhaustive semantic API compatibility analysis or proof that an upgrade is safe.
- Accounts, billing, dashboards, project-wide security scanning, or package popularity scoring. Direct-package known-advisory comparison is included in the SLC.

Framework, hosting, and AI-provider selection belong to subsequent implementation planning. No choice of Nuxt or any other framework is implied by using npmx as inspiration.

## 3. Approaches considered

### Recommended: evidence-first comparison with an AI briefing

Calculate structured differences from version-specific package data. Retrieve matching release evidence. Ask AI to explain the important implications with citations. Keep the evidence and calculated results usable independently of the model.

**Trade-off:** release mapping and evidence coverage require deliberate handling, but the result is inspectable and useful when one source fails.

### Alternative: AI-led research report

Give an agent a package and version pair and let it browse and write a report.

**Trade-off:** flexible discovery, but less predictable coverage, latency, cost, and reproducibility. Not the primary path for facts that can be calculated directly.

### Alternative: project-aware upgrade analysis

Import the user's code and lockfile, run their build, and inspect actual usage.

**Trade-off:** stronger project-specific answers, but significantly greater permissions, setup, and execution requirements. Outside the requested package-only experience.

## 4. User journey and results layout

### Input

1. Search a package name, including scoped names such as `@scope/package`.
2. Choose the current version from a searchable list with publication dates.
3. Choose the target version. Suggest the version tagged `latest`, while allowing another published version.
4. Mark prereleases and deprecated versions visibly. Resolve tags to exact versions before starting a comparison.
5. Compare and retain the package and exact version pair in a shareable URL.

The initial flow is for upgrades: an older-to-newer version selection according to semantic version precedence. Identical selections return “Same version selected”; a lower target asks the user to select an upgrade rather than produce inverted upgrade advice.

### Results hierarchy

**1. Comparison header**

Package, current version, target version, publication dates, and source coverage. Show that the result concerns the package in isolation, not the user's application.

**2. Upgrade briefing**

Three to five short bullets, prioritizing:

- Compatibility changes and documented breaking changes.
- Important fixes and new capabilities.
- Size and dependency implications.
- Concrete checks or migration actions.

Use actionable findings such as “ESM migration required” or “Peer requirement changed.” Never equate “No breaking changes documented” with “No breaking changes.” Do not display an opaque numerical safety score.

**3. Size comparison**

Show before, after, absolute delta, and percentage delta for each available metric. Use an unavailable state rather than a fabricated zero; a zero baseline has no finite percentage increase. Keep bundle estimate and unpacked package size separately labeled.

**4. Dependency and compatibility details**

Added, removed, and changed requirements, with runtime, peer, and optional dependencies separated. Show before/after values for runtime requirements, module format, entry points, export maps, type entry points, and license declarations. Keep unchanged entries collapsed.

**5. Release changes**

Group breaking changes, deprecations, fixes, and features across the relevant releases. Provide expandable original notes, version labels, migration-guide links, and source references.

**6. Published-file changes**

List added, removed, and modified files. Allow inspection of text diffs and the shipped manifest. Label binary or oversized files instead of pretending to produce a meaningful text diff. Keep raw/minified output below the briefing rather than sending the user through it first.

**7. Known advisories**

Show advisories matching the old version only, both versions, or the target only, with source links, severity and documented fixes where available. Label this as direct-package coverage, not an application scan. No matches and unavailable/incomplete evidence are distinct states.

Show calculated results as soon as they are ready. Advisory data, release evidence, bundle estimates, and the AI review have independent loading and failure states; none should hide already available facts.

## 5. Data sources and what each proves

| Information | Primary source | Usage and limitations |
| --- | --- | --- |
| Package search | npm registry `/-/v1/search` | Discover names and descriptions; search ranking is not an upgrade recommendation |
| Versions and publication dates | Package metadata from `registry.npmjs.org` | Resolve exact endpoints; do not assume `latest` is numerically the highest version |
| Declared dependencies and requirements | Exact-version registry manifests; shipped `package.json` for artifact confirmation | Compare declarations, not invented installed resolutions |
| Own published size | Registry `dist.unpackedSize`; inspect the published tarball if absent | Bytes of unpacked archive files, not browser bundle size or a dependency-tree install size |
| Published files | Archives identified by each version's `dist.tarball` | What was shipped, which may differ from source-control contents |
| Bundle estimate | Bundlephobia for the two exact versions, where supported | A standardized estimate under the provider's methodology, not the user's application |
| Known advisories | OSV queries for the two exact package versions | Direct-package matches only; deduplicate aliases, preserve source attribution, and never equate no matches with safety |
| Maintainer explanations | Package-specific release notes, migration guides, published changelogs, and version-matched repository changelogs | Report mapping and coverage; notes can be incomplete or change over time |
| Supplementary source changes | Repository comparison at identified release tags or commits | Supporting context, not a substitute for the published-package diff |

### SLC call sequence and API guide — agreed 2026-09-17

The initial **Simple, Lovable, Complete (SLC)** experience uses four external data sources (npm, OSV, GitHub/changelogs, Bundlephobia), local comparison code, and one AI briefing call. No runtime requests go to npmx.dev. This records the agreed product/data flow, not authorization to implement it.

#### Call order

1. **Resolve inputs through npm:** search, fetch full package metadata, and resolve the chosen current/target versions to exact published versions. Capture publication dates, version-specific manifests and tarball URLs.
2. **Fetch independent evidence in parallel:** both npm tarballs; OSV matches for both versions followed by advisory details; GitHub releases/version-matched repository changelogs; Bundlephobia measurements for both versions. Published changelogs become available when the tarballs are inspected. Parallel means independent branches, not literally four HTTP requests: pagination and advisory-detail requests may be needed.
3. **Compare locally as evidence arrives:** unpacked size, published files, runtime/peer/optional requirements, Node requirements, ESM/CJS, exports, types, licenses, install scripts, deduplicated advisory differences, and comparable bundle measurements. Do not execute package code or lifecycle scripts. AI does not calculate these facts.
4. **Render factual sections immediately:** each branch has independent loading, available, partial or unavailable state. A source failure must not hide completed sections or become a fabricated zero.
5. **Make one AI briefing call:** once evidence branches have completed or reached their bounded failure/timeout states, send the exact version pair, calculated facts, matched release excerpts, coverage gaps and source references. Return 3–5 cited bullets about changes, migration actions and uncertainty. Do not repeatedly call the model for each arriving section. If AI fails, retain the factual report.

#### npm registry and published archives

- Search: `GET https://registry.npmjs.org/-/v1/search?text={query}&size=20`.
- Full package metadata: `GET https://registry.npmjs.org/{encodedPackage}` with `Accept: application/json`. Use `versions[version]`, `time[version]` and `dist-tags`; do not use latest-only top-level fields for historical versions. The abbreviated `application/vnd.npm.install-v1+json` response omits fields needed for this comparison.
- If a separate exact manifest is needed: `GET https://registry.npmjs.org/{encodedPackage}/{exactVersion}`. Do not refetch it when the full metadata already supplies it.
- Download the two `dist.tarball` URLs; verify `dist.integrity` where supplied and inspect archives with the safety limits in §8. Compare shipped files and `package.json`; no install/build is necessary.
- URL-encode package path parameters (including scoped names) and query values independently. Do not construct tarball URLs by guessing their names.
- Public package reads need no token. Respect service limits and cache rather than repeatedly downloading full metadata/archives.

Learn: [registry endpoints and search](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md), [full versus abbreviated metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md), [manifest fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [published-package diff semantics](https://docs.npmjs.com/cli/v11/commands/npm-diff/).

#### OSV — known advisories for the selected package versions

Call `POST https://api.osv.dev/v1/querybatch` with `Content-Type: application/json`. Example request:

```json
{
  "queries": [
    { "package": { "name": "chalk", "ecosystem": "npm" }, "version": "4.1.2" },
    { "package": { "name": "chalk", "ecosystem": "npm" }, "version": "5.3.0" }
  ]
}
```

- Results correspond to input order and contain advisory IDs/modified timestamps, not full details. Follow each result's `next_page_token` where present, then fetch the union of IDs via `GET https://api.osv.dev/v1/vulns/{id}`.
- Group records through `aliases` (GHSA/CVE/etc.), retaining their underlying ranges and sources; do not treat `related` records as duplicates. Exclude withdrawn findings and expose conflicting evidence.
- Show advisories matching only the old version, both versions, or only the target; include severity and explicitly documented fixed versions when available. Distinguish malware reports from ordinary vulnerabilities if returned.
- Scope is the selected package itself, **not its dependency tree or the user's application**. Empty successful results mean “No known advisories found”; failed/incomplete lookups mean unavailable/partial, never “safe.”
- The API needs no key and currently documents no rate limit. Preserve source attribution: aggregated records retain their upstream data licenses. Refresh advisory data independently of immutable artifact comparisons.
- Do not add a separate GitHub advisory feed or npm audit backend to the SLC. OSV already aggregates GitHub advisories; npm security-data redistribution also has separate restrictions.

Learn: [API/access](https://google.github.io/osv.dev/api/), [batch queries and pagination](https://google.github.io/osv.dev/post-v1-querybatch/), [advisory detail lookup](https://google.github.io/osv.dev/get-v1-vulns/), [record schema, aliases and affected ranges](https://ossf.github.io/osv-schema/), [data sources and licenses](https://google.github.io/osv.dev/data/), [npm security-data terms](https://docs.npmjs.com/policies/open-source-terms/#conditions).

#### GitHub releases and version-matched changelogs

- Derive repository and monorepo subdirectory from the selected-version metadata; do not assume a package name equals its repository name.
- Releases: `GET https://api.github.com/repos/{owner}/{repo}/releases?per_page=100`; follow pagination as needed. Match package-specific tags/releases to the interval `(current, target]`, not merely publication dates. The API omits tags without GitHub release records.
- Repository changelog: `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={identifiedTagOrCommit}`. Use an explicit version-matched ref, preferably a resolved commit, rather than the default branch. Published changelogs from the npm tarballs are another source and need no extra provider.
- Retain release bodies, version labels, migration links and source URLs. Monorepo ambiguity, unsupported repository hosts and missing notes produce explicit partial/unavailable coverage, not guessed release mappings.
- Public reads work without authentication, but the normal GitHub limit is 60 requests/hour per IP versus 5,000/hour with a free authenticated token; secondary limits also apply. Keep any token server-side.

Learn: [releases API](https://docs.github.com/en/rest/releases/releases#list-releases), [repository contents and ref parameter](https://docs.github.com/en/rest/repos/contents#get-repository-content), [Git references](https://docs.github.com/en/rest/git/refs), [pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

#### Bundlephobia — standalone bundle estimates

- Call `GET https://bundlephobia.com/api/size?package={encodedNameAtExactVersion}` once per selected version, e.g. `package=react%4018.2.0`.
- Check the returned package name/version. Use `size` (minified bytes) and `gzip` (minified + gzip bytes), keeping both separate from `dist.unpackedSize`.
- No authentication is required. Requests are rate-limited per IP; uncached builds take longer and have tighter limits. Handle `422` build failures, `429` rate limits and timeouts as measurement unavailability.
- Show a delta only for comparable measurements under the provider's methodology. Record provider, retrieval time and available build/import assumptions. Do not substitute unpacked/install size or claim the user's application bundle delta. No self-hosted bundling fallback in the SLC.

The comparison endpoint exposes `from.bundleSize` and `to.bundleSize`. Each includes `provider: 'bundlephobia'`, a source URL, and an independent `available`/`unavailable` status. Available results include verified package identity, nonnegative integer `size`/`gzip` bytes, `retrievedAt` (retrieval time, not build time), and returned module/side-effect/dependency metadata. Unavailable results use `size: null` and `gzip: null`. Each request, including body decoding, has a 30-second deadline with no retries. Exact inputs start alongside npm/OSV; tags and ranges wait for npm resolution. This backend evidence integration does not calculate a delta or establish reproducible build methodology.

Learn: [upstream OpenAPI contract](https://github.com/pastelsky/bundlephobia/blob/bundlephobia/client/assets/public/openapi.json), [project and build-failure FAQ](https://github.com/pastelsky/bundlephobia/tree/bundlephobia#readme), [package-build-stats measurement tooling](https://github.com/pastelsky/package-build-stats).

#### AI and initial-release boundary

The AI provider/model is not chosen by this data-source decision; there is no provider endpoint to prescribe yet. The contract is one evidence-constrained briefing call, with credentials on the server and citations validated against our evidence index (§7). AI inference is a separate operating cost, not part of the free public-data claim.

Outside the initial SLC: extra advisory providers (GitHub advisory API, EPSS, KEV), popularity metrics, Scorecard, deps.dev, provenance verification, publint, ATTW, Node lifecycle enrichment and generated transitive dependency-tree analysis. These are potential additions, not prerequisites for completing the agreed flow.

### Source precedence and traceability

- Keep version-specific records; never substitute the latest README or manifest for an older selected version.
- Use published archives as the authority for file contents. Preserve registry metadata separately if it disagrees with the shipped manifest.
- Attach source URLs, version/ref, retrieval time, and the relevant excerpt or structured fact to findings.
- Pin repository evidence to an identified tag or commit where possible. An unversioned current-branch document is not proof of a historical package state.
- Cache by exact package/version and analysis methodology. Record provider/tool settings for size measurements and evidence snapshots for summaries; do not assume mutable release notes remain unchanged.

## 6. Comparison semantics

### Size

The two headline metrics are deliberately different:

1. **Estimated bundle size:** minified and gzip bytes for the provider's defined import/build setup. Show provider, import/entry assumptions where available, dependency inclusion, and measurement time. Only show a numerical delta when both measurements are meaningfully comparable. Label unavailable methodology rather than claiming reproducibility we cannot establish.
2. **Own unpacked package size:** total bytes of the selected package's published files. This includes shipped documentation, declarations, maps, and any vendored code; it does not recursively include separately installed dependencies.

A package can grow in unpacked size and shrink in bundle size, or remove dependency declarations by incorporating their code. Do not infer the cause of a size change merely from correlation.

Node-only packages and packages that cannot be built by the provider should retain a useful metadata/file comparison with “Bundle estimate unavailable.” Do not substitute archive bytes into that metric. A self-hosted bundling service is not part of the initial proposal.

### Dependencies and compatibility

- Compare name, declared range, category, and relevant optional-peer metadata.
- Report additions, removals, range changes, and moves between dependency categories.
- Respect optional-dependency overrides when a name also appears in `dependencies`; avoid double-counting it.
- Keep peer requirements separate: their interpretation depends on the consumer's package manager and environment.
- Do not treat the package author's `devDependencies` as packages added to the consumer's production installation.
- Explain declared engine, module-format, export-map, and type-entry changes without claiming to know which APIs the consumer uses.
- A semver-major upgrade is a signal to inspect, not evidence of a particular breaking behavior. A patch upgrade is not proof of safety.

### Release evidence

- Find notes for releases relevant to the interval after the current version through the target version, including intermediate breaking releases.
- Match package names, repository subdirectories, and package-specific tag conventions for monorepos.
- Do not blindly summarize every repository release or every version published later by date. Parallel maintenance branches and prereleases require explicit matching.
- Prefer package-specific notes and migration guidance. Combine and deduplicate release pages and changelog sections when both discuss the same change.
- Distinguish complete matched coverage, partial coverage, unavailable evidence, and ambiguous version mapping. “Complete matched coverage” means the identified release records were covered, not that maintainers documented every change.
- If the upgrade crosses a prerelease or a release boundary that cannot be mapped confidently, expose that limitation and avoid definitive compatibility advice.

## 7. AI's role and boundaries

**Code computes facts; AI explains implications.**

The model receives the exact version pair, structured comparison facts, relevant release excerpts, and an evidence index. It does not invent numbers, dependency resolutions, or package history from memory.

The briefing must:

- Stay concise: three to five prioritized bullets, with detail available on expansion.
- Cite evidence for each substantive claim.
- Distinguish measured facts, maintainer statements, and inferred implications.
- Use conditional wording when impact depends on user behavior: “If you use this API…”
- Surface missing or conflicting evidence rather than turn absence into reassurance.
- Suggest specific checks or maintainer-documented migration steps, not generic “test thoroughly” filler.

Repository files and release text are untrusted data, never instructions to the model. The summarization step has no authority to execute package code or follow instructions embedded in evidence. Only citations present in the collected evidence may be exposed as supporting references.

If AI is unconfigured, unavailable, or produces an unsupported claim, retain the factual report and explicitly mark the AI review unavailable or incomplete. The planned AI capability is still required for the complete product; this failure mode is not a substitute for implementing it.

### Grounded example

During planning, registry records for `chalk@4.1.2` and `chalk@5.3.0` showed two declared runtime dependencies becoming zero, while the package's own unpacked size rose from 35,047 to 43,736 bytes. Chalk's v5 release notes explain that dependencies were bundled and document the ESM migration.

This demonstrates why the review should connect facts to maintainer explanations rather than simply say “two fewer dependencies” or “the package got bigger.” It is not a bundle measurement or a complete review of that version interval.

## 8. Application responsibilities and failure behavior

Use one application with clear internal responsibilities; separate services are not required by this plan.

1. **Registry access:** search, exact-version resolution, metadata retrieval.
2. **Published-package comparison:** archive inspection, structured manifest changes, file changes.
3. **Size measurements:** fetch and label compatible provider measurements independently of archive size.
4. **Release evidence:** repository identification, version mapping, note collection, coverage reporting.
5. **Briefing generation:** evidence-constrained AI interpretation.
6. **Results interface:** display available results, citations, and per-section state.

Unknown packages or unpublished/unavailable versions stop the comparison with an explicit explanation. External-provider failures, rate limits, missing repository links, missing changelogs, and unsupported bundle builds affect only the relevant sections.

Treat tarballs as untrusted: inspect them without running lifecycle scripts or package code; enforce archive size/file-count limits and safe paths. Validate fetched destinations rather than allowing package metadata to direct unrestricted server requests. Render remote Markdown and model output safely. Keep service credentials on the server.

Report any truncated file or release evidence so a partial result is not presented as exhaustive.

## 9. Delivery milestones and acceptance criteria

These describe observable product increments, not permission to start implementation or a code-level task breakdown.

### Milestone 1 — Find and select a real upgrade

- [ ] Search works for unscoped and scoped public npm packages.
- [ ] Users can select exact current and target versions with dates and prerelease/deprecation labels.
- [ ] The selected comparison survives opening its shareable URL.
- [ ] Unknown, identical, and reverse-version selections have explicit outcomes.

### Milestone 2 — Show factual package changes

- [ ] Real version pairs produce before/after unpacked sizes and direct dependency requirement changes.
- [ ] Runtime, peer, and optional requirements remain distinct, without double-counting overrides.
- [ ] Compatibility-relevant manifest changes and published-file diffs can be inspected.
- [ ] Missing data, binary files, and truncated analyses are represented honestly.
- [ ] Every displayed package fact is traceable to selected-version metadata or artifacts; advisory findings cite their source records and retrieval time.
- [ ] OSV findings are compared for both exact versions, aliases are deduplicated, and no matches are distinct from unavailable/incomplete evidence; no application-safety claim is made.

### Milestone 3 — Add comparable bundle estimates

- [ ] Supported packages show minified and gzip before/after measurements with their source and stated scope.
- [ ] Unavailable or incomparable measurements do not produce fabricated deltas.
- [ ] The UI never labels unpacked archive size as bundle size or predicts application impact.

### Milestone 4 — Explain the relevant releases

- [ ] Notes cover matched intermediate releases as well as the target release.
- [ ] Package-specific monorepo notes are separated from unrelated repository releases.
- [ ] Breaking changes, deprecations, fixes, features, and migration links are navigable.
- [ ] Missing or ambiguous release mapping is visible in coverage status.

### Milestone 5 — Deliver the concise upgrade briefing

- [ ] A configured AI provider generates an actual evidence-backed review from collected comparison data.
- [ ] Each substantive claim has a valid supporting reference and an appropriate evidence/interpretation label.
- [ ] The briefing prioritizes compatibility and migration actions over incidental file churn.
- [ ] Deterministic results stay available when the model or an external provider fails.
- [ ] The complete page is exercised in a browser with real package comparisons, including a major migration and an incomplete-evidence case.

### Verification focus for eventual implementation

Use real comparisons to verify the end-to-end experience, including scoped packages, a dependency-category change, a monorepo release mapping, a prerelease, a Node-only package without a bundle result, and a package without release notes. Keep targeted regression tests for genuinely ambiguous rules such as optional overrides and release-range matching. Do not count mocked summaries as proof that source collection or real AI integration works.

## 10. Repository context and npmx inspiration

The repository currently contains a TypeScript starter that prints “Hello from Nub”; `package.json` uses `nub` and does not establish a frontend framework or comparison service.

The local `npmx.dev/` clone is ignored by the root `.gitignore`. It is reference material, not an application dependency or a submodule to commit.

Relevant areas inspected during planning:

- `npmx.dev/server/utils/compare.ts`: file-tree and dependency-comparison boundaries.
- `npmx.dev/server/utils/install-size.ts`: explicit distinction between a package's own size and a resolved dependency total; its platform-specific install estimate must not be presented as bundle size.
- `npmx.dev/server/utils/changelog/detectChangelog.ts`: repository-provider discovery and package-subdirectory handling.

Borrow useful interaction and data-model ideas; do not depend on npmx's internal endpoints. Check upstream licensing and preserve required notices if implementation later copies code rather than using it as inspiration.

## 11. Sources

- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)
- [npm package metadata, including `dist.unpackedSize`](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md)
- [npm diff: comparisons of published packages](https://docs.npmjs.com/cli/v11/commands/npm-diff/)
- [Bundlephobia](https://github.com/pastelsky/bundlephobia)
- [package-build-stats: Bundlephobia's measurement tooling](https://github.com/pastelsky/package-build-stats)
- [Chalk 4.1.2 registry record](https://registry.npmjs.org/chalk/4.1.2)
- [Chalk 5.3.0 registry record](https://registry.npmjs.org/chalk/5.3.0)
- [Chalk v5 release notes](https://github.com/chalk/chalk/releases/tag/v5.0.0)
- [npmx source repository](https://github.com/npmx-dev/npmx.dev)

## 12. Review boundary

The SLC data flow and bundle-size definition in §5 were agreed on 2026-09-17. Review remaining product details separately. A subsequent implementation plan can choose the AI provider, reconcile the current project stack, define concrete files and interfaces, and sequence implementation work. No application implementation is included in this documentation task.
