import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
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
    ignore: ['**/*.unit.ts'],
    preset: 'cloudflare_module',
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
