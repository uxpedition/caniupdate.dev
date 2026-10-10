---
name: git-workflow-and-versioning
description: Keeps changes reviewable and releases traceable. Use for any code change, when organizing commits or branches, resolving conflicts, separating mixed work, preparing or reviewing a pull request, or coordinating parallel work. Use when choosing a consumer-facing version, preparing changelog entries, or tagging a release.
---

# Git Workflow and Versioning

## Overview

Git is a safety net: commits are save points, branches are sandboxes, and history explains how the code changed. Fast agent-generated changes make disciplined version control more important, not less. Keep each slice understandable, verified, and reversible; preserve unrelated user work.

## When to Use

Always for code changes. Apply the release and versioning sections when another team, deployed client, package consumer, or other external dependency needs to identify what it runs and whether an upgrade is safe.

## Safety and scope

1. Inspect the current branch, status, staged diff, and repository instructions before changing Git state. Treat every pre-existing or unfamiliar change as user-owned; do not stage, rewrite, discard, or attribute it to this task without clear authorization.
2. Use the repository's established branch, commit, and review conventions. Do not impose a second convention when one already exists.
3. Keep temporary AI working material outside the repository in the explicitly named `workDir`. Read the working-set policy in [`../../references/POLICY.md`](../../references/POLICY.md); use the exact absolute `workDir` supplied for this work and pass it between skills and sessions rather than guessing which plan is active. Never stage or commit temporary briefs, specifications, plans, task lists, or handoff material. Commits contain only code and authorized durable documentation.
4. A local verification or discussion does not authorize a commit, push, tag, release, publication, remote mutation, or deployment. Obtain authorization for actions not already covered by the user's explicit task or established repository workflow. Ordinary Git inspection and repository tools follow runtime/repository permissions; each external CLI invocation for cross-model review requires its own explicit authorization. Preserve per-slice commit discipline within the authorized workflow; never include temporary AI working artifacts.
5. Prefer non-destructive inspection and recovery. Do not use destructive reset/clean, force-push, or broad checkout commands to make a tree look clean. If a change must be undone, first identify exactly which work is yours and use the narrowest reviewed recovery. Stop rather than overwrite unowned work.

## Core principles

### Trunk-based development (recommended)

Keep the default branch deployable. Prefer short-lived branches that merge promptly; a 1–3 day lifetime is a guide, not a universal rule. Long-lived branches accumulate divergence and merge risk. Teams with Gitflow or another established model can adapt the principles—atomic changes, small slices, and clear messages matter more than adopting a new branching model.

```
default branch ──●──●──●──●──●──●──  (kept deployable)
                  ╲   ╱    ╲  ╱
short-lived work   ●─●      ●─●       (integrated promptly)
```

- Treat development branches as a cost; keep divergence small.
- Release branches can be appropriate when a release must stabilize while the default branch advances.
- Prefer a feature flag over a long-lived branch when incomplete work can safely be integrated but must remain unavailable to users. Plan flag ownership and removal; see `shipping-and-launch`.

### Commit early, commit each verified slice

Each finished, verified increment can become its own save point, subject to explicit commit authorization and repository policy. Keep working slices independently understandable.

```
Implement one slice → exercise its behavior → review its diff → authorized commit → next slice
```

A failed check is a signal to investigate, not to hide the failure by skipping checks or resetting unrelated work. Use `debugging-and-error-recovery` when the failure needs structured diagnosis.

### Atomic commits

One commit expresses one logical change. Keep implementation, tests, and necessary documentation together when they form one consumer-visible behavior; split independent behavior, cleanup, and formatting into separate commits when they can be reviewed and reverted independently.

```
Good: Add request validation to the task endpoint
Good: Add focused validation tests
Bad: Add task creation, reformat the app, and upgrade unrelated packages
```

Tests and required durable documentation may belong in the same logical slice. Never commit a temporary AI artifact as part of that slice.

### Descriptive messages

Explain intent and impact, not only filenames or the visible diff. Follow the existing message format; if none exists, a conventional format is a useful default:

```
<type>: <short description>

<optional body explaining why and important constraints>
```

Common types are `feat`, `fix`, `refactor`, `test`, `docs`, and `chore`. For example, `fix: reject malformed package selectors` explains a behavior change better than `update handler`. Avoid a body that merely paraphrases every changed line.

