import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: fileURLToPath(new URL('../../shared/db/evidenceSchema.ts', import.meta.url)),
  out: fileURLToPath(new URL('./drizzle/', import.meta.url)),
});
