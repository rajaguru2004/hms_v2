/**
 * All eleven Indic languages, end to end, against the box that is actually up.
 *
 * ── What this script is testing
 *
 * The architecture changed: the patient's chosen language now governs INPUT
 * only. They speak one of eleven languages, the recogniser transcribes in that
 * language, the clinical engine reasons in English, and the next question comes
 * back in ENGLISH and is read aloud in English. The patient reads and hears
 * English; they only ever *speak* their own language.
 *
 * That is a strong claim and most of it is checkable from outside. For each
 * language this walks one turn all the way round:
 *
 *   session in `xx`   → what did the session store for input and for output?
 *   complaint in xx   → is the patient's own text still in the fact row,
 *                       byte for byte, after extraction has had its go?
 *   engine            → which category did it derive, which red flags fired,
 *                       and can the cardiac branch be reached at all?
 *   next question     → is it English, in Latin script?
 *   that question     → /tts → /stt → which language came back?
 *
 * ── Why the cardiac probe is the interesting one
 *
 * `hpi.associated.breathlessness` is gated on `whenCategory('cardiac',
 * 'respiratory', 'allergic')` (field-registry.ts:650) and the ACS_TRIAD rule
 * opens with `{ kind: 'complaint', anyOf: ['cardiac'] }` (safety-rules.ts:126).
 * Both of those run off `classifyComplaint`, which is a table of English
 * regexes. So "does a chest-pain complaint reach the cardiac pathway regardless
 * of the script it arrived in" is not a question about tone — it decides
 * whether the interview is capable of asking about breathlessness at all. The
 * probe answers it the blunt way: it tries to post the answer and reports what
 * the server says.
 *
 * ── Nothing here is graded on a curve
 *
 * Odia has no speech recogniser anywhere and IndicF5's weights are gated on
 * Hugging Face with no token set. Neither of those is a pass and neither is a
 * fail — they print as N/A with the reason, because a green row nobody can
 * justify is worse than a red one.
 *
 *   npm run verify:languages
 *
 * Environment, all optional:
 *   HMS_API        default http://127.0.0.1:3000/api
 *   SIDECAR_URL    default http://127.0.0.1:8801
 *   EXTRACT_WAIT_MS  how long to let background extraction land (default 20000)
 *   SKIP_VOICE=1   skip the /tts and /stt hops when only the text half matters
 *   LANGS=ta,hi    restrict the walk to these codes, for re-running one row
 */

import '../prisma/load-env';

import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import {
  classifyComplaint,
  type ComplaintCategory,
} from '../src/modules/case-taking/engine/field-registry';

const BASE = process.env.HMS_API ?? 'http://127.0.0.1:3000/api';
const SIDECAR = process.env.SIDECAR_URL ?? 'http://127.0.0.1:8801';
const EMAIL = 'patient@hms.local';
const PASSWORD = 'Demo@HMS2024!';
const EXTRACT_WAIT_MS = Number(process.env.EXTRACT_WAIT_MS ?? 20000);
const SKIP_VOICE = process.env.SKIP_VOICE === '1';
/** A comma-separated subset, for re-running one row without waiting for eleven. */
const ONLY = (process.env.LANGS ?? '')
  .split(',')
  .map((code) => code.trim())
  .filter((code) => code.length > 0);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let token = '';

/* ══════════════════════════════ the corpus ═══════════════════════════════ */

/**
 * One neutral sentence per language: "I have had chest pain for three days."
 *
 * Deliberately the same clinical content in every row and deliberately thin —
 * three days, chest pain, nothing else. Inventing a richer history would give
 * the extractor more to find in one language than another and the comparison
 * across the table would stop meaning anything.
 */
interface LanguageCase {
  readonly code: string;
  readonly englishName: string;
  /** Unicode block that the language's own script lives in. */
  readonly script: RegExp;
  readonly complaint: string;
  /** Present only for the four languages the brief names for code-switching. */
  readonly codeSwitched?: string;
}

const CASES: readonly LanguageCase[] = [
  {
    code: 'as',
    englishName: 'Assamese',
    script: /[ঀ-৿]/,
    complaint: 'মোৰ তিনি দিন ধৰি বুকুৰ বিষ হৈ আছে',
  },
  {
    code: 'bn',
    englishName: 'Bengali',
    script: /[ঀ-৿]/,
    complaint: 'আমার তিন দিন ধরে বুকে ব্যথা হচ্ছে',
    codeSwitched: 'আমার three days ধরে chest pain হচ্ছে',
  },
  {
    code: 'gu',
    englishName: 'Gujarati',
    script: /[઀-૿]/,
    complaint: 'મને ત્રણ દિવસથી છાતીમાં દુખાવો થાય છે',
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    script: /[ऀ-ॿ]/,
    complaint: 'मुझे तीन दिन से सीने में दर्द हो रहा है',
    codeSwitched: 'मुझे three days से chest pain हो रहा है',
  },
  {
    code: 'kn',
    englishName: 'Kannada',
    script: /[ಀ-೿]/,
    complaint: 'ನನಗೆ ಮೂರು ದಿನಗಳಿಂದ ಎದೆ ನೋವು ಇದೆ',
  },
  {
    code: 'ml',
    englishName: 'Malayalam',
    script: /[ഀ-ൿ]/,
    complaint: 'എനിക്ക് മൂന്ന് ദിവസമായി നെഞ്ചുവേദന ഉണ്ട്',
  },
  {
    code: 'mr',
    englishName: 'Marathi',
    script: /[ऀ-ॿ]/,
    complaint: 'मला तीन दिवसांपासून छातीत दुखत आहे',
  },
  {
    code: 'or',
    englishName: 'Odia',
    script: /[଀-୿]/,
    complaint: 'ମୋର ତିନି ଦିନ ହେଲା ଛାତିରେ ଯନ୍ତ୍ରଣା ହେଉଛି',
  },
  {
    code: 'pa',
    englishName: 'Punjabi',
    script: /[਀-੿]/,
    complaint: 'ਮੈਨੂੰ ਤਿੰਨ ਦਿਨਾਂ ਤੋਂ ਛਾਤੀ ਵਿੱਚ ਦਰਦ ਹੋ ਰਿਹਾ ਹੈ',
  },
  {
    code: 'ta',
    englishName: 'Tamil',
    script: /[஀-௿]/,
    complaint: 'எனக்கு மூன்று நாட்களாக நெஞ்சு வலி இருக்கிறது',
    codeSwitched: 'எனக்கு three days-ஆ chest pain இருக்கு',
  },
  {
    code: 'te',
    englishName: 'Telugu',
    script: /[ఀ-౿]/,
    complaint: 'నాకు మూడు రోజులుగా ఛాతీ నొప్పి ఉంది',
    codeSwitched: 'నాకు three days నుంచి chest pain ఉంది',
  },
];

/**
 * "I twisted my ankle yesterday" — a complaint with no cardiac content.
 *
 * The control for the classifier. A category table that cannot read a script
 * gives the same answer to this as to chest pain, and comparing the two is the
 * only way to tell "the engine recognised a cardiac presentation" from "the
 * engine recognised nothing".
 */
const ANKLE_COMPLAINTS: Readonly<Record<string, string>> = {
  as: 'কালি মোৰ ভৰিৰ গাঁঠি মোচৰা খালে',
  bn: 'কাল আমার পায়ের গোড়ালি মচকে গেছে',
  gu: 'ગઈ કાલે મારો પગની ઘૂંટી મચકોડાઈ ગઈ',
  hi: 'कल मेरा टखना मुड़ गया',
  kn: 'ನಿನ್ನೆ ನನ್ನ ಪಾದದ ಗಂಟು ಉಳುಕಿತು',
  ml: 'ഇന്നലെ എന്റെ കണങ്കാൽ ഉളുക്കി',
  mr: 'काल माझा घोटा मुरगळला',
  or: 'କାଲି ମୋର ଗୋଡ଼ ମୋଡ଼ି ହୋଇଗଲା',
  pa: 'ਕੱਲ੍ਹ ਮੇਰਾ ਗਿੱਟਾ ਮੁੜ ਗਿਆ',
  ta: 'நேற்று என் கணுக்கால் சுளுக்கியது',
  te: 'నిన్న నా చీలమండ బెణికింది',
};

/** Any Indic script at all — for "is this question English?". */
// Two of these block boundaries are combining marks, which is what the rule
// below objects to. It is right in general — a range whose endpoint is a mark
// usually means somebody pasted a grapheme and got a code point — and wrong
// here: these are Unicode block bounds, written deliberately, and the question
// this asks is only ever "is there any Indic code point in this string".
// eslint-disable-next-line no-misleading-character-class
const ANY_INDIC = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