### Keep concerns separate

Separate behavior from broad formatting, unrelated refactors, dependency churn, and opportunistic cleanup. A small rename needed to make a feature clear may stay with that feature; use judgment and make the choice visible to reviewers.

### Size changes for review

Use roughly 100 changed lines as a planning target for a commit or pull request, not a hard limit. About 300 lines can be reasonable for one coherent slice; changes above roughly 1,000 lines usually deserve splitting. Generated files, schemas, tests, and other mechanically coupled outputs can make a coherent slice larger. Split by independently verifiable outcome rather than deleting required work to meet a number. For review-splitting tactics, use `code-review-and-quality`.

## Branches and parallel work

### Branching

Branch from the repository's default integration branch. Name a branch for its purpose, following existing patterns such as `feature/<short-description>`, `fix/<short-description>`, `chore/<short-description>`, or `refactor/<short-description>`. Keep branches short-lived, remove merged branches only when authorized and only when they are yours, and avoid force-pushing shared branches.

### Worktrees

For genuinely independent parallel streams, a Git worktree can isolate each branch without repeated branch switching:

```bash
git worktree add ../project-feature feature/example
# Work only in the worktree that owns this branch.
# After integration, inspect ownership and state before removing it:
git worktree list
```

A worktree is a separate working directory attached to a branch, not a backup. Do not use it to evade shared-state, credential, or authorization boundaries. Create or remove worktrees only when permitted; remove only a worktree you created and verified is no longer in use. Never run cleanup commands over an unfamiliar worktree.

### Save points and recovery

After a verified increment, an authorized commit creates a known point from which later work can be reasoned about. If a later increment fails, diagnose it and preserve the failed evidence and unrelated changes. Use a narrow revert or restoration only after confirming ownership and scope; never assume a broad reset is safe. A commit is not proof of correctness; run the repository's appropriate verification before the next slice.

## Change summaries

After a non-trivial modification, provide a concise review map:

```
CHANGES MADE:
- path: outcome and user-visible behavior

INTENTIONALLY UNCHANGED:
- path or concern: why it is outside this slice

POTENTIAL CONCERNS:
- unresolved compatibility, data, performance, or security question
```

This gives reviewers a scope boundary without turning the summary into an execution log. Distinguish verified facts from assumptions and do not claim a check passed unless it was run.

## Pre-commit hygiene

Before a commit, and only with authorization to commit:

1. Inspect the exact staged diff and confirm it contains only this logical slice and authorized durable documentation.
2. Check for secrets, private runtime configuration, and personal or provider data using the repository's available secret-scanning convention. A text search is not a substitute for reviewing the diff or for rotating a leaked credential.
3. Run the relevant tests, static checks, type checks, and build commands defined by the repository. Discover them from project instructions, scripts, tool configuration, and CI; use the detected package manager and its pinned version. Do not copy an `npm`, `yarn`, `pnpm`, `bun`, or other command from an example into a repository that uses a different manager.
4. Keep formatting-only changes separate from behavior changes unless the established project convention requires otherwise.
5. Confirm generated files are handled according to the project: commit generated source or migration artifacts only when required; keep build output, private configuration, credentials, and local state out of version control. Check `.gitignore` and the lockfile convention.

Repository configuration is authoritative for tooling. The files and commands can change, so inspect them rather than caching a command list in this skill.

## Generated files and private material

Commit generated artifacts only when the repository expects them (for example, a committed lockfile, generated client, or reviewed migration). Keep build output, dependency directories, local state, editor-private settings, real environment files, and key material out of Git unless the repository explicitly establishes a safe shared artifact. Ensure ignore rules cover applicable cases such as dependency/build directories, `.env` variants, private key files, and local state. A committed example configuration should contain placeholders only.

## Git for diagnosis

Use history to narrow a regression and understand ownership, not to assign blame:

```bash
git log --oneline -20
git diff <known-good-revision>..<current-revision> -- <path>
git blame <path>
git log --grep="validation" --oneline
git bisect start
```

`git bisect` changes the checked-out revision. Use it only in a clean, isolated worktree with permission, a known good and bad revision, and a deterministic reproducer; restore the worktree safely when done. Never start a bisect in a working tree containing user changes.

