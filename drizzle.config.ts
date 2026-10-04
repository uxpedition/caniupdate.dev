import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './shared/db/briefingSchema.ts',
  out: './drizzle',
});