/* ═════════════════════════════ result model ══════════════════════════════ */

/**
 * Three outcomes, not two.
 *
 * `NA` exists so that "Odia has no recogniser" and "IndicF5's weights are
 * gated" can be reported as the untestable things they are. Folding either of
 * them into PASS would be a claim nobody made; folding them into FAIL would
 * hide the real failures in the same column.
 */
type Verdict = 'PASS' | 'FAIL' | 'NA';

interface StepResult {
  verdict: Verdict;
  detail: string;
}

const ok = (detail: string): StepResult => ({ verdict: 'PASS', detail });
const bad = (detail: string): StepResult => ({ verdict: 'FAIL', detail });
const na = (detail: string): StepResult => ({ verdict: 'NA', detail });

interface LanguageRow {
  code: string;
  englishName: string;
  sessionId: string;
  storedLanguage: string;
  step1_session: StepResult;
  step2_submit: StepResult;
  step3_verbatim: StepResult;
  step4_classify: StepResult;
  step4_cardiac: StepResult;
  step5_english: StepResult;
  step6_roundTrip: StepResult;
  classification: readonly ComplaintCategory[];
  redFlags: string[];
  nextQuestion: string;
  ttsDetail: string;
  sttDetail: string;
  latency: Record<string, number>;
}

const rows: LanguageRow[] = [];

/**
 * One entry per defect, not one per language that demonstrates it.
 *
 * Every finding here is found eleven times, once per row, and printing it
 * eleven times buries the other ten findings. The key is the `file:line` plus
 * enough of the first sentence to tell two defects at the same line apart. The
 * languages that showed it are collected beside it, because "all eleven" and
 * "only Tamil" are different bugs and the count is the evidence.
 *
 * `underTest` is set by whichever section is running rather than passed at each
 * call site: a defect is always about the language being walked, and threading
 * that through twenty call sites is twenty chances to pass the wrong one.
 */
interface DefectEntry {
  text: string;
  languages: Set<string>;
}

const defects = new Map<string, DefectEntry>();
let underTest = '';

function defect(line: string): void {
  const dash = line.indexOf(' — ');
  const key = dash === -1 ? line.slice(0, 80) : line.slice(0, dash + 63);
  const existing = defects.get(key);
  if (existing) {
    if (underTest) existing.languages.add(underTest);
    return;
  }
  defects.set(key, {
    text: line,
    languages: new Set(underTest ? [underTest] : []),
  });
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);
}

/* ══════════════════════════════ transport ════════════════════════════════ */

/**
 * Retry a request that never reached the server, and only that.
 *
 * `nest start --watch` is running on this box: a save under `src/` takes the
 * API down for a few seconds while it recompiles, and a request in flight comes
 * back as ECONNRESET rather than as an HTTP status. That is a fact about the
 * development box, not a result about the language pipeline, so it is retried
 * loudly and counted — while anything the server actually answered, including
 * every 4xx and 5xx, is returned untouched. A refusal is a finding; a dropped
 * socket is not.
 */
let transportRetries = 0;

async function resilient<T>(what: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      // `fetch` reports a dropped socket as a bare "fetch failed" and hangs the
      // real reason on `cause`, so both have to be read to tell a transport
      // failure from anything the server actually said.
      const cause =
        error instanceof Error
          ? (error as { cause?: unknown }).cause
          : undefined;
      const described = [
        error instanceof Error ? error.message : String(error),
        cause instanceof Error ? cause.message : '',
        typeof (cause as { code?: unknown })?.code === 'string'
          ? String((cause as { code?: unknown }).code)
          : '',
      ].join(' ');
      const droppedSocket =
        /ECONNRESET|ECONNREFUSED|socket hang up|fetch failed/i.test(described);
      if (!droppedSocket || attempt > 20) throw error;
      transportRetries += 1;
      console.log(
        `  … ${what}: the API dropped the connection (attempt ${attempt}); it is ` +
          'probably recompiling. Waiting 5s.',
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

interface ApiResult<T> {
  status: number;
  data: T | undefined;
  raw: string;
  ms: number;
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return resilient(`${method} ${path}`, () => apiOnce<T>(method, path, body));
}

async function apiOnce<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let parsed: { data?: T } = {};
  try {
    parsed = JSON.parse(raw) as { data?: T };
  } catch {
    /* binary or empty; `raw` is what the caller wanted */
  }
  return {
    status: res.status,
    data: parsed.data,
    raw,
    ms: Date.now() - started,
  };
}

/* ══════════════════════════════ memory ═══════════════════════════════════ */

interface MemorySample {
  freeRamMb: number;
  totalRamMb: number;
  freeCommitMb: number;
  commitLimitMb: number;
}

/**
 * Free RAM and commit headroom, from the OS rather than from this process.
 *
 * `process.memoryUsage()` would report the harness, which is not the thing at
 * risk: two builds died on this box today because the *machine* ran out of
 * commit while a model was loading. `TotalVirtualMemorySize` is the commit
 * limit and `FreeVirtualMemory` the headroom under it, both in KB.
 */
function sampleMemory(): MemorySample | null {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$o = Get-CimInstance Win32_OperatingSystem; ' +
          "'{0},{1},{2},{3}' -f $o.FreePhysicalMemory, $o.TotalVisibleMemorySize, $o.FreeVirtualMemory, $o.TotalVirtualMemorySize",
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    const [freeRam, totalRam, freeCommit, commitLimit] = out
      .trim()
      .split(',')
      .map((value) => Number(value.trim()));
    if ([freeRam, totalRam, freeCommit, commitLimit].some(Number.isNaN)) {
      return null;
    }
    return {
      freeRamMb: Math.round(freeRam / 1024),
      totalRamMb: Math.round(totalRam / 1024),
      freeCommitMb: Math.round(freeCommit / 1024),
      commitLimitMb: Math.round(commitLimit / 1024),
    };
  } catch {
    return null;
  }
}

function printMemory(label: string, sample: MemorySample | null): void {
  if (!sample) {
    console.log(`  ${label}: could not be read`);
    return;
  }
  console.log(
    `  ${label}: free RAM ${sample.freeRamMb} MB / ${sample.totalRamMb} MB, ` +
      `commit headroom ${sample.freeCommitMb} MB / ${sample.commitLimitMb} MB limit`,
  );
}

/* ══════════════════════════════ fixtures ═════════════════════════════════ */

interface QuestionView {
  fieldPath: string;
  prompt: string;
  label?: string;
}

interface SessionView {
  id: string;
  language: string;
  resumed?: boolean;
  consent: { given: boolean; requiredVersion: string | null };
  currentQuestion: QuestionView | null;
}

interface TurnView {
  turnId: string;
  accepted: {
    fieldPath: string | null;
    presence: string | null;
    reason: string | null;
    factId: string | null;
    needsPatientConfirmation: boolean;
  };
  extraction: { queued: boolean; reason: string };
  nextQuestion: QuestionView | null;
  redFlags: Array<{ severity: string; message: string }>;
  patientMessage: string | null;
  serverTimeMs: number;
}

/**
 * A session that is genuinely in the language asked for.
 *
 * `POST /sessions` resumes whatever is open and a resumed session keeps the
 * language it was *started* with — so without closing the previous one, asking
 * for Bengali hands back the Hindi session from the row above and the whole
 * table silently measures one language eleven times. There is no `abandon`
 * route by design, so the close happens here, in the fixture.
 */
async function freshSession(language: string): Promise<SessionView> {
  await prisma.caseSession.updateMany({
    where: { status: { in: ['in_progress', 'review'] } },
    data: { status: 'abandoned' },
  });

  const started = await api<SessionView>('POST', '/case-taking/sessions', {
    kind: 'new_consultation',
    language,
  });
  if (!started.data) {
    throw new Error(
      `could not start a ${language} session: ${started.status} ${started.raw}`,
    );
  }
  const session = started.data;

  if (!session.consent.given && session.consent.requiredVersion) {
    await api('POST', `/case-taking/sessions/${session.id}/consent`, {
      consentVersion: session.consent.requiredVersion,
      accepted: true,
    });
  }
  return session;
}

