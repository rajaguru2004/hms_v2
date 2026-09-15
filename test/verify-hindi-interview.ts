/**
 * Does the interview actually ask its questions in Hindi, end to end?
 *
 * Not "is there a phrasebook" — that is a unit test. This runs against the
 * server that is actually up, with the patient demo account, and follows one
 * question all the way round the loop:
 *
 *   session in `hi`  →  next question comes back in Devanagari
 *                    →  that exact string goes to `/tts`, Piper returns wav
 *                    →  that wav goes back to `/stt` with NO language named
 *                    →  Whisper says `hi` and returns Devanagari
 *
 * The last step is the one that matters. Naming the language to the recogniser
 * would be assuming the answer; sending the audio unlabelled and getting `hi`
 * back is the round trip proving that what Piper spoke was recognisably Hindi
 * and not Devanagari characters read as English phonemes.
 *
 * Run with the gate open — the whole point of the run is to exercise a
 * translation that no clinician has signed off yet:
 *
 *   MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS=true npx ts-node test/verify-hindi-interview.ts
 *
 * Run it with the flag off too. The expected result then is that every question
 * comes back in English, and the script says so rather than failing: that is the
 * review gate doing its job.
 */

import '../prisma/load-env';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const BASE = process.env.HMS_API ?? 'http://127.0.0.1:3000/api';
const EMAIL = 'patient@hms.local';
const PASSWORD = 'Demo@HMS2024!';

const DEVANAGARI = /[ऀ-ॿ]/;
const TAMIL = /[஀-௿]/;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let token = '';
let failures = 0;

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`);
}

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`,
  );
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | undefined; raw: string }> {
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
    /* a binary or empty body; `raw` is what the caller wanted anyway */
  }
  return { status: res.status, data: parsed.data, raw };
}

interface QuestionView {
  fieldPath: string;
  prompt: string;
}

interface SessionView {
  id: string;
  language: string;
  resumed: boolean;
  consent: { given: boolean; requiredVersion: string | null };
  currentQuestion: QuestionView | null;
}

interface TurnView {
  nextQuestion: QuestionView | null;
}

/**
 * A fresh session in a given language.
 *
 * `POST /sessions` resumes whatever is open, and a resumed session keeps the
 * language it was started with — so without closing the previous one, asking
 * for Hindi hands back the English session from the run before and the whole
 * test silently measures nothing.
 */
