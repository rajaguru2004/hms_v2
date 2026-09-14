import '../prisma/load-env';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * The acceptance check for patient portal identity.
 *
 * The unit spec mocks the repository, so it proves the service decides the
 * right thing and nothing about what the API on port 3000 actually answers —
 * and every property worth having here is a property of the answer. Whether two
 * responses are distinguishable is not something a mock can tell you.
 *
 *   npx ts-node -r tsconfig-paths/register test/verify-patient-auth.ts
 *
 * Requires `npm run db:seed` and a server on port 3000.
 *
 * Four things are on trial:
 *
 *   1. `POST /patient-auth/claim` answers a real MRN and a made-up one the
 *      same way. If it does not, one patient card enumerates the hospital.
 *   2. Every attempt leaves a row naming the MRN that was tried, so a run of
 *      failures is a query rather than an invisible event.
 *   3. A claim activates exactly once.
 *   4. A patient asking for another patient's id gets their own record or a
 *      refusal — never the other patient's.
 *
 * `POST /patient-auth/claim` is rate limited to 5 per minute by default, so
 * this script spends four of them. Re-running inside the same minute will hit
 * the limit; that is reported as a throttle, not as a failure of the contract.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000/api';

// ── The contract, as types ───────────────────────────────────────────────────

interface Envelope<T> {
  success?: boolean;
  message?: string;
  errorCode?: string;
  data?: T;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

interface ClaimResponse {
  claimToken: string;
  expiresAt: string;
  expiresInSeconds: number;
}

interface PatientRow {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

interface RoleRow {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
}

interface PortalState {
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  portal: {
    isLinked: boolean;
    userId: string | null;
    email: string | null;
    activatedAt: string | null;
  };
}

interface JwtClaims {
  sub: string;
  roles?: string[];
  organizationId?: string;
  patientId?: string;
}

// ── Tiny harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Res<T> {
  status: number;
  body: Envelope<T>;
  /** Milliseconds on the wire — the claim endpoint is judged on this too. */
  elapsedMs: number;
  contentType: string;
}

/**
 * Retries a refused connection rather than failing the run: in development the
 * API runs under `nest start --watch`, so any edit restarts it. Only connection
 * errors are retried — an HTTP status is an answer and is returned as-is.
 */
async function call<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Res<T>> {
  let res: Response | undefined;
  let lastError: unknown;
  let startedAt = 0;

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      startedAt = Date.now();
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      break;
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }

  if (!res) throw lastError;

  const elapsedMs = Date.now() - startedAt;
  const text = await res.text();
  let body: Envelope<T> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Envelope<T>;
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }

  return {
    status: res.status,
    body,
    elapsedMs,
    contentType: res.headers.get('content-type') ?? '',
  };
}

function decodeClaims(token: string): JwtClaims {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtClaims;
}

