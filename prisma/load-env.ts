import * as dotenv from 'dotenv';

import { assertLocalDatabaseUrl } from '../src/common/utils/database-url.util';
import { envFilePaths } from './env-paths';

/**
 * Environment loader for Prisma CLI tooling (seed, catalog, demo scripts).
 *
 * The order lives in `./env-paths`, shared with ConfigModule in
 * src/app.module.ts and with prisma.config.ts, so the API and the Prisma
 * tooling always resolve the same DATABASE_URL.
 */
dotenv.config({ path: envFilePaths() });

/**
 * Refuses to run a destructive operation against a non-local database.
 *
 * The host list and the error copy live in
 * `src/common/utils/database-url.util.ts`, which the API's startup guard uses
 * too — one list, so the seeds and the server can never disagree about what
 * "local" means.
 *
 * Set ALLOW_REMOTE_DB=1 to deliberately override (CI against an ephemeral DB).
 */
export function assertLocalDatabase(): void {
  const target = assertLocalDatabaseUrl(process.env.DATABASE_URL, {
    operation: 'a destructive database operation',
    onBypass: () =>
      console.warn('⚠️  ALLOW_REMOTE_DB=1 — host guard bypassed deliberately.'),
  });

  console.log(`✅ Database host verified as local: ${target.label}`);
}