/** What the row actually holds, read past the API rather than through it. */
async function storedFactText(
  sessionId: string,
  fieldPath: string,
): Promise<string | null> {
  const fact = await prisma.caseFact.findFirst({
    where: { sessionId, fieldPath, supersededById: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!fact) return null;
  const value = fact.valueJson as unknown;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/* ═══════════════════════════ the voice hops ══════════════════════════════ */

interface SpeakResult {
  status: number;
  contentType: string;
  bytes: number;
  provider: string | null;
  spokenLanguage: string | null;
  body: Buffer;
  detail: string;
  ms: number;
}

/** `/tts` through the patient-facing API, which is the path a phone takes. */
async function speakViaApi(
  text: string,
  body: Record<string, unknown>,
): Promise<SpeakResult> {
  return resilient('POST /case-taking/tts', () => speakViaApiOnce(text, body));
}

async function speakViaApiOnce(
  text: string,
  body: Record<string, unknown>,
): Promise<SpeakResult> {
  const started = Date.now();
  const res = await fetch(`${BASE}/case-taking/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, ...body }),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  return {
    status: res.status,
    contentType,
    bytes: buffer.length,
    provider: res.headers.get('x-tts-provider'),
    spokenLanguage: res.headers.get('x-tts-language'),
    body: buffer,
    detail: contentType.includes('audio/wav')
      ? `${buffer.length} bytes`
      : buffer.toString('utf8').slice(0, 200),
    ms: Date.now() - started,
  };
}

/** `/tts` on the sidecar itself, where the provenance headers still exist. */
async function speakViaSidecar(
  text: string,
  language: string,
): Promise<SpeakResult> {
  return resilient('POST <sidecar>/tts', () =>
    speakViaSidecarOnce(text, language),
  );
}

async function speakViaSidecarOnce(
  text: string,
  language: string,
): Promise<SpeakResult> {
  const started = Date.now();
  const res = await fetch(`${SIDECAR}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  return {
    status: res.status,
    contentType,
    bytes: buffer.length,
    provider: res.headers.get('x-tts-provider'),
    spokenLanguage: res.headers.get('x-tts-language'),
    body: buffer,
    detail: contentType.includes('audio/wav')
      ? `${buffer.length} bytes`
      : buffer.toString('utf8').slice(0, 200),
    ms: Date.now() - started,
  };
}

interface HeardResult {
  status: number;
  language: string | null;
  text: string;
  confidence: number | null;
  raw: string;
  ms: number;
}

/**
 * Back through `/stt` with NO language named.
 *
 * Naming one would be assuming the answer. The point of the round trip is that
 * the recogniser, told nothing, says what it heard — which is the only way to
 * tell a question that was spoken in English from a question whose English
 * letters were read out with an Indic voice.
 */
async function hear(audio: Buffer): Promise<HeardResult> {
  return resilient('POST /case-taking/stt', () => hearOnce(audio));
}

async function hearOnce(audio: Buffer): Promise<HeardResult> {
  const started = Date.now();
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
    'question.wav',
  );
  const res = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const raw = await res.text();
  let parsed: {
    data?: { text?: string; language?: string; confidence?: number };
  } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    /* handled by the caller through `raw` */
  }
  return {
    status: res.status,
    language: parsed.data?.language ?? null,
    text: parsed.data?.text ?? '',
    confidence: parsed.data?.confidence ?? null,
    raw,
    ms: Date.now() - started,
  };
}

/* ═════════════════════════════ the per-language walk ═════════════════════ */

async function walk(entry: LanguageCase): Promise<LanguageRow> {
  underTest = entry.code;
  section(`${entry.code} — ${entry.englishName}`);

  const latency: Record<string, number> = {};
  const row: LanguageRow = {
    code: entry.code,
    englishName: entry.englishName,
    sessionId: '',
    storedLanguage: '',
    step1_session: bad('not run'),
    step2_submit: bad('not run'),
    step3_verbatim: bad('not run'),
    step4_classify: bad('not run'),
    step4_cardiac: bad('not run'),
    step5_english: bad('not run'),
    step6_roundTrip: bad('not run'),
    classification: [],
    redFlags: [],
    nextQuestion: '',
    ttsDetail: '',
    sttDetail: '',
    latency,
  };

  /* ── 1. the session, and what it stored about language ──────────────────── */

  const sessionStarted = Date.now();
  const session = await freshSession(entry.code);
  latency.session = Date.now() - sessionStarted;
  row.sessionId = session.id;
  row.storedLanguage = session.language;

  // Read the row itself: the API view is a projection and this is a question
  // about what was persisted. `language` is the only language column on
  // CaseSession — there is no second field for the language of the questions.
  const raw =
    (
      await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "CaseSession" WHERE id = $1`,
        session.id,
      )
    )[0] ?? {};
  const languageColumns = Object.keys(raw).filter((name) => /lang/i.test(name));
  const inputLanguage = raw.inputLanguage as string | undefined;
  const outputLanguage = raw.outputLanguage as string | undefined;
  const legacyLanguage = raw.language as string | undefined;
  const consented = Boolean(raw.consentGivenAt);

  console.log(
    `  session ${session.id}  consent=${consented ? String(raw.consentVersion) : 'NOT GIVEN'}`,
  );
  console.log(
    `  language columns: ${
      languageColumns
        .map((name) => `${name}=${String(raw[name])}`)
        .join('  ') || '(none)'
    }`,
  );
  console.log(
    `  the API's own session view reports language=${session.language}`,
  );

  // The architecture says the patient's choice governs INPUT only, so the row
  // has to be able to say so. Two columns holding two different answers is the
  // shape that claim needs; one column holding the input code is a session that
  // cannot state what language it will answer in.
  if (
    !languageColumns.includes('inputLanguage') ||
    !languageColumns.includes('outputLanguage')
  ) {
    row.step1_session = bad(
      `no input/output split on the row: ${languageColumns.join(', ')}`,
    );
    defect(
      'prisma/schema.prisma:2059 — CaseSession has no inputLanguage/outputLanguage split, so ' +
        'the row cannot record that the patient speaks one language and reads another.',
    );
  } else if (!consented) {
    row.step1_session = bad('consent was not recorded');
  } else if (inputLanguage !== entry.code) {
    row.step1_session = bad(
      `asked for ${entry.code}, inputLanguage=${String(inputLanguage)}`,
    );
    defect(
      'src/modules/case-taking/case-taking.service.ts:241 — a session started with language ' +
        `"${entry.code}" stored inputLanguage=${String(inputLanguage)}. The patient's choice ` +
        'did not reach the column the recogniser is driven from.',
    );
  } else if (outputLanguage !== 'en') {
    row.step1_session = bad(
      `outputLanguage=${String(outputLanguage)}, expected en under the input-only architecture`,
    );
    defect(
      `src/modules/case-taking/case-taking.service.ts:241 — a ${entry.code} session stored ` +
        `outputLanguage=${String(outputLanguage)}. Every session must read and hear English.`,
    );
  } else {
    row.step1_session = ok(
      `input=${String(inputLanguage)} output=${String(outputLanguage)} ` +
        `legacy language=${String(legacyLanguage)}`,
    );
    if (legacyLanguage !== inputLanguage) {
      defect(
        'prisma/schema.prisma:2059 — the retained `language` column is documented as holding ' +
          'the same value as `inputLanguage`, but a ' +
          `${entry.code} session has language=${String(legacyLanguage)} and ` +
          `inputLanguage=${String(inputLanguage)}. Every pre-split reader — the mobile client, ` +
          'the demo seed, an exported case — reads the wrong one.',
      );
    }
  }

  /* ── 2. the complaint, in the patient's own script ──────────────────────── */

  const turn = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'chief_complaint.symptom',
      modality: 'text',
      text: entry.complaint,
    },
  );
  latency.turn = turn.ms;

  if (turn.status !== 200 && turn.status !== 201) {
    row.step2_submit = bad(`HTTP ${turn.status} ${turn.raw.slice(0, 160)}`);
    return row;
  }
  const accepted = turn.data?.accepted;
  console.log(
    `  turn accepted: presence=${String(accepted?.presence)} reason=${String(accepted?.reason)} ` +
      `confirm=${String(accepted?.needsPatientConfirmation)} extraction=${String(turn.data?.extraction.queued)} ` +
      `(${String(turn.data?.extraction.reason)})`,
  );
  row.step2_submit =
    accepted?.presence === 'recorded'
      ? ok(`presence=recorded reason=${String(accepted.reason)}`)
      : bad(
          `presence=${String(accepted?.presence)} reason=${String(accepted?.reason)}`,
        );

  /* ── 3. is the patient's own text still there? ──────────────────────────── */

  const immediate = await storedFactText(session.id, 'chief_complaint.symptom');
  const verbatimNow = immediate === entry.complaint;

  console.log(`  submitted : ${entry.complaint}`);
  console.log(`  stored now: ${String(immediate)}`);

  // The rest of step 3 — does the patient's text survive the background
  // extraction? — is settled below, after the cardiac probe. The wait it needs
  // is twenty-odd seconds long, and there is exactly one open session per
  // patient on this box: leaving a session idle for that long is how another
  // verification script running against the same demo account abandons it out
  // from under this one. Probing first shrinks that window to a round trip.

  /* ── 4. classification, red flags, and the cardiac branch ───────────────── */

  // Run the engine's own classifier over exactly what is in the row. Doing it
  // in-process rather than inferring it from the next question is what makes
  // the result attributable to a function rather than to a guess.
  const classification = classifyComplaint(immediate ?? entry.complaint);
  row.classification = classification;
  const englishBaseline = classifyComplaint(
    'I have had chest pain for three days',
  );

  console.log(
    `  classifyComplaint(stored) -> ${JSON.stringify(classification)}`,
  );
  console.log(
    `  classifyComplaint(English equivalent) -> ${JSON.stringify(englishBaseline)}`,
  );

  row.redFlags = (turn.data?.redFlags ?? []).map((flag) => flag.severity);
  console.log(
    `  red flags from this turn: ${JSON.stringify(turn.data?.redFlags ?? [])}`,
  );

  // Three outcomes, and only one of them is right. `unclassified` is the old
  // failure — the cardiac pathway never opens. Every category at once is the
  // new one: it opens the cardiac pathway and thirteen others with it, so
  // ACS_TRIAD firing proves nothing about whether the complaint was understood.
  // Matching the English baseline is the only result that means the engine read
  // the sentence.
  const overClassified = classification.length >= englishBaseline.length + 3;
  const sameAsEnglish =
    classification.length === englishBaseline.length &&
    englishBaseline.every((category) => classification.includes(category));

  if (sameAsEnglish) {
    row.step4_classify = ok(
      `${classification.join(', ')} — matches the English baseline`,
    );
  } else if (overClassified) {
    row.step4_classify = bad(
      `${classification.length} of ${classification.length} categories at once ` +
        `(English baseline: ${englishBaseline.join(', ')})`,
    );
    defect(
      'src/modules/case-taking/engine/field-registry.ts:368 — classifyComplaint falls back to ' +
        'CLASSIFIABLE_CATEGORIES (every category there is) for any text in a non-English ' +
        `script. A ${entry.englishName} chest-pain complaint is therefore classified as cardiac ` +
        'AND obstetric AND psychiatric AND trauma AND dermatological AND ten more, so ' +
        'ACS_TRIAD fires — but so would every other category-gated rule, for any complaint at ' +
        'all. The flag carries no information: a sprained ankle described in Tamil is a ' +
        'cardiac presentation by the same code path. The comment calls this a floor under the ' +
        'window before translation lands, but the translation never reaches ' +
        'chief_complaint.symptom (the fact is verbatim, permanently, by design), so the ' +
        'window never closes. ' +
        `Repro: classifyComplaint('${entry.complaint}') returns all ` +
        `${classification.length} categories; the English sentence returns ` +
        `${englishBaseline.join(', ')}.`,
    );
  } else {
    row.step4_classify = bad(
      `${classification.join(', ')} — the same sentence in English classifies as ` +
        `${englishBaseline.join(', ')}`,
    );
    defect(
      'src/modules/case-taking/engine/field-registry.ts:150-157 — the cardiac pattern list is ' +
        'English regexes plus two romanised Tamil strings. A chest-pain complaint written in ' +
        `${entry.englishName} script matches nothing, so the cardiac pathway is never entered.`,
    );
  }

  // The blunt probe: try to answer the question the cardiac branch would ask.
  // `hpi.associated.breathlessness` is gated on the cardiac / respiratory /
  // allergic categories, so a 400 here is the classifier failure made concrete.
  const breathless = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'hpi.associated.breathlessness',
      modality: 'choice',
      value: 'yes',
    },
  );
  latency.cardiacProbe = breathless.ms;
  console.log(
    `  probe hpi.associated.breathlessness=yes -> HTTP ${breathless.status} ` +
      `${breathless.status === 200 || breathless.status === 201 ? 'accepted' : breathless.raw.slice(0, 150)}`,
  );

  if (breathless.status === 200 || breathless.status === 201) {
    const sweating = await api<TurnView>(
      'POST',
      `/case-taking/sessions/${session.id}/turns`,
      {
        fieldPath: 'hpi.associated.sweating',
        modality: 'choice',
        value: 'yes',
      },
    );
    const fired = (sweating.data?.redFlags ?? []).concat(
      breathless.data?.redFlags ?? [],
    );
    const flagRows = await prisma.caseRedFlag.findMany({
      where: { sessionId: session.id },
      select: { ruleId: true, severity: true },
    });
    row.redFlags = flagRows.map((flag) => `${flag.ruleId}/${flag.severity}`);
    console.log(
      `  probe hpi.associated.sweating=yes -> HTTP ${sweating.status}; red flags now ` +
        `${JSON.stringify(row.redFlags)} (${fired.length} raised on these turns)`,
    );
    if (row.redFlags.some((flag) => flag.startsWith('ACS_TRIAD'))) {
      row.step4_cardiac = ok(`ACS_TRIAD fired: ${row.redFlags.join(', ')}`);
    } else {
      row.step4_cardiac = bad(
        `chest pain + breathlessness + sweating raised ${row.redFlags.join(', ') || 'nothing'}`,
      );
      defect(
        'src/modules/case-taking/engine/safety-rules.ts:126 — ACS_TRIAD opens with ' +
          "{ kind: 'complaint', anyOf: ['cardiac'] }, which reads classifyComplaint. A " +
          `chest-pain complaint written in ${entry.englishName} script classifies as ` +
          'unclassified, so the rule cannot fire even when the patient then answers yes to ' +
          'breathlessness AND yes to sweating. Both answers are accepted (HTTP 200) and ' +
          'recorded, so the case looks complete and silently carries no critical flag. ' +
          `Repro: start a session with language "${entry.code}", post the complaint in ` +
          `${entry.englishName} script, then post breathlessness=yes and sweating=yes as ` +
          'choice turns; no ACS_TRIAD row exists. The same three answers in English raise it.',
      );
    }
  } else if (/CASE_SESSION_NOT_IN_PROGRESS/.test(breathless.raw)) {
    // Not a result about this product. One open session per patient plus a
    // second verification script running against the same demo login means a
    // session can be abandoned between two of this script's own requests.
    row.step4_cardiac = na(
      'another process abandoned this session mid-walk (one open session per ' +
        'patient, shared demo account) — the probe never reached the engine',
    );
  } else if (
    breathless.status === 400 &&
    /CASE_FIELD_UNKNOWN/.test(breathless.raw)
  ) {
    row.step4_cardiac = bad(
      `HTTP 400 CASE_FIELD_UNKNOWN — the field is not applicable, so the cardiac ` +
        'branch cannot be answered at all',
    );
    defect(
      'src/modules/case-taking/engine/field-registry.ts:650 — hpi.associated.breathlessness is ' +
        "gated on whenCategory('cardiac','respiratory','allergic'). With a non-English " +
        'complaint the category is unclassified, so POST turns for that field return HTTP 400 ' +
        'CASE_FIELD_UNKNOWN and ACS_TRIAD (safety-rules.ts:126) can never fire. ' +
        `Repro: start a ${entry.code} session, post the complaint in ${entry.englishName} ` +
        'script, then post {"fieldPath":"hpi.associated.breathlessness","modality":"choice",' +
        '"value":"yes"}.',
    );
  } else {
    row.step4_cardiac = bad(
      `HTTP ${breathless.status} ${breathless.raw.slice(0, 160)}`,
    );
  }

  // ── step 3, settled ─────────────────────────────────────────────────────
  //
  // Extraction is fire-and-forget and takes eight to twenty seconds on this
  // box. A translation that overwrote the patient's words would land *after*
  // the response, so the immediate reading above is not enough on its own.
  if (turn.data?.extraction.queued && EXTRACT_WAIT_MS > 0) {
    await sleep(EXTRACT_WAIT_MS);
  }
  latency.extractionWait = turn.data?.extraction.queued ? EXTRACT_WAIT_MS : 0;
  const settled = await storedFactText(session.id, 'chief_complaint.symptom');
  const verbatimAfter = settled === entry.complaint;
  console.log(
    `  after ${Math.round(latency.extractionWait / 1000)}s: ${String(settled)}`,
  );

  if (verbatimNow && verbatimAfter) {
    row.step3_verbatim = ok('byte-identical, before and after extraction');
  } else if (verbatimNow && !verbatimAfter) {
    row.step3_verbatim = bad(`extraction replaced it with ${String(settled)}`);
    defect(
      'src/modules/case-taking/case-taking.service.ts:1383 — background extraction overwrote ' +
        `the patient's verbatim ${entry.code} complaint with ${String(settled)}. The record of ` +
        'what the patient said must never be replaced by a translation of it.',
    );
  } else {
    row.step3_verbatim = bad(`stored as ${String(immediate)}`);
  }

  // Did the translation the architecture depends on ever reach the fact the
  // classifier reads? If the row is still in the patient's script after the
  // wait, `complaintCategories` will go on reading a script it cannot parse for
  // the rest of the interview — the "window" the safe-side fallback is
  // documented as covering never closes.
  if (verbatimAfter && turn.data?.extraction.queued) {
    defect(
      'src/modules/case-taking/case-taking.service.ts:1876 — extractionMenu only offers fields ' +
        "whose presence is 'not_assessed', and chief_complaint.symptom is recorded by the " +
        'foreground turn before extraction runs. So the English translation produced at ' +
        'case-taking.service.ts:1319 can never be written to chief_complaint.symptom, and ' +
        'complaintCategories (field-registry.ts:437) reads the original script forever. The ' +
        'all-categories fallback at field-registry.ts:368 is documented as a floor under the ' +
        'window before translation lands; there is no window, it is the permanent state of ' +
        `every non-English interview. Repro: post a ${entry.englishName} complaint, wait ` +
        `${Math.round(EXTRACT_WAIT_MS / 1000)}s, and SELECT "valueJson" FROM "CaseFact" WHERE ` +
        `"fieldPath" = 'chief_complaint.symptom' — it is still ${JSON.stringify(entry.complaint)}.`,
    );
  }

  // The control the over-classification finding needs. If a sprained ankle in
  // this script also classifies as cardiac, then ACS_TRIAD firing above was not
  // the engine recognising chest pain — it was the engine recognising nothing
  // and saying yes to everything.
  const ankle = ANKLE_COMPLAINTS[entry.code];
  if (ankle) {
    const ankleCategories = classifyComplaint(ankle);
    console.log(
      `  CONTROL — classifyComplaint(${JSON.stringify(ankle)}) -> ` +
        `${ankleCategories.length} categories${
          ankleCategories.includes('cardiac') ? ', INCLUDING cardiac' : ''
        }`,
    );
    if (ankleCategories.includes('cardiac')) {
      defect(
        'src/modules/case-taking/engine/field-registry.ts:368 — CONTROL: a complaint with no ' +
          `cardiac content at all ("I twisted my ankle yesterday" in ${entry.englishName}) also ` +
          'classifies as cardiac. Any ACS_TRIAD that fires on a non-English complaint is a ' +
          'false positive by construction, so a clinician reading the red-flag queue cannot ' +
          'use it to triage.',
      );
    }
  }

  /* ── 5. the next question: English, under the new architecture ──────────── */

  const next = turn.data?.nextQuestion;
  row.nextQuestion = next?.prompt ?? '';
  console.log(`  next question: ${row.nextQuestion || '(none)'}`);

  if (!next) {
    row.step5_english = bad('the interview returned no next question');
  } else if (ANY_INDIC.test(next.prompt)) {
    row.step5_english = bad(`Indic script: ${next.prompt.slice(0, 80)}`);
    defect(
      'src/modules/case-taking/case-taking.service.ts:1226 — `askNext` renders the prompt ' +
        'through the phrasebook for the SESSION language, so with ' +
        'MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS=true a ' +
        `${entry.englishName} session is asked its next question in ${entry.englishName} ` +
        'script. Under the input-only architecture every question must come back in English ' +
        'regardless of the session language; nothing in the code implements that rule.',
    );
  } else if (!/[A-Za-z]{3,}/.test(next.prompt)) {
    row.step5_english = bad(`no Latin words in ${JSON.stringify(next.prompt)}`);
  } else {
    row.step5_english = ok(next.prompt.slice(0, 60));
  }

  /* ── 6. that English question, spoken and heard back ────────────────────── */

  if (SKIP_VOICE) {
    row.step6_roundTrip = na('SKIP_VOICE=1');
    return row;
  }

  const toSpeak = row.nextQuestion || 'Where exactly is the pain?';

  // Two calls, deliberately. The first is what the DTO documents as the right
  // thing for a client to do — name the session and let it decide the language.
  // The second names English explicitly. Under the new architecture those two
  // must agree, because the question IS English whatever the session says.
  const viaSession = await speakViaApi(toSpeak, { sessionId: session.id });
  const viaEnglish = await speakViaApi(toSpeak, { language: 'en' });
  latency.ttsSessionScoped = viaSession.ms;
  latency.tts = viaEnglish.ms;

  console.log(
    `  POST /tts {sessionId} -> ${viaSession.status} ${viaSession.contentType || '(no type)'} ${viaSession.detail}`,
  );
  console.log(
    `  POST /tts {language:'en'} -> ${viaEnglish.status} ${viaEnglish.contentType} ${viaEnglish.detail}`,
  );

  if (viaSession.status !== 200 && viaEnglish.status === 200) {
    defect(
      'src/modules/case-taking/case-taking.service.ts:877 — `voiceLanguage` makes the ' +
        'session language win over the body for /tts. The question is now always English, so ' +
        `naming the session on a ${entry.code} interview asks for a ${entry.code} voice that ` +
        `does not exist and gets HTTP ${viaSession.status}: the English question cannot be read ` +
        'aloud through the call the DTO tells clients to make. ' +
        `Repro: POST /api/case-taking/tts {"text":"<English question>","sessionId":"<${entry.code} session>"}.`,
    );
  }

  if (viaEnglish.provider === null) {
    defect(
      'src/modules/ai/sidecar.client.ts:307 — `speak()` returns only the audio buffer, and ' +
        'case-taking.controller.ts:363 writes only Content-Type and Content-Length. The ' +
        "sidecar's X-TTS-Provider / X-TTS-Language headers — added so a wrong-language " +
        'response is detectable from outside — never reach the patient-facing API, so the ' +
        'one invariant that matters is unverifiable through the route patients use.',
    );
  }

  row.ttsDetail =
    `session-scoped ${viaSession.status}; en ${viaEnglish.status} ` +
    `${viaEnglish.bytes} bytes; provider hdr=${viaEnglish.provider ?? 'ABSENT'}`;

  if (
    viaEnglish.status !== 200 ||
    !viaEnglish.contentType.includes('audio/wav')
  ) {
    row.step6_roundTrip = bad(
      `/tts(en) ${viaEnglish.status} ${viaEnglish.detail}`,
    );
    return row;
  }

  const heard = await hear(viaEnglish.body);
  latency.stt = heard.ms;
  console.log(
    `  POST /stt (no language named) -> ${heard.status} language=${String(heard.language)} ` +
      `confidence=${String(heard.confidence)} text=${JSON.stringify(heard.text.slice(0, 90))}`,
  );
  row.sttDetail = `${String(heard.language)} "${heard.text.slice(0, 60)}"`;

  if (heard.status !== 200) {
    row.step6_roundTrip = bad(
      `/stt ${heard.status} ${heard.raw.slice(0, 120)}`,
    );
  } else if (heard.language !== 'en') {
    row.step6_roundTrip = bad(
      `spoke English, heard back as ${String(heard.language)}: ${heard.text.slice(0, 60)}`,
    );
  } else if (ANY_INDIC.test(heard.text)) {
    row.step6_roundTrip = bad(
      `transcript is not Latin script: ${heard.text.slice(0, 60)}`,
    );
  } else {
    row.step6_roundTrip = ok(`heard back as en: ${heard.text.slice(0, 50)}`);
  }

  return row;
}

