# Nuxt, Nub, Effect, and Ox Tooling Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Nub hello-world starter with a Nub-managed Nuxt application that demonstrates Effect on the server and enforces `docpenny`'s TypeScript, Oxlint, and Oxfmt policies.

**Architecture:** Use Nuxi through `nub dlx` to generate the root Nuxt application, then use Nub to install dependencies and maintain `nub.lock`. Keep Nuxt's generated TypeScript project references and configure shared compiler checks through `nuxt.config.ts`; adapt only workspace-specific lint/format ignores. Add one `/api/health` server route whose response is produced by `Effect.runSync`.

**Tech Stack:** Nuxt 4, Vue, TypeScript, Nub 0.8.3, Effect, Oxlint, Oxfmt.

**Spec:** `docs/superpowers/specs/2026-09-16-nuxt-nub-effect-tooling-design.md`

## Global Constraints

- Work in the current checkout; do not create a worktree.
- Use Nub for initialization, dependency changes, scripts, installation, and the committed lockfile.
- Initialize with `nub dlx nuxi@latest init . --packageManager=nub --no-install --force`.
- Preserve the project name `can-i-npm-update` and Nub package-manager metadata.
- Do not add pnpm workspace files or pnpm-specific scripts.
- Keep Nuxt's root project-reference `tsconfig.json` and generated `.nuxt/tsconfig.*` files under Nuxt control.
- Copy `docpenny` compiler, Oxlint, and Oxfmt policy; remove only irrelevant `docpenny` workspace ignore paths.
- Treat the Effect endpoint as a setup smoke path, not product behavior.
- Skip permanent automated tests for generated/configuration setup; prove behavior with Nuxt type-check, build, lint/format checks, and a live HTTP smoke request.

---

### Task 1: Scaffold the Nuxt application through Nub

**Files:**
- Create/modify: Nuxi-generated root application files.
- Modify: `package.json`, `tsconfig.json`, `.gitignore`.
- Modify: `nub.lock`.
- Delete: `index.ts`.

**Interfaces:**
- Produces a root Nuxt app with `nuxt.config.ts`, the Nuxt project-reference `tsconfig.json`, and an initial app entrypoint.
- Keeps `package.json#packageManager` as `nub@0.8.3` and the existing package name.

- [ ] **Step 1: Run the Nub-compatible Nuxi initializer**

```bash
nub dlx nuxi@latest init . --packageManager=nub --no-install --force
```

Expected: Nuxi writes a Nuxt starter in the current directory without installing dependencies or initializing another Git repository.

- [ ] **Step 2: Inspect generated metadata and preserve Nub identity**

Read `package.json` and verify:

```json
{
  "name": "can-i-npm-update",
  "packageManager": "nub@0.8.3"
}
```

If Nuxi replaced either value, restore those exact values while retaining the generated Nuxt dependency and scripts. Preserve the existing `devEngines.packageManager` block when it is absent from the generated manifest.

- [ ] **Step 3: Remove the obsolete Nub entrypoint**

Delete `index.ts`; Nuxt now owns application startup and the old `nub index.ts` hello-world command must no longer remain in `package.json`.

- [ ] **Step 4: Add Nuxt output ignores without removing existing project ignores**

Ensure `.gitignore` contains these entries:

```gitignore
.nuxt
.output
.nitro
.data
dist
node_modules
.env*
!.env.example
```

Retain the existing `/npmx.dev/` exclusion.

- [ ] **Step 5: Install the generated dependency graph with Nub**

```bash
nub install
```

Expected: Nub creates/updates `nub.lock` and links the generated Nuxt dependencies without introducing `pnpm-lock.yaml` or a workspace file.

- [ ] **Step 6: Prepare Nuxt’s generated contexts**

```bash
nub run prepare
```

Expected: `.nuxt/tsconfig.app.json`, `.nuxt/tsconfig.server.json`, `.nuxt/tsconfig.shared.json`, and `.nuxt/tsconfig.node.json` exist and the root `tsconfig.json` remains a project-reference entrypoint.