async function login(email: string, password: string): Promise<string | null> {
  const res = await call<TokenPair>('POST', '/auth/login', {
    body: { email, password },
  });
  return res.body.data?.accessToken ?? null;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN = Date.now();
const DOB = '1988-03-11';

/**
 * An MRN that cannot exist. Shaped like a real one so the only thing separating
 * it from a hit is whether the row is there — if the format itself were
 * obviously wrong, validation would answer before the lookup did and the
 * comparison would prove nothing.
 */
const ABSENT_MRN = `MRN${RUN.toString().slice(-8)}0000`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main(): Promise<void> {
  console.log(`\x1b[1mPatient portal identity\x1b[0m  →  ${BASE}`);

  // ── Setup ─────────────────────────────────────────────────────────────────
  section('setup');

  const adminToken = await login(
    process.env.SEED_ADMIN_EMAIL ?? 'admin@hms.local',
    process.env.SEED_ADMIN_PASSWORD ?? 'Admin@HMS2024!',
  );
  check('an administrator can sign in', Boolean(adminToken));
  if (!adminToken) return;

  const created: PatientRow[] = [];
  for (const who of ['Alpha', 'Beta']) {
    const res = await call<PatientRow>('POST', '/patients', {
      token: adminToken,
      body: {
        firstName: who,
        lastName: `Portal${RUN}`,
        dateOfBirth: DOB,
        gender: 'female',
        phonePrimary: '+251911000000',
      },
    });
    if (res.body.data) created.push(res.body.data);
  }

  check(
    'two patient records exist to test against',
    created.length === 2,
    `created ${created.length}`,
  );
  if (created.length !== 2) return;

  const [alpha, beta] = created;
  console.log(`  alpha ${alpha.mrn} · beta ${beta.mrn}`);

  // ── 1. The MRN oracle ─────────────────────────────────────────────────────
  //
  // Three claims: two against a real MRN and one against an MRN that does not
  // exist. The good/good pair establishes what legitimately varies between two
  // identical requests; anything that varies between good and bad but *not*
  // between good and good is a signal about whether the record exists.
  section('claim answers the same whether or not the MRN exists');

  const goodOne = await call<ClaimResponse>('POST', '/patient-auth/claim', {
    body: { mrn: alpha.mrn, dateOfBirth: DOB },
  });
  const goodTwo = await call<ClaimResponse>('POST', '/patient-auth/claim', {
    body: { mrn: alpha.mrn, dateOfBirth: DOB },
  });
  const bad = await call<ClaimResponse>('POST', '/patient-auth/claim', {
    body: { mrn: ABSENT_MRN, dateOfBirth: DOB },
  });

  if ([goodOne, goodTwo, bad].some((r) => r.status === 429)) {
    console.log(
      '  \x1b[33m•\x1b[0m the claim endpoint is rate limiting this run — ' +
        'wait a minute and try again (the limit is the feature)',
    );
    return;
  }

  check(
    'a real MRN and an absent one return the same status',
    goodOne.status === bad.status && goodOne.status === 200,
    `${goodOne.status} vs ${bad.status}`,
  );

  check(
    'both return the same content type',
    goodOne.contentType === bad.contentType,
    `${goodOne.contentType} vs ${bad.contentType}`,
  );

  const goodKeys = Object.keys(goodOne.body.data ?? {}).sort();
  const badKeys = Object.keys(bad.body.data ?? {}).sort();
  check(
    'both return the same fields',
    goodKeys.join(',') === badKeys.join(',') && goodKeys.length > 0,
    `${goodKeys.join(',')} vs ${badKeys.join(',')}`,
  );

  check(
    'both carry the same envelope message and no error code',
    goodOne.body.message === bad.body.message &&
      goodOne.body.errorCode === bad.body.errorCode,
    `${String(goodOne.body.message)} vs ${String(bad.body.message)}`,
  );

  const goodToken = goodOne.body.data?.claimToken ?? '';
  const badToken = bad.body.data?.claimToken ?? '';
  check(
    'an absent MRN still gets a token, of the same length',
    badToken.length > 0 && badToken.length === goodToken.length,
    `${goodToken.length} vs ${badToken.length}`,
  );

  check(
    'the tokens differ from each other, as random values should',
    goodToken !== badToken && goodToken !== goodTwo.body.data?.claimToken,
  );

  check(
    'both expire after the same interval',
    goodOne.body.data?.expiresInSeconds === bad.body.data?.expiresInSeconds,
    `${String(goodOne.body.data?.expiresInSeconds)} vs ${String(bad.body.data?.expiresInSeconds)}`,
  );

  const leaks = JSON.stringify(goodOne.body).toLowerCase();
  check(
    'the response never echoes the MRN or the name it matched',
    !leaks.includes(alpha.mrn.toLowerCase()) &&
      !leaks.includes('alpha') &&
      !leaks.includes(`portal${RUN}`.toLowerCase()),
  );

  // Timing is the signal a response body cannot hide. The bound is deliberately
  // loose — this runs on a developer's machine next to a watch-mode compiler,
  // so a tight threshold would fail for reasons that have nothing to do with
  // the API. What it catches is the shape that matters: a miss that skips work
  // a hit does, or vice versa, and comes back several times faster.
  const spread = Math.abs(goodOne.elapsedMs - goodTwo.elapsedMs);
  const gap = Math.abs(goodOne.elapsedMs - bad.elapsedMs);
  check(
    'a miss takes about as long as a hit',
    gap <= Math.max(spread * 4, 150),
    `hit ${goodOne.elapsedMs}ms / hit ${goodTwo.elapsedMs}ms / miss ${bad.elapsedMs}ms`,
  );

  // ── 2. Every attempt is on the record ─────────────────────────────────────
  //
  // Read straight from Postgres: there is no API that lists claims, and there
  // should not be. This is the half of the design the HTTP responses are built
  // to hide — the response says nothing, and the row says everything.
  section('every attempt leaves a row, including the failures');

  const absentRow = await prisma.patientPortalClaim.findFirst({
    where: { mrnAttempted: ABSENT_MRN },
  });
  check(
    'an MRN that matched nothing is still recorded',
    absentRow !== null,
    `looked for ${ABSENT_MRN}`,
  );
  check(
    'and is recorded as matching no patient',
    absentRow?.patientId === null,
    `patientId ${String(absentRow?.patientId)}`,
  );

  const storedGood = await prisma.patientPortalClaim.findFirst({
    where: { mrnAttempted: alpha.mrn },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'a matching MRN is recorded against the record it found',
    storedGood?.patientId === alpha.id,
  );
  check(
    'the token itself is never stored',
    storedGood !== null &&
      storedGood.tokenHash !== goodToken &&
      /^[0-9a-f]{64}$/.test(storedGood.tokenHash),
    `tokenHash ${storedGood?.tokenHash.slice(0, 12) ?? 'none'}…`,
  );

  // ── 3. Activation ─────────────────────────────────────────────────────────
  section('a claim activates exactly once');

  const email = `portal.alpha.${RUN}@hms.local`;
  const password = 'Portal@12345';

  const madeUp = await call<unknown>('POST', '/patient-auth/activate', {
    body: { claimToken: 'x'.repeat(43), password, email },
  });
  const dud = await call<unknown>('POST', '/patient-auth/activate', {
    body: { claimToken: badToken, password, email },
  });

  check(
    'a token for an absent MRN fails exactly as an invented token does',
    madeUp.status === dud.status &&
      madeUp.body.errorCode === dud.body.errorCode &&
      madeUp.body.message === dud.body.message,
    `${madeUp.status}/${String(madeUp.body.errorCode)} vs ${dud.status}/${String(dud.body.errorCode)}`,
  );

  const activated = await call<TokenPair>('POST', '/patient-auth/activate', {
    body: { claimToken: goodToken, password, email },
  });
  check(
    'a real claim activates',
    activated.status === 200 && Boolean(activated.body.data?.accessToken),
    `${activated.status} ${String(activated.body.message)}`,
  );

  const replay = await call<TokenPair>('POST', '/patient-auth/activate', {
    body: { claimToken: goodToken, password, email: `replay.${email}` },
  });
  check(
    'the same claim cannot be activated twice',
    replay.status >= 400 && !replay.body.data,
    `${replay.status} ${String(replay.body.errorCode)}`,
  );

  const portalToken = activated.body.data?.accessToken;
  if (!portalToken) return;

  // ── 4. The token carries the record ───────────────────────────────────────
  section('a patient token knows which patient it is');

  check(
    'the token issued by activation carries patientId',
    decodeClaims(portalToken).patientId === alpha.id,
    `got ${String(decodeClaims(portalToken).patientId)}`,
  );
  check(
    'and carries the PATIENT role',
    decodeClaims(portalToken).roles?.includes('PATIENT') === true,
  );

  // The point of resolving patientId inside generateTokenPair: the ordinary
  // login path has to agree with the activation path, or a patient loses their
  // own record the first time they sign in again.
  const relogged = await login(email, password);
  check('the new account can sign in through /auth/login', Boolean(relogged));
  check(
    'a token from /auth/login carries the same patientId',
    relogged !== null && decodeClaims(relogged).patientId === alpha.id,
    relogged ? `got ${String(decodeClaims(relogged).patientId)}` : 'no token',
  );

  const refreshed = await call<TokenPair>('POST', '/auth/refresh', {
    body: { refreshToken: activated.body.data?.refreshToken },
  });
  check(
    'and so does a token from /auth/refresh',
    refreshed.body.data?.accessToken !== undefined &&
      decodeClaims(refreshed.body.data.accessToken).patientId === alpha.id,
    `status ${refreshed.status}`,
  );

  // ── 5. Self-scoping ───────────────────────────────────────────────────────
  section('a patient can only ever reach their own record');

  const mine = await call<PortalState>('GET', '/patient-auth/me', {
    token: portalToken,
  });
  check(
    'the portal returns the caller’s own record',
    mine.status === 200 && mine.body.data?.patient.id === alpha.id,
    `${mine.status} ${String(mine.body.data?.patient.mrn)}`,
  );
  check(
    'and reports it as linked to a portal account',
    mine.body.data?.portal.isLinked === true &&
      Boolean(mine.body.data?.portal.userId),
  );

  // The attack: ask for somebody else by id. Either answer is acceptable —
  // their own record, or a refusal — but beta's record is not.
  const asBeta = await call<PortalState>(
    'GET',
    `/patient-auth/me?patientId=${beta.id}`,
    { token: portalToken },
  );
  check(
    'asking for another patient by id never returns that patient',
    asBeta.body.data?.patient.id !== beta.id &&
      asBeta.body.data?.patient.mrn !== beta.mrn,
    `${asBeta.status} ${String(asBeta.body.data?.patient.mrn)}`,
  );
  check(
    'it returns the caller’s own record, or refuses',
    (asBeta.status === 200 && asBeta.body.data?.patient.id === alpha.id) ||
      asBeta.status === 403 ||
      asBeta.status === 404,
    `${asBeta.status} ${String(asBeta.body.data?.patient.id)}`,
  );

  // And the same id against the staff route, which the portal role has no
  // permission for at all — the guard is the second line, not the only one.
  const viaPatients = await call<PatientRow>('GET', `/patients/${beta.id}`, {
    token: portalToken,
  });
  check(
    'a patient cannot read another record through /patients/:id either',
    viaPatients.status === 403 || viaPatients.status === 401,
    `status ${viaPatients.status}`,
  );

  // ── 6. Staff are not caught by any of this ────────────────────────────────
  section('staff still work the way they did');

  const staffView = await call<PortalState>(
    'GET',
    `/patient-auth/me?patientId=${beta.id}`,
    { token: adminToken },
  );
  check(
    'an administrator reads the patient they asked for',
    staffView.status === 200 && staffView.body.data?.patient.id === beta.id,
    `${staffView.status} ${String(staffView.body.data?.patient.mrn)}`,
  );
  check(
    'and sees that record as unclaimed',
    staffView.body.data?.portal.isLinked === false,
  );

  // ── 7. The seeded demo account ────────────────────────────────────────────
  //
  // `npm run db:reset:demo` has to produce a portal login that works, or the
  // first thing anyone tries after a reset is the thing that is broken.
  section('the seeded demo account works end to end');

  const demoToken = await login('patient@hms.local', 'Demo@HMS2024!');
  check('patient@hms.local can sign in', Boolean(demoToken));

  if (demoToken) {
    check(
      'the seeded patient token carries patientId',
      Boolean(decodeClaims(demoToken).patientId),
      `got ${String(decodeClaims(demoToken).patientId)}`,
    );

    const demoMe = await call<PortalState>('GET', '/patient-auth/me', {
      token: demoToken,
    });
    check(
      'and resolves to the seeded record',
      demoMe.status === 200 &&
        demoMe.body.data?.patient.mrn === 'MRN-PORTAL-0001',
      `${demoMe.status} ${String(demoMe.body.data?.patient.mrn)}`,
    );
  }

  // ── 8. A patient account with nothing behind it ───────────────────────────
  //
  // The branch that matters most and is hardest to reach by accident: a User
  // holding the PATIENT role whose `Patient.userId` was never set. The wrong
  // answer is to fall back to some record; the right one is to refuse.
  section('a patient account with no record is refused, not defaulted');

  const rolesRes = await call<RoleRow[]>('GET', '/roles', {
    token: adminToken,
  });
  const patientRole = (rolesRes.body.data ?? []).find(
    (r) => r.name === 'PATIENT',
  );

  const orphanEmail = `orphan.${RUN}@hms.local`;
  const orphan = await call<UserRow>('POST', '/users', {
    token: adminToken,
    body: {
      email: orphanEmail,
      password,
      firstName: 'Orphan',
      lastName: 'Portal',
      role: 'PATIENT',
    },
  });

  if (patientRole && orphan.body.data?.id) {
    await call<unknown>('POST', `/roles/${patientRole.id}/users`, {
      token: adminToken,
      body: { userId: orphan.body.data.id },
    });

    const orphanToken = await login(orphanEmail, password);
    check('the unlinked account can sign in', Boolean(orphanToken));

    if (orphanToken) {
      check(
        'its token carries no patientId',
        decodeClaims(orphanToken).patientId === undefined,
        `got ${String(decodeClaims(orphanToken).patientId)}`,
      );

      const orphanMe = await call<PortalState>('GET', '/patient-auth/me', {
        token: orphanToken,
      });
      check(
        'and the portal refuses it rather than guessing a record',
        orphanMe.status === 403 &&
          orphanMe.body.errorCode === 'PATIENT_PORTAL_NOT_LINKED',
        `${orphanMe.status} ${String(orphanMe.body.errorCode)}`,
      );
      check(
        'no patient data comes back with the refusal',
        orphanMe.body.data === undefined,
      );
    }
  } else {
    check(
      'an unlinked patient account could be created to test with',
      false,
      `role ${String(patientRole?.id)} / user ${orphan.status}`,
    );
  }

  // ── 9. A record that already has an account ───────────────────────────────
  section('a record that already has an account says so');

  const reclaim = await call<ClaimResponse>('POST', '/patient-auth/claim', {
    body: { mrn: 'MRN-PORTAL-0001', dateOfBirth: '1990-05-17' },
  });

  if (reclaim.status === 429) {
    console.log(
      '  \x1b[33m•\x1b[0m skipped: the claim endpoint is now rate limiting, ' +
        'which is the throttle doing its job',
    );
  } else {
    check(
      'claiming an already-claimed record still answers identically',
      reclaim.status === 200 && Boolean(reclaim.body.data?.claimToken),
      `status ${reclaim.status}`,
    );

    const reactivate = await call<TokenPair>('POST', '/patient-auth/activate', {
      body: {
        claimToken: reclaim.body.data?.claimToken,
        password: 'Another@12345',
        email: `dup.${RUN}@hms.local`,
      },
    });
    check(
      'and only refuses at activation, never at claim',
      reactivate.status === 409 &&
        reactivate.body.errorCode === 'PATIENT_PORTAL_ALREADY_CLAIMED',
      `${reactivate.status} ${String(reactivate.body.errorCode)}`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    failed++;
    failures.push('the run threw');
  })
  .finally(() => {
    void prisma.$disconnect();
    console.log(`\n${'='.repeat(62)}`);
    console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
    if (failures.length) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  • ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