/* ═══════════════════════════ code-switching ══════════════════════════════ */

interface SwitchRow {
  code: string;
  turn: StepResult;
  englishSurvived: StepResult;
  meaning: StepResult;
  stored: string;
  classification: readonly ComplaintCategory[];
}

/**
 * A sentence with English words inside an Indic one.
 *
 * This is how people actually talk, and it is the case where "store the
 * patient's words verbatim" and "classify with English regexes" happen to
 * agree: `chest pain` is right there in the Tamil sentence, so the classifier
 * can see it. Whether that is a fix or a coincidence is the thing worth
 * reporting.
 */
async function codeSwitch(entry: LanguageCase): Promise<SwitchRow> {
  underTest = entry.code;
  section(`code-switching — ${entry.code} (${entry.englishName})`);
  const text = entry.codeSwitched!;
  console.log(`  submitting: ${text}`);

  const session = await freshSession(entry.code);
  const turn = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    { fieldPath: 'chief_complaint.symptom', modality: 'text', text },
  );

  const accepted =
    (turn.status === 200 || turn.status === 201) &&
    turn.data?.accepted.presence === 'recorded';

  const stored =
    (await storedFactText(session.id, 'chief_complaint.symptom')) ?? '';
  const classification = classifyComplaint(stored || text);
  console.log(`  stored: ${stored}`);
  console.log(`  classifyComplaint -> ${JSON.stringify(classification)}`);

  // Does the English inside it survive the round trip into the fact row, with
  // the Indic half still attached? Either half going missing is the failure.
  const englishIntact =
    /chest\s*pain/i.test(stored) && /three\s*days/i.test(stored);
  const indicIntact = entry.script.test(stored);

  const probe = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'hpi.associated.breathlessness',
      modality: 'choice',
      value: 'yes',
    },
  );
  console.log(
    `  probe hpi.associated.breathlessness -> HTTP ${probe.status}` +
      (probe.status >= 400 ? ` ${probe.raw.slice(0, 120)}` : ' accepted'),
  );

  return {
    code: entry.code,
    turn: accepted
      ? ok(`HTTP ${turn.status}, presence=recorded`)
      : bad(
          `HTTP ${turn.status} presence=${String(turn.data?.accepted.presence)}`,
        ),
    englishSurvived:
      englishIntact && indicIntact
        ? ok('both halves present, byte-identical')
        : bad(
            `english=${String(englishIntact)} indic=${String(indicIntact)} stored=${stored}`,
          ),
    meaning: classification.includes('cardiac')
      ? ok(`cardiac; breathlessness probe HTTP ${probe.status}`)
      : bad(`classified ${classification.join(', ')}`),
    stored,
    classification,
  };
}

