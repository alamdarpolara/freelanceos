import { defineConfig } from 'drizzle-kit';
import { databaseUrl } from './src/config/environment.js';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl(process.env, 'MIGRATION_DATABASE_URL') },
  migrations: { prefix: 'index', schema: 'drizzle', table: '__drizzle_migrations' },
  breakpoints: true,
  strict: true,
  verbose: false,
});