## Release and versioning

Commits describe source changes; a version identifies what consumers receive. When other code, teams, or deployed clients depend on the artifact, a version and human-readable release notes answer what changed and whether an upgrade is safe. Do not impose SemVer or a changelog on a project whose published contract deliberately uses a different scheme; inspect its existing release policy first.

### Semantic Versioning

For a SemVer contract, use `MAJOR.MINOR.PATCH`:

```
MAJOR  incompatible public behavior or interface; consumers must adapt
MINOR  backward-compatible capability
PATCH  backward-compatible correction
```

The number is a promise. Compatibility includes observable behavior, not only types; Hyrum's Law means consumers can depend on behavior that was never documented. Consult `api-and-interface-design` for public contract changes and `deprecation-and-migration` for removal plans. When uncertain whether a change is breaking, examine consumer-visible behavior and document the uncertainty instead of disguising it as a patch.

### Tags and release identity

Treat a release as an immutable point in history. Follow the repository's tag and artifact conventions, and keep source revision, version, build, and release notes consistent. Derive artifact identity from the authoritative release metadata rather than hand-editing the same version into multiple files. A remote tag or publication changes shared state: obtain explicit authorization, verify the exact commit and tag name, then record the resulting identity.

```bash
# Illustrative only: use the project's approved tag and release procedure.
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

### Changelog for consumers

A changelog is a curated answer to “what changed and do I care?”, not a raw commit dump. Follow the existing format; a useful default groups the newest release by `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, and `Security`, with each entry phrased in user impact. Update it with the change while the impact is known. Breaking changes need a clear migration note and deprecation window where compatible policy allows; see `deprecation-and-migration`. Shipping the release itself belongs to `shipping-and-launch` and requires explicit authorization.

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- A user-visible capability and who can use it.

### Fixed

- The observable failure that no longer occurs.

### Deprecated

- The old contract, replacement, and removal policy.
```

## Common rationalizations

| Rationalization                                 | Reality                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| “I'll commit when the whole feature is done.”   | A giant commit is harder to review, debug, and revert. Save verified slices independently when authorized.         |
| “The message does not matter.”                  | History is documentation for future maintainers and agents.                                                        |
| “I'll squash everything later.”                 | Squashing can erase a useful development narrative. Follow the project review policy and keep logical units clear. |
| “Branches add overhead.”                        | Short-lived branches isolate concurrent work; long-lived divergence is the cost to avoid.                          |
| “I'll split it after review.”                   | Large changes are harder to review and safely deploy; plan slices before submission.                               |
| “It's a tiny change, so secrets do not matter.” | A single credential in a diff can compromise an environment. Review the staged content.                            |
| “It's only a patch bump.”                       | A small diff can break observable behavior; classify by consumer impact.                                           |
| “The changelog is just the commit log.”         | Raw commits obscure what consumers need to know.                                                                   |
| “We can write the release note later.”          | Later means reconstructing user impact from memory.                                                                |

## Red flags

- Large uncommitted changes or ambiguous staged content
- Vague commit messages and mixed unrelated concerns
- Temporary AI briefs/specifications/plans or private material staged for commit
- Build output, local state, or credentials in the proposed commit
- Long-lived divergent branches, force-pushes to shared branches, or destructive cleanup of unfamiliar work
- A breaking change released under a compatible version number
- A tag, artifact, version, and changelog that disagree
- A consumer-facing release with no curated notes or migration information
- A remote Git mutation or release action treated as authorized merely because it was discussed

## Verification

For every commit:

- [ ] Commit contains one reviewable logical slice and no temporary AI artifacts.
- [ ] The message explains intent and follows repository conventions.
- [ ] Relevant checks ran successfully before commit; the exact staged diff was reviewed.
- [ ] No credentials, private runtime/provider details, or unapproved user changes are included.
- [ ] Generated files and ignore rules match repository conventions.

For every release with consumers:

- [ ] The version matches consumer-visible compatibility and the existing release policy.
- [ ] The tagged source, artifact metadata, and release notes identify the same release.
- [ ] Notes are curated for user impact; breaking changes identify migration and deprecation expectations.
- [ ] Tagging, publishing, pushing, and deployment were explicitly authorized and the resulting identity was recorded.
