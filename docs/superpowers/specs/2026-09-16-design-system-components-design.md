# Design System and Component Foundation

**Date:** 2026-09-16
**Status:** Self-reviewed; implementation design ready for user review

## Goal

Establish the first shared UI foundation for the root Nuxt application: Tailwind CSS v4, shadcn-style semantic design tokens, Reka UI primitives, explicit imports, a class-merging utility, and one reusable Button component. The foundation must be easy to retheme and must not introduce a speculative component catalog or a permanent showcase surface.

## Decisions

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

## Approaches considered

### Recommended: local Tailwind foundation with explicit primitives

Configure Tailwind's Vite plugin, own the shadcn stylesheet, import Reka primitives directly, and keep all application components as ordinary explicitly imported Vue files. This preserves shadcn's copy-and-own model while honoring the project's specificity preference. It also avoids hidden module registrations and keeps the dependency graph visible at each component boundary.

### Rejected: `shadcn-nuxt`

The Nuxt module provides useful scaffolding, but its default component directory and module-managed auto-import behavior conflict with explicit imports and semantic component folders. The project needs the shadcn CSS and component patterns, not a module that owns registration.

### Rejected: Nuxt Tailwind/Reka modules

Framework modules reduce initial configuration but add registration and auto-import behavior. They obscure which primitives enter a component and weaken the explicit dependency boundary requested for this project.

## Architecture

### Styling pipeline

1. `nuxt.config.ts` registers `@tailwindcss/vite` under `vite.plugins`.
2. `nuxt.config.ts` adds `~/assets/css/main.css` to the global `css` list.
3. `main.css` imports Tailwind and defines semantic CSS variables for light and dark themes.
4. Tailwind v4's `@theme inline` maps semantic variables to utilities such as `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, and `ring-ring`.
5. The base layer applies the global border/focus defaults, body surface/text colors, and system font stack.

The semantic variables are the stable design-system contract. Component styles consume semantic utilities rather than hard-coded palette values. A future product theme can replace variable values without changing component APIs.

### Theme selection

`main.css` provides three states:

- `:root`: light token values and `color-scheme: light`.
- `html.dark`: dark token values and `color-scheme: dark`.
- `@media (prefers-color-scheme: dark)` with `html:not(.light)`: dark token values when no explicit light override exists.

The explicit `.dark` class is the contract for future theme state. The `.light` class prevents the system fallback from switching a user-selected light theme. The initial slice does not implement a theme toggle or persistence layer.

### Import boundaries

`imports.autoImport: false` disables Nuxt's implicit Vue, composable, utility, and Nuxt helper imports. `components.dirs: []` disables scanning of application component directories. No module in this slice registers additional component auto-imports.

Source files use explicit imports:

- Vue APIs from `vue`.
- Nuxt-owned runtime helpers and composables from `#imports` when no direct package export is appropriate.
- Nuxt built-in components from `#components` when the root app needs them.
- The existing server handler helper directly from `h3`.
- Reka primitives and types from `reka-ui`.
- Local components from their semantic path.
- `cn` from `~/utils/cn`.

Nuxt configuration itself imports `defineNuxtConfig` from `nuxt/config`; this is configuration code, not application auto-import behavior.

### Component organization

`app/components` is organized by semantic responsibility, not by vendor package. `element` is the initial folder for generic interactive elements. Future folders may be introduced when a real component requires a distinct semantic group; this slice does not pre-create empty taxonomy directories.

The component's filename and default export are both `Button`. Explicit imports preserve the full source path while keeping template usage readable:

```vue
<script setup lang="ts">
import Button from '~/components/element/Button.vue'
</script>

<template>
  <Button>Compare versions</Button>
</template>
```

## Dependencies

Add the following packages through Nub and keep their roles separate:

- `tailwindcss` and `@tailwindcss/vite` as development dependencies for the Tailwind v4 build pipeline.
- `cn` as a runtime dependency for class joining and Tailwind conflict resolution.
- `class-variance-authority` as a runtime dependency for component variant functions.
- `reka-ui` as a runtime dependency for accessible headless primitives and `Primitive` composition.
- `h3` as a direct runtime dependency for the explicit `defineEventHandler` import in the existing health route after Nuxt auto-imports are disabled.

The implementation must resolve current published versions through Nub and update `nub.lock`. It must not add `clsx` or `tailwind-merge` as direct dependencies. CVA may retain its own `clsx` transitive dependency; application code uses `cn` for merging.

## `cn` utility

Create `app/utils/cn.ts` as a thin explicit boundary:

```ts
export { cn } from 'cn'
```