async function freshSession(language: string): Promise<SessionView> {
  // There is no `abandon` route — a patient does not abandon an interview, they
  // walk away from it — so the open session is closed here, in the fixture,
  // rather than by adding an endpoint that exists only for tests.
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
      `could not start a session: ${started.status} ${started.raw}`,
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

async function main(): Promise<void> {
  const flagOn = process.env.MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS === 'true';
  console.log(
    `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS=${String(flagOn)} (as this script sees it)`,
  );

  const login = await api<{ accessToken: string }>('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  if (!login.data?.accessToken) {
    throw new Error(`login failed: ${login.status} ${login.raw}`);
  }
  token = login.data.accessToken;

  /* ── what the server says it can do ─────────────────────────────────────── */

  section('the capability surface');
  const catalogue = await api<
    Array<{
      code: string;
      questions: string;
      questionSource: string | null;
      tts: boolean;
      stt: boolean;
    }>
  >('GET', '/case-taking/languages');
  const hiRow = catalogue.data?.find((row) => row.code === 'hi');
  const taRow = catalogue.data?.find((row) => row.code === 'ta');
  console.log('  hi:', JSON.stringify(hiRow));
  console.log('  ta:', JSON.stringify(taRow));
  check(
    'the languages endpoint reports the question-translation state, not just speech',
    hiRow?.questionSource === 'machine_draft' &&
      taRow?.questionSource === 'human_draft',
    `hi=${String(hiRow?.questions)} ta=${String(taRow?.questions)}`,
  );

  /* ── Hindi: the question ────────────────────────────────────────────────── */

  section('a Hindi session, and the question it asks');
  const session = await freshSession('hi');
  console.log(
    '  session:',
    JSON.stringify({
      id: session.id,
      language: session.language,
      resumed: session.resumed,
    }),
  );
  console.log(
    '  currentQuestion:',
    JSON.stringify(session.currentQuestion, null, 2),
  );

  const opening = await api<TurnView>(
    'POST',
    `/case-taking/sessions/${session.id}/turns`,
    {
      fieldPath: 'chief_complaint.symptom',
      modality: 'text',
      text: 'तीन दिन से सीने में दर्द हो रहा है',
    },
  );
  const next = opening.data?.nextQuestion ?? null;
  console.log('  nextQuestion:', JSON.stringify(next, null, 2));

  if (!next) throw new Error('the interview returned no next question');

  if (flagOn) {
    check(
      'the next question is in Devanagari, not English',
      DEVANAGARI.test(next.prompt),
      next.prompt,
    );
    check(
      'and there is no English left in it',
      !/[A-Za-z]{3,}/.test(next.prompt),
      next.prompt,
    );
  } else {
    check(
      'GATE SHUT: the next question is in English, because nobody has reviewed the Hindi',
      !DEVANAGARI.test(next.prompt),
      next.prompt,
    );
    console.log(
      '\n  (re-run with MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS=true for the Hindi half)',
    );
    console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* ── Hindi: the voice ───────────────────────────────────────────────────── */

  section('the same string, read aloud and heard back');
  const spoken = await fetch(`${BASE}/case-taking/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: next.prompt, language: 'hi' }),
  });
  const audio = Buffer.from(await spoken.arrayBuffer());
  const wav = (spoken.headers.get('content-type') ?? '').includes('audio/wav');
  console.log(
    `  POST /tts -> ${spoken.status} ${String(spoken.headers.get('content-type'))} ${audio.length} bytes` +
      (wav ? '' : ` ${audio.toString('utf8').slice(0, 200)}`),
  );
  check(
    'Piper returns real Hindi audio',
    spoken.status === 200 && wav && audio.length > 20000,
    wav
      ? `${spoken.status}, ${audio.length} bytes`
      : `${spoken.status} — if this says the voice is unavailable while /health lists ` +
          '`hi` under piper, check WHICH interpreter is serving :8801: the sidecar must ' +
          'run from ai-sidecar/.venv, and a host-interpreter process that won the port ' +
          'reports the voice and then cannot load it',
  );

  if (!wav) {
    console.log(
      [
        '',
        '  Cannot round-trip through /tts. To test the recogniser half anyway,',
        '  synthesise with the deployed voice directly and post that wav to /stt:',
        '    ai-sidecar/.venv/Scripts/python.exe  ->  PiperVoice.load(',
        '      "ai-sidecar/voices/hi_IN-pratham-medium.onnx")',
      ].join('\n'),
    );
  }

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'question.wav');
  // Deliberately no `language`: the recogniser has to work it out, which is the
  // whole proof. Naming `hi` here would be assuming the answer.
  const heard = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const heardBody = (await heard.json()) as {
    data?: { text?: string; language?: string; confidence?: number };
  };
  console.log('  POST /stt ->', JSON.stringify(heardBody.data, null, 2));

  const transcript = heardBody.data?.text ?? '';
  check(
    'Whisper detects Hindi from the audio alone',
    heardBody.data?.language === 'hi',
    String(heardBody.data?.language),
  );
  check(
    'and returns Devanagari, not a romanisation',
    DEVANAGARI.test(transcript),
    transcript.slice(0, 120),
  );

  /* ── Tamil: the text half works, the voice half does not ─────────────────── */

  section('Tamil — the phrasebook exists, the voice does not');
  const tamil = await freshSession('ta');
  console.log(
    '  session:',
    JSON.stringify({
      id: tamil.id,
      language: tamil.language,
      resumed: tamil.resumed,
    }),
  );
  console.log(
    '  currentQuestion:',
    JSON.stringify(tamil.currentQuestion, null, 2),
  );
  check(
    'a Tamil session asks its first question in Tamil script',
    TAMIL.test(tamil.currentQuestion?.prompt ?? ''),
    tamil.currentQuestion?.prompt ?? '(none)',
  );

  const tamilVoice = await fetch(`${BASE}/case-taking/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text: tamil.currentQuestion?.prompt ?? '',
      language: 'ta',
    }),
  });
  const tamilBody = await tamilVoice.text();
  console.log(
    `  POST /tts (ta) -> ${tamilVoice.status} ${tamilBody.slice(0, 200)}`,
  );
  check(
    'and refuses to read it aloud in a written sentence, rather than playing silence',
    tamilVoice.status === 503 || tamilVoice.status === 400,
    String(tamilVoice.status),
  );

  console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('\nverification aborted:', error);
  process.exit(1);
});
