/**
 * Where the database actually is, and whether we are allowed to touch it.
 *
 * This repository ships a tracked `.env` whose DATABASE_URL points at a remote
 * production host, and every env loader falls through to it when nothing
 * earlier defines the key. So "I forgot to write .env.local" and "I am about to
 * write to production" are the same mistake, and it is silent. These helpers
 * are the one place that turns it into an error.
 *
 * Shared deliberately: the seeds guard themselves through `prisma/load-env.ts`
 * and the API guards itself in `PrismaService.onModuleInit`. Two copies of this
 * list would eventually disagree, and the one that disagreed would be the one
 * protecting the destructive path.
 */

/**
 * Hosts that are safe to seed, reset and truncate.
 *
 * Includes the docker-compose service names because the API also runs inside
 * the compose network, where `postgres` is as local as `localhost` is outside
 * it.
 */
export const LOCAL_DB_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'db',
  'hms_v2_postgres',
  'hms_v2_postgres_local',
  'hms_v2_postgres_test',
  'host.docker.internal',
]);

export interface DatabaseTarget {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  /** `host:port/database` — what the startup log prints. */
  readonly label: string;
  readonly isLocal: boolean;
}

/**
 * Parses a connection URL into the parts a human needs to recognise it.
 *
 * Never throws and never includes credentials: this is called from logging and
 * from error messages, and a guard that leaks a password into a stack trace has
 * traded one incident for another.
 */
export function describeDatabaseUrl(url: string | undefined): DatabaseTarget {
  if (!url) {
    return {
      host: 'unset',
      port: '',
      database: '',
      label: 'unset',
      isLocal: false,
    };
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//, '') || 'unknown';

    return {
      host,
      port,
      database,
      label: `${host}:${port}/${database}`,
      isLocal: LOCAL_DB_HOSTS.has(host),
    };
  } catch {
    return {
      host: 'unparseable',
      port: '',
      database: '',
      label: 'unparseable-url',
      isLocal: false,
    };
  }
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  return describeDatabaseUrl(url).isLocal;
}

export interface AssertLocalOptions {
  /** What the caller is about to do, for the error message. */
  readonly operation?: string;
  /** Honour ALLOW_REMOTE_DB=1. Seeds and startup both do; tests do not. */
  readonly allowRemote?: boolean;
  readonly onBypass?: (target: DatabaseTarget) => void;
}

/**
 * Throws unless DATABASE_URL names a local database.
 *
 * The escape hatch is deliberate and loud: CI against an ephemeral database is
 * a real case, and a guard with no override is a guard people delete.
 */
export function assertLocalDatabaseUrl(
  url: string | undefined,
  options: AssertLocalOptions = {},
): DatabaseTarget {
  const {
    operation = 'this operation',
    allowRemote = true,
    onBypass,
  } = options;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Create hms_v2/.env.local (see .env.example) before running ' +
        `${operation}.`,
    );
  }

  const target = describeDatabaseUrl(url);

  if (allowRemote && process.env.ALLOW_REMOTE_DB === '1') {
    onBypass?.(target);
    return target;
  }

  if (!target.isLocal) {
    throw new Error(
      [
        '',
        `🛑 Refusing to run ${operation} against a non-local database.`,
        '',
        `   Resolved host : ${target.host}`,
        `   Database      : ${target.database}`,
        `   Expected host : one of ${[...LOCAL_DB_HOSTS].join(', ')}`,
        '',
        '   The tracked `.env` points at a production host and every env loader',
        '   falls through to it. Pin DATABASE_URL in hms_v2/.env.local to your',
        '   local Postgres, or set ALLOW_REMOTE_DB=1 if you genuinely mean it.',
        '',
      ].join('\n'),
    );
  }

  return target;
}

/**
 * The stricter check that guards TRUNCATE.
 *
 * A local host is not enough here. `.env.local` and `.env.test` are both local
 * and the loaders resolve `.env.local` first, so a test run could — and before
 * this guard, did — truncate the development database. The database *name* is
 * what separates the two, so that is what this checks.
 */
export function assertTruncatableDatabaseUrl(
  url: string | undefined,
): DatabaseTarget {
  const target = assertLocalDatabaseUrl(url, {
    operation: 'a full database truncation',
    allowRemote: false,
  });

  if (!/_test$/.test(target.database)) {
    throw new Error(
      [
        '',
        '🛑 Refusing to truncate a database whose name does not end in `_test`.',
        '',
        `   Resolved database : ${target.database}`,
        '',
        '   Run the suite with NODE_ENV=test so `.env.test` wins the env load',
        '   order and points at hms_v2_test (docker-compose.local.yml, profile',
        '   `test`, port 5433).',
        '',
      ].join('\n'),
    );
  }

  return target;
}