- [ ] **Step 7: Verify the scaffold before adding custom behavior**

```bash
nub run build
```

Expected: the generated Nuxt app builds successfully before the Effect route and copied policy are added.

---

### Task 2: Add Effect integration and Nub scripts

**Files:**
- Modify: `package.json`.
- Modify: `nub.lock`.
- Create: `server/api/health.get.ts`.

**Interfaces:**
- `GET /api/health` returns `{ status: 'ok' }` with HTTP success status.
- The response is produced by a synchronous Effect program, not a direct object literal.

- [ ] **Step 1: Add the Effect runtime dependency**

```bash
nub add effect
```

Expected: `effect` is added under `dependencies` and the lockfile resolves it.

- [ ] **Step 2: Add Nuxt type-check and Ox tooling dependencies**

```bash
nub add -D typescript vue-tsc @types/node oxlint oxfmt
```

Expected: the manifest contains the tools needed by `nuxt typecheck`, Oxlint, and Oxfmt. Keep any Nuxi-generated Nuxt and Vue dependencies.

- [ ] **Step 3: Add the Effect-backed health endpoint**

Create `server/api/health.get.ts`:

```ts
import { Effect } from 'effect'

export default defineEventHandler(() => Effect.runSync(Effect.succeed({ status: 'ok' as const })))
```

Expected: Nuxt auto-registers this file as `GET /api/health`; no extra server plugin or Effect abstraction is introduced.

- [ ] **Step 4: Replace starter scripts with Nub-runnable project commands**

Set `package.json#scripts` to include:

```json
{
  "build": "nuxt build",
  "dev": "nuxt dev",
  "preview": "nuxt preview",
  "prepare": "nuxt prepare",
  "type-check": "nuxt typecheck",
  "lint": "oxlint . --fix",
  "lint:check": "oxlint .",
  "format": "oxfmt . --write",
  "format:check": "oxfmt ."
}
```

Remove the obsolete `start: nub index.ts` script. Do not add a second package-manager command layer; `nub run <script>` is the invocation contract.

- [ ] **Step 5: Regenerate the dependency lockfile**

```bash
nub install
```

Expected: `nub.lock` contains `effect`, `typescript`, `vue-tsc`, `@types/node`, `oxlint`, and `oxfmt` resolutions matching `package.json`.

---

### Task 3: Apply Nuxt-native TypeScript rules from `docpenny`

**Files:**
- Modify: `nuxt.config.ts`.
- Verify without rewriting: `tsconfig.json` and `.nuxt/tsconfig.*`.

**Interfaces:**
- Nuxt generates the four context configurations and continues to provide aliases such as `~`, `#imports`, and `#build`.
- The generated configurations receive the compatible `docpenny` compiler checks through Nuxt configuration.

- [ ] **Step 1: Configure strict type-checking and shared compiler options**

In `nuxt.config.ts`, preserve the generated Nuxt configuration and add this `typescript` block:

```ts
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
```

This copies `docpenny`’s meaningful checks while leaving Nuxt-managed `module`, `moduleResolution`, `types`, `paths`, and context-specific project-reference behavior intact.

- [ ] **Step 2: Preserve Nuxt’s root project-reference file**

Verify the root `tsconfig.json` still has `files: []` and references all four generated configs:

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

Do not replace it with `docpenny`’s standalone compiler-options file.

- [ ] **Step 3: Regenerate and inspect the effective configs**

```bash
nub run prepare
```

Confirm that the generated configs contain the strictness and safety flags above and still contain Nuxt aliases/types needed by the app and server contexts. If Nuxt omits an option that it explicitly manages (`types`, `paths`, or per-context `noEmit`), retain Nuxt’s generated value rather than forcing an incompatible override.

- [ ] **Step 4: Run the type-check command**

```bash
nub run type-check
```

Expected: `vue-tsc` completes with no errors for the generated app and Effect endpoint.

---

### Task 4: Copy and adapt Oxlint/Oxfmt policy

**Files:**
- Create: `.oxlintrc.json`.
- Create: `.oxfmtrc.json`.

