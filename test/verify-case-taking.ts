import '../prisma/load-env';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { OllamaProvider } from '../src/modules/ai/ollama.provider';
import { STATIC_FIELDS } from '../src/modules/case-taking/engine/field-registry';

/**
 * The acceptance check for the case-taking interview.
 *
 * The unit specs mock the repository and the model, so they prove the engine
 * decides the right thing and nothing about what the API on port 3000 answers
 * with a real Postgres behind it and a real 4B model on the same box. Every
 * property this script cares about is a property of the running system:
 *
 *   npx ts-node -r tsconfig-paths/register test/verify-case-taking.ts
 *
 * Requires `npm run db:seed`, a server on port 3000 and — for the last
 * section — nothing at all, because the point of the last section is what
 * happens when the model is not there.
 *
 * Nine things are on trial:
 *
 *   1. One interview per patient. Starting twice resumes, it does not fork.
 *   2. Consent is a moment with a version on it, not a flag.
 *   3. `POST /turns` answers from the engine, so it answers in milliseconds.
 *      The wall-clock bound is asserted, and the real number is printed.
 *   4. The tri-state survives the round trip: "I don't know" comes back as
 *      unknown, and the review never turns it into "no known allergies".
 *   5. The ACS screen fires, is persisted, and what the patient reads names no
 *      diagnosis.
 *   6. A correction writes a new fact and supersedes the old one. The old row
 *      is still there, because the disagreement is the interesting part.
 *   7. Submit produces a structured case on the patient's record.
 *   8. A patient cannot reach another patient's interview by any route.
 *   9. An unreachable model degrades. It does not break the interview.
 *
 * The two patients are created fresh on every run — the interview is
 * one-per-patient, so reusing a seeded account would make check 1 depend on
 * whatever the last run left behind.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000/api';

/**
 * What `POST /turns` is allowed to cost end to end.
 *
 * The design claim is that the next question comes from `selectNext` with no
 * model in the path — so this bound is not "fast for a model", it is "fast for
 * a database write and a pure function". Measured on this box the handler
 * reports 17-50ms and the wire adds a few more. One second leaves room for a
 * watch-mode recompile landing mid-run without pretending a twenty-second model
 * call would have passed.
 */
const TURN_BUDGET_MS = 1_000;

/** And what the handler itself may spend, which is the number §37 is about. */
const SERVER_BUDGET_MS = 500;

/**
 * Words a patient must never read on a red flag.
 *
 * §29 draws the line at risk detection: the rule set may know it is looking at
 * an ACS screen, and the person holding the phone may not be told they are
 * having a heart attack by a 4B model's nearest neighbour. The list is checked
 * against `patientMessage` and against every stored flag message.
 */
const FORBIDDEN_IN_PATIENT_MESSAGE = [
  'heart attack',
  'myocardial',
  'infarction',
  'infarct',
  'angina',
  'acute coronary',
  'ischaemia',
  'ischemia',
  'ischaemic',
  'ischemic',
  'cardiac arrest',
  'embolism',
  'stroke',
  'sepsis',
  'septic',
  'haemorrhage',
  'hemorrhage',
  'diagnosis',
  'diagnose',
  'diagnosed',
  'condition is',
  'you are having',
  'this is probably',
  'most likely',
];

/** The sentence §19 exists to prevent. "Not asked" is not "none". */
const NO_KNOWN_ALLERGIES = [
  'no known allergies',
  'no known allergy',
  'nkda',
  'no allergies',
  'none known',
  'denies allergies',
];

// ── The contract, as types ───────────────────────────────────────────────────

interface Envelope<T> {
  success?: boolean;
  message?: string;
  errorCode?: string;
  data?: T;
}

interface TokenPair {
  accessToken: string;
}

interface PatientRow {
  id: string;
  mrn: string;
}

interface UserRow {
  id: string;
}

interface QuestionView {
  fieldPath: string;
  section: string;
  label: string;
  kind: string;
  choices?: string[];
  prompt: string;
  remaining: number;
}

interface RedFlagView {
  id: string;
  severity: string;
  message: string;
  triggeredAt: string;
}

interface SessionView {
  id: string;
  patientId: string;
  status: string;
  resumed?: boolean;
  consent: {
    given: boolean;
    givenAt: string | null;
    version: string | null;
    requiredVersion: string;
  };
  progress: { percent: number; complete: boolean };
  interviewStatus: string;
  currentQuestion: QuestionView | null;
  answeredCount: number;
  redFlags: RedFlagView[];
  patientMessage: string | null;
}

interface TurnView {
  turnId: string;
  sessionId: string;
  accepted: {
    fieldPath: string | null;
    presence: string | null;
    value?: unknown;
    reason: string | null;
    needsPatientConfirmation: boolean;
    factId: string | null;
  };
  extraction: { queued: boolean; reason: string };
  nextQuestion: QuestionView | null;
  interviewStatus: string;
  redFlags: RedFlagView[];
  patientMessage: string | null;
  serverTimeMs: number;
}

interface ReviewItem {
  fieldPath: string;
  label: string;
  presence: string;
  display: string;
  presenceText: string;
}

