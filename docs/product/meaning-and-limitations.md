# Product meaning and limitations

## What the product is for

**Can I update? helps you notice important changes between two versions of one public npm package.**

It compares packages, not your project. It shows facts to help you review an update; it does not approve the update or give it a safety score.

## Start a comparison

The homepage keeps the package and version form first. Below it, a short guide introduces the compared categories, followed by three steps: find a public npm package, pick two versions, and explore the changes to plan what to test.

The heading and form occupy most of the first screen, with the guide beginning near the bottom to show there is more to read. On shorter screens, the form keeps its natural height and the page scrolls.

The guide has a lightly shaded background and rounded outer corners matching the form inputs. The four category panels have square corners and sit together with single-line dividers, without gaps or an outer inset. Their heading bands are shaded. The usage steps have simple left-hand rules instead of boxes.

Both section headings use full-width shaded bands. The evidence note is plain text; the three usage steps keep their left-hand rules.

The guide is part of the initial HTML. It leads with the available evidence and keeps limits beside the relevant categories, with a short note on coverage and compatibility. AI notes are supplementary; they are not required to use the factual comparison.

## Read the comparison at a glance

The header highlights three categories:

- **Dependencies:** Changes to the required and optional dependencies listed by the package.
- **Gzip estimate:** Changes to Bundlephobia's estimate of the compressed bundle size for the package on its own.
- **Security:** Known security issues that OSV, an advisory database, matches to the selected versions.

A separate warning shows changes to the package's stated Node requirements. If the minimum rises, people using older Node versions may need to upgrade. Not everyone will.

Select a header tile to open its details in the comparison table. The table also shows other package declarations and measurements.

The page header names the package and exact releases. The overview adds before-and-after values in each tile. These are factual labels, not an AI-generated summary. When measurements are missing, the overview says so rather than treating them as unchanged.

Open **Fact sources & collection times** for links to each package version on npmx.dev, available Bundlephobia estimates, and matched advisory records. Package declarations are still collected from the npm registry. Collection times appear only when the evidence supplies them. An advisory's modification date is not the time we collected it.

The overview and its source links are included in the initial HTML. A cold comparison can contain declarations before measurements are available; it does not wait for AI notes to explain those declarations.

## Where evidence comes from and how current it is

The [About page](../../app/pages/about.vue) explains these sources and limits publicly:

- **npm:** Published metadata supplies package declarations. Package archives supply file sizes and shipped changelogs. Neither proves application behavior.
- **GitHub:** Release notes and changelogs supply maintainer descriptions for AI notes when the collector can identify a supported repository and matching versions.
- **OSV:** Advisory matches describe known issues for the selected package versions, not the security of a user's project.
- **Bundlephobia:** Bundle and gzip estimates describe the package on its own, not inside an application.

Sources can fail or return incomplete evidence. Collection limits can also leave gaps. Other evidence can remain available when one source is missing. A missing result does not mean nothing changed or an issue was fixed.

A collection or retrieval date describes when evidence was fetched. A release date describes publication, not the latest check. Some evidence is cached, and upstream sources can lag or change. Reopening a comparison does not guarantee every source is current.