/* ════════════════ what "cannot exclude" costs, measured ═════════════════ */

/**
 * The bill for the safe-side reading of an unreadable complaint.
 *
 * `safety-engine.ts` treats a complaint it cannot read as "cannot exclude"
 * rather than "does not match", and argues that this is safe because every rule
 * is a conjunction: a sprained-ankle patient answers no to breathlessness and
 * ACS_TRIAD stays silent. That argument is sound for the patient who answers
 * no. It says nothing about the patient who answers yes for another reason —
 * asthma, anxiety, a fever, a hot waiting room — and that patient exists.
 *
 * So this posts the same two structured answers against a complaint with no
 * cardiac content, once in the patient's own script and once in English, and
 * reports whether the two get the same answer. A difference is not a bug: it is
 * the measured price of the trade-off, and the number belongs in front of
 * whoever decided to pay it.
 */
interface ExclusionRow {
  code: string;
  indicFlags: string[];
  englishFlags: string[];
  verdict: StepResult;
}

const ENGLISH_ANKLE = 'I twisted my ankle yesterday';

/** Complaint, then breathlessness=yes and sweating=yes. What fires? */
async function triadOn(
  language: string,
  complaint: string,
): Promise<{ flags: string[]; probeStatus: number }> {
  const session = await freshSession(language);
  await api<TurnView>('POST', `/case-taking/sessions/${session.id}/turns`, {
    fieldPath: 'chief_complaint.symptom',
    modality: 'text',
    text: complaint,
  });
  const probe = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'hpi.associated.breathlessness',
      modality: 'choice',
      value: 'yes',
    },
  );
  if (probe.status !== 200 && probe.status !== 201) {
    return { flags: [], probeStatus: probe.status };
  }
  await api<TurnView>('POST', `/case-taking/sessions/${session.id}/turns`, {
    fieldPath: 'hpi.associated.sweating',
    modality: 'choice',
    value: 'yes',
  });
  const flags = await prisma.caseRedFlag.findMany({
    where: { sessionId: session.id },
    select: { ruleId: true },
  });
  return { flags: flags.map((flag) => flag.ruleId), probeStatus: probe.status };
}

