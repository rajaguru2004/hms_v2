import { registerAs } from '@nestjs/config';

/**
 * Database configuration.
 * Uses Prisma — so only DATABASE_URL needed.
 * Additional pool settings exposed for PrismaService tuning.
 */
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10),
  poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
  poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
}));
