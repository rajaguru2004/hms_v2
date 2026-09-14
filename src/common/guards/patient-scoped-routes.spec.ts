import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * No patient-scoped route may take a parameter called `:id`.
 *
 * `PatientSelfGuard` resolves which patient a request may act on by looking for
 * `patientId` or **`id`** in the params, body and query — and for a PATIENT
 * caller it then *overwrites* those fields with the caller's own patient id, so
 * that an id supplied by the client can never be acted on.
 *
 * That is right for `patientId`. It is a trap for `id`: a route like
 * `GET /patient-documents/:id` has its document id replaced by a patient id
 * before the controller ever sees it, and the owner of the document gets a 404
 * for their own record. Every patient-facing read in the documents module was
 * dead exactly this way, and no unit test could see it, because unit tests call
 * the service and the damage happens in the guard above it.
 *
 * So the convention is that the parameter is named for what it is —
 * `:sessionId`, `:documentId`, `:factId` — and this test is what keeps the
 * convention from being rediscovered the expensive way. It reads the source
 * rather than the Nest metadata deliberately: the failure is a *spelling*, and
 * spelling is what a reader sees.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

/** Controllers that put themselves behind the guard, whatever else they do. */
function patientScopedControllers(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];

  for (const moduleName of readdirSync(MODULES_DIR)) {
    const moduleDir = join(MODULES_DIR, moduleName);
    let entries: string[];
    try {
      entries = readdirSync(moduleDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.controller.ts')) continue;
      const path = join(moduleDir, entry);
      const source = readFileSync(path, 'utf8');
      if (
        source.includes('PatientSelfGuard') ||
        source.includes('@PatientScope')
      ) {
        found.push({ path: `${moduleName}/${entry}`, source });
      }
    }
  }

  return found;
}

/** Route paths out of the `@Get('…')` family, as written. */
function routePathsIn(source: string): string[] {
  const routes = /@(?:Get|Post|Put|Patch|Delete)\(\s*'([^']*)'/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = routes.exec(source)) !== null) paths.push(match[1]);
  return paths;
}

describe('patient-scoped routes', () => {
  const controllers = patientScopedControllers();

  it('finds the controllers that sit behind the guard', () => {
    // A rename that empties this list would make every assertion below pass by
    // vacuum, which is the one way a guard test can lie.
    expect(controllers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(controllers.map((c) => [c.path, c.source]))(
    '%s names its parameters for what they are, never :id',
    (path, source) => {
      const offenders = routePathsIn(source).filter((route) =>
        /:id(\/|$)/.test(route),
      );

      expect(offenders).toEqual([]);
    },
  );
});