No wrapper that reimplements conflict resolution is allowed. Components call `cn` with the CVA output first and caller-provided classes last so consumer overrides win after Tailwind conflict resolution:

```ts
cn(buttonVariants({ variant, size }), props.class)
```

## Button contract

Create `app/components/element/Button.vue` as a local, source-owned shadcn-style component.

### Rendering

- Render a native `button` by default.
- Use Reka's `Primitive` so callers can select another element with `as` or compose a child element with `asChild`.
- Forward native attributes, event listeners, and arbitrary attributes through `$attrs`.
- Preserve explicit caller attributes when they conflict with defaults.
- Use `data-slot="button"` for predictable styling and inspection.
- Default native button behavior to `type="button"`; callers can explicitly provide `type="submit"` or another valid native value. Do not emit a button-only attribute when the primitive renders a non-button element.
- Render the default slot exactly once; loading, icons, and special slot contracts are out of scope.

### Props

- `variant`: `default | destructive | outline | secondary | ghost | link`; default `default`.
- `size`: `default | sm | lg | icon | icon-sm | icon-lg`; default `default`.
- `as`: Reka `PrimitiveProps['as']`, default `button`.
- `asChild`: boolean, default `false`.
- `class`: Vue HTML class attribute type; merged last through `cn`.

Variant and size unions are inferred from the CVA definition through `VariantProps<typeof buttonVariants>` rather than duplicated string unions. The component must reject unsupported values at type-check time.

### Styles

CVA owns the style groups:

- Base: inline-flex layout, centered content, gap, no wrapping, rounded token radius, text sizing/weight, transition, focus-visible ring, disabled opacity/pointer behavior, and SVG sizing.
- `default`: primary background and foreground with a subtle hover state.
- `destructive`: destructive background and foreground with a subtle hover state.
- `outline`: background, border, foreground, and accent hover state.
- `secondary`: secondary background/foreground with a subtle hover state.
- `ghost`: transparent base with accent hover state.
- `link`: primary foreground with underline-on-hover treatment.
- `default` size: standard control height and horizontal padding.
- `sm` size: compact control height and padding.
- `lg` size: larger control height and padding.
- `icon`, `icon-sm`, `icon-lg`: square controls matching their corresponding heights and padding.

All color utilities refer to shadcn semantic tokens. A caller's `class` is merged after CVA output. The component must remain usable without an icon package.

### Accessibility

The default rendered element remains a native button with keyboard activation, focus-visible indication, and disabled semantics. `asChild` is an escape hatch for callers that own link or custom-element semantics; the component does not pretend that a link is disabled. Icon-only sizes require callers to provide an accessible name, typically `aria-label`.

## Root app integration

Replace the generated welcome surface with a minimal explicit Nuxt shell that imports `NuxtPage` and `NuxtRouteAnnouncer` from `#components` and renders both. Do not add a permanent design-system showcase. The existing health endpoint remains a setup smoke path; import `defineEventHandler` directly from `h3` without changing its response contract.

The root shell must not rely on implicit component registration. The only built-in components in this slice are the explicitly imported `NuxtPage` and `NuxtRouteAnnouncer`.

## Verification

Use real project commands and a temporary, uncommitted smoke surface that is removed after verification:

1. Install the dependency graph with `nub install` and confirm no pnpm lockfile or workspace file appears.
2. Run `nub run prepare` and confirm generated Nuxt contexts remain intact.
3. Run `nub run type-check` and confirm the explicit imports, CSS-aware Vue files, Reka types, and CVA-inferred props pass.
4. Run `nub run lint:check` and `nub run format:check`.
5. Run `nub run --node build`.
6. Temporarily add a small route that explicitly imports `Button` and renders representative variants, sizes, disabled state, and an `asChild` link. Start the real Nuxt dev server, inspect the rendered DOM and computed classes in a browser, and exercise the native click/disabled behavior. Capture a screenshot for visual confirmation.
7. Remove the temporary route, rerun the non-mutating format check, and leave no showcase or test fixture in the repository.
8. Request `/api/health` from the running server to confirm the existing Effect route still returns `{ "status": "ok" }` after auto-import changes.

No permanent automated test is required for this setup-only slice. The browser smoke surface tests the consumer-visible rendering and the project checks prove the build/type/configuration integration.

## Out of scope

- Product page layout or comparison workflow.
- Theme toggling, persistence, or hydration-safe theme state.
- Additional shadcn components beyond Button.
- `shadcn-nuxt`, `reka-ui/nuxt`, component registries, Storybook, icons, animation packages, or a new testing framework.
- Retheming from `docpenny` or copying code from `npmx.dev`.
