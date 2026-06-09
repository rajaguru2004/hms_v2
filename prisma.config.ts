import { defineConfig } from 'prisma/config';

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
});
