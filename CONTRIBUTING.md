# Contributing

Contributions are welcome. Report bugs and discuss changes through [GitLab issues](https://gitlab.com/uxpedition-oss/caniupdate.dev/-/work_items), or submit a merge request.

## Getting started

Use Node 26 and Nub 0.9.6, the project's package manager.

Choose where to clone from:

- **To explore or run the project:** clone this repository directly using the command below. No fork is needed.
- **To contribute without upstream write access:** [create a fork on GitLab](https://docs.gitlab.com/user/project/repository/forking_workflow/#create-a-fork), then use your fork's clone URL instead of the URL below. A fork is a copy under your GitLab account where you can push your branches.
- **If you already have upstream write access:** clone this repository directly and work on a branch. A fork is optional.

Cloning gives you a local checkout; it does not grant permission to push to this project.

```bash
git clone https://gitlab.com/uxpedition-oss/caniupdate.dev.git
cd caniupdate.dev
nub ci
nub run dev
```

Open <http://localhost:5173>, search for a package, and select the versions to compare.

Local development needs no Cloudflare account or paid AI provider. The launcher applies local database migrations, then starts both backend Workers and the frontend.

**The frontend and briefing socket are reachable from other devices on connected networks.**

## Development and verification

See the [development guide](docs/engineering/ops/development.md) for configuration, checks, troubleshooting, and the local built dev runtime. Local verification is sufficient to contribute; deploying your own instance is not required. Never commit credentials or local state.

## Submitting changes

1. Create a branch for your change.
2. Make your changes and run the relevant checks from the [development guide](docs/engineering/ops/development.md).
3. Commit and push your branch to your fork, or to this project if you have upstream write access.
4. Open a merge request from your branch to `main` in `uxpedition-oss/caniupdate.dev`, not to your fork's `main`. Explain the change and the verification you performed.

## AI assistance

AI assistance is welcome, including for issue and merge request drafts. Keep judgment and conversations human, and take responsibility for everything you submit. Follow the [AI contribution policy](AI_POLICY.md).

## Tech stack

- [Nuxt](https://nuxt.com/) and [Vue](https://vuejs.org/)
- [Effect](https://effect.website/)
- [Tailwind CSS](https://tailwindcss.com/) and [Reka UI](https://reka-ui.com/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/), Durable Objects, D1, and Queues
- Public npm registry, OSV, Bundlephobia, and GitHub evidence

## Release identity

The footer identifies the build:

- Staging: `stage - <short-commit>`.
- Local development: `dev - <short-commit>`.
- Production: `vMAJOR.MINOR.PATCH - <short-commit>`, using a validated release receipt and build identity.

The commit hash links to the full source commit. Staging identifies the commit used for its build, not the latest commit on the branch.

Production releases require the protected GitLab workflow and target-specific setup. A Maintainer chooses the production version in the manual `release:tag` job after main-branch checks and staging browser checks pass. Production uses those exact checked bundles without rebuilding. This does not change `package.json` or create a release branch or merge request.

For setup and recovery, see [deployment operations](docs/engineering/ops/deployment.md#manual-protected-main-release) and [release recovery](docs/engineering/ops/releases-and-recovery.md).

## Engineering documentation

- [System architecture](docs/engineering/overview.md)
- [Evidence collection and storage](docs/engineering/evidence.md)
- [AI briefing architecture](docs/engineering/briefing.md)
- [Deployment](docs/engineering/ops/deployment.md)
- [Releases and recovery](docs/engineering/ops/releases-and-recovery.md)
- [Documentation organization and decision records](docs/CONTEXT.md)

## Third-party notices

Third-party agent skills and their supporting material retain their upstream notices. See [skill sources and license notices](.agents/skills/THIRD_PARTY_NOTICES.md).
