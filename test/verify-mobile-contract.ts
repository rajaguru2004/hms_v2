import '../prisma/load-env';

/**
 * The acceptance check for everything the mobile app depends on.
 *
 * Unit tests mock the database, so they prove the code does what it says and
 * nothing about what the API actually answers. This runs against a live server
 * as each seeded role in turn and asserts the contract the Flutter client is
 * written against: the bootstrap shape, the site settings keys, the per-role
 * access matrix, both pagination dialects, and the auth lifecycle.
 *
 *   npm run verify:mobile
 *
 * Requires `npm run db:seed` + `db:seed:catalog` and a server on port 3000.
 *
 * The response types below are deliberately spelled out rather than left as
 * `any`: this script is the written form of the contract, so the shapes it
 * expects should be readable in one place.
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

interface ModuleAccess {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

interface MeResponse {
  user?: {
    id: string;
    email: string;
    fullName: string;
    roles?: string[];
    permissions?: string[];
  };
  access?: { modules?: Record<string, ModuleAccess> };
  organization?: {
    id: string;
    name: string;
    settings?: {
      locale?: { currency?: string };
      clinical?: { waitBreachMinutes?: number };
    };
  };
}

interface PageMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  // The queue's legacy dialect, kept for the console during the transition.
  currentPage?: number;
  perPage?: number;
  lastPage?: number;
  prev?: number | null;
  next?: number | null;
}

interface Paged<T> {
  data?: T[];
  meta?: PageMeta;
}

interface IdRow {
  id: string;
}

interface QueueRow extends IdRow {
  priority?: string;
}

type SiteSettings = Record<string, string>;

interface JwtClaims {
  sub: string;
  exp: number;
  iat: number;
  organizationId?: string;
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
}

/**
 * Retries a refused connection rather than failing the run.
 *
 * In development the API runs under `nest start --watch`, so any edit restarts
 * it — and a verification that dies on ECONNREFUSED reports a contract failure
 * when all that happened was a recompile. Only connection errors are retried;
 * an HTTP status is an answer and is returned as-is.
 */
async function call<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Res<T>> {
  let res: Response | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
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

  const text = await res.text();
  let body: Envelope<T> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Envelope<T>;
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }
  return { status: res.status, body };
}

function decodeClaims(token: string): JwtClaims {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtClaims;
}

// ── Who we test as ───────────────────────────────────────────────────────────

interface RoleFixture {
  email: string;
  password: string;
  /** Modules this role must be able to read, per prisma/seed.ts. */
  canRead: string[];
  /** Modules this role must NOT be able to read. */
  cannotRead: string[];
}

const DEMO = 'Demo@HMS2024!';

const ROLES: Record<string, RoleFixture> = {
  SUPER_ADMIN: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@hms.local',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@HMS2024!',
    canRead: ['patients', 'queue', 'billing', 'settings', 'roles', 'users'],
    cannotRead: [],
  },
  DOCTOR: {
    email: 'doctor@hms.local',
    password: 'Doctor@HMS2024!',
    canRead: ['patients', 'queue', 'consultations', 'laboratory', 'radiology'],
    cannotRead: ['users', 'roles'],
  },
  NURSE: {
    email: 'nurse@hms.local',
    password: 'Nurse@HMS2024!',
    canRead: ['patients', 'queue', 'pre-triage', 'inpatient'],
    cannotRead: ['billing', 'pharmacy', 'laboratory', 'users'],
  },
  RECEPTIONIST: {
    email: 'receptionist@hms.local',
    password: DEMO,
    canRead: ['patients', 'appointments', 'queue', 'billing'],
    cannotRead: ['consultations', 'laboratory', 'users'],
  },
  PHARMACIST: {
    email: 'pharmacist@hms.local',
    password: DEMO,
    canRead: ['pharmacy', 'patients'],
    cannotRead: ['laboratory', 'billing', 'users'],
  },
  LAB_TECHNICIAN: {
    email: 'lab-tech@hms.local',
    password: DEMO,
    canRead: ['laboratory', 'patients'],
    cannotRead: ['radiology', 'pharmacy', 'users'],
  },
  RADIOLOGIST: {
    email: 'radiologist@hms.local',
    password: DEMO,
    canRead: ['radiology', 'patients'],
    cannotRead: ['laboratory', 'pharmacy', 'users'],
  },
  BILLING_STAFF: {
    email: 'billing@hms.local',
    password: DEMO,
    canRead: ['billing', 'patients'],
    cannotRead: ['laboratory', 'pharmacy', 'users'],
  },
  ADMIN: {
    email: 'admin-staff@hms.local',
    password: DEMO,
    canRead: ['users', 'settings', 'patients'],
    cannotRead: [],
  },
  PATIENT: {
    email: 'patient@hms.local',
    password: DEMO,
    canRead: ['appointments'],
    cannotRead: ['patients', 'billing', 'users'],
  },
};