**Interfaces:**
- `nub run lint:check` runs Oxlint in type-aware mode with the copied `docpenny` rule set.
- `nub run format:check` runs Oxfmt with the copied formatting policy and no write side effects.

- [ ] **Step 1: Create the adapted Oxlint configuration**

Create `.oxlintrc.json` using the `docpenny` rules and these application-specific ignores:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "import", "unicorn"],
  "ignorePatterns": ["**/.*/**", "node_modules", ".nuxt", ".output", ".nitro", "dist"],
  "options": { "typeAware": true },
  "rules": {
    "no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrors": "none"
      }
    ],
    "typescript/consistent-type-assertions": ["error", { "assertionStyle": "never" }],
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "max-lines": ["error", { "max": 400, "skipBlankLines": true, "skipComments": true }],
    "complexity": ["error", { "max": 10 }],
    "max-lines-per-function": ["warn", { "max": 40, "skipBlankLines": true, "skipComments": true }],
    "max-statements": ["warn", { "max": 15 }],
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-enum-comparison": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-unsafe-unary-minus": "error"
  },
  "overrides": [
    {
      "files": ["**/*.test.ts"],
      "rules": {
        "max-lines": "off",
        "max-lines-per-function": "off",
        "max-statements": "off",
        "typescript/no-floating-promises": "off"
      }
    },
    {
      "files": ["**/*.js", "**/*.mjs", "**/*.cjs"],
      "rules": {
        "typescript/no-floating-promises": "off",
        "typescript/no-misused-promises": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-enum-comparison": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/no-unsafe-unary-minus": "off"
      }
    }
  ]
}
```

- [ ] **Step 2: Create the adapted Oxfmt configuration**

Create `.oxfmtrc.json` with the `docpenny` formatter settings:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "ignorePatterns": ["**/.*/**", "node_modules", ".nuxt", ".output", ".nitro", "dist"],
  "sortImports": true,
  "printWidth": 120,
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "jsxSingleQuote": true
}
```

- [ ] **Step 3: Format the project files**

```bash
nub run format
```

Expected: Oxfmt formats the Nuxt and server files while leaving generated/hidden output ignored.

- [ ] **Step 4: Run the non-mutating lint and format checks**

```bash
nub run lint:check
nub run format:check
```

Expected: both commands pass without changing files. If Oxlint reports a genuine rule violation in the generated starter or health route, fix the source/configuration rather than disabling the copied rule.

---

### Task 5: Verify the complete setup through Nuxt and the live endpoint

**Files:**
- Verify: `package.json`, `nub.lock`, `nuxt.config.ts`, `server/api/health.get.ts`, `.oxlintrc.json`, `.oxfmtrc.json`.
- No permanent test file required; this task uses the real application smoke path.

**Interfaces:**
- The project installs from its Nub manifest/lockfile.
- The Nuxt build, type checker, lint, and formatter all pass.
- The running server returns the Effect-produced health response.

- [ ] **Step 1: Run a lockfile-consistent install**

```bash
nub ci
```

Expected: a clean install succeeds from `package.json` and `nub.lock` without manifest drift.

- [ ] **Step 2: Run all static project checks**

```bash
nub run prepare
nub run type-check
nub run lint:check
nub run format:check
nub run build
```

Expected: every command exits successfully; Nuxt generated types, strict TypeScript, copied Oxlint policy, copied Oxfmt policy, and production compilation all work together.

- [ ] **Step 3: Start Nuxt through Nub**

Start a supervised process with the project script:

```text
nub run dev -- --host 127.0.0.1 --port 3000
```

Wait for Nuxt’s ready message before making the request.

- [ ] **Step 4: Exercise the Effect endpoint**

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

Expected output:

```json
{"status":"ok"}
```

This proves the request reaches Nuxt’s server route and that the route executes the imported Effect runtime.

- [ ] **Step 5: Stop the supervised dev process**

Stop the process after the HTTP smoke request and verify no generated output was accidentally staged. The final deliverable contains only the Nuxt source/configuration, lockfile, and required setup documentation.

---
