import { defineConfig } from 'prisma/config';
import * as dotenv from 'dotenv';

// Load order must match ConfigModule in src/app.module.ts and prisma/load-env.ts:
// .env.local (gitignored) → .env.<NODE_ENV> → .env. Without this, the Prisma CLI
// falls back to .env, which points at a remote production host.
dotenv.config({
  path: ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
});

/**
 * Prisma 7+ configuration file.
 * DATABASE_URL is read from environment by Prisma CLI automatically.
 *
 * For local development, ensure DATABASE_URL is set in .env.development
 * or export it before running prisma commands.
 *
 * Note: This file is NOT compiled by NestJS — it's only used by Prisma CLI.
 * The PrismaService in src/ connects using DATABASE_URL env var via PrismaClient constructor.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
