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

## Checks

```bash
nub run prepare
nub run type-check
nub run lint:check
nub run format:check
```

## Production

Build and preview the application through Nub without runtime augmentation:

```bash
nub run --node build
nub run --node preview
```

See the [Nuxt deployment documentation](https://nuxt.com/docs/getting-started/deployment) for deployment options.
