# Design System and Component Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tailwind v4/shadcn token foundation, explicit Nuxt imports, direct Reka primitives, `cn`, CVA, and a semantic Button component.

**Architecture:** Configure Tailwind through the official Vite plugin and keep the shadcn neutral token stylesheet in `app/assets/css/main.css`. Disable Nuxt application auto-imports, import Reka primitives directly, and source the Button from `app/components/element/Button.vue` with CVA variants and `cn` class merging. Use a temporary browser smoke route for consumer-visible verification, then remove it.

**Tech Stack:** Nuxt 4, Vue 3, Tailwind CSS 4, `@tailwindcss/vite`, Reka UI, shadcn-ui `cn`, `class-variance-authority`, Nub, TypeScript, Oxlint, Oxfmt.

**Spec:** `docs/superpowers/specs/2026-09-16-design-system-components-design.md`

## Global Constraints

- Use Tailwind CSS v4 through the official `@tailwindcss/vite` plugin.
- Keep the shadcn CSS as a local stylesheet under `app/assets/css/main.css`; do not install or enable `shadcn-nuxt`.
- Use the official neutral shadcn token palette as the initial theme. Do not copy the sibling `docpenny` product palette or fonts.
- Use class-controlled dark tokens with system-preference fallback. `.dark` forces dark mode, `.light` forces light mode, and an unqualified root follows `prefers-color-scheme`.
- Use `reka-ui` directly, not the `reka-ui/nuxt` module. Components import only the primitives they need.
- Disable Nuxt auto-imports broadly with `imports.autoImport: false` and disable local component scanning with `components.dirs: []`. Framework and application APIs are imported explicitly from their owning packages or Nuxt aliases.
- Place generic components in semantic subdirectories under `app/components`; the first component is `app/components/element/Button.vue`.
- Require explicit component imports, for example `import Button from '~/components/element/Button.vue'`.
- Use `cn` from shadcn-ui's `cn` package for conditional class joining and Tailwind conflict resolution. Expose it through `app/utils/cn.ts` so application imports have one stable local path without recreating the old `clsx` + `tailwind-merge` implementation.
- Use `class-variance-authority` from Joe Bell's CVA project for variant definitions and inferred variant prop types.
- Do not add `tw-animate-css`, icon packages, theme state, a component registry, or additional generic components in this slice. None is required by the Button foundation.
- Add `tailwindcss` and `@tailwindcss/vite` as development dependencies.
- Add `cn`, `class-variance-authority`, `reka-ui`, and `h3` as runtime dependencies.
- Do not add `clsx` or `tailwind-merge` as direct dependencies.
- Keep Nuxt's generated root project references and `.nuxt/tsconfig.*` files under Nuxt control.
- Do not add a permanent showcase route or permanent automated test for this setup-only slice.

---

## File Map

- Modify `package.json`: add the UI/runtime and Tailwind build dependencies; retain existing Nuxt, Effect, Nub, and tooling scripts.
- Modify `nub.lock`: record the Nub-resolved dependency graph through Nub commands only.
- Modify `nuxt.config.ts`: explicitly import `defineNuxtConfig`, register Tailwind's Vite plugin and global CSS, and disable Nuxt auto-imports.
- Create `app/assets/css/main.css`: own the Tailwind import, neutral shadcn token variables, dark/system fallback, Tailwind theme aliases, and base layer.
- Create `app/utils/cn.ts`: re-export the `cn` package without reimplementing merge logic.
- Create `app/components/element/Button.vue`: implement the explicit CVA/Reka Button contract.
- Modify `app/app.vue`: replace the welcome starter with an explicit `NuxtPage`/`NuxtRouteAnnouncer` shell.
- Modify `server/api/health.get.ts`: import `defineEventHandler` explicitly from `h3` without changing the response.
- Temporarily create and remove `app/pages/design-system-smoke.vue`: browser-only Button verification fixture.

### Task 1: Install UI dependencies and wire Nuxt explicitly

**Files:**

- Modify: `package.json`
- Modify: `nub.lock`
- Modify: `nuxt.config.ts`

**Interfaces:**

- Produces direct runtime imports for `cn`, CVA, Reka UI, and H3.
- Produces Tailwind v4 Vite processing and global stylesheet registration.
- Makes Nuxt application auto-import behavior explicit and disabled.

- [ ] **Step 1: Add runtime dependencies through Nub**

Run:

```bash
nub add cn class-variance-authority reka-ui h3
```

