# Accessibility Checklist

Quick reference for WCAG 2.1 AA checks. Use alongside the local [`frontend-ui-engineering`](../skills/frontend-ui-engineering/SKILL.md) skill when present, and apply the criteria relevant to the product and platform.

## Table of Contents

- [Essential Checks](#essential-checks)
- [Common HTML Patterns](#common-html-patterns)
- [Testing Tools](#testing-tools)
- [Quick Reference: ARIA Live Regions](#quick-reference-aria-live-regions)
- [Common Anti-Patterns](#common-anti-patterns)

## Essential Checks

### Keyboard Navigation

- [ ] All interactive elements are reachable by keyboard (normally Tab)
- [ ] Focus order follows visual and logical order
- [ ] Focus is visible (outline/ring on focused elements)
- [ ] Custom widgets support appropriate keyboard operation (for example Enter to activate and Escape to close)
- [ ] No keyboard traps: a user can always leave a component
- [ ] A skip-to-content link appears at the top of the page and becomes visible on keyboard focus
- [ ] Modals manage focus while open and return focus to the invoking control on close

### Screen Readers

- [ ] Every informative image has meaningful `alt` text; decorative images use `alt=""`
- [ ] Every form input has an associated label (`<label>` or an appropriate accessible name)
- [ ] Buttons and links have descriptive names, not generic text such as “Click here”
- [ ] Icon-only buttons have an accessible name such as `aria-label`
- [ ] Page has one top-level `<h1>` and headings do not skip levels
- [ ] Dynamic content changes are announced when needed (for example with `aria-live`)
- [ ] Data tables use `<th>` headers with appropriate `scope`

### Visual

- [ ] Text contrast is at least 4.5:1 for normal text or 3:1 for large text (18px+)
- [ ] UI components have at least 3:1 contrast against their background
- [ ] Color is not the only way to convey information
- [ ] Text can be resized to 200% without loss of content or functionality
- [ ] No content flashes more than 3 times per second

### Forms

- [ ] Every input has a visible label
- [ ] Required fields are indicated by more than color alone
- [ ] Error messages are specific and programmatically associated with the field
- [ ] Error state is visible through more than color (for example icon, text, or border)
- [ ] Submission errors are summarized and the summary can receive focus
- [ ] Known fields use suitable autocomplete tokens (for example `type="email" autocomplete="email"`)

### Content

- [ ] Page language is declared (for example `<html lang="en">`)
- [ ] Page has a descriptive `<title>`
- [ ] Links are distinguishable from surrounding text by more than color alone
- [ ] Touch targets are at least 44×44 CSS pixels on mobile, unless an applicable exception applies
- [ ] Empty states communicate what happened and what the user can do, rather than showing a blank screen

## Common HTML Patterns

### Buttons vs. Links

```html
<!-- Use <button> for actions -->
<button onClick="{handleDelete}">Delete Task</button>

<!-- Use <a> for navigation -->
<a href="/tasks/123">View Task</a>

<!-- A generic div/span is not a substitute for a button -->
<div onClick="{handleDelete}">Delete</div>
<!-- BAD -->
```

### Form Labels

```html
<!-- Explicit label association -->
<label htmlFor="email">Email address</label>
<input id="email" type="email" required />

<!-- Implicit wrapping -->
<label>
  Email address
  <input type="email" required />
</label>

<!-- Hidden label (visible label preferred) -->
<input type="search" aria-label="Search tasks" />
```

### ARIA Roles

```html
<!-- Navigation -->
<nav aria-label="Main navigation">...</nav>
<nav aria-label="Footer links">...</nav>

<!-- Status messages -->
<div role="status" aria-live="polite">Task saved</div>

<!-- Alert messages -->
<div role="alert">Error: Title is required</div>

<!-- Modal dialogs -->
<dialog aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Delete</h2>
  ...
</dialog>

<!-- Loading states -->
<div aria-busy="true" aria-label="Loading tasks">
  <Spinner />
</div>
```

### Accessible Lists

```html
<ul role="list" aria-label="Tasks">
  <li>
    <input type="checkbox" id="task-1" aria-label="Complete: Buy groceries" />
    <label htmlFor="task-1">Buy groceries</label>
  </li>
</ul>
```

## Testing Tools

First discover the repository's existing accessibility tooling, package manager, test scripts, and supported browsers; use those rather than installing a second toolchain. In a JavaScript project that already provides them, examples include an axe-core programmatic audit or the `pa11y` CLI. Use only the installed/configured tool and its project-approved invocation; do not fetch a tool implicitly. Ordinary accessibility checks follow runtime/repository permissions; cross-model review CLI calls require separate explicit authorization. Use the available browser's accessibility tree or equivalent inspection; do not assume a specific browser vendor or developer-tools integration.

Test with assistive technologies appropriate to supported platforms, for example VoiceOver (macOS), NVDA or JAWS (Windows), and Orca (Linux). Automated checks are useful but do not replace keyboard and screen-reader testing.

## Quick Reference: ARIA Live Regions

| Value                   | Behavior                                           | Use For                              |
| ----------------------- | -------------------------------------------------- | ------------------------------------ |
| `aria-live="polite"`    | Announced at the next suitable pause               | Status updates, saved confirmations  |
| `aria-live="assertive"` | Announced immediately, interrupting current speech | Errors or time-sensitive alerts only |
| `role="status"`         | Implicit polite live region                        | Status messages                      |
| `role="alert"`          | Implicit assertive live region                     | Urgent error messages                |

## Common Anti-Patterns

| Anti-Pattern                                   | Problem                                                                | Fix                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `div` as button                                | Not focusable by default; no keyboard behavior                         | Use `<button>`                                                                |
| Missing `alt` text                             | Informative images are unavailable to screen readers                   | Add descriptive `alt`; use `alt=""` for decorative images                     |
| Color-only states                              | Information is unavailable to people who cannot distinguish the colors | Add icons, text, or patterns                                                  |
| Autoplaying media                              | Disorienting and may not be stoppable                                  | Provide controls and avoid autoplay                                           |
| Custom dropdown with no ARIA/keyboard behavior | Unusable by keyboard or screen-reader users                            | Use native `<select>` or implement the appropriate accessible listbox pattern |
| Removing focus outlines                        | Users cannot see their current position                                | Style visible focus indicators; do not remove them                            |
| Empty links/buttons                            | Control is announced without a useful name                             | Add text or an accessible name                                                |
| `tabindex > 0`                                 | Disrupts natural tab order                                             | Use `tabindex="0"` or `-1` only where needed                                  |