async function exclusionCost(entry: LanguageCase): Promise<ExclusionRow> {
  section(
    `the cost of "cannot exclude" — ${entry.code} (${entry.englishName})`,
  );
  underTest = entry.code;

  const ankle = ANKLE_COMPLAINTS[entry.code];
  const indic = await triadOn(entry.code, ankle);
  console.log(
    `  ${JSON.stringify(ankle)} + breathlessness + sweating ` +
      `-> probe ${indic.probeStatus}, flags ${JSON.stringify(indic.flags)}`,
  );

  const english = await triadOn('en', ENGLISH_ANKLE);
  console.log(
    `  ${JSON.stringify(ENGLISH_ANKLE)} + breathlessness + sweating ` +
      `-> probe ${english.probeStatus}, flags ${JSON.stringify(english.flags)}`,
  );

  const indicFired = indic.flags.includes('ACS_TRIAD');
  const englishFired = english.flags.includes('ACS_TRIAD');

  if (indicFired && !englishFired) {
    defect(
      'src/modules/case-taking/engine/safety-engine.ts:205 — the complaint condition matches ' +
        'when the complaint is in a script the classifier cannot read ("cannot exclude"). The ' +
        'conjunction argument beside it covers the patient who answers NO to breathlessness; ' +
        'it does not cover the one who answers yes for a non-cardiac reason. Measured: the ' +
        `same non-cardiac complaint plus breathlessness=yes and sweating=yes raises ACS_TRIAD ` +
        `in ${entry.englishName} and NOT in English. So a non-English speaker with asthma and ` +
        'a hot waiting room is routed to the acute-coronary pathway and an English speaker ' +
        'with the identical answers is not — the trade-off is real and its cost falls entirely ' +
        'on the eleven. ' +
        `Repro: POST ${JSON.stringify(ankle)} as chief_complaint.symptom on a ${entry.code} ` +
        'session, then breathlessness=yes and sweating=yes; compare with the same two answers ' +
        `after ${JSON.stringify(ENGLISH_ANKLE)} on an en session.`,
    );
  }

  return {
    code: entry.code,
    indicFlags: indic.flags,
    englishFlags: english.flags,
    verdict:
      indicFired === englishFired
        ? ok(`both ${indicFired ? 'fire' : 'stay silent'}`)
        : bad(
            `${entry.code} ${indicFired ? 'fires' : 'silent'}, en ${
              englishFired ? 'fires' : 'silent'
            } on the same two answers`,
          ),
  };
}

/* ═════════════════════ one Latin token, and the floor goes ═══════════════ */

/**
 * The gap between "is this English?" and "can the engine read this?".
 *
 * Two separate things key off the same test. `extractionDecision` queues the
 * translator when `isNonEnglishScript(text)` is true, and `classifyComplaint`
 * falls back to every category when it is true. `isNonEnglishScript` is
 * `!/[A-Za-z]/.test(text)` — one Latin letter anywhere makes it false.
 *
 * So an Indic sentence carrying one English token — ECG, BP, COVID, a brand
 * name, a unit — is treated as English by both. It is not translated, and when
 * the English keyword table then fails to match it, the answer is
 * `unclassified` rather than the safe-side fallback. That is the original
 * silent failure, reachable with one word, in the one sentence patients are
 * most likely to write that way.
 *
 * This section is not hypothetical arithmetic: it posts the sentence and reads
 * back what the interview did with it.
 */
interface LatinTokenRow {
  code: string;
  text: string;
  categories: readonly ComplaintCategory[];
  verdict: StepResult;
  redFlags: string[];
}

/**
 * A chest-pain complaint in the patient's script, carrying one clinical
 * abbreviation in Latin letters — the way a patient who has had a test writes.
 * No English word for the symptom, so the keyword table has nothing to find.
 */
const LATIN_TOKEN_COMPLAINTS: Readonly<Record<string, string>> = {
  ta: 'எனக்கு மூன்று நாட்களாக நெஞ்சு வலி, ECG எடுக்கவில்லை',
  hi: 'मुझे तीन दिन से सीने में दर्द है, ECG नहीं हुआ',
  bn: 'আমার তিন দিন ধরে বুকে ব্যথা, ECG করাইনি',
  te: 'నాకు మూడు రోజులుగా ఛాతీ నొప్పి, ECG చేయించలేదు',
};

