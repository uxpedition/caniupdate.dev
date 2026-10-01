# Product meaning and limitations

## What the product is for

**Can I update? makes consequential, easily missed differences between two versions of one public npm package easy to notice.**

It is a package comparison, not a project assessment. Its core purpose is to show useful facts quickly, not issue an upgrade approval or safety score.

## Read the comparison at a glance

The header highlights three categories:

- **Dependencies:** Changes to declared runtime and optional dependency requirements.
- **Gzip estimate:** Changes to Bundlephobia's standalone package bundle estimate.
- **Security:** Known advisories matched to the selected versions by OSV.

A separate warning surfaces changes to the declared Node requirement. A raised minimum matters to consumers running an older runtime; it does not mean every consumer needs a Node upgrade.

The header tiles link to the corresponding comparison-table details. The table provides additional package declarations and measurement evidence beyond those headline categories.

## What AI adds

AI notes are supplementary. The structured comparison remains useful when AI notes are unavailable.

AI can:

- Explain a finding already highlighted in the header.
- Surface consequential details from gathered release notes or other supplied evidence.
- Explain conditional implications of supplied facts, such as changes to declared export paths.

AI must ground its claims in collected evidence and cite the relevant comparison data or source material. It must not introduce package facts from its general knowledge. Maintainer statements and inferred consequences are distinct from directly computed facts.

These are the intended rules for the briefing, not a guarantee that every generated explanation is correct.

## What the results establish

| Result                         | Meaning                                                      | Limit                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node requirement change        | The package's declared supported range changed.              | Does not identify the user's runtime or prove behavior outside the declared range.                                                                                |
| Dependency change              | A declared requirement changed.                              | Does not predict the user's resolved dependency tree.                                                                                                             |
| Bundle estimate change         | The provider's standalone estimate differs between versions. | Not the user's application bundle or proof that an environment's size limit will be exceeded. Incomplete builds are not comparable.                               |
| Advisory difference            | OSV matches differ between the selected versions.            | Not independent security analysis, project-wide scanning, or proof of safety. A target-only match does not by itself prove the target introduced a vulnerability. |
| Release-note finding           | Collected maintainer evidence describes a relevant change.   | Not exhaustive discovery of every behavioral change.                                                                                                              |
| Export/type declaration change | Published metadata changed.                                  | Not exhaustive semantic API or implementation-code analysis.                                                                                                      |

**Unavailable or incomplete evidence means uncertainty, not "nothing changed."** In particular, incomplete advisory coverage cannot establish that an issue was fixed.

## Scope

The current product compares two versions of one public npm package. It does not inspect the user's project, accept private-registry credentials, modify dependencies, apply migrations, or guarantee compatibility.

## Evidence and provenance

The purpose and priority above were agreed during the product-documentation review on 2026-10-02. Implementation references support the described presentation and evidence boundaries; they do not prove that every generated AI claim is correct.

- [Current header and navigation](../../app/components/comparison/ComparisonDetails.vue).
- [Result explanations and limitations](../../app/pages/[packageName]/comparisonView.ts).
- [AI evidence packet](../../server/utils/packageBriefingEvidence.ts) and [briefing instructions](../../server/utils/packageBriefingPrompt.ts).
- [Historical product proposal](../superpowers/specs/2026-09-16-package-upgrade-design.md), sections 1 and 2. This remains a proposal, not proof that all requested capabilities shipped.