/** The GET the app actually makes for each module, for the 200-vs-403 matrix. */
const MODULE_PROBE: Record<string, string> = {
  patients: '/patients?limit=1',
  appointments: '/appointments?limit=1',
  consultations: '/consultations?limit=1',
  'pre-triage': '/pre-triage?limit=1',
  queue: '/queue?limit=1',
  inpatient: '/inpatient/wards',
  laboratory: '/laboratory/tests',
  radiology: '/radiology/exams',
  pharmacy: '/pharmacy/drugs',
  billing: '/billing/services',
  users: '/users?limit=1',
  roles: '/roles',
  settings: '/settings/departments',
};

/** Every key the Flutter `SiteSettings` model reads. */
const SITE_SETTINGS_KEYS = [
  'site_name',
  'site_logo',
  'theme_preset',
  'theme_custom_colors',
  'theme_font',
  'triage_scale',
  'wait_breach_minutes',
  'show_patient_names',
  'default_currency_code',
  'currency_symbol',
  'currency_position',
  'decimal_sep',
  'thousand_sep',
  'cent_precision',
  'zero_format',
  'date_format',
  'use_24_hour_clock',
];

const STANDARD_META: (keyof PageMeta)[] = [
  'page',
  'limit',
  'total',
  'totalPages',
  'hasNextPage',
  'hasPreviousPage',
];

/** Lower is more urgent. Mirrors QUEUE_PRIORITY_RANK in the queue DTO. */
const PRIORITY_RANK: Record<string, number> = {
  p1: 0,
  emergency: 0,
  p2: 1,
  urgent: 2,
  p3: 3,
  high: 3,
  p4: 4,
  normal: 4,
  p5: 5,
  low: 6,
  routine: 6,
};

interface LoginResult {
  tokens: TokenPair | null;
  status: number;
  message?: string;
}

async function login(role: RoleFixture): Promise<LoginResult> {
  const { status, body } = await call<TokenPair>('POST', '/auth/login', {
    body: { email: role.email, password: role.password },
  });
  return {
    tokens: status === 200 && body.data ? body.data : null,
    status,
    // 429 here is this script tripping the login rate limit it asked for, not a
    // broken credential — worth saying out loud rather than reading as a auth
    // failure.
    message: status === 429 ? 'rate limited' : body.message,
  };
}

