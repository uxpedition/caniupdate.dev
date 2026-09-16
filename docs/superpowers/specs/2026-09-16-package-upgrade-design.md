# Can I npm update? — Product plan

**Date:** 2026-09-16
**Status:** Written proposal for review. This document records what to build, how to present it, and where the evidence comes from. It does not authorize implementation.

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

**Main product choice still requiring confirmation:** whether “just that package” means a standalone import including bundled runtime dependencies, or strictly the package's own files. This plan recommends the former for the bundle estimate and always distinguishes the latter as published package size. Excluding dependencies from a custom build would be a separate measurement, not an interchangeable fallback.

### Outside this scope

- Uploading or connecting application repositories, manifests, or lockfiles.
- Private registries and authenticated private packages.
- Predicting the user's resolved dependency tree or actual application bundle delta.
- Automatically editing dependencies, generating pull requests, or applying migrations.
- Exhaustive semantic API compatibility analysis or proof that an upgrade is safe.
- Accounts, billing, dashboards, security scanning, or package popularity scoring.

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

Show calculated results as soon as they are ready. Release evidence, bundle estimates, and the AI review have independent loading and failure states; none should hide already available facts.

## 5. Data sources and what each proves

| Information | Primary source | Usage and limitations |
| --- | --- | --- |
| Package search | npm registry `/-/v1/search` | Discover names and descriptions; search ranking is not an upgrade recommendation |
| Versions and publication dates | Package metadata from `registry.npmjs.org` | Resolve exact endpoints; do not assume `latest` is numerically the highest version |
| Declared dependencies and requirements | Exact-version registry manifests; shipped `package.json` for artifact confirmation | Compare declarations, not invented installed resolutions |
| Own published size | Registry `dist.unpackedSize`; inspect the published tarball if absent | Bytes of unpacked archive files, not browser bundle size or a dependency-tree install size |
| Published files | Archives identified by each version's `dist.tarball` | What was shipped, which may differ from source-control contents |
| Bundle estimate | Bundlephobia for the two exact versions, where supported | A standardized estimate under the provider's methodology, not the user's application |
| Maintainer explanations | Package-specific release notes, migration guides, published changelogs, and version-matched repository changelogs | Report mapping and coverage; notes can be incomplete or change over time |
| Supplementary source changes | Repository comparison at identified release tags or commits | Supporting context, not a substitute for the published-package diff |

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
- [ ] Every displayed fact is traceable to selected-version metadata or artifacts.

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

Review this product plan and confirm or adjust the proposed defaults, especially the bundle-size definition. A subsequent implementation plan can then choose the stack and provider, define concrete files and interfaces, and sequence implementation work. No application implementation is included in this planning task.
