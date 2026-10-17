# Can I update?

> Notice consequential npm package changes before updating.

- [Check it out](https://caniupdate.dev)
- [Understand the results](docs/product/meaning-and-limitations.md)

## Vision

Updating a dependency should not mean hunting through package metadata, release notes, and advisory databases to find what matters.

Can I update? compares two versions of one public npm package and brings consequential differences into one view. It helps you review an update; it does not decide whether that update is safe for your project.

## Features

- **Dependency changes** — Compare declared runtime, optional, and peer dependency requirements.
- **Node requirements** — Spot changes to the package's declared runtime support.
- **Bundle estimates** — Compare standalone package estimates from Bundlephobia, with incomplete builds clearly identified.
- **Security advisories** — Compare OSV matches for the selected versions, preserving missing or incomplete coverage.
- **Package declarations** — Review exports, module format, TypeScript metadata, licenses, and install scripts.
- **Evidence-backed AI notes** — Supplement structured results with cited explanations grounded in collected package and maintainer evidence.
- **Progressive results** — Read declarations while measurements and AI notes load.
- **Shareable comparisons** — Link directly to a version pair and its details.
- **Light and dark themes** — Use the presentation that suits your environment.

Bundle estimates are not your application bundle. Advisory results are not a project-wide security audit. AI notes can be wrong. Missing evidence means uncertainty, not “nothing changed.”

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

Local development requires no Cloudflare account or paid AI provider. The launcher starts the frontend and both backend Workers and applies local database migrations. It exposes the frontend and briefing socket on connected network interfaces.

See [development](docs/engineering/ops/development.md) for configuration, checks, troubleshooting, and the local built dev runtime.

## Release identity

The stage footer displays `stage - <short-commit>`; local dev runs display `dev - <short-commit>`. Production displays `vMAJOR.MINOR.PATCH - <short-commit>` only with a stable runtime release version and a configured build identity. In each case the hash links to the full deployed commit. The production artifact must be built from the commit identified by its release tag; stage identifies the main commit used for its build, not the latest mutable branch tip. Shared schemas validate the stable version and release receipt shape. Receipt publication and production deployment remain unimplemented.

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
