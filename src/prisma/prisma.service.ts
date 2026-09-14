import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import {
  assertLocalDatabaseUrl,
  assertTruncatableDatabaseUrl,
  describeDatabaseUrl,
} from '../common/utils/database-url.util';

/**
 * PrismaService — enterprise-grade Prisma client wrapper.
 *
 * Responsibilities:
 * - Manages connection lifecycle (connect on init, disconnect on destroy)
 * - Enables graceful shutdown (SIGINT/SIGTERM safe)
 * - Provides soft-delete middleware globally
 * - Provides transaction helper
 *
 * Why extend PrismaClient instead of inject?
 * Extending gives us access to $on, $connect, $disconnect, $transaction
 * without adding an extra wrapper layer. Services receive this class directly.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is missing');
    }
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ],
    });

    // Log slow queries in development
    if (process.env.NODE_ENV === 'development') {
      // @ts-expect-error — Prisma event types are defined at runtime
      this.$on('query', (event: { query: string; duration: number }) => {
        if (event.duration > 1000) {
          this.logger.warn(`Slow query (${event.duration}ms): ${event.query}`);
        }
      });
    }
  }

  private getDbConnectionInfo(): string {
    return describeDatabaseUrl(process.env.DATABASE_URL).label;
  }

  /**
   * Refuses to start against a database that is not local.
   *
   * The seeds have had this guard for a while; the server did not, so
   * `npm run start:dev` with a missing `.env.local` fell through the env chain
   * to the tracked `.env` and connected to production — quietly, because a
   * successful connection looks exactly like a correct one.
   *
   * Production is exempt (that is where a remote host is the point), and
   * ALLOW_REMOTE_DB=1 is the deliberate override.
   */
  private assertSafeTarget(): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    assertLocalDatabaseUrl(process.env.DATABASE_URL, {
      operation: 'the API server',
      onBypass: (target) =>
        this.logger.warn(
          `ALLOW_REMOTE_DB=1 — connecting to the non-local database ${target.label} deliberately.`,
        ),
    });
  }

  async onModuleInit(): Promise<void> {
    this.assertSafeTarget();

    const dbInfo = this.getDbConnectionInfo();
    this.logger.log(
      `Connecting to PostgreSQL database (${dbInfo}) via Prisma...`,
    );
    try {
      await this.$connect();
      // Force connection & credential validation on startup
      await this.$queryRawUnsafe('SELECT 1');
      this.logger.log(`Prisma connected successfully to database (${dbInfo})`);
    } catch (err) {
      this.logger.error(
        `Database connection/authentication failed for (${dbInfo}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const dbInfo = this.getDbConnectionInfo();
    this.logger.log(`Disconnecting from PostgreSQL database (${dbInfo})...`);
    await this.$disconnect();
    this.logger.log(`Prisma disconnected from database (${dbInfo})`);
  }

  /**
   * Graceful shutdown — call this in beforeExit/SIGTERM handlers.
   * NestJS calls onModuleDestroy automatically, but this is available
   * for manual invocation from main.ts shutdown hooks.
   */
  enableShutdownHooks(app: { close: () => Promise<void> }): void {
    process.on('beforeExit', () => {
      app.close().catch((err) => {
        this.logger.error(
          `Failed to close app: ${err instanceof Error ? err.message : err}`,
        );
      });
    });
  }

  /**
   * cleanDatabase — used in testing only. Truncates every table.
   *
   * Three checks, not one. NODE_ENV alone was not enough: the env loaders used
   * to resolve `.env.local` ahead of `.env.test`, so a suite that set
   * NODE_ENV=test still opened the *development* database and truncated it.
   * The database name is the check that actually separates the two.
   */
  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase can only be called in test environment');
    }

    assertTruncatableDatabaseUrl(process.env.DATABASE_URL);

    const tablenames = await this.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public'
    `;

    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
      }
    }
  }
}
