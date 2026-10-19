# Can I update?

> See important npm package changes before you update.

- [Check it out](https://caniupdate.dev)
- [Understand the results](docs/product/meaning-and-limitations.md)

## Vision

Updating a dependency should not mean searching package metadata, release notes, and security databases for what matters.

Can I update? compares two versions of one public npm package in one view.

It helps you review an update. It cannot tell you whether the update is safe for your project.

## Features

- **Dependency changes** — See changes to required, optional, and peer dependencies.
- **Node requirements** — See changes to the Node versions the package says it supports.
- **Bundle estimates** — Compare Bundlephobia's estimates for the package on its own. Incomplete builds are clearly marked.
- **Security advisories** — Compare known issues found by OSV, a security advisory database, including gaps in its results.
- **Package declarations** — Review import paths, module format, TypeScript settings, licenses, and install scripts.
- **AI notes with sources** — Read extra explanations based on the collected package data and maintainer notes.
- **Results as they arrive** — Read package declarations while measurements and AI notes load.
- **Shareable comparisons** — Link directly to a version pair and its details.
- **Light and dark themes** — Use the presentation that suits your environment.

These results have limits:

- Bundle estimates are not your application's bundle size.
- Advisory results are not a security audit of your project.
- AI notes can be wrong.
- Missing evidence means uncertainty, not “nothing changed.”

See [product meaning and limitations](docs/product/meaning-and-limitations.md) for the full interpretation guide.

## Getting started

Use Node 26 and Nub 0.9.6, the project's package manager.

```bash
git clone https://gitlab.com/uxpedition/can-i-npm-update.git
cd can-i-npm-update
nub ci
nub run dev
```

Open <http://localhost:5173>, search for a package, and select the versions to compare.

Local development needs no Cloudflare account or paid AI provider. The launcher applies local database migrations, then starts both backend Workers and the frontend.

**The frontend and briefing socket are reachable from other devices on connected networks.**

See [development](docs/engineering/ops/development.md) for configuration, checks, troubleshooting, and the local built dev runtime.

## Release identity

The footer identifies the build:

- Stage: `stage - <short-commit>`.
- Local development: `dev - <short-commit>`.
- Production: `vMAJOR.MINOR.PATCH - <short-commit>`, using a validated release receipt and build identity.

The commit hash links to the full source commit. Stage identifies the commit used for its build, not the latest commit on the branch.

Production releases require the protected GitLab workflow and target-specific setup.[^release-process]

For setup and recovery, see [deployment operations](docs/engineering/ops/deployment.md#manual-protected-main-release) and [release recovery](docs/engineering/ops/releases-and-recovery.md).

## Tech stack

- [Nuxt](https://nuxt.com/) and [Vue](https://vuejs.org/)
- [Effect](https://effect.website/)
- [Tailwind CSS](https://tailwindcss.com/) and [Reka UI](https://reka-ui.com/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/), Durable Objects, D1, and Queues
- Public npm registry, OSV, Bundlephobia, and GitHub evidence

## Contributing

Contributions are welcome. Report bugs and discuss changes through [GitLab issues](https://gitlab.com/uxpedition/can-i-npm-update/-/issues), or submit a merge request.

Start with the [development guide](docs/engineering/ops/development.md). Local verification is sufficient to contribute; deploying your own instance is not required. Never commit credentials or local state.

## Documentation

- [Product meaning and limitations](docs/product/meaning-and-limitations.md)
- [System architecture](docs/engineering/overview.md)
- [Evidence collection and storage](docs/engineering/evidence.md)
- [AI briefing architecture](docs/engineering/briefing.md)
- [Deployment](docs/engineering/ops/deployment.md)
- [Releases and recovery](docs/engineering/ops/releases-and-recovery.md)
- [Documentation organization and decision records](docs/CONTEXT.md)

## License

Published under the [MIT License](LICENSE).

Third-party agent skills and their supporting material retain their upstream notices. See [skill sources and license notices](.agents/skills/THIRD_PARTY_NOTICES.md).

[^release-process]: A Maintainer chooses the production version in the manual `release:tag` job after main-branch checks and stage browser checks pass. Production uses those exact checked bundles without rebuilding. This does not change `package.json` or create a release branch or merge request.