AI notes can be reused when the collected evidence matches. They are not a new independent check each time the page opens. See [evidence collection and cache rules](../engineering/evidence.md#cache-keys-coalescing-expiry-and-storage-failures) and [briefing identity](../engineering/briefing.md#evidence-identity-and-private-submission) for implementation details.

## What AI adds

AI notes add context. You can still use the factual comparison when the notes are unavailable.

AI can:

- Explain a finding shown in the header.
- Highlight important details from collected release notes or other supplied evidence.
- Explain what a fact might mean, such as how a changed import path could affect users.

AI must use only the collected evidence and cite the relevant data or source. It must not add package facts from its general knowledge.

A maintainer's statement, an AI interpretation, and a directly measured fact are different kinds of evidence. The notes should make that difference clear.

These are the rules for generating notes, not a guarantee that every explanation is correct.

## What the results establish

### Node requirements and dependencies

A changed Node requirement means the package lists a different supported range. It does not tell us your Node version or prove how the package behaves outside that range.

A dependency change means a listed requirement changed. It does not tell us which dependency versions your project will install.

### Bundle estimates

A bundle estimate compares the package on its own, not inside your application. It cannot prove that your application will exceed a size limit. Incomplete builds cannot be compared.

### Security advisories

An advisory difference means OSV found different matches for the two versions. This is not an independent security review or a scan of your project.

Expand **Security advisories** to see a table for each version. Each match links to its specific OSV record and includes a summary when available. The tables show coverage separately: no known matches with complete coverage is different from missing or incomplete results. Matches remain linked even when their details could not be retrieved.

The summary above the tables shows matches **only in previous**, **only in new**, and **present in both**. Open a nonzero count to see which advisories it includes. Records identified as the same issue count once in this summary. If coverage is incomplete, one-sided matches are labelled **unconfirmed** instead. Confirmed shared matches still appear, but the list may not include every shared issue.

An issue matched only to the target version does not, by itself, prove that version introduced it. **Missing or incomplete coverage cannot prove that an issue was fixed or that a package is safe.**

### Release notes, exports, and types

A release-note finding reports a relevant change described by the maintainer. The collected notes may not cover every behavior change.

An export or type declaration change means the published metadata changed. We do not fully analyze the package's API behavior or implementation.

**Package surface** keeps exports, loading styles, and type declarations in one expandable row. When collapsed, it shows each version’s explicit path count and evidence badges: ESM for ES module files, CJS for CommonJS files, and TYPES for TypeScript declarations. These describe package-level evidence, not which syntax works for every path.

A tick marks the strongest metadata evidence: an explicit JavaScript file extension, a `.js` target with an explicit package format, or a declared type entry. A circled question mark marks weaker indications, such as legacy JavaScript conventions or compiler-version type mappings. No badge means no indication was found, not that support is ruled out. Metadata alone does not verify published files or runtime compatibility, and nested package rules may differ.

All badges use the same readable text color. Icons and help text distinguish evidence strength; uncertain badges are not disabled controls.

Archive measurements can add a question-mark TYPES badge when a published JavaScript entry target has a matching declaration file beside it: `.js` with `.d.ts`, `.mjs` with `.d.mts`, or `.cjs` with `.d.cts`. Both must be regular files in that release’s archive. Wildcard routes and links are not expanded or followed. These matches do not verify type resolution, correctness, or coverage of every export. They reuse the archive inspection already needed for measurements; declaration rendering does not wait for them.

The browser can also check whether the corresponding public `@types` package exists. A match adds an uncertain TYPES badge and links to that package on npmx. Its existence does not establish compatibility with either compared version. An unavailable lookup adds no external-types indication. Declared bundled types and exact-release file matches take precedence over this external hint.

If the latest `@types` release is deprecated, its external TYPES badge shows a warning triangle instead. Badge help identifies that release, quotes the maintainer’s notice, and asks you to check whether the package version in that column needs external types. This warning does not establish whether older `@types` releases are suitable or whether every version of the main package includes its own types. It does not replace a declared-types tick or a matching-file question mark.

Expand the row for a change summary and a separate import-path tree for each version. Trees sit side by side on wider screens and stack on narrow screens. Hover over, focus, or tap a path to see loading syntax, target files, conditions, and types for that version. Folder-only rows group paths; they are not importable entries.

The summary uses a compact row, with counting limits in its help popover. JavaScript fields, package-level types, and compiler-version rules sit in a separate **Package details** disclosure, closed by default.

The summary counts unchanged, changed, new, and removed export declarations, not verified API additions or removals. Wildcards count as patterns rather than a list of files. Blocked entries do not count as exports. An absent or incomplete export map leaves path totals and change counts uncertain, not zero: older file-resolution rules may still allow imports.

Loading examples show syntax, not tested compatibility. Conditions and fallback targets remain in declaration order; the interface does not resolve them for your runtime. In particular, an ES module declaration alone does not establish whether `require()` works. Non-JavaScript targets need file-specific loading rules.

TypeScript type entries and compiler-version mappings describe where tools may look for types. Missing declarations do not prove that types are absent, and changed paths do not prove that the types themselves changed.

**Missing or incomplete evidence means uncertainty, not “nothing changed.”**

## Scope

The product compares two versions of one public npm package. It does not:

- Inspect your project.
- Accept private-registry credentials.
- Change your dependencies or apply migration steps.
- Guarantee compatibility.

## Implementation references

These sources define the interface and evidence limits. They do not prove that every AI explanation is correct.

- [Current header and navigation](../../app/components/comparison/ComparisonDetails.vue).
- [Result explanations and limitations](../../app/pages/[packageName]/comparisonView.ts).
- [AI evidence packet](../../server/comparison/briefing/evidence/build.ts) and [briefing instructions](../../server/comparison/briefing/prompt.ts).
