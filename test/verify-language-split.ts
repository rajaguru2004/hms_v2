/**
 * The interview's two languages, against the running API.
 *
 * ── What this proves that a unit test cannot
 *
 * That the column exists, that the migration ran, and that a Tamil patient
 * starting an interview on this box right now is recorded as speaking Tamil and
 * answered in English. The service spec asserts the routing against an
 * in-memory repository; this asserts it against Postgres and the wire format
 * the phone actually parses.
 *
 * Run: npx ts-node test/verify-language-split.ts
 */

const BASE = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:3000/api';
const EMAIL = process.env.VERIFY_EMAIL ?? 'patient@hms.local';
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'Demo@HMS2024!';

let token = '';

interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await response.json()) as Envelope<T>;
  if (!response.ok) {
    throw new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

function check(label: string, ok: boolean, saw: unknown): void {
  if (!ok) throw new Error(`FAILED: ${label} (saw ${JSON.stringify(saw)})`);
  console.log(`  ok  ${label}  ${JSON.stringify(saw)}`);
}

interface SessionView {
  id: string;
  language: string;
  inputLanguage: string;
  outputLanguage: string;
  consent: { given: boolean; requiredVersion: string | null };
  currentQuestion: { prompt: string } | null;
}

interface LanguageRow {
  code: string;
  stt: boolean;
  tts: boolean;
  outputLanguage: string;
  outputTts: boolean;
}

/**
 * 44 bytes of silent WAV. Enough to be a file: the language is refused at the
 * validation pipe, so nothing here ever reaches a recogniser.
 */
function wavHeader(): ArrayBuffer {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(0, 40);
  // Copied into a plain ArrayBuffer: a Node Buffer's backing store is a shared
  // pool, which is not a `BlobPart`.
  const bytes = new ArrayBuffer(buffer.length);
  new Uint8Array(bytes).set(buffer);
  return bytes;
}

/** English wording is ASCII; every phrasebook this could fall to is not. */
function isAscii(text: string): boolean {
  return /^[\x20-\x7E\s]+$/.test(text);
}

async function main(): Promise<void> {
  const login = await call<{ accessToken: string }>('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  token = login.data.accessToken;
  console.log(`signed in as ${EMAIL}`);

  console.log('\nGET /case-taking/languages');
  const catalogue = await call<LanguageRow[]>('GET', '/case-taking/languages');
  const rows = catalogue.data;
  check('is still an ARRAY, not an object wrapper', Array.isArray(rows), {
    type: Array.isArray(rows) ? 'array' : typeof rows,
    length: rows.length,
  });
  const tamil = rows.find((row) => row.code === 'ta');
  const odia = rows.find((row) => row.code === 'or');
  check('Tamil can be spoken', tamil?.stt === true, tamil);
  check(
    'Odia still cannot be transcribed — no faster-whisper model',
    odia?.stt === false,
    { code: odia?.code, stt: odia?.stt },
  );
  check(
    'every row is answered in English',
    rows.every((row) => row.outputLanguage === 'en'),
    [...new Set(rows.map((row) => row.outputLanguage))],
  );
  check(
    'the ten non-Odia Indic rows are all usable for INPUT',
    rows.filter((row) => row.code !== 'or' && row.code !== 'en').length ===
      10 &&
      rows
        .filter((row) => row.code !== 'or' && row.code !== 'en')
        .every((row) => row.stt),
    rows.filter((row) => row.stt).map((row) => row.code),
  );

  // `POST /sessions` resumes whatever is open, and a resumed session keeps the
  // language it was started with — so an interview left open by an earlier run
  // would be handed back and this would silently measure nothing. It is closed
  // through the API a patient would use (a refused consent abandons a session)
  // rather than by reaching into the database from a verification script.
  //
  // That open session is also the evidence for the MIGRATION: it was started
  // before the split, so its `inputLanguage` can only be the value the backfill
  // copied out of the old `language` column.
  console.log('\nGET /case-taking/sessions/current (a pre-split row, if any)');
  const open = await call<SessionView | null>(
    'GET',
    '/case-taking/sessions/current',
  );
  if (open.data) {
    check(
      'a session started before the split reads back with both languages',
      typeof open.data.inputLanguage === 'string' &&
        open.data.inputLanguage === open.data.language &&
        open.data.outputLanguage === 'en',
      {
        language: open.data.language,
        inputLanguage: open.data.inputLanguage,
        outputLanguage: open.data.outputLanguage,
      },
    );
    await call('POST', `/case-taking/sessions/${open.data.id}/consent`, {
      consentVersion: open.data.consent.requiredVersion ?? '2026.09.1',
      accepted: false,
    });
    console.log('  (closed the open interview so a Tamil one can be started)');
  }

  console.log('\nPOST /case-taking/sessions {"language":"ta"}');
  const started = await call<SessionView>('POST', '/case-taking/sessions', {
    kind: 'new_consultation',
    language: 'ta',
  });
  const session = started.data;
  check('input language is Tamil', session.inputLanguage === 'ta', {
    inputLanguage: session.inputLanguage,
  });
  check('output language is English', session.outputLanguage === 'en', {
    outputLanguage: session.outputLanguage,
  });
  check(
    'the legacy `language` field still carries the patient\u2019s choice',
    session.language === 'ta',
    { language: session.language },
  );

  const prompt = session.currentQuestion?.prompt ?? '';
  check(
    'the question comes back in English',
    prompt.length > 0 && isAscii(prompt),
    prompt,
  );

  console.log('\nGET /case-taking/sessions/:id');
  const reread = await call<SessionView>(
    'GET',
    `/case-taking/sessions/${session.id}`,
  );
  check(
    'the split survives a re-read, so it is on the row and not in a response',
    reread.data.inputLanguage === 'ta' && reread.data.outputLanguage === 'en',
    {
      inputLanguage: reread.data.inputLanguage,
      outputLanguage: reread.data.outputLanguage,
    },
  );

  // The routing, where a patient would hear it: the same Tamil session, asked
  // to read its own English question aloud. The sidecar is handed `en`, which
  // is the voice that is actually installed — so this is a 200 with audio in it
  // rather than a refusal for a missing Tamil voice.
  console.log('\nPOST /case-taking/tts for the Tamil session');
  const spoken = await fetch(`${BASE}/case-taking/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // A Tamil `language` in the body on purpose: the session's OUTPUT language
    // has to win over it, or the handset is still deciding.
    body: JSON.stringify({
      text: prompt,
      language: 'ta',
      sessionId: session.id,
    }),
  });
  const audio = spoken.ok
    ? Buffer.from(await spoken.arrayBuffer())
    : Buffer.alloc(0);
  check(
    'the question is read aloud by the output language’s voice',
    spoken.ok && audio.length > 0,
    {
      status: spoken.status,
      contentType: spoken.headers.get('content-type'),
      bytes: audio.length,
    },
  );

  // The other direction, on the same session and with NO language in the body:
  // the recogniser has to be told Tamil, and it is the session's INPUT language
  // that tells it. The sidecar echoes back the language it was given, which is
  // what makes this an assertion about routing rather than about the audio.
  console.log('\nPOST /case-taking/stt for the Tamil session');
  const heardForm = new FormData();
  heardForm.append('sessionId', session.id);
  heardForm.append(
    'file',
    new Blob([wavHeader()], { type: 'audio/wav' }),
    'a.wav',
  );
  const heard = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: heardForm,
  });
  const heardBody = (await heard.json()) as Envelope<{ language?: string }>;
  check(
    'the recogniser is told Tamil, from the session and not from the body',
    heard.ok && heardBody.data?.language === 'ta',
    { status: heard.status, language: heardBody.data?.language },
  );

  // The client sends the raw OS tag without narrowing it, so a code this build
  // has no row for arrives here unmodified. It has to be refused rather than
  // passed to a recogniser that would detect *something* and hand back a
  // confident transcript in the wrong language — which becomes a clinical fact.
  console.log('\nan unsupported code on both voice routes');
  const refusedTts = await fetch(`${BASE}/case-taking/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: 'hello', language: 'ur' }),
  });
  check('/tts refuses it', refusedTts.status === 400, {
    status: refusedTts.status,
  });

  const form = new FormData();
  form.append('language', 'ur');
  form.append('file', new Blob([wavHeader()], { type: 'audio/wav' }), 'a.wav');
  const refusedStt = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  check(
    '/stt refuses it too, on the multipart field',
    refusedStt.status === 400,
    {
      status: refusedStt.status,
    },
  );

  // And the one that is refused for a different reason: Odia has a voice but no
  // recogniser anywhere, so it is not in the STT set at all.
  const odiaForm = new FormData();
  odiaForm.append('language', 'or');
  odiaForm.append(
    'file',
    new Blob([wavHeader()], { type: 'audio/wav' }),
    'a.wav',
  );
  const refusedOdia = await fetch(`${BASE}/case-taking/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: odiaForm,
  });
  check(
    '/stt still refuses Odia rather than letting the recogniser guess',
    refusedOdia.status === 400,
    { status: refusedOdia.status },
  );

  console.log('\nall checks passed');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
