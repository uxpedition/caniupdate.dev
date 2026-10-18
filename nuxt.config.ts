import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

import { parseBuildIdentity } from './shared/site/buildIdentity';
import { parseSiteOrigin } from './shared/site/siteUrl';

const buildIdentity = parseBuildIdentity(
  process.env['NUXT_BUILD_COMMIT_SHA'],
  process.env['NUXT_BUILD_REPOSITORY_URL'],
);

// Builds never embed the origin: each runtime reads `NUXT_PUBLIC_SITE_URL`; an empty value emits no canonical link.
// A non-empty value is validated here so `nuxt dev` and `nuxt build` fail at startup, not on every page render.

const rawSiteUrl = process.env['NUXT_PUBLIC_SITE_URL'] ?? '';

const siteOrigin = parseSiteOrigin(rawSiteUrl);

if (rawSiteUrl !== '' && !siteOrigin.ok) throw new Error(`NUXT_PUBLIC_SITE_URL ${siteOrigin.reason}`);

export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  appConfig: { buildIdentity },
  runtimeConfig: {
    otelEndpoint: '',
    otelHeaders: {},
    // Deployment derives this from its validated target; local/demo runtimes stay noindex by default.
    indexingEnabled: false,
    public: {
      // Public by design: canonical, social, and later sitemap URLs. Builds never bake it: each deployed Worker and
      // dev runtime supplies `NUXT_PUBLIC_SITE_URL` at runtime, and an unset value emits no canonical link.
      siteUrl: '',
      // A production version is runtime identity from the validated release receipt, never part of the build artifact.
      releaseVersion: '',
      telemetryEnabled: false,
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    },
  },
  experimental: {
    // Firefox can preload modules from HTTP Link headers before the entry import map is registered.
    entryImportMap: false,
    // Shared edge caches must serve literal metadata regardless of the warming request's user agent.
    // Streaming sends page head tags as JS patches; crawler exclusion only applies on an origin miss.
    ssrStreaming: false,
  },
  devtools: { enabled: true },
  ignore: ['**/*.unit.ts'],
  pages: {
    pattern: ['**/*.vue'],
  },
  nitro: {
    // Keep Nitro's sanitized error responder. Nuxt's Vue error fetch drops Cloudflare
    // context and would replace the original error with a protection-unavailable 503.
    errorHandler: [],
    ignore: ['**/*.unit.ts', '**/_internals/**'],
    preset: 'cloudflare_module',
    hooks: {
      'rollup:before'(nitro, config) {
        if (nitro.options.preset === 'cloudflare-module' && !nitro.options.dev) {
          config.input = fileURLToPath(new URL('./server/telemetry/workerEntry.ts', import.meta.url));
        }
      },
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      dev: { configPath: 'wrangler.jsonc', persistDir: '.wrangler/state/v3' },
    },
  },
  css: ['~/assets/css/main.css'],
  modules: [
    [
      '@nuxt/fonts',
      {
        families: [{ name: 'DM Sans', provider: 'fontsource', preload: true }],
        defaults: {
          weights: ['400 700'],
          styles: ['normal'],
          subsets: ['latin'],
        },
      },
    ],
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  imports: {
    autoImport: false,
  },
  components: {
    dirs: [],
  },
  hooks: {
    'prepare:types'({ nodeTsConfig }) {
      nodeTsConfig.include ??= [];
      nodeTsConfig.include.push(
        fileURLToPath(new URL('./scripts/**/*.ts', import.meta.url)),
        fileURLToPath(new URL('./test/**/*.ts', import.meta.url)),
        fileURLToPath(new URL('./shared/site/*.d.ts', import.meta.url)),
      );
    },
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
});
