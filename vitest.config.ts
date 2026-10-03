import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nuxt supplies this compile-time flag to server modules in development; Vitest otherwise leaves it undefined.
  define: { 'import.meta.dev': 'true' },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['{app,server,shared,scripts,workers}/**/*.unit.ts'],
  },
});
