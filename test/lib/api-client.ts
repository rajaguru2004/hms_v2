import '../../prisma/load-env';

/**
 * Minimal typed API client shared by the demo seed and the `verify-*.ts` scripts.
 *
 * Everything goes through the real HTTP API rather than Prisma on purpose: MRN
 * generation, queue numbering, invoice numbering, stock decrement on dispense and
 * the audit/notification side-effects all live in NestJS services. Rows inserted
 * straight into Postgres render in the UI but cannot advance through a workflow —
 * which is exactly the trap that makes seeded data look fine and behave broken.
 */

export const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  errorCode?: string;
}

export class ApiError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${label} failed: ${status} ${body.slice(0, 400)}`);
    this.name = 'ApiError';
  }
}

async function parseEnvelope<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();

  if (!res.ok) throw new ApiError(label, res.status, text);

  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(label, res.status, text);
  }

  if (!json.success) throw new ApiError(label, res.status, text);
  return json.data;
}

export class ApiClient {
  private token: string | null = null;

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async login(
    email = process.env.SEED_ADMIN_EMAIL ?? 'admin@hms.local',
    password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@HMS2024!',
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await parseEnvelope<{ accessToken: string }>(res, 'Login');
    this.token = data.accessToken;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers });
    return parseEnvelope<T>(res, `GET ${path}`);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return parseEnvelope<T>(res, `POST ${path}`);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return parseEnvelope<T>(res, `PATCH ${path}`);
  }

  /** POST that tolerates failure — used for optional/best-effort demo steps. */
  async tryPost<T>(path: string, body: unknown): Promise<T | null> {
    try {
      return await this.post<T>(path, body);
    } catch {
      return null;
    }
  }

  async waitForHealth(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `API did not become healthy at ${BASE_URL}/health within ${timeoutMs}ms. ` +
        'Start it with `npm run start:dev` in hms_v2.',
    );
  }
}

// ── Determinism helpers ──────────────────────────────────────────────────────

/**
 * Anchor for all generated timestamps. Every date in the seed is expressed as an
 * offset from this instant, never as `new Date()` at the point of use.
 *
 * Default: today at 08:00 local. This matters because the dashboard is built around
 * "today" — today's appointments, today's revenue, the current queue. Anchoring to a
 * hardcoded past date makes every one of those tiles render zero, so the product
 * looks broken to anyone opening it.
 *
 * For visual regression, pin it explicitly and pin the browser clock to the same
 * instant, so the comparison is deterministic:
 *
 *   SEED_ANCHOR_DATE=2026-03-15T08:00:00+03:00 npm run db:seed:demo
 */
export const SEED_ANCHOR = (() => {
  const override = process.env.SEED_ANCHOR_DATE;
  if (override) {
    const d = new Date(override);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`SEED_ANCHOR_DATE is not a valid date: ${override}`);
    }
    return d;
  }
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  return today;
})();

export function daysFromAnchor(days: number, hour = 9, minute = 0): Date {
  const d = new Date(SEED_ANCHOR);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

/** Deterministic xorshift PRNG — seeded, so every run produces identical data. */
export function createRng(seed = 20260315) {
  let state = seed >>> 0 || 1;
  return {
    next(): number {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0xffffffff;
    },
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(this.next() * items.length)];
    },
  };
}