interface ReviewView {
  sessionId: string;
  status: string;
  percentComplete: number;
  missingInformation: string[];
  sections: { section: string; title: string; items: ReviewItem[] }[];
  text: string;
  narrative: string | null;
  safety: {
    highestSeverity: string | null;
    patientMessage: string | null;
    triggeredCount: number;
  };
}

interface CorrectionView {
  factId: string;
  supersededFactId: string;
  fieldPath: string;
  presence: string;
  value: unknown;
}

interface SubmissionView {
  submissionId: string;
  sessionId: string;
  patientId: string;
  percentComplete: number;
  sectionCount: number;
  missingInformation: string[];
  structuredCase: {
    rulesetVersion: string;
    consentVersion: string | null;
    sections: { section: string }[];
    safety: { highestSeverity: string | null; triggered: unknown[] };
    text: string;
  };
}

interface JwtClaims {
  sub: string;
  roles?: string[];
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

function note(text: string): void {
  console.log(`  \x1b[2m${text}\x1b[0m`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Res<T> {
  status: number;
  body: Envelope<T>;
  /** Milliseconds on the wire. `POST /turns` is judged on this. */
  elapsedMs: number;
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

  return { status: res.status, body, elapsedMs };
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

/** Any of the forbidden words that actually appear in the text. */
function forbiddenWordsIn(text: string, words: string[]): string[] {
  const haystack = text.toLowerCase();
  return words.filter((word) => haystack.includes(word));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN = Date.now();
const DOB = '1971-04-22';
const PORTAL_PASSWORD = 'Interview@12345';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface Portal {
  patientId: string;
  mrn: string;
  token: string;
}

/**
 * A patient with a portal login, built through the API and linked in one write.
 *
 * `POST /patient-auth/claim` is the door a real patient comes through, and
 * `verify-patient-auth.ts` is where that door is tested. It is rate limited to
 * five a minute, which is the feature — so this script does not spend them.
 * What it needs is two accounts that exist, and the link between a `User` and a
 * `Patient` is a column, not a workflow.
 */
async function makePortalPatient(
  adminToken: string,
  who: string,
): Promise<Portal | null> {
  const patient = await call<PatientRow>('POST', '/patients', {
    token: adminToken,
    body: {
      firstName: who,
      lastName: `Interview${RUN}`,
      dateOfBirth: DOB,
      gender: 'male',
      phonePrimary: '+251911000000',
    },
  });
  if (!patient.body.data) return null;

  const email = `case.${who.toLowerCase()}.${RUN}@hms.local`;
  const user = await call<UserRow>('POST', '/users', {
    token: adminToken,
    body: {
      email,
      password: PORTAL_PASSWORD,
      firstName: who,
      lastName: 'Interview',
      role: 'PATIENT',
    },
  });
  if (!user.body.data) return null;

  await prisma.patient.update({
    where: { id: patient.body.data.id },
    data: { userId: user.body.data.id },
  });

  const token = await login(email, PORTAL_PASSWORD);
  if (!token) return null;

  return {
    patientId: patient.body.data.id,
    mrn: patient.body.data.mrn,
    token,
  };
}

/** Answer a question, and hand back both the answer and what it cost. */
async function answer(
  token: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Res<TurnView>> {
  return call<TurnView>('POST', `/case-taking/sessions/${sessionId}/turns`, {
    token,
    body,
  });
}

async function main(): Promise<void> {
  console.log(`\x1b[1mCase-taking interview\x1b[0m  →  ${BASE}`);

  // ── Setup ─────────────────────────────────────────────────────────────────
  section('setup');

  const adminToken = await login(
    process.env.SEED_ADMIN_EMAIL ?? 'admin@hms.local',
    process.env.SEED_ADMIN_PASSWORD ?? 'Admin@HMS2024!',
  );
  check('an administrator can sign in', Boolean(adminToken));
  if (!adminToken) return;

  const alpha = await makePortalPatient(adminToken, 'Alpha');
  const beta = await makePortalPatient(adminToken, 'Beta');
  check(
    'two patients with portal accounts exist to test against',
    alpha !== null && beta !== null,
  );
  if (!alpha || !beta) return;

  check(
    'each portal token carries its own patient record',
    decodeClaims(alpha.token).patientId === alpha.patientId &&
      decodeClaims(beta.token).patientId === beta.patientId,
  );
  note(`alpha ${alpha.mrn} · beta ${beta.mrn}`);

  // ── 1. One interview per patient ──────────────────────────────────────────
  section('an interview starts, and starting again resumes it');

  const first = await call<SessionView>('POST', '/case-taking/sessions', {
    token: alpha.token,
    body: { kind: 'new_consultation', language: 'en' },
  });
  check(
    'a patient with no interview gets a new one',
    first.status === 200 &&
      Boolean(first.body.data?.id) &&
      first.body.data?.resumed === false,
    `${first.status} ${String(first.body.message)}`,
  );

  const sessionId = first.body.data?.id;
  if (!sessionId) return;

  const again = await call<SessionView>('POST', '/case-taking/sessions', {
    token: alpha.token,
    body: { kind: 'new_consultation', language: 'en' },
  });
  check(
    'starting again hands back the same interview',
    again.body.data?.id === sessionId,
    `${String(again.body.data?.id)} vs ${sessionId}`,
  );
  check(
    'and says so, rather than pretending it is new',
    again.body.data?.resumed === true,
    `resumed ${String(again.body.data?.resumed)}`,
  );

  const openSessions = await prisma.caseSession.count({
    where: {
      patientId: alpha.patientId,
      status: { in: ['in_progress', 'review'] },
      isDeleted: false,
    },
  });
  check(
    'exactly one interview is open in the database, not two',
    openSessions === 1,
    `found ${openSessions}`,
  );

  const current = await call<SessionView>(
    'GET',
    '/case-taking/sessions/current',
    { token: alpha.token },
  );
  check(
    'the interview can be found again without knowing its id',
    current.body.data?.id === sessionId,
  );

  // ── 2. Consent ────────────────────────────────────────────────────────────
  section('consent is recorded with the wording it was given against');

  const beforeConsent = await answer(alpha.token, sessionId, {
    fieldPath: 'chief_complaint.symptom',
    modality: 'text',
    text: 'chest pain',
  });
  check(
    'no question can be answered before consent is given',
    beforeConsent.status === 409 &&
      beforeConsent.body.errorCode === 'CASE_SESSION_CONSENT_REQUIRED',
    `${beforeConsent.status} ${String(beforeConsent.body.errorCode)}`,
  );

  const requiredVersion = first.body.data?.consent.requiredVersion ?? '';
  check(
    'the session says which wording the patient has to be shown',
    requiredVersion.length > 0,
    `requiredVersion ${requiredVersion}`,
  );

  const consented = await call<SessionView>(
    'POST',
    `/case-taking/sessions/${sessionId}/consent`,
    {
      token: alpha.token,
      body: { consentVersion: requiredVersion, accepted: true },
    },
  );
  check(
    'consent is accepted and timestamped',
    consented.status === 200 &&
      consented.body.data?.consent.given === true &&
      Boolean(consented.body.data?.consent.givenAt),
    `${consented.status} ${String(consented.body.data?.consent.givenAt)}`,
  );

  const consentRow = await prisma.caseSession.findUnique({
    where: { id: sessionId },
    select: { consentVersion: true, consentGivenAt: true },
  });
  check(
    'the version is stored beside the timestamp, not just the fact of it',
    consentRow?.consentVersion === requiredVersion &&
      consentRow?.consentGivenAt !== null,
    `stored ${String(consentRow?.consentVersion)}`,
  );

  // ── 3. The hot path ───────────────────────────────────────────────────────
  //
  // The design claim in one number: the next question comes from the
  // deterministic selector, so answering costs a write and a pure function
  // rather than the eight to twenty seconds a model costs on this hardware.
  section('answering returns the next question straight away');

  const opening = await answer(alpha.token, sessionId, {
    fieldPath: 'chief_complaint.symptom',
    modality: 'text',
    text: 'chest pain',
  });
  check(
    'the first answer is accepted and read by the engine',
    opening.status === 200 &&
      opening.body.data?.accepted.presence === 'recorded',
    `${opening.status} ${String(opening.body.data?.accepted.presence)}`,
  );
  check(
    'and the next question comes back with it',
    Boolean(opening.body.data?.nextQuestion?.fieldPath),
    `next ${String(opening.body.data?.nextQuestion?.fieldPath)}`,
  );
  check(
    'no model was asked to read a two-word answer',
    opening.body.data?.extraction.queued === false,
    String(opening.body.data?.extraction.reason),
  );

  // Sixteen turns of the interview, answering whatever it asks, so the number
  // reported is a distribution rather than one lucky request. The interview is
  // adaptive, so which questions arrive is its decision — `answerFor` answers by
  // field shape, and the three answers the later sections depend on are given
  // whenever the interview gets round to asking for them.
  const wall: number[] = [opening.elapsedMs];
  const server: number[] = [opening.body.data?.serverTimeMs ?? 0];
  let asked = opening.body.data?.nextQuestion ?? null;

  /** The turn that raised a red flag, and the turn that answered "I don't know". */
  let fired: Res<TurnView> | null = null;
  let unsure: Res<TurnView> | null = null;

  for (let turn = 0; turn < 16 && asked; turn++) {
    const res = await answer(alpha.token, sessionId, answerFor(asked));
    if (res.status !== 200 || !res.body.data) break;

    wall.push(res.elapsedMs);
    server.push(res.body.data.serverTimeMs);
    if (!fired && res.body.data.redFlags.length > 0) fired = res;
    if (res.body.data.accepted.fieldPath === 'allergies.reported') unsure = res;
    asked = res.body.data.nextQuestion;
  }

  const worstWall = Math.max(...wall);
  const worstServer = Math.max(...server);
  const medianWall = [...wall].sort((a, b) => a - b)[
    Math.floor(wall.length / 2)
  ];
  note(
    `${wall.length} turns — wall median ${medianWall}ms, worst ${worstWall}ms; ` +
      `handler worst ${worstServer}ms`,
  );

  check(
    `every turn answered inside ${TURN_BUDGET_MS}ms on the wire`,
    worstWall < TURN_BUDGET_MS,
    `worst ${worstWall}ms over ${wall.length} turns`,
  );
  check(
    `and the handler itself spent under ${SERVER_BUDGET_MS}ms`,
    worstServer < SERVER_BUDGET_MS,
    `worst ${worstServer}ms`,
  );

  // A narrative answer carries more than the question asked for, and the
  // engine reads all of it before the response is built — `harvest` is regex
  // over one sentence, not a model call. `queued` is therefore always false
  // now; it used to mean "a model will write facts into this session later",
  // and this check asserted it was true. The model left that path, so the
  // property worth holding is the one below: the extra fields are read, and
  // the turn is no slower for it. That is still what catches somebody putting
  // an `await` on an extraction.
  const narrative = await answer(alpha.token, sessionId, {
    modality: 'text',
    text:
      'It started three days ago after I climbed the stairs at work. The pain ' +
      'is in the middle of my chest and it comes back whenever I walk quickly. ' +
      'I also feel more tired than usual in the evenings.',
  });
  check(
    'a long narrative is read in full by the engine, with no model in the path',
    narrative.body.data?.extraction.queued === false,
    `queued ${String(narrative.body.data?.extraction.queued)} — ${String(
      narrative.body.data?.extraction.reason,
    )}`,
  );
  check(
    'and the answer yields more than the one field that was asked for',
    /read [1-9]\d* more field/.test(
      narrative.body.data?.extraction.reason ?? '',
    ),
    String(narrative.body.data?.extraction.reason),
  );
  check(
    'and that turn comes back just as fast as the short ones',
    narrative.elapsedMs < TURN_BUDGET_MS,
    `${narrative.elapsedMs}ms on the wire, handler ${String(
      narrative.body.data?.serverTimeMs,
    )}ms`,
  );
  note(
    `narrative turn: ${narrative.elapsedMs}ms wall, ` +
      `${String(narrative.body.data?.serverTimeMs)}ms handler`,
  );

  // ── 4. The tri-state, end to end ──────────────────────────────────────────
  section('"I don\'t know" is recorded as unknown, never as no');

  // Asked for by name rather than waited for: `allergies.reported` sits behind
  // the whole history in ask order, and the point here is the answer, not when
  // the interview gets to it. If the loop above already reached it, that turn is
  // the one being judged.
  unsure =
    unsure ??
    (await answer(alpha.token, sessionId, {
      fieldPath: 'allergies.reported',
      modality: 'text',
      text: "I don't know",
    }));

  check(
    'the answer is accepted as unknown',
    unsure.body.data?.accepted.presence === 'unknown',
    `${String(unsure.body.data?.accepted.presence)} via ${String(
      unsure.body.data?.accepted.reason,
    )}`,
  );

  const allergyFactId = unsure.body.data?.accepted.factId ?? null;
  const storedUnsure = allergyFactId
    ? await prisma.caseFact.findUnique({ where: { id: allergyFactId } })
    : null;
  check(
    'and the row in the database says unknown too',
    storedUnsure?.presence === 'unknown' &&
      storedUnsure?.fieldPath === 'allergies.reported',
    `presence ${String(storedUnsure?.presence)}`,
  );

  const review = await call<ReviewView>(
    'GET',
    `/case-taking/sessions/${sessionId}/review`,
    { token: alpha.token },
  );
  check(
    'the review document comes back with no model in the path',
    review.status === 200 && review.body.data !== undefined,
    `${review.status} in ${review.elapsedMs}ms`,
  );

  const allergyLine = review.body.data?.sections
    .flatMap((s) => s.items)
    .find((item) => item.fieldPath === 'allergies.reported');
  check(
    'the review prints the allergy question as unsure',
    allergyLine?.presence === 'unknown' &&
      allergyLine.display.toLowerCase().includes('unsure'),
    `${String(allergyLine?.presence)} / "${String(allergyLine?.display)}"`,
  );

  const reviewBlob = JSON.stringify(review.body.data ?? {}).toLowerCase();
  const inventedNone = forbiddenWordsIn(reviewBlob, NO_KNOWN_ALLERGIES);
  check(
    'the case never says the patient has no known allergies',
    inventedNone.length === 0,
    inventedNone.join(', '),
  );

  const renderedText = review.body.data?.text ?? '';
  check(
    'and the printed case says so in words a clinician will read correctly',
    /Allergies:\s*Patient unsure/i.test(renderedText),
    renderedText
      .split('\n')
      .filter((line) => /allerg/i.test(line))
      .join(' | ') || 'no allergy line found',
  );

  // ── 5. The red flag ───────────────────────────────────────────────────────
  //
  // §29's worked example: chest pain, breathlessness, and sweating or sudden
  // onset. The complaint went in as the first answer and the interview asks for
  // breathlessness and sweating next — `answerFor` says yes to both — so by here
  // the triad has usually already completed. If it has not, it is completed by
  // name, because what is on trial is the rule and not the ask order.
  section('the chest-pain screen fires, and says nothing clinical');

  if (!fired) {
    await answer(alpha.token, sessionId, {
      fieldPath: 'hpi.associated.breathlessness',
      modality: 'choice',
      value: 'yes',
    });
    fired = await answer(alpha.token, sessionId, {
      fieldPath: 'hpi.associated.sweating',
      modality: 'choice',
      value: 'yes',
    });
  }

  check(
    'a red flag is raised on the turn that completes the triad',
    (fired.body.data?.redFlags.length ?? 0) > 0,
    `${String(fired.body.data?.redFlags.length)} flag(s)`,
  );
  check(
    'it is raised as critical',
    fired.body.data?.redFlags.some((flag) => flag.severity === 'critical') ===
      true,
    fired.body.data?.redFlags.map((f) => f.severity).join(',') ?? 'none',
  );
  check(
    'and the patient is given one thing to do',
    typeof fired.body.data?.patientMessage === 'string' &&
      fired.body.data.patientMessage.length > 0,
    String(fired.body.data?.patientMessage),
  );

  const patientMessage = fired.body.data?.patientMessage ?? '';
  const leaked = forbiddenWordsIn(patientMessage, FORBIDDEN_IN_PATIENT_MESSAGE);
  check(
    'what the patient reads contains no diagnosis language',
    leaked.length === 0,
    leaked.join(', '),
  );
  note(`patient message: "${patientMessage}"`);

  const wholeTurn = JSON.stringify(fired.body.data ?? {});
  check(
    'the rule id, its title and the clinician summary stay on the server',
    !/ACS_TRIAD|clinicianSummary|recommendedAction|ruleId/i.test(wholeTurn),
    wholeTurn.slice(0, 120),
  );

  const storedFlags = await prisma.caseRedFlag.findMany({
    where: { sessionId },
  });
  check(
    'the flag is persisted against the session',
    storedFlags.some((flag) => flag.ruleId === 'ACS_TRIAD'),
    storedFlags.map((f) => f.ruleId).join(',') || 'none',
  );
  check(
    'with the rule version it fired under, so it can be re-read later',
    storedFlags.every((flag) => typeof flag.ruleVersion === 'number'),
  );
  check(
    'and the message it stored is the one the patient was shown',
    storedFlags.some((flag) => flag.message === patientMessage),
  );
  check(
    'no stored patient message carries diagnosis language either',
    storedFlags.every(
      (flag) =>
        forbiddenWordsIn(flag.message, FORBIDDEN_IN_PATIENT_MESSAGE).length ===
        0,
    ),
  );

  const flaggedReview = await call<ReviewView>(
    'GET',
    `/case-taking/sessions/${sessionId}/review`,
    { token: alpha.token },
  );
  check(
    'the review reports the severity and a count, never the rules themselves',
    flaggedReview.body.data?.safety.highestSeverity === 'critical' &&
      (flaggedReview.body.data?.safety.triggeredCount ?? 0) > 0,
    `${String(flaggedReview.body.data?.safety.highestSeverity)} × ${String(
      flaggedReview.body.data?.safety.triggeredCount,
    )}`,
  );

  // ── 6. Corrections ────────────────────────────────────────────────────────
  section('a correction writes a new fact and keeps the old one');

  if (!allergyFactId) {
    check('there is a fact to correct', false, 'no factId from the turn');
  } else {
    const corrected = await call<CorrectionView>(
      'PATCH',
      `/case-taking/sessions/${sessionId}/facts/${allergyFactId}`,
      { token: alpha.token, body: { text: 'yes, penicillin' } },
    );

    check(
      'the correction is accepted',
      corrected.status === 200 && Boolean(corrected.body.data?.factId),
      `${corrected.status} ${String(corrected.body.message)}`,
    );
    check(
      'it returns a different fact from the one it replaced',
      corrected.body.data?.factId !== allergyFactId &&
        corrected.body.data?.supersededFactId === allergyFactId,
      `${String(corrected.body.data?.factId)} supersedes ${String(
        corrected.body.data?.supersededFactId,
      )}`,
    );
    check(
      'and the corrected answer reads as recorded, not unknown',
      corrected.body.data?.presence === 'recorded',
      String(corrected.body.data?.presence),
    );

    const original = await prisma.caseFact.findUnique({
      where: { id: allergyFactId },
    });
    check(
      'the original row is still there',
      original !== null,
      `looked for ${allergyFactId}`,
    );
    check(
      'still saying what it originally said',
      original?.presence === 'unknown',
      `presence ${String(original?.presence)}`,
    );
    check(
      'and pointing at the fact that replaced it',
      original?.supersededById === corrected.body.data?.factId,
      `supersededById ${String(original?.supersededById)}`,
    );

    const afterCorrection = await call<ReviewView>(
      'GET',
      `/case-taking/sessions/${sessionId}/review`,
      { token: alpha.token },
    );
    const correctedLine = afterCorrection.body.data?.sections
      .flatMap((s) => s.items)
      .find((item) => item.fieldPath === 'allergies.reported');
    check(
      'the review shows the correction and not the superseded answer',
      correctedLine?.presence === 'recorded',
      `${String(correctedLine?.presence)} / "${String(correctedLine?.display)}"`,
    );

    const twice = await call<CorrectionView>(
      'PATCH',
      `/case-taking/sessions/${sessionId}/facts/${allergyFactId}`,
      { token: alpha.token, body: { text: 'no, nothing' } },
    );
    check(
      'a fact that has already been corrected cannot be corrected again',
      twice.status === 409 &&
        twice.body.errorCode === 'CASE_FACT_ALREADY_SUPERSEDED',
      `${twice.status} ${String(twice.body.errorCode)}`,
    );
  }

  // ── 7. Submit ─────────────────────────────────────────────────────────────
  section('submitting produces a structured case on the patient record');

  const submitted = await call<SubmissionView>(
    'POST',
    `/case-taking/sessions/${sessionId}/submit`,
    { token: alpha.token },
  );
  check(
    'the case is accepted',
    submitted.status === 200 && Boolean(submitted.body.data?.submissionId),
    `${submitted.status} ${String(submitted.body.message)}`,
  );
  check(
    'it is attached to the patient who gave it',
    submitted.body.data?.patientId === alpha.patientId,
    String(submitted.body.data?.patientId),
  );
  check(
    'the structured case carries the sections the interview filled in',
    (submitted.body.data?.structuredCase.sections.length ?? 0) > 0 &&
      (submitted.body.data?.sectionCount ?? 0) > 0,
    `${String(submitted.body.data?.sectionCount)} sections`,
  );
  check(
    'and the rule set and consent versions it was taken under',
    Boolean(submitted.body.data?.structuredCase.rulesetVersion) &&
      submitted.body.data?.structuredCase.consentVersion === requiredVersion,
    `${String(submitted.body.data?.structuredCase.rulesetVersion)} / ${String(
      submitted.body.data?.structuredCase.consentVersion,
    )}`,
  );
  check(
    'what is missing is printed rather than omitted',
    Array.isArray(submitted.body.data?.missingInformation),
    `${String(submitted.body.data?.missingInformation.length)} outstanding`,
  );
  check(
    'the safety assessment travels with the case',
    submitted.body.data?.structuredCase.safety.highestSeverity === 'critical' &&
      (submitted.body.data?.structuredCase.safety.triggered.length ?? 0) > 0,
  );

  const submissionRow = await prisma.caseSubmission.findFirst({
    where: { sessionId },
  });
  check(
    'the submission is a row on the patient, not only a response body',
    submissionRow?.patientId === alpha.patientId,
    `patientId ${String(submissionRow?.patientId)}`,
  );

  const closed = await prisma.caseSession.findUnique({
    where: { id: sessionId },
    select: { status: true, submittedAt: true },
  });
  check(
    'and the interview is closed behind it',
    closed?.status === 'submitted' && closed.submittedAt !== null,
    `status ${String(closed?.status)}`,
  );

  const twiceSubmitted = await call<SubmissionView>(
    'POST',
    `/case-taking/sessions/${sessionId}/submit`,
    { token: alpha.token },
  );
  check(
    'the same case cannot be sent twice',
    twiceSubmitted.status === 409 &&
      twiceSubmitted.body.errorCode === 'CASE_SESSION_ALREADY_SUBMITTED',
    `${twiceSubmitted.status} ${String(twiceSubmitted.body.errorCode)}`,
  );

  // The next visit.
  //
  // One interview per patient is enforced against the *open* ones -
  // `findInProgressForPatient` looks for `in_progress` or `review` - so a
  // submitted interview has to leave the way clear for the next one. This is
  // the property a returning patient depends on and the one that fails
  // silently: if a submitted session still counted as open, `POST /sessions`
  // would hand back the closed interview, the patient would be shown a case
  // they already sent, and the only symptom would be a second visit that
  // cannot be started.
  //
  // The other half is that starting again must not inherit the last visit's
  // answers. A new session carrying October's chest pain into January is worse
  // than no history at all, because it reads as something the patient just
  // said.
  section('a submitted interview gives way to the next one');

  const afterSubmit = await call<SessionView>(
    'GET',
    '/case-taking/sessions/current',
    { token: alpha.token },
  );
  // A 200 carrying nothing, or an explicit 404 - and nothing else. `!data`
  // alone passed on any error at all: a 500, an expired token's 401, a 403.
  // All of them have no `data`, so the check would have reported "no live
  // interview" for a server that had simply fallen over.
  check(
    'once submitted, there is no live interview to resume',
    afterSubmit.status === 404 ||
      (afterSubmit.status === 200 && !afterSubmit.body.data),
    `${afterSubmit.status} ${String(afterSubmit.body.data?.id)}`,
  );

  const nextVisit = await call<SessionView>('POST', '/case-taking/sessions', {
    token: alpha.token,
    body: {},
  });
  const nextId = nextVisit.body.data?.id;
  check(
    'starting again opens an interview rather than refusing',
    nextVisit.status === 200 || nextVisit.status === 201,
    `${nextVisit.status} ${String(nextVisit.body.message)}`,
  );
  check(
    'and it is a new one, not the case that was already sent',
    Boolean(nextId) && nextId !== sessionId,
    `${String(nextId)} vs submitted ${sessionId}`,
  );

  // "Empty" here means empty of *answers*, not empty of rows.
  //
  // Every session opens with what the patient record already knows seeded as
  // `existing_record` facts - `social.age_band` on this account - so counting
  // rows and expecting zero fails on a session that is behaving perfectly.
  // What must not appear is anything the patient said: a `patient_text`,
  // `patient_choice` or `patient_voice` fact in a brand-new interview is last
  // visit's illness presented as this visit's answer.
  const spokenSources = ['patient_text', 'patient_choice', 'patient_voice'];
  const carriedOver = nextId
    ? await prisma.caseFact.count({
        where: { sessionId: nextId, sourceType: { in: spokenSources } },
      })
    : -1;
  check(
    'the new interview carries over nothing the patient said last time',
    carriedOver === 0,
    `${carriedOver} answered fact(s) already present`,
  );

  const submissionsNow = await prisma.caseSubmission.count({
    where: { patientId: alpha.patientId },
  });
  check(
    'and the case already sent is still on the record',
    submissionsNow === 1,
    `${submissionsNow} submission(s) for this patient`,
  );

  if (nextId) {
    const resumeNext = await call<SessionView>(
      'POST',
      '/case-taking/sessions',
      { token: alpha.token, body: {} },
    );
    check(
      'and that new interview is itself resumed, not forked',
      resumeNext.body.data?.id === nextId,
      `${String(resumeNext.body.data?.id)} vs ${nextId}`,
    );
  }

  // ── 8. One patient, one interview ─────────────────────────────────────────
  //
  // Beta runs the other arm of the ACS rule — sudden onset instead of
  // sweating — and then tries to reach Alpha's interview by every route there
  // is. Either answer is acceptable: their own data, or a refusal. Alpha's is
  // not.
  section('a patient cannot reach another patient’s interview');

  const betaSession = await call<SessionView>('POST', '/case-taking/sessions', {
    token: beta.token,
    body: {},
  });
  const betaId = betaSession.body.data?.id;
  check('the second patient gets their own interview', Boolean(betaId));
  check(
    'which is a different interview from the first patient’s',
    betaId !== sessionId,
  );
  if (!betaId) return;

  await call<SessionView>('POST', `/case-taking/sessions/${betaId}/consent`, {
    token: beta.token,
    body: { consentVersion: requiredVersion, accepted: true },
  });
  await answer(beta.token, betaId, {
    fieldPath: 'chief_complaint.symptom',
    modality: 'text',
    text: 'chest pain',
  });
  await answer(beta.token, betaId, {
    fieldPath: 'hpi.associated.breathlessness',
    modality: 'choice',
    value: 'yes',
  });
  const suddenOnset = await answer(beta.token, betaId, {
    fieldPath: 'hpi.onset',
    modality: 'choice',
    value: 'sudden',
  });
  check(
    'the screen also fires on sudden onset rather than sweating',
    (suddenOnset.body.data?.redFlags.length ?? 0) > 0 &&
      forbiddenWordsIn(
        suddenOnset.body.data?.patientMessage ?? '',
        FORBIDDEN_IN_PATIENT_MESSAGE,
      ).length === 0,
    `${String(suddenOnset.body.data?.redFlags.length)} flag(s)`,
  );

  const peek = await call<SessionView>(
    'GET',
    `/case-taking/sessions/${sessionId}`,
    { token: beta.token },
  );
  check(
    'reading the other interview by id is refused',
    peek.status === 404 && peek.body.errorCode === 'CASE_SESSION_NOT_FOUND',
    `${peek.status} ${String(peek.body.errorCode)}`,
  );
  check(
    'and nothing of it comes back with the refusal',
    peek.body.data === undefined,
  );

  const intrude = await answer(beta.token, sessionId, {
    fieldPath: 'hpi.duration',
    modality: 'text',
    text: 'two weeks',
  });
  check(
    'answering a question in the other interview is refused',
    intrude.status >= 400 && intrude.body.data === undefined,
    `${intrude.status} ${String(intrude.body.errorCode)}`,
  );

  const peekReview = await call<ReviewView>(
    'GET',
    `/case-taking/sessions/${sessionId}/review`,
    { token: beta.token },
  );
  check(
    'reading the other patient’s review is refused',
    peekReview.status === 404 && peekReview.body.data === undefined,
    `${peekReview.status}`,
  );

  if (allergyFactId) {
    const peekCorrect = await call<CorrectionView>(
      'PATCH',
      `/case-taking/sessions/${sessionId}/facts/${allergyFactId}`,
      { token: beta.token, body: { text: 'nothing at all' } },
    );
    check(
      'correcting a fact in the other interview is refused',
      peekCorrect.status >= 400 && peekCorrect.body.data === undefined,
      `${peekCorrect.status} ${String(peekCorrect.body.errorCode)}`,
    );
  }

  const betaCurrent = await call<SessionView>(
    'GET',
    '/case-taking/sessions/current',
    { token: beta.token },
  );
  check(
    'asking for "my interview" always answers with the caller’s own',
    betaCurrent.body.data?.id === betaId &&
      betaCurrent.body.data?.patientId === beta.patientId,
    `${String(betaCurrent.body.data?.id)}`,
  );

  const staffPeek = await call<SessionView>(
    'GET',
    `/case-taking/sessions/${sessionId}`,
    { token: adminToken },
  );
  check(
    'a staff account is refused a live interview rather than defaulted into one',
    staffPeek.status === 403 &&
      staffPeek.body.errorCode === 'PATIENT_PORTAL_NOT_LINKED',
    `${staffPeek.status} ${String(staffPeek.body.errorCode)}`,
  );

  // ── 9. Degradation ────────────────────────────────────────────────────────
  //
  // The interview must survive the model being gone, because on this hardware
  // the model being gone is a Tuesday. Two halves: the provider itself, pointed
  // at an address nothing is listening on, and the running API, which is asked
  // for a question while a background extraction is in flight.
  section('an unreachable model degrades rather than breaking the interview');

  const unreachable = new OllamaProvider({
    get: (key: string) =>
      ({
        OLLAMA_URL: 'http://127.0.0.1:9',
        OLLAMA_MODEL: 'gemma3:4b',
        AI_TIMEOUT_MS: '4000',
      })[key],
  } as unknown as ConfigService);

  check(
    'the provider reports the model as unavailable rather than throwing',
    (await unreachable.isAvailable()) === false,
  );

  const degradedExtraction = await unreachable.extractFacts({
    utterance: 'I have had chest pain for three days and I feel breathless',
    candidateFields: STATIC_FIELDS.slice(0, 5),
    askedFieldPath: 'chief_complaint.symptom',
    language: 'en',
  });
  check(
    'extraction comes back degraded and empty, not as an exception',
    degradedExtraction.degraded === true &&
      degradedExtraction.facts.length === 0,
    String(degradedExtraction.degradedReason),
  );

  const degradedPhrasing = await unreachable.phraseQuestion({
    field: STATIC_FIELDS[0],
    fallbackPrompt: 'What is bothering you the most today?',
    language: 'en',
  });
  check(
    'question phrasing falls back to the registry’s own wording',
    degradedPhrasing.degraded === true &&
      degradedPhrasing.question === 'What is bothering you the most today?',
    degradedPhrasing.question,
  );

  const degradedSummary = await unreachable.draftReviewSummary({
    sections: [
      { title: 'Chief Complaint', lines: ['Main concern: Chest pain'] },
    ],
    language: 'en',
  });
  check(
    'the prose read-back returns nothing rather than inventing one',
    degradedSummary.degraded === true && degradedSummary.summary === null,
    String(degradedSummary.summary),
  );

  // And through HTTP: a narrative answer queues a model call, so if anything in
  // the turn path depended on the model this is the turn that would hang.
  const stillAsking = await answer(beta.token, betaId, {
    modality: 'text',
    text:
      'The pain came on while I was resting and I felt sick with it, and my ' +
      'father had heart trouble at about my age so I would like it looked at.',
  });
  check(
    'a turn that queues the model still returns a question immediately',
    stillAsking.status === 200 &&
      Boolean(stillAsking.body.data?.nextQuestion?.prompt) &&
      stillAsking.elapsedMs < TURN_BUDGET_MS,
    `${stillAsking.status} in ${stillAsking.elapsedMs}ms → ${String(
      stillAsking.body.data?.nextQuestion?.fieldPath,
    )}`,
  );
  check(
    'and the question it asks is a complete sentence, with no model needed',
    (stillAsking.body.data?.nextQuestion?.prompt ?? '').length > 10,
    String(stillAsking.body.data?.nextQuestion?.prompt),
  );
}

/**
 * A plausible answer to whatever was asked.
 *
 * The interview is adaptive, so a fixed script falls out of step with it after
 * the first branch. This answers by field shape instead — a boolean gets no, a
 * choice gets one of its own options, a free-text field is skipped rather than
 * fed prose a shape rule would reject — with three exceptions the rest of the
 * script depends on:
 *
 *   `hpi.associated.breathlessness` and `hpi.associated.sweating` are answered
 *   yes, because a patient describing chest pain with both is §29's screen and
 *   the script is here to watch it fire.
 *
 *   `allergies.reported` is answered in words rather than tapped, because the
 *   tri-state is about what happens to "I don't know".
 */
function answerFor(question: QuestionView): Record<string, unknown> {
  const path = question.fieldPath;

  if (
    path === 'hpi.associated.breathlessness' ||
    path === 'hpi.associated.sweating'
  ) {
    return { fieldPath: path, modality: 'choice', value: 'yes' };
  }

  if (path === 'allergies.reported') {
    return { fieldPath: path, modality: 'text', text: "I don't know" };
  }

  switch (question.kind) {
    case 'boolean':
      return { fieldPath: path, modality: 'choice', value: 'no' };
    case 'choice':
    case 'scale':
      // Its own vocabulary, not ours. A value the field's shape refuses is
      // stored as nothing, and the interview asks the same question again —
      // which would turn this loop into sixteen copies of one turn.
      return {
        fieldPath: path,
        modality: 'choice',
        value: question.choices?.[0] ?? 'no',
      };
    case 'duration':
      return { fieldPath: path, modality: 'text', text: '3 days' };
    default:
      // A skip is a real answer — `declined` — so the field stops being asked
      // and shows on the review as something the patient chose not to say.
      return { fieldPath: path, modality: 'skip' };
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
