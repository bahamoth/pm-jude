import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/store/schema.ts',
  out: './src/store/migrations',
  dbCredentials: {
    url: process.env.PMJUDE_DB_PATH ?? './data/pm-jude.db',
  },
});
