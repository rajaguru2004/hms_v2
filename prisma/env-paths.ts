/**
 * Which .env files load, and in what order.
 *
 * Three places resolve DATABASE_URL — the API (`src/app.module.ts`), the Prisma
 * CLI (`prisma.config.ts`) and the seed scripts (`prisma/load-env.ts`). When
 * they disagree, the symptom is that a command writes to a different database
 * than the one you just inspected, so the order lives here once.
 *
 * dotenv and Nest both take "first file to define a key wins".
 */
export function envFilePaths(nodeEnv = process.env.NODE_ENV): string[] {
  // Tests get `.env.test` and nothing else. The general order puts `.env.local`
  // first, which meant a test run resolved the *development* database — and the
  // suite truncates every table in `beforeEach`. One developer's `.env.local`
  // away from being a production incident.
  if (nodeEnv === 'test') {
    return ['.env.test'];
  }

  return ['.env.local', `.env.${nodeEnv ?? 'development'}`, '.env'];
}
