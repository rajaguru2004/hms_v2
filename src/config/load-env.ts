import * as dotenv from 'dotenv';

import { envFilePaths } from '../../prisma/env-paths';

/**
 * Populates `process.env` before anything else in the app is imported.
 *
 * `ConfigModule.forRoot()` loads the .env files in the module *body*, but
 * decorators run when their file is first imported — which happens while
 * Node is still resolving `app.module.ts`'s import list, before that body
 * executes. So any decorator argument that reads `process.env` sees nothing and
 * silently falls back to its default.
 *
 * That is not hypothetical: `@Throttle` on the login route read
 * THROTTLE_LOGIN_LIMIT this way and quietly rate-limited at 10/minute no matter
 * what was configured. A limit that ignores its setting is worse than no limit,
 * because it looks deliberate.
 *
 * Imported for its side effect, first, by both `main.ts` and `app.module.ts`.
 * ConfigModule still runs afterwards and remains the way application code reads
 * configuration — this only guarantees the variables exist by then.
 */
dotenv.config({ path: envFilePaths() });
