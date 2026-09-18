# Can I npm update?

A Nuxt starter using Nub, Effect v4 RC, Oxlint, and Oxfmt.

## Setup

Install the locked dependency graph with Nub:

```bash
nub ci
```

## Development

Start the Nuxt development server on port `5173`, exposed on all network interfaces including Tailscale:

```bash
nub run --node dev
```

Open `http://<tailscale-ip>:5173` from another device. Get this device's current Tailscale IPv4 address with `tailscale ip -4`.

Nub's `--node` mode keeps Nub as the package/script runner while disabling its runtime augmentation for Nuxt worker processes.

The setup includes an Effect-backed health endpoint at `/api/health`.

## Package comparison API

`GET /api/package/{encodedPackageName}/compare?from={versionOrTag}&to={versionOrTag}` returns registry metadata and a `vulnerabilities` object on each version. Tags resolve to published versions before OSV is queried.

Both npm manifest requests start concurrently. When both inputs are full, unprefixed versions, OSV starts alongside npm; tags and noncanonical inputs wait for registry resolution before OSV is queried. Each comparison makes one OSV batch request for both versions, then one detail request per unique returned ID, shared across versions. Detail requests run concurrently with a limit of five. No automatic retries or pagination are performed.

- `status`: `available`, `partial`, or `unavailable`.
- `count`: unique OSV IDs for that version, excluding confirmed withdrawn records. A successful empty result is `0`; a failed or missing batch result is `null`. Counts are by OSV ID, not merged by CVE aliases.
- `advisories`: IDs, OSV links, detail availability, summaries, aliases, severity vectors, publication/modification times, references, and affected entries restricted to the selected npm package. Ranges retain their documented fixed events; these are not automatically recommended upgrade versions.

A failed detail lookup retains its batch match and count with `detailsStatus: 'unavailable'`, marking only the affected version `partial`. Pagination tokens also mark results `partial`: the returned count is not exhaustive, and zero must not be presented as a complete no-matches result. OSV failures do not discard registry metadata. Coverage concerns the package itself, not its dependency tree.

For example, `minimist` versions `1.2.5` and `1.2.8` currently return counts of `1` and `0`, respectively. Advisory data can change over time.

## Checks

Always pass `--node` so Nuxt processes run on plain Node without Nub's runtime augmentation, matching the dev, build, and preview commands:

```bash
nub run --node prepare
nub run --node type-check
nub run --node lint:check
nub run --node format:check
```

## Unit tests

Unit tests live beside their implementation and use the `.unit.ts` suffix:

```text
app/pages/versionSearch.ts
app/pages/versionSearch.unit.ts
```

Run the suite once or watch for changes:

```bash
nub run --node test
nub run --node test:watch
```

Vitest discovers `*.unit.ts` files under `app/`, `server/`, and `shared/`, using a Node environment with `~`, `@`, and `#shared` aliases. Import test helpers explicitly from `vitest`. Nuxt and Nitro ignore these files during application discovery, and `pages.pattern` keeps page routes to `.vue` files so page-owned modules such as `versionSearch.ts` are not routed. The local `npmx.dev/` reference checkout is not part of the suite.

`Select` keeps search opt-in: pass a `search` prop (`{ filter, placeholder?, emptyMessage? }`) to render the filter input, or omit it for a plain list. The version-select filter lives with the page that owns it and is covered by local fixtures for ranking, numeric/hash/date matches, tag descriptions, normalization, stable ordering, and input preservation. The suite does not start Nuxt or call the npm registry.

## Production

Build and preview the application through Nub without runtime augmentation:

```bash
nub run --node build
nub run --node preview
```

See the [Nuxt deployment documentation](https://nuxt.com/docs/getting-started/deployment) for deployment options.