async function latinTokenProbe(entry: LanguageCase): Promise<LatinTokenRow> {
  underTest = entry.code;
  section(`one Latin token — ${entry.code} (${entry.englishName})`);
  const text = LATIN_TOKEN_COMPLAINTS[entry.code];
  console.log(`  submitting: ${text}`);

  const session = await freshSession(entry.code);
  const turn = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    { fieldPath: 'chief_complaint.symptom', modality: 'text', text },
  );
  console.log(
    `  extraction queued=${String(turn.data?.extraction.queued)} ` +
      `(${String(turn.data?.extraction.reason)})`,
  );

  const stored =
    (await storedFactText(session.id, 'chief_complaint.symptom')) ?? text;
  const categories = classifyComplaint(stored);
  console.log(`  classifyComplaint -> ${JSON.stringify(categories)}`);

  const breathless = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'hpi.associated.breathlessness',
      modality: 'choice',
      value: 'yes',
    },
  );
  let flags: string[] = [];
  if (breathless.status === 200 || breathless.status === 201) {
    await api<TurnView>('POST', `/case-taking/sessions/${session.id}/turns`, {
      fieldPath: 'hpi.associated.sweating',
      modality: 'choice',
      value: 'yes',
    });
    flags = (
      await prisma.caseRedFlag.findMany({
        where: { sessionId: session.id },
        select: { ruleId: true },
      })
    ).map((flag) => flag.ruleId);
  }
  console.log(
    `  breathlessness probe HTTP ${breathless.status}; red flags ${JSON.stringify(flags)}`,
  );

  const silenced = !categories.includes('cardiac');
  if (silenced) {
    defect(
      'src/common/constants/language.constants.ts:318 — isNonEnglishScript is ' +
        '`!/[A-Za-z]/.test(text)`, so ONE Latin letter makes an Indic sentence count as ' +
        'English. Both the translation trigger (case-taking.service.ts:1248) and the ' +
        'safe-side classifier fallback (field-registry.ts:368) key off it. A ' +
        `${entry.englishName} chest-pain complaint containing the token "ECG" is therefore ` +
        'neither translated nor given the fallback: classifyComplaint returns ' +
        `[${categories.join(', ')}] and ACS_TRIAD stays silent — the exact failure the ` +
        'fallback was added to prevent, reachable with one abbreviation. ' +
        `Repro: POST a turn on chief_complaint.symptom with ${JSON.stringify(text)}, then ` +
        'breathlessness=yes and sweating=yes; no ACS_TRIAD row is written.',
    );
  }

  return {
    code: entry.code,
    text,
    categories,
    redFlags: flags,
    verdict: silenced
      ? bad(
          `classified ${categories.join(', ')}; red flags ${flags.join(', ') || 'none'}`,
        )
      : ok(
          `classified ${categories.join(', ')}; red flags ${flags.join(', ') || 'none'}`,
        ),
  };
}

/* ═══════════════════════════ the fallback chain ══════════════════════════ */

interface FallbackRow {
  code: string;
  apiStatus: number;
  sidecarStatus: number;
  provider: string | null;
  spokenLanguage: string | null;
  bytes: number;
  verdict: StepResult;
  note: string;
}

/**
 * IndicF5 → Piper → text on screen, proved while IndicF5 is genuinely down.
 *
 * The invariant under test is not "does a voice exist". It is that no request
 * for language X ever returns audio in language Y. There are exactly two
 * acceptable answers per language: WAV whose `X-TTS-Language` is the language
 * asked for, or a refusal with a written sentence. Anything else — a 200 from
 * a provider that does not own the language, a 200 with no provenance at all,
 * a 500 — is the failure the whole package was written after.
 */
async function fallbackChain(): Promise<{
  rows: FallbackRow[];
  health: Record<string, unknown>;
}> {
  // Not about any one language: the chain is asked about all twelve in turn.
  underTest = '';
  section('the fallback chain: IndicF5 → Piper → text on screen');

  const healthRes = await fetch(`${SIDECAR}/health`);
  const health = (await healthRes.json()) as Record<string, unknown>;
  const providers = (health.ttsProviders ?? []) as Array<{
    id: string;
    ready: boolean;
    detail: string;
    languages: string[];
  }>;
  for (const provider of providers) {
    console.log(
      `  provider ${provider.id}: ready=${String(provider.ready)} languages=${JSON.stringify(provider.languages)}` +
        (provider.detail ? `\n      ${provider.detail}` : ''),
    );
  }

  const indicf5 = providers.find((provider) => provider.id === 'indicf5');
  if (indicf5?.ready) {
    console.log(
      '  NOTE: IndicF5 reports ready. The degradation below is therefore NOT being ' +
        'exercised and these rows prove nothing about the fallback.',
    );
  }

  const out: FallbackRow[] = [];
  const englishLine = 'Where exactly is the pain?';

  for (const entry of [{ code: 'en', englishName: 'English' }, ...CASES]) {
    const viaSidecar = await speakViaSidecar(englishLine, entry.code);
    const viaApi = await speakViaApi(englishLine, { language: entry.code });

    const isWav = viaSidecar.contentType.includes('audio/wav');
    console.log(
      `  ${entry.code}: sidecar ${viaSidecar.status} ${isWav ? 'audio/wav' : 'text'} ` +
        `provider=${viaSidecar.provider ?? '-'} lang=${viaSidecar.spokenLanguage ?? '-'} ` +
        `${viaSidecar.detail}  |  api ${viaApi.status}`,
    );

    let verdict: StepResult;
    let note: string;

    if (viaSidecar.status === 200 && isWav) {
      if (viaSidecar.spokenLanguage === entry.code) {
        verdict = ok(`spoken by ${viaSidecar.provider ?? 'unknown'}`);
        note =
          viaSidecar.provider === 'piper' && entry.code !== 'en'
            ? 'IndicF5 declined or failed; Piper picked it up — hop 2 of the chain'
            : 'native provider';
      } else {
        verdict = bad(
          `asked for ${entry.code}, response says ${String(viaSidecar.spokenLanguage)}`,
        );
        note =
          'WRONG LANGUAGE AT 200 — the invariant this package exists to hold';
      }
    } else if (viaSidecar.status === 503) {
      verdict = ok(`refused: ${viaSidecar.detail}`);
      note =
        'no provider owns this language with IndicF5 down — hop 3, text on screen';
    } else {
      verdict = bad(`HTTP ${viaSidecar.status} ${viaSidecar.detail}`);
      note = 'neither audio nor a written refusal';
    }

    if (viaApi.status !== viaSidecar.status) {
      note +=
        `; API answered ${viaApi.status} where the sidecar answered ` +
        `${viaSidecar.status}: ${viaApi.detail}`;
    }
    if (viaApi.status === 200 && viaApi.provider === null) {
      note += '; API dropped X-TTS-Provider';
    }

    out.push({
      code: entry.code,
      apiStatus: viaApi.status,
      sidecarStatus: viaSidecar.status,
      provider: viaSidecar.provider,
      spokenLanguage: viaSidecar.spokenLanguage,
      bytes: viaSidecar.bytes,
      verdict,
      note,
    });
  }

  return { rows: out, health };
}

/* ═════════════════════════════ Odia, explicitly ══════════════════════════ */

/**
 * Odia has no recogniser, so the only question is what happens when one is
 * asked for anyway. A refusal is correct. A transcript is not — and a
 * transcript is what detection produces, in some neighbouring language, with
 * nothing on the response saying so.
 */
async function odiaStt(): Promise<StepResult> {
  underTest = 'or';
  section('Odia — what /stt does when there is no Odia model');

  const explicit = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: (() => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(2048)], { type: 'audio/wav' }),
        'x.wav',
      );
      form.append('language', 'or');
      return form;
    })(),
  });
  const explicitBody = await explicit.text();
  console.log(
    `  POST /stt language=or -> ${explicit.status} ${explicitBody.slice(0, 220)}`,
  );

  // The other door: name an Odia SESSION instead of the language. `voiceLanguage`
  // resolves `or` from the session, `sttLanguageFor` turns it into `undefined`,
  // and the sidecar is asked to detect — which is guessing.
  const session = await freshSession('or');
  const spoken = await speakViaSidecar('Where exactly is the pain?', 'en');
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(spoken.body)], { type: 'audio/wav' }),
    'q.wav',
  );
  form.append('sessionId', session.id);
  const viaSession = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const viaSessionBody = await viaSession.text();
  console.log(
    `  POST /stt sessionId=<or session> -> ${viaSession.status} ${viaSessionBody.slice(0, 260)}`,
  );

  const refusedExplicitly = explicit.status === 400;
  const guessed = viaSession.status === 200;

  if (guessed) {
    defect(
      'src/common/constants/language.constants.ts:238 — `sttLanguageFor` answers `undefined` ' +
        'for `or`, which tells the sidecar to auto-detect rather than refuse. Reached through ' +
        '`case-taking.service.ts:815`, an Odia session posting audio to /stt gets HTTP 200 and ' +
        'a transcript in some neighbouring language, with nothing in the response saying the ' +
        'language was guessed. The brief requires a clean refusal. The explicit ' +
        '`language=or` door does refuse (400), so the two doors disagree. ' +
        'Repro: start a session with language "or", POST /api/case-taking/stt with any wav and ' +
        'that sessionId and no `language` field.',
    );
  }

  return refusedExplicitly && !guessed
    ? ok('refused on both doors')
    : bad(
        `explicit language=or -> ${explicit.status}; via an Odia session -> ${viaSession.status}` +
          (guessed ? ' with a transcript (guessed)' : ''),
      );
}

/* ═════════════════════════════════ output ═══════════════════════════════ */

function cell(result: StepResult): string {
  return result.verdict;
}

