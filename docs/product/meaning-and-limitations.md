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

An issue matched only to the target version does not, by itself, prove that version introduced it. **Missing or incomplete coverage cannot prove that an issue was fixed or that a package is safe.**

### Release notes, exports, and types

A release-note finding reports a relevant change described by the maintainer. The collected notes may not cover every behavior change.

An export or type declaration change means the published metadata changed. We do not fully analyze the package's API behavior or implementation.

**Missing or incomplete evidence means uncertainty, not “nothing changed.”**

## Scope

The product compares two versions of one public npm package. It does not:

- Inspect your project.
- Accept private-registry credentials.
- Change your dependencies or apply migration steps.
- Guarantee compatibility.

## Evidence and provenance

The product's purpose and priorities were agreed during the documentation review on 2026-10-02.

The source links below support the described interface and evidence limits. They do not prove that every AI explanation is correct.

- [Current header and navigation](../../app/components/comparison/ComparisonDetails.vue).
- [Result explanations and limitations](../../app/pages/[packageName]/comparisonView.ts).
- [AI evidence packet](../../server/comparison/briefing/evidence/build.ts) and [briefing instructions](../../server/comparison/briefing/prompt.ts).
