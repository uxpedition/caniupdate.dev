import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  compatibilityDate: '2026-09-16',
  devtools: { enabled: true },
  ignore: ['**/*.unit.ts'],
  pages: {
    pattern: ['**/*.vue'],
  },
  nitro: {
    ignore: ['**/*.unit.ts'],
  },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/fonts'],
  fonts: {
    families: [
      { name: 'DM Sans', provider: 'fontsource' },
      { name: 'Newsreader', provider: 'fontsource' },
    ],
    defaults: {
      weights: ['400 700'],
      styles: ['normal'],
      subsets: ['latin'],
    },
  },
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
});