Expected manifest result: the existing `dependencies` retains `effect`, `nuxt`, `vue`, and `vue-router`, and additionally contains `cn`, `class-variance-authority`, `reka-ui`, and `h3` with the versions selected by Nub.

Keep Nub as the package manager. Do not add `clsx` or `tailwind-merge` directly.

- [ ] **Step 2: Add Tailwind build dependencies through Nub**

Run:

```bash
nub add -D tailwindcss @tailwindcss/vite
```

Expected: `tailwindcss` and `@tailwindcss/vite` appear under `devDependencies`, and no Tailwind v3 configuration file is generated.

- [ ] **Step 3: Replace implicit Nuxt config helpers and add Tailwind wiring**

Update `nuxt.config.ts` to this shape while preserving the existing strict TypeScript options exactly:

```ts
import tailwindcss from '@tailwindcss/vite'
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  imports: {
    autoImport: false,
  },
  components: {
    dirs: [],
  },
  typescript: {
    strict: true,
    typeCheck: true,
    tsConfig: {
      compilerOptions: {
        target: 'es2024',
        strict: true,
        skipLibCheck: true,
        isolatedModules: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        moduleDetection: 'force',
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noUncheckedSideEffectImports: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
      },
    },
  },
})
```

Do not add `modules: ['shadcn-nuxt', 'reka-ui/nuxt']`. Do not enable a custom components directory or `pathPrefix` because local component scanning is disabled.

- [ ] **Step 4: Regenerate Nuxt contexts**

Run:

```bash
nub run prepare
```

Expected: Nuxt regenerates `.nuxt/tsconfig.app.json`, `.nuxt/tsconfig.server.json`, `.nuxt/tsconfig.shared.json`, and `.nuxt/tsconfig.node.json`; the root `tsconfig.json` remains a references-only file.

- [ ] **Step 5: Inspect the dependency and configuration boundary**

Read `package.json` and `nuxt.config.ts`. Confirm the only new configuration behavior is Tailwind registration plus disabled application auto-imports. Confirm the Nub lockfile changed through Nub and no `pnpm-lock.yaml` or workspace file exists.

- [ ] **Step 6: Commit dependency and configuration wiring**

Run:

```bash
git add package.json nub.lock nuxt.config.ts
git commit -m "chore: wire Tailwind and explicit Nuxt imports"
```

### Task 2: Add the shadcn token stylesheet and class utility

**Files:**

- Create: `app/assets/css/main.css`
- Create: `app/utils/cn.ts`

**Interfaces:**

- Exposes semantic Tailwind utilities such as `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, and `ring-ring`.
- Exposes `cn` through the explicit import path `~/utils/cn`.
- Defines light tokens, explicit `.dark` tokens, explicit `.light` opt-out, and system dark fallback.

- [ ] **Step 1: Create the Tailwind/shadcn stylesheet**

Create `app/assets/css/main.css` with this content:

```css
@import 'tailwindcss';

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

html {
  color-scheme: light;
}

