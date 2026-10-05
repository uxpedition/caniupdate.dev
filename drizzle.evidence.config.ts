import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './shared/db/evidenceSchema.ts',
  out: './drizzle-evidence',
});
