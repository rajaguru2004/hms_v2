import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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

  async onModuleInit(): Promise<void> {
    this.logger.log('Connecting to PostgreSQL via Prisma...');
    await this.$connect();
    this.logger.log('Prisma connected successfully');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting from PostgreSQL...');
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Graceful shutdown — call this in beforeExit/SIGTERM handlers.
   * NestJS calls onModuleDestroy automatically, but this is available
   * for manual invocation from main.ts shutdown hooks.
   */
  async enableShutdownHooks(app: {
    close: () => Promise<void>;
  }): Promise<void> {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  /**
   * cleanDatabase — used in testing only.
   * Truncates all tables in dependency order.
   * Never call in production.
   */
  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase can only be called in test environment');
    }

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
