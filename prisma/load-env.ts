import * as dotenv from 'dotenv';

/**
 * Environment loader for Prisma CLI tooling (seed, catalog, demo scripts).
 *
 * Load order — first file to define a key wins:
 *   1. .env.local              — developer-local overrides, gitignored
 *   2. .env.<NODE_ENV>         — per-environment defaults
 *   3. .env                    — last resort
 *
 * This mirrors the `envFilePath` order used by ConfigModule in src/app.module.ts,
 * so the API and the Prisma tooling always resolve the same DATABASE_URL.
 */
dotenv.config({
  path: ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
});

/**
 * Hosts considered safe for destructive operations (seeding, resetting).
 * Includes docker-compose service names so the guard also works inside containers.
 */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'db',
  'hms_v2_postgres',
]);

/**
 * Refuses to run a destructive operation against a non-local database.
 *
 * `hms_v2/.env` points at a remote production host, and NestJS/dotenv fall back
 * to it when nothing else is set. Without this guard, `db:seed` or `db:reset`
 * would silently write to — or destroy — production.
 *
 * Set ALLOW_REMOTE_DB=1 to deliberately override (CI against an ephemeral DB).
 */
export function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Create hms_v2/.env.local (see .env.example) before seeding.',
    );
  }

  if (process.env.ALLOW_REMOTE_DB === '1') {
    console.warn('⚠️  ALLOW_REMOTE_DB=1 — host guard bypassed deliberately.');
    return;
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      [
        '',
        '🛑 Refusing to run a destructive database operation against a non-local host.',
        '',
        `   Resolved host : ${host}`,
        `   Expected      : one of ${[...LOCAL_HOSTS].join(', ')}`,
        '',
        '   Pin DATABASE_URL in hms_v2/.env.local to your local Postgres, or set',
        '   ALLOW_REMOTE_DB=1 if you genuinely intend to target a remote database.',
        '',
      ].join('\n'),
    );
  }

  console.log(`✅ Database host verified as local: ${host}`);
}