function table(header: string[], body: string[][]): void {
  const widths = header.map((column, index) =>
    Math.max(column.length, ...body.map((line) => (line[index] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    '| ' +
    cells
      .map((value, index) => (value ?? '').padEnd(widths[index]))
      .join(' | ') +
    ' |';
  console.log(line(header));
  console.log(
    '|' + widths.map((width) => '-'.repeat(width + 2)).join('|') + '|',
  );
  for (const entry of body) console.log(line(entry));
}

/* ═══════════════════════════════════ main ═══════════════════════════════ */

async function main(): Promise<void> {
  console.log('MediHive — eleven languages, end to end');
  console.log(`API      ${BASE}`);
  console.log(`sidecar  ${SIDECAR}`);
  console.log(
    `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS=${String(process.env.MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS)}`,
  );
  console.log(
    'Architecture under test: the chosen language governs INPUT only; ' +
      'questions come back in ENGLISH.',
  );

  section('memory, before');
  const before = sampleMemory();
  printMemory('before', before);

  const login = await api<{ accessToken: string }>('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  if (!login.data?.accessToken) {
    throw new Error(`login failed: ${login.status} ${login.raw}`);
  }
  token = login.data.accessToken;

  const selected =
    ONLY.length > 0 ? CASES.filter((c) => ONLY.includes(c.code)) : CASES;
  for (const entry of selected) {
    rows.push(await walk(entry));
  }

  const switches: SwitchRow[] = [];
  for (const entry of selected.filter((item) => item.codeSwitched)) {
    switches.push(await codeSwitch(entry));
  }

  const latinTokens: LatinTokenRow[] = [];
  for (const entry of selected.filter(
    (item) => LATIN_TOKEN_COMPLAINTS[item.code],
  )) {
    latinTokens.push(await latinTokenProbe(entry));
  }

  const exclusion: ExclusionRow[] = [];
  for (const entry of selected.filter((item) => ANKLE_COMPLAINTS[item.code])) {
    exclusion.push(await exclusionCost(entry));
  }

  const fallback = await fallbackChain();
  const odia = await odiaStt();

  section('memory, after');
  const after = sampleMemory();
  printMemory('after', after);

  /* ── the tables ─────────────────────────────────────────────────────────── */

  section('per language');
  table(
    [
      'lang',
      'name',
      '1 session',
      '2 submit',
      '3 verbatim',
      '4 classify',
      '4 cardiac',
      '5 English Q',
      '6 tts→stt',
    ],
    rows.map((row) => [
      row.code,
      row.englishName,
      cell(row.step1_session),
      cell(row.step2_submit),
      cell(row.step3_verbatim),
      cell(row.step4_classify),
      cell(row.step4_cardiac),
      cell(row.step5_english),
      cell(row.step6_roundTrip),
    ]),
  );

  console.log('\ndetail, per language:');
  for (const row of rows) {
    console.log(
      `\n  ${row.code} (${row.englishName}) — session ${row.sessionId}`,
    );
    console.log(
      `    1 session   ${row.step1_session.verdict}  ${row.step1_session.detail}`,
    );
    console.log(
      `    2 submit    ${row.step2_submit.verdict}  ${row.step2_submit.detail}`,
    );
    console.log(
      `    3 verbatim  ${row.step3_verbatim.verdict}  ${row.step3_verbatim.detail}`,
    );
    console.log(
      `    4 classify  ${row.step4_classify.verdict}  ${row.step4_classify.detail}`,
    );
    console.log(
      `    4 cardiac   ${row.step4_cardiac.verdict}  ${row.step4_cardiac.detail}`,
    );
    console.log(
      `    5 English Q ${row.step5_english.verdict}  ${row.step5_english.detail}`,
    );
    console.log(
      `    6 round trip ${row.step6_roundTrip.verdict}  ${row.step6_roundTrip.detail}`,
    );
    console.log(`    red flags   ${row.redFlags.join(', ') || '(none)'}`);
    console.log(`    tts         ${row.ttsDetail || '(not run)'}`);
    console.log(`    stt         ${row.sttDetail || '(not run)'}`);
    console.log(
      `    latency ms  ${Object.entries(row.latency)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
  }

  section('code-switching');
  table(
    ['lang', 'turn succeeds', 'English survives', 'meaning extracted'],
    switches.map((row) => [
      row.code,
      cell(row.turn),
      cell(row.englishSurvived),
      cell(row.meaning),
    ]),
  );
  for (const row of switches) {
    console.log(
      `  ${row.code}: stored=${JSON.stringify(row.stored)} classify=${JSON.stringify(row.classification)}`,
    );
    console.log(`      turn: ${row.turn.detail}`);
    console.log(`      english: ${row.englishSurvived.detail}`);
    console.log(`      meaning: ${row.meaning.detail}`);
  }

  section('one Latin token inside an Indic complaint');
  table(
    ['lang', 'categories', 'red flags', 'verdict'],
    latinTokens.map((row) => [
      row.code,
      String(row.categories.length),
      row.redFlags.join(', ') || 'none',
      cell(row.verdict),
    ]),
  );
  for (const row of latinTokens) {
    console.log(`  ${row.code}: ${JSON.stringify(row.text)}`);
    console.log(`      -> ${JSON.stringify(row.categories)}`);
    console.log(`      ${row.verdict.detail}`);
  }

  section(
    'the cost of "cannot exclude": same two answers, non-cardiac complaint',
  );
  table(
    ['lang', 'flags in this language', 'flags in English', 'verdict'],
    exclusion.map((row) => [
      row.code,
      row.indicFlags.join(', ') || 'none',
      row.englishFlags.join(', ') || 'none',
      cell(row.verdict),
    ]),
  );
  for (const row of exclusion)
    console.log(`  ${row.code}: ${row.verdict.detail}`);

  section('fallback chain (IndicF5 unavailable — the degradation is live)');
  table(
    [
      'lang',
      'sidecar',
      'api',
      'provider',
      'X-TTS-Language',
      'bytes',
      'verdict',
    ],
    fallback.rows.map((row) => [
      row.code,
      String(row.sidecarStatus),
      String(row.apiStatus),
      row.provider ?? '-',
      row.spokenLanguage ?? '-',
      String(row.bytes),
      cell(row.verdict),
    ]),
  );
  for (const row of fallback.rows) {
    console.log(`  ${row.code}: ${row.verdict.detail} — ${row.note}`);
  }

  const wrongLanguage = fallback.rows.filter(
    (row) => row.sidecarStatus === 200 && row.spokenLanguage !== row.code,
  );
  console.log(
    `\n  INVARIANT — no request ever returned audio in another language: ${
      wrongLanguage.length === 0
        ? 'HELD'
        : `BROKEN for ${wrongLanguage.map((row) => row.code).join(', ')}`
    }`,
  );

  section('Odia speech');
  console.log(`  ${odia.verdict}  ${odia.detail}`);

  section('memory');
  printMemory('before', before);
  printMemory('after ', after);
  if (before && after) {
    console.log(
      `  delta: free RAM ${after.freeRamMb - before.freeRamMb} MB, ` +
        `commit headroom ${after.freeCommitMb - before.freeCommitMb} MB`,
    );
    const degraded = after.freeRamMb < before.freeRamMb - 1024;
    console.log(
      degraded
        ? '  THIS RUN DEGRADED THE BOX: more than 1 GB of free RAM went and did not come back.'
        : '  This run did not meaningfully degrade the box.',
    );
  }

  section('the run itself');
  console.log(
    `  transport retries (the API recompiling under \`nest start --watch\`): ${transportRetries}`,
  );

  section('defects');
  if (defects.size === 0) {
    console.log('  none found');
  } else {
    let index = 0;
    for (const entry of defects.values()) {
      index += 1;
      const seen =
        entry.languages.size > 0
          ? `\n     seen in: ${[...entry.languages].join(', ')} (${entry.languages.size})`
          : '';
      console.log(`\n  ${index}. ${entry.text}${seen}`);
    }
  }

  const failures =
    rows.flatMap((row) =>
      [
        row.step1_session,
        row.step2_submit,
        row.step3_verbatim,
        row.step4_classify,
        row.step4_cardiac,
        row.step5_english,
        row.step6_roundTrip,
      ].filter((result) => result.verdict === 'FAIL'),
    ).length +
    switches.flatMap((row) =>
      [row.turn, row.englishSurvived, row.meaning].filter(
        (result) => result.verdict === 'FAIL',
      ),
    ).length +
    latinTokens.filter((row) => row.verdict.verdict === 'FAIL').length +
    exclusion.filter((row) => row.verdict.verdict === 'FAIL').length +
    fallback.rows.filter((row) => row.verdict.verdict === 'FAIL').length +
    (odia.verdict === 'FAIL' ? 1 : 0);

  console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch(async (error: unknown) => {
  console.error('\nverification aborted:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