async function main(): Promise<void> {
  console.log(
    `\nVerifying the mobile contract against ${BASE}\n${'='.repeat(62)}`,
  );

  const health = await call<unknown>('GET', '/health/live');
  if (health.status !== 200) {
    console.error(
      `\nThe API is not answering on ${BASE}. Start it with \`npm run start:dev\`.`,
    );
    process.exit(1);
  }

  const tokens: Record<string, string> = {};
  const sessions: Record<string, TokenPair> = {};

  for (const [name, role] of Object.entries(ROLES)) {
    section(`${name} (${role.email})`);

    const attempt = await login(role);
    const session = attempt.tokens;
    if (!session?.accessToken) {
      check(
        'can sign in',
        false,
        `HTTP ${attempt.status}${attempt.message ? ` ${attempt.message}` : ''}`,
      );
      continue;
    }
    tokens[name] = session.accessToken;
    sessions[name] = session;
    check('can sign in', true);

    // `expiresIn` must describe the token actually issued. It was hard-coded to
    // 900 regardless of config, so a client scheduling a refresh off it was
    // wrong by a factor of ninety-six in this environment.
    const claims = decodeClaims(session.accessToken);
    const lifetime = claims.exp - claims.iat;
    check(
      'expiresIn matches the token it describes',
      Math.abs(lifetime - session.expiresIn) <= 2,
      `said ${session.expiresIn}s, token lives ${lifetime}s`,
    );
    check('JWT carries organizationId', !!claims.organizationId);

    const me = await call<MeResponse>('GET', '/auth/me', {
      token: session.accessToken,
    });
    const meData = me.body.data;
    check('GET /auth/me answers', me.status === 200, `status ${me.status}`);
    check(
      'bootstrap carries user, access and organization',
      !!meData?.user && !!meData.access?.modules && !!meData.organization,
    );
    check(
      'user has roles and permissions',
      Array.isArray(meData?.user?.roles) &&
        meData.user.roles.includes(name) &&
        Array.isArray(meData.user.permissions),
      `roles=${JSON.stringify(meData?.user?.roles)}`,
    );
    check(
      'organization settings are resolved, not raw',
      !!meData?.organization?.settings?.locale?.currency &&
        typeof meData.organization.settings.clinical?.waitBreachMinutes ===
          'number',
    );

    const settings = await call<SiteSettings>('GET', '/settings', {
      token: session.accessToken,
    });
    const missing = SITE_SETTINGS_KEYS.filter(
      (k) => settings.body.data?.[k] === undefined,
    );
    check(
      'GET /settings serves every key the app reads',
      settings.status === 200 && missing.length === 0,
      missing.length
        ? `missing ${missing.join(', ')}`
        : `status ${settings.status}`,
    );

    // The access map is what the app gates its navigation on, so a mismatch
    // here is a tab that either 403s on open or is hidden from somebody who
    // needs it.
    const modules = meData?.access?.modules ?? {};
    for (const mod of role.canRead) {
      const probe = MODULE_PROBE[mod];
      if (!probe) continue;
      const res = await call<unknown>('GET', probe, {
        token: session.accessToken,
      });
      check(
        `can read ${mod}`,
        modules[mod]?.canRead === true && res.status === 200,
        `map=${String(modules[mod]?.canRead)} http=${res.status}`,
      );
    }
    for (const mod of role.cannotRead) {
      const probe = MODULE_PROBE[mod];
      if (!probe) continue;
      const res = await call<unknown>('GET', probe, {
        token: session.accessToken,
      });
      check(
        `is refused ${mod}`,
        modules[mod]?.canRead !== true && res.status === 403,
        `map=${String(modules[mod]?.canRead)} http=${res.status}`,
      );
    }
  }

  // ── Pagination shapes ─────────────────────────────────────────────────────
  section('pagination');
  const admin = tokens.SUPER_ADMIN;

  for (const [label, path] of [
    ['patients', '/patients?limit=5'],
    ['queue', '/queue?limit=5'],
  ] as const) {
    const res = await call<Paged<IdRow>>('GET', path, { token: admin });
    const meta = res.body.data?.meta ?? {};
    const missingMeta = STANDARD_META.filter((k) => meta[k] === undefined);
    check(
      `${label} answers the standard meta`,
      missingMeta.length === 0,
      missingMeta.length ? `missing ${missingMeta.join(', ')}` : '',
    );
  }

  const queuePage = await call<Paged<QueueRow>>('GET', '/queue?limit=5', {
    token: admin,
  });
  const queueMeta = queuePage.body.data?.meta ?? {};
  check(
    'queue still carries the legacy keys the console reads',
    queueMeta.currentPage !== undefined && queueMeta.perPage !== undefined,
  );

  const bare = await call<IdRow[]>('GET', '/billing/services', {
    token: admin,
  });
  check(
    'a bare-array list is still a bare array',
    Array.isArray(bare.body.data),
    `got ${typeof bare.body.data}`,
  );

  const compat = await call<Envelope<unknown>>(
    'GET',
    '/inpatient?resource=wards',
    { token: admin },
  );
  check(
    'the compat route is wrapped once, not twice',
    compat.body.success === true && compat.body.data?.success === undefined,
  );

  // ── Auth lifecycle ────────────────────────────────────────────────────────
  section('auth lifecycle');
  // Reuses the pair the per-role loop already obtained. Logging in again here
  // was two extra requests per run against a login limit this script itself
  // asked for, and it tripped at 429 — reporting a broken lifecycle when the
  // rate limiter was simply doing its job.
  const nurse = sessions.NURSE;
  // An unreported skip is indistinguishable from a pass, so say it either way.
  check('has a nurse session to exercise the token lifecycle', !!nurse);
  if (nurse) {
    const rotated = await call<TokenPair>('POST', '/auth/refresh', {
      body: { refreshToken: nurse.refreshToken },
    });
    check(
      'refresh rotates the pair',
      rotated.status === 200,
      `status ${rotated.status}`,
    );

    const replay = await call<TokenPair>('POST', '/auth/refresh', {
      body: { refreshToken: nurse.refreshToken },
    });
    check('replaying a used token is refused', replay.status === 401);

    const afterReplay = await call<TokenPair>('POST', '/auth/refresh', {
      body: { refreshToken: rotated.body.data?.refreshToken },
    });
    check(
      'a replay revokes the whole family',
      afterReplay.status === 401,
      `status ${afterReplay.status}`,
    );

    const refreshed = await login(ROLES.NURSE);
    const fresh = refreshed.tokens;
    check(
      'can sign in again to exercise logout',
      !!fresh,
      `HTTP ${refreshed.status}${refreshed.message ? ` ${refreshed.message}` : ''}`,
    );
    if (fresh) {
      const out = await call<unknown>('POST', '/auth/logout', {
        token: fresh.accessToken,
        body: { refreshToken: fresh.refreshToken },
      });
      check('logout answers 204', out.status === 204);
      const afterLogout = await call<TokenPair>('POST', '/auth/refresh', {
        body: { refreshToken: fresh.refreshToken },
      });
      check('logout actually revokes', afterLogout.status === 401);
    }
  }

  // ── Things the app sends that used to be rejected ─────────────────────────
  section('mobile-specific requests');

  const consults = await call<Paged<IdRow>>(
    'GET',
    '/consultations?search=a&limit=1',
    { token: tokens.DOCTOR },
  );
  check(
    'consultations accepts ?search (the app always sends it)',
    consults.status === 200,
    `status ${consults.status}`,
  );

  const patientsPage = await call<Paged<IdRow>>('GET', '/patients?limit=1', {
    token: tokens.NURSE,
  });
  const somePatient = patientsPage.body.data?.data?.[0]?.id;

  if (somePatient && tokens.NURSE) {
    const created: string[] = [];
    for (const priority of ['p1', 'p3', 'routine']) {
      const res = await call<IdRow>('POST', '/queue', {
        token: tokens.NURSE,
        body: { patientId: somePatient, serviceArea: 'opd', priority },
      });
      check(
        `queue accepts priority ${priority}`,
        res.status === 201 || res.status === 200,
        `status ${res.status} ${res.body.message ?? ''}`,
      );
      if (res.body.data?.id) created.push(res.body.data.id);
    }

    const board = await call<Paged<QueueRow>>(
      'GET',
      '/queue?serviceArea=opd&limit=50',
      { token: tokens.NURSE },
    );
    const order = (board.body.data?.data ?? []).map((r) => r.priority ?? '');
    const ranks = order.map((p) => PRIORITY_RANK[p.toLowerCase()] ?? 99);
    check(
      'the board is ordered by acuity, not alphabetically',
      ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
      order.slice(0, 8).join(' → '),
    );

    for (const id of created) {
      await call<unknown>('DELETE', `/queue/${id}`, { token: tokens.NURSE });
    }
  } else {
    // Not a failure — the demo seed may not have run — but it must be visible,
    // because "no output" and "all green" look identical in a terminal.
    console.log(
      '  \x1b[33m•\x1b[0m skipped the queue write checks: no patients seeded ' +
        '(run `npm run db:seed:mobile`)',
    );
  }

  // ── Tenancy ───────────────────────────────────────────────────────────────
  section('tenancy');
  const crossTenant = await call<unknown>(
    'GET',
    '/settings/organization?id=some-other-org',
    { token: tokens.DOCTOR ?? tokens.NURSE },
  );
  check(
    'a non-admin cannot read another organisation',
    crossTenant.status === 403 || crossTenant.status === 404,
    `status ${crossTenant.status}`,
  );

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(62)}`);
  console.log(`\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
