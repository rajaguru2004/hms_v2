import { registerAs } from '@nestjs/config';

/**
 * Redis configuration.
 * Used by CacheModule and BullMQ (jobs) if added later.
 */
export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  ttl: parseInt(process.env.REDIS_TTL || '300', 10), // seconds
  db: parseInt(process.env.REDIS_DB || '0', 10),
}));