html.dark {
  color-scheme: dark;

  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@media (prefers-color-scheme: dark) {
  html:not(.light) {
    color-scheme: dark;

    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.205 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --destructive-foreground: oklch(0.985 0 0);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
    --chart-1: oklch(0.488 0.243 264.376);
    --chart-2: oklch(0.696 0.17 162.48);
    --chart-3: oklch(0.769 0.188 70.08);
    --chart-4: oklch(0.627 0.265 303.9);
    --chart-5: oklch(0.645 0.246 16.439);
    --sidebar: oklch(0.205 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.488 0.243 264.376);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.556 0 0);
  }
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

The dark media block intentionally duplicates the `.dark` values. `.dark` wins through the explicit class selector, while `html.light` excludes the system fallback. Do not import `shadcn/tailwind.css`, `tw-animate-css`, or any product-specific font file.

- [ ] **Step 2: Create the explicit `cn` boundary**

Create `app/utils/cn.ts`:

```ts
export { cn } from 'cn'
```

Do not add `clsx`, `tailwind-merge`, a local merge implementation, or a Nuxt auto-import registration.

- [ ] **Step 3: Run formatting for the new CSS and utility**

Run:

```bash
nub run format
```

Expected: Oxfmt formats the two new files without changing generated output. Review that the `cn` file remains a one-line re-export.

- [ ] **Step 4: Commit the styling foundation**

Run:

```bash
git add app/assets/css/main.css app/utils/cn.ts
git commit -m "feat: add shadcn theme tokens and cn utility"
```

### Task 3: Implement the semantic Reka/CVA Button

**Files:**

- Create: `app/components/element/Button.vue`

**Interfaces:**

- Default usage renders a native `<button type="button">`.
- `variant` accepts `default`, `destructive`, `outline`, `secondary`, `ghost`, or `link`.
- `size` accepts `default`, `sm`, `lg`, `icon`, `icon-sm`, or `icon-lg`.
- `as` selects a Reka primitive element; `asChild` composes styles onto the slot child.
- Native attributes/events are forwarded; caller classes are merged last with `cn`.

- [ ] **Step 1: Create the Button component with explicit imports and CVA styles**

Create `app/components/element/Button.vue`:

```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cn } from '~/utils/cn'

defineOptions({ inheritAttrs: false })

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonVariantProps = VariantProps<typeof buttonVariants>
type ButtonType = 'button' | 'submit' | 'reset'

interface ButtonProps extends PrimitiveProps {
  variant?: ButtonVariantProps['variant']
  size?: ButtonVariantProps['size']
  type?: ButtonType
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<ButtonProps>(), {
  as: 'button',
  asChild: false,
  variant: 'default',
  size: 'default',
  type: 'button',
})

const buttonType = computed(() => {
  if (props.asChild || props.as !== 'button') {
    return undefined
  }

  return props.type
})
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="props.as"
    :as-child="props.asChild"
    :type="buttonType"
    data-slot="button"
    :class="cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)"
  >
    <slot />
  </Primitive>
</template>
```

The CVA output is the first `cn` argument and `props.class` is the second, so a caller can override conflicting utility classes. Keep the class contract typed with `HTMLAttributes['class']`; do not widen it to `any`.

- [ ] **Step 2: Check the component’s generated type surface**

Run:

```bash
nub run prepare
nub run type-check
```

Expected: TypeScript accepts the Reka `PrimitiveProps`, CVA `VariantProps`, Vue class type, explicit `cn` import, and native attribute forwarding. Nuxt must not report an auto-imported component or missing generated component registration for `Button.vue`.

- [ ] **Step 3: Commit the Button component**

Run:

```bash
git add app/components/element/Button.vue
git commit -m "feat: add semantic Reka button"
```

### Task 4: Remove starter surface and finish explicit runtime imports

**Files:**

- Modify: `app/app.vue`
- Modify: `server/api/health.get.ts`

**Interfaces:**

- The root app explicitly renders `NuxtRouteAnnouncer` and `NuxtPage`.
- `GET /api/health` still returns `{ status: 'ok' }`.
- No source file relies on Nuxt's implicit application auto-imports.

- [ ] **Step 1: Replace the welcome starter with an explicit Nuxt shell**

Set `app/app.vue` to:

```vue
<script setup lang="ts">
import { NuxtPage, NuxtRouteAnnouncer } from '#components'
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
</template>
```

This removes `NuxtWelcome` and preserves the route announcer without relying on component scanning.

- [ ] **Step 2: Import the existing server handler explicitly**

Set `server/api/health.get.ts` to:

```ts
import { defineEventHandler } from 'h3'
import { Effect } from 'effect'

export default defineEventHandler(() => Effect.runSync(Effect.succeed({ status: 'ok' as const })))
```

Keep the endpoint path, synchronous Effect program, and response shape unchanged.

- [ ] **Step 3: Run the application type-check**

Run:

```bash
nub run type-check
```

Expected: `NuxtPage`, `NuxtRouteAnnouncer`, `defineEventHandler`, and `Effect` all resolve through explicit imports; no implicit component or helper import is required.

- [ ] **Step 4: Commit the explicit runtime boundary**

Run:

```bash
git add app/app.vue server/api/health.get.ts
git commit -m "refactor: make Nuxt runtime imports explicit"
```

### Task 5: Run full static checks and browser smoke verification

**Files:**

- Temporary create/remove: `app/pages/design-system-smoke.vue`
- Verify: `package.json`, `nub.lock`, `nuxt.config.ts`, `app/assets/css/main.css`, `app/utils/cn.ts`, `app/components/element/Button.vue`, `app/app.vue`, `server/api/health.get.ts`

**Interfaces:**

- The dependency graph installs from Nub.
- Type-check, lint, formatter, and production build pass.
- The Button is visibly rendered from an explicit import and preserves native/primitive behavior.
- The health endpoint remains operational.
- The final tree contains no temporary smoke route.

- [ ] **Step 1: Run a lockfile-consistent install**

Run:

```bash
nub ci
```

Expected: installation succeeds from `package.json` and `nub.lock` without creating `pnpm-lock.yaml` or a workspace file.

- [ ] **Step 2: Run all static project checks**

Run in order:

```bash
nub run prepare
nub run type-check
nub run lint:check
nub run format:check
nub run --node build
```

Expected: all commands exit successfully. Nuxt preserves generated project references, Tailwind compiles the global CSS, explicit imports type-check, Oxlint accepts the source, Oxfmt reports no changes, and the production build completes.

- [ ] **Step 3: Add the temporary explicit-import browser fixture**

Create `app/pages/design-system-smoke.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import Button from '~/components/element/Button.vue'

const clicks = ref(0)
</script>

<template>
  <main class="min-h-screen bg-background p-8 text-foreground">
    <h1 class="mb-6 text-2xl font-semibold">Design system smoke</h1>
    <div class="flex flex-wrap items-center gap-3">
      <Button data-testid="default" @click="clicks += 1">Default</Button>
      <Button data-testid="outline" variant="outline">Outline</Button>
      <Button data-testid="destructive" variant="destructive">Destructive</Button>
      <Button data-testid="secondary" variant="secondary">Secondary</Button>
      <Button data-testid="ghost" variant="ghost">Ghost</Button>
      <Button data-testid="link" variant="link">Link</Button>
      <Button data-testid="small" size="sm">Small</Button>
      <Button data-testid="large" size="lg">Large</Button>
      <Button data-testid="disabled" disabled>Disabled</Button>
      <Button data-testid="as-child" as-child>
        <a href="/design-system-smoke#link">Composed link</a>
      </Button>
    </div>
    <p data-testid="click-count" class="mt-6">Clicks: {{ clicks }}</p>
  </main>
</template>
```

This route is a verification fixture only. Do not commit it.

- [ ] **Step 4: Start the real Nuxt development server**

Start a supervised process with the project runner:

```text
nub run --node dev -- --host 127.0.0.1 --port 3000
```

Use the process supervisor and wait for Nuxt’s ready message before browser access. Do not run the dev server as an unmanaged background shell process.

- [ ] **Step 5: Verify the Button in Chromium**

Open `http://127.0.0.1:3000/design-system-smoke` in a browser tab and confirm:

- The page uses the shadcn background/foreground tokens and renders all Button variants without hydration errors.
- The default button is a native `button` with `type="button"`, `data-slot="button"`, and the CVA base/variant classes.
- The `outline` button includes border and accent-hover classes.
- The disabled button has the disabled attribute and does not increment the click count.
- Clicking the default button changes `Clicks: 0` to `Clicks: 1`.
- The `as-child` control renders the styled anchor rather than a nested button.
- The page is visually coherent in light mode; toggle the root `html` class to `dark` in DevTools and confirm the token colors switch without changing component markup.
- Emulate a dark system preference with no `.dark` or `.light` class and confirm the token colors switch; add `.light` and confirm the light tokens remain active.

Capture a screenshot as the visual verification evidence.

- [ ] **Step 6: Verify the existing health route**

While the supervised server is running, run:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

Expected output is the existing response:

```json
{"status":"ok"}
```

- [ ] **Step 7: Stop the supervised development server**

Stop the named process through the process supervisor after the browser and HTTP checks complete.

- [ ] **Step 8: Remove the temporary fixture**

Delete `app/pages/design-system-smoke.vue` and remove the empty `app/pages` directory when no other file remains. Do not replace the fixture with a permanent page or test.

- [ ] **Step 9: Verify cleanup and final static state**

Run:

```bash
nub run format:check
```

Confirm the temporary route is absent and no generated `.nuxt`, `.output`, or `.nitro` files are tracked. The final deliverable contains only the permanent source/configuration changes and the committed design/plan documents.

The permanent changes were committed in Tasks 1–4. Task 5 is verification and cleanup only; do not create an empty commit after removing the uncommitted fixture.

## Plan Self-Review

- Spec coverage: decisions and approaches are covered by Tasks 1–2; import boundaries by Tasks 1 and 4; token/theme behavior by Task 2; `cn` by Task 2; Button rendering, props, styles, and accessibility by Task 3; root integration by Task 4; verification and cleanup by Task 5.
- Placeholder scan: no implementation step uses an unresolved placeholder, TODO, or unspecified edge-case instruction. Dependency versions are resolved by Nub rather than manually copied into the manifest.
- Type consistency: `ButtonProps` extends `PrimitiveProps`; `VariantProps<typeof buttonVariants>` supplies `variant` and `size`; `cn` accepts CVA output plus the Vue class attribute; the temporary route imports the Button from its exact source path.
- Scope check: this remains one foundation subsystem with one component and one verification fixture; no independent product subsystem is hidden inside the plan.
