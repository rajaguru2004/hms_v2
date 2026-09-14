import { defineConfig } from 'prisma/config';
import * as dotenv from 'dotenv';

import { envFilePaths } from './prisma/env-paths';

// The load order is shared with ConfigModule in src/app.module.ts and with
// prisma/load-env.ts. Without it the Prisma CLI falls back to `.env` alone,
// which points at a remote production host.
dotenv.config({ path: envFilePaths() });

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
