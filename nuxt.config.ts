import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

import { parseSiteOrigin } from './shared/siteUrl';

// The origin every absolute URL is built from. A configured value is validated here so a typo fails the run instead of
// shipping a wrong canonical address; `scripts/check-site-url/check-site-url.ts` additionally requires one to exist for a build. An
// unset value is allowed here: local development then emits no canonical link rather than a guessed origin.
const rawSiteUrl = process.env['NUXT_PUBLIC_SITE_URL'] ?? '';
const parsedSiteUrl = parseSiteOrigin(rawSiteUrl);

if (!parsedSiteUrl.ok && rawSiteUrl.trim() !== '') {
  throw new Error(`NUXT_PUBLIC_SITE_URL ${parsedSiteUrl.reason}.`);
}

export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  runtimeConfig: {
    otelEndpoint: '',
    otelHeaders: {},
    public: {
      // Public by design: canonical, social, and later sitemap URLs. The deployed Worker must carry the same value
      // (`wrangler.jsonc`), because the prerendered homepage bakes the build-time value into its HTML.
      siteUrl: parsedSiteUrl.ok ? parsedSiteUrl.origin : '',
      telemetryEnabled: false,
    },
  },
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    },
  },
  experimental: {
    // Firefox can preload modules from HTTP Link headers before the entry import map is registered.
    entryImportMap: false,
    // Stream the shell before the awaited declarations prefetch resolves; Nuxt excludes crawler user agents.
    ssrStreaming: true,
  },
  devtools: { enabled: true },
  ignore: ['**/*.unit.ts'],
  pages: {
    pattern: ['**/*.vue'],
  },
  routeRules: {
    '/': { prerender: true },
  },
  nitro: {
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
