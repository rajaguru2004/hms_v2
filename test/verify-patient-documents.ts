import '../prisma/load-env';

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * The acceptance check for document intelligence.
 *
 * The unit specs mock the OCR sidecar and the model, which is the only way to
 * test a pipeline deterministically — and it means they prove nothing about
 * what PP-OCRv5 reads off a photograph of a prescription, or what `gemma3:4b`
 * makes of the text when it gets it. This runs the whole thing:
 *
 *   npx ts-node -r tsconfig-paths/register test/verify-patient-documents.ts
 *
 * Requires `npm run db:seed`, a server on port 3000, the Python sidecar on
 * 127.0.0.1:8801 and Ollama with `gemma3:4b`. On this hardware a page costs
 * about five seconds of OCR and fifteen to seventy of the model, so the polls
 * below wait minutes rather than seconds — slow is not the same as broken.
 *
 * The fixtures come from `test/fixtures/generate-documents.py`. The prescription
 * is the important one and it is important for what it does *not* have: no
 * allergy section, so "not found must never become no" can be watched rather
 * than argued about.
 *
 * Seven things are on trial:
 *
 *   1. A prescription is read, structured, and stopped at `needs_review`.
 *   2. A laboratory report comes back as investigations, not prose.
 *   3. The same file twice is recorded and reported, never refused, and never
 *      read a second time.
 *   4. An unreadable photograph gets a sentence a patient can act on, with no
 *      component named in it.
 *   5. A document that says nothing about allergies produces no claim about
 *      allergies.
 *   6. The original is retrievable by its owner and by nobody else.
 *   7. OCR confidence and extraction confidence stay two numbers, and neither
 *      of them is the model's opinion of itself.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000/api';

const FIXTURES = join(__dirname, 'fixtures');

/** How long the pipeline may take on one page before this script gives up. */
const PIPELINE_TIMEOUT_MS = 300_000;

/** How often to ask. The client the mobile app ships polls at about this rate. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Strings that mean the inside of the system leaked into a patient's screen.
 *
 * §27's worked example is `PP-OCR inference exception` reaching somebody who
 * wanted to know whether to take another photograph. The list is deliberately
 * wider than that one string: what must not appear is any word that belongs to
 * the machine rather than to the person holding it.
 */
const TECHNICAL_LEAKS = [
  'pp-ocr',
  'ppocr',
  'paddle',
  'ocr',
  'inference',
  'exception',
  'traceback',
  'stack',
  'stderr',
  'null',
  'undefined',
  'nan',
  'timeout',
  'econnrefused',
  'http',
  'json',
  'python',
  'sidecar',
  'ollama',
  'gemma',
  'model',
  'tensor',
  'buffer',
  'status code',
];

/** The claim §19 forbids a silent document from making on a patient's behalf. */
const INVENTED_NEGATIVES = [
  'no known allergies',
  'no known allergy',
  'nkda',
  'no allergies',
  'none known',
  'denies allergies',
  'allergies: none',
  'no drug allergies',
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

interface Medication {
  name: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  uncertain: boolean;
}

interface Investigation {
  test: string;
  result: string | null;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
}

interface Provenance {
  page: number;
  field: string;
  value: string;
  source: string;
  grounded: boolean;
  documentId: string;
  verification: string;
  ocrConfidence: number | null;
}

interface DocumentFact {
  label: string;
  values: string[];
  presence: string;
}

interface ExtractionEnvelope {
  document: { type: string; date: string | null; facility: string | null };
  medications: Medication[];
  investigations: Investigation[];
  diagnosesRecorded: string[];
  procedures: string[];
  followUp: string[];
  allergies: string[];
  facts: Record<string, DocumentFact>;
  sources: Provenance[];
  ungrounded: string[];
  contradictions: { kind: string; topic: string; message: string }[];
  confidence: {
    ocr: number | null;
    ocrSource: string;
    extraction: number | null;
    extractionSource: string;
  };
  verificationStatus: string;
}

interface DocumentView {
  id: string;
  patientId: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  status: string;
  docType: string | null;
  docTypeConfidence: number | null;
  ocrEngine: string | null;
  ocrConfidence: number | null;
  extractionConfidence: number | null;
  extraction: ExtractionEnvelope | null;
  visionFallbackUsed: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  message: string;
  uploadedAt: string;
  processedAt: string | null;
  verifiedAt: string | null;
}

interface OriginalView {
  url: string;
  expiresInSeconds: number;
  expiresAt: string;
  mimeType: string;
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
  elapsedMs: number;
}

/** Retries a refused connection — `nest start --watch` restarts on every edit. */
async function call<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; form?: FormData } = {},
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
          // Never set for multipart: `fetch` writes the boundary itself, and a
          // hand-written Content-Type would leave it out.
          ...(opts.form ? {} : { 'Content-Type': 'application/json' }),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body:
          opts.form ??
          (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
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

async function login(email: string, password: string): Promise<string | null> {
  const res = await call<TokenPair>('POST', '/auth/login', {
    body: { email, password },
  });
  return res.body.data?.accessToken ?? null;
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function leaksIn(text: string, words: string[]): string[] {
  const haystack = text.toLowerCase();
  return words.filter((word) => haystack.includes(word));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN = Date.now();
const PORTAL_PASSWORD = 'Documents@12345';

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
 * Fresh on every run rather than the seeded `patient@hms.local`: half of what is
 * on trial here is what a *second* upload does, and a shared account carries
 * whatever the last run left behind. `POST /patient-auth/claim` is the door a
 * real patient comes through and `verify-patient-auth.ts` is where that door is
 * tested; it is rate limited to five a minute, so this script does not spend
 * them on setup.
 */
async function makePortalPatient(
  adminToken: string,
  who: string,
): Promise<Portal | null> {
  const patient = await call<PatientRow>('POST', '/patients', {
    token: adminToken,
    body: {
      firstName: who,
      lastName: `Documents${RUN}`,
      dateOfBirth: '1972-01-30',
      gender: 'male',
      phonePrimary: '+251911000000',
    },
  });
  if (!patient.body.data) return null;

  const email = `docs.${who.toLowerCase()}.${RUN}@hms.local`;
  const user = await call<UserRow>('POST', '/users', {
    token: adminToken,
    body: {
      email,
      password: PORTAL_PASSWORD,
      firstName: who,
      lastName: 'Documents',
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

  return { patientId: patient.body.data.id, mrn: patient.body.data.mrn, token };
}

const MIME: Record<string, string> = {
  png: 'image/png',
  pdf: 'application/pdf',
};

async function upload(
  token: string,
  filename: string,
): Promise<Res<DocumentView>> {
  const bytes = readFileSync(join(FIXTURES, filename));
  const extension = filename.split('.').pop() ?? 'png';
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], {
      type: MIME[extension] ?? 'application/octet-stream',
    }),
    filename,
  );

  return call<DocumentView>('POST', '/patient-documents', { token, form });
}

/**
 * Poll until the pipeline has finished with this document.
 *
 * `uploaded` is ambiguous on purpose — it is both "the queue has not picked
 * this up" and "this is a duplicate and never will be" — so a row that carries
 * a `processedAt` is finished whatever its status says.
 */
async function settled(
  token: string,
  id: string,
): Promise<{ document: DocumentView | null; waitedMs: number }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PIPELINE_TIMEOUT_MS) {
    const res = await call<DocumentView>('GET', `/patient-documents/${id}`, {
      token,
    });
    const document = res.body.data;
    if (!document) {
      return { document: null, waitedMs: Date.now() - startedAt };
    }
    const running =
      (document.status === 'uploaded' && document.processedAt === null) ||
      document.status === 'processing';
    if (!running) {
      return { document, waitedMs: Date.now() - startedAt };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return { document: null, waitedMs: Date.now() - startedAt };
}

/** Everything the row holds that the response DTO deliberately does not carry. */
async function storedText(id: string): Promise<string | null> {
  const row = await prisma.patientDocument.findUnique({
    where: { id },
    select: { ocrText: true },
  });
  return row?.ocrText ?? null;
}

async function main(): Promise<void> {
  console.log(`\x1b[1mPatient documents\x1b[0m  →  ${BASE}`);

  // ── Setup ─────────────────────────────────────────────────────────────────
  section('setup');

  const adminToken = await login(
    process.env.SEED_ADMIN_EMAIL ?? 'admin@hms.local',
    process.env.SEED_ADMIN_PASSWORD ?? 'Admin@HMS2024!',
  );
  check('an administrator can sign in', Boolean(adminToken));
  if (!adminToken) return;

  const owner = await makePortalPatient(adminToken, 'Owner');
  const other = await makePortalPatient(adminToken, 'Other');
  check(
    'two patients with portal accounts exist to test against',
    owner !== null && other !== null,
  );
  if (!owner || !other) return;
  note(`owner ${owner.mrn} · other ${other.mrn}`);

  const prescriptionBytes = readFileSync(join(FIXTURES, 'prescription.png'));
  check(
    'the fixtures are on disk',
    prescriptionBytes.length > 0 &&
      readFileSync(join(FIXTURES, 'lab-report.png')).length > 0 &&
      readFileSync(join(FIXTURES, 'unreadable.png')).length > 0 &&
      readFileSync(join(FIXTURES, 'too-small.png')).length > 0,
  );

  // ── 1. A prescription, read for real ──────────────────────────────────────
  section('a photographed prescription is read and structured');

  const posted = await upload(owner.token, 'prescription.png');
  check(
    'the upload is accepted',
    posted.status === 201 && Boolean(posted.body.data?.id),
    `${posted.status} ${String(posted.body.message)}`,
  );
  check(
    'and answers straight away rather than holding the request open',
    posted.elapsedMs < 5_000 && posted.body.data?.status === 'uploaded',
    `${posted.elapsedMs}ms, status ${String(posted.body.data?.status)}`,
  );
  check(
    'the patient is told it is being read',
    (posted.body.data?.message ?? '').toLowerCase().includes('reading'),
    String(posted.body.data?.message),
  );

  const prescriptionId = posted.body.data?.id;
  if (!prescriptionId) return;

  const read = await settled(owner.token, prescriptionId);
  check(
    'the pipeline finishes',
    read.document !== null,
    `waited ${Math.round(read.waitedMs / 1000)}s`,
  );
  if (!read.document) return;
  note(`the prescription took ${Math.round(read.waitedMs / 1000)}s end to end`);

  const prescription = read.document;
  check(
    'the recogniser actually read the page',
    prescription.ocrEngine !== null && (prescription.ocrConfidence ?? 0) > 0.5,
    `${String(prescription.ocrEngine)} at ${String(prescription.ocrConfidence)}`,
  );

  const ocrText = await storedText(prescriptionId);
  console.log(
    '\n  \x1b[2m── what the recogniser read ──────────────────\x1b[0m',
  );
  for (const line of (ocrText ?? '').split('\n')) {
    console.log(`  \x1b[2m│\x1b[0m ${line}`);
  }
  console.log(
    '  \x1b[2m──────────────────────────────────────────────\x1b[0m\n',
  );

  check(
    'and read the medicines that are printed on it',
    ['METFORMIN', 'AMLODIPINE', 'ATORVASTATIN'].every((drug) =>
      (ocrText ?? '').toUpperCase().includes(drug),
    ),
    `${(ocrText ?? '').length} characters`,
  );

  check(
    'the document is classified as a prescription',
    prescription.docType === 'prescription' &&
      (prescription.docTypeConfidence ?? 0) > 0.5,
    `${String(prescription.docType)} at ${String(prescription.docTypeConfidence)}`,
  );

  const extraction = prescription.extraction;
  check('an extraction envelope came back', extraction !== null);
  if (!extraction) return;

  const drugNames = extraction.medications
    .map((medication) => medication.name.toUpperCase())
    .join(' | ');
  check(
    'every medicine on the page is structured, not summarised',
    extraction.medications.length === 3 &&
      ['METFORMIN', 'AMLODIPINE', 'ATORVASTATIN'].every((drug) =>
        drugNames.includes(drug),
      ),
    `${extraction.medications.length}: ${drugNames}`,
  );
  check(
    'with the strength and the dosing beside each one',
    extraction.medications.every(
      (medication) =>
        (medication.strength ?? '').length > 0 &&
        (medication.frequency ?? '').length > 0,
    ),
    extraction.medications
      .map((m) => `${m.name} ${String(m.strength)} ${String(m.frequency)}`)
      .join(' | '),
  );
  note(
    extraction.medications
      .map(
        (m) =>
          `${m.name} ${String(m.strength)} — ${String(m.dose)}, ` +
          `${String(m.frequency)}, ${String(m.route)}`,
      )
      .join('\n  '),
  );

  check(
    'every extracted value carries where it came from',
    extraction.sources.length > 0 &&
      extraction.sources.every(
        (source) =>
          source.documentId === prescriptionId &&
          source.source === 'uploaded_document' &&
          source.verification === 'unverified' &&
          typeof source.page === 'number',
      ),
    `${extraction.sources.length} provenance entries`,
  );
  check(
    'and each of those values was actually found in the text',
    extraction.sources.every((source) => source.grounded) &&
      extraction.ungrounded.length === 0,
    `${extraction.ungrounded.length} ungrounded`,
  );

  check(
    'the document stops at needs_review — nothing is auto-verified',
    prescription.status === 'needs_review' && prescription.verifiedAt === null,
    `${prescription.status} / ${String(prescription.verifiedAt)}`,
  );
  check(
    'and the envelope says so in its own words',
    extraction.verificationStatus === 'unverified',
    extraction.verificationStatus,
  );
  check(
    'the patient is asked to check it before it becomes history',
    prescription.message.toLowerCase().includes('check that it is correct'),
    prescription.message,
  );

  const notYetVerified = await prisma.patientDocument.count({
    where: { patientId: owner.patientId, status: 'verified' },
  });
  check(
    'no document reached verified without somebody saying so',
    notYetVerified === 0,
    `${notYetVerified} already verified`,
  );

  // ── 2. A laboratory report ────────────────────────────────────────────────
  section('a laboratory report comes back as investigations');

  const labPost = await upload(owner.token, 'lab-report.png');
  const labId = labPost.body.data?.id;
  check('the report uploads', labPost.status === 201 && Boolean(labId));
  if (!labId) return;

  const labRead = await settled(owner.token, labId);
  check(
    'and is read',
    labRead.document !== null,
    `waited ${Math.round(labRead.waitedMs / 1000)}s`,
  );
  if (!labRead.document?.extraction) return;
  note(
    `the lab report took ${Math.round(labRead.waitedMs / 1000)}s end to end`,
  );

  const lab = labRead.document;
  const labExtraction = lab.extraction as ExtractionEnvelope;

  check(
    'it is recognised as a laboratory report',
    lab.docType === 'laboratory_report',
    String(lab.docType),
  );
  check(
    'every row of the table comes back as its own investigation',
    labExtraction.investigations.length === 7,
    `${labExtraction.investigations.length}: ${labExtraction.investigations
      .map((investigation) => investigation.test)
      .join(', ')}`,
  );
  check(
    'each one keeps the result the report printed',
    labExtraction.investigations.every(
      (investigation) => (investigation.result ?? '').length > 0,
    ),
    labExtraction.investigations
      .map((i) => `${i.test}=${String(i.result)}`)
      .join(' | '),
  );
  note(
    labExtraction.investigations
      .map(
        (i) =>
          `${i.test}: ${String(i.result)} ${String(i.unit)} ` +
          `(ref ${String(i.referenceRange)})`,
      )
      .join('\n  '),
  );
  check(
    'and nothing on a lab report is presented as a diagnosis',
    labExtraction.diagnosesRecorded.length === 0,
    labExtraction.diagnosesRecorded.join(', '),
  );
  check(
    'the report is held for review like everything else',
    lab.status === 'needs_review' && lab.verifiedAt === null,
    lab.status,
  );

  // ── 3. The same document twice ────────────────────────────────────────────
  section('the same file again is recorded and told, never refused');

  const copy = await upload(owner.token, 'prescription.png');
  check(
    'the second upload is accepted rather than rejected',
    copy.status === 201 && Boolean(copy.body.data?.id),
    `${copy.status} ${String(copy.body.errorCode)}`,
  );
  check(
    'it is recorded as a copy of the one already held',
    copy.body.data?.isDuplicate === true &&
      copy.body.data.duplicateOfId === prescriptionId,
    `duplicateOf ${String(copy.body.data?.duplicateOfId)}`,
  );
  check(
    'and the patient is told, in a sentence',
    (copy.body.data?.message ?? '').toLowerCase().includes('already uploaded'),
    String(copy.body.data?.message),
  );

  const copyId = copy.body.data?.id;
  if (!copyId) return;

  // The evidence that the pipeline did not run again is on the row: a document
  // that was read has an engine, a confidence and an extraction. A copy has
  // none of them, and a `processedAt` that says it was decided rather than
  // queued.
  const copyRow = await prisma.patientDocument.findUnique({
    where: { id: copyId },
  });
  check(
    'the copy was never sent to the recogniser or the model',
    copyRow?.ocrEngine === null &&
      copyRow?.ocrText === null &&
      copyRow?.extraction === null &&
      copyRow?.extractionConfidence === null,
    `engine ${String(copyRow?.ocrEngine)}, extraction ${JSON.stringify(
      copyRow?.extraction,
    )}`,
  );
  check(
    'it is finished rather than queued',
    copyRow?.processedAt !== null && copyRow?.status === 'uploaded',
    `${String(copyRow?.status)} at ${String(copyRow?.processedAt)}`,
  );
  check(
    'the original is untouched by the copy arriving',
    (await prisma.patientDocument.findUnique({ where: { id: prescriptionId } }))
      ?.duplicateOfId === null,
  );

  const extractedForOwner = await prisma.patientDocument.count({
    where: {
      patientId: owner.patientId,
      extraction: { not: Prisma.DbNull },
    },
  });
  check(
    'the patient still has one prescription and one report, not three documents of findings',
    extractedForOwner === 2,
    `${extractedForOwner} documents carry an extraction`,
  );

  check(
    'and the copy points at the same stored original, so the evidence is kept once',
    copyRow?.fileKey ===
      (
        await prisma.patientDocument.findUnique({
          where: { id: prescriptionId },
        })
      )?.fileKey,
  );

  // ── 4. A photograph nobody can read ───────────────────────────────────────
  section('an unreadable photograph is refused in writing');

  const refusals: { name: string; document: DocumentView }[] = [];

  for (const name of ['unreadable.png', 'too-small.png']) {
    const post = await upload(owner.token, name);
    const id = post.body.data?.id;
    if (!id) {
      check(`${name} uploads`, false, `${post.status}`);
      continue;
    }
    const outcome = await settled(owner.token, id);
    if (!outcome.document) {
      check(`${name} is answered`, false, 'never settled');
      continue;
    }
    refusals.push({ name, document: outcome.document });
  }

  check('both unreadable fixtures were answered', refusals.length === 2);

  for (const { name, document } of refusals) {
    check(
      `${name} is refused rather than half-read`,
      document.status === 'rejected_quality' || document.status === 'failed',
      document.status,
    );
    check(
      `${name} gets a sentence a patient can act on`,
      document.message.length > 30 &&
        document.message.toLowerCase().includes('please'),
      document.message,
    );

    const leaked = leaksIn(document.message, TECHNICAL_LEAKS);
    check(
      `${name}'s message names nothing inside the machine`,
      leaked.length === 0,
      leaked.join(', '),
    );
    note(`${name}: "${document.message}"`);

    check(
      `nothing was extracted from ${name}`,
      document.extraction === null && document.extractionConfidence === null,
    );
  }

  const keptRefusals = await prisma.patientDocument.count({
    where: { patientId: owner.patientId, status: 'rejected_quality' },
  });
  check(
    'a refused document is kept rather than thrown away',
    keptRefusals === 2,
    `${keptRefusals} rows`,
  );

  // ── 5. Not found is not no ────────────────────────────────────────────────
  //
  // The prescription fixture has no allergy section. §19's requirement is that
  // silence stays silence: the extraction must not fill the gap, the derived
  // fact must say the document did not mention it, and the words "no known
  // allergies" must not appear anywhere in what is stored.
  section('a document that says nothing about allergies claims nothing');

  check(
    'the extraction lists no allergies, because the page names none',
    extraction.allergies.length === 0,
    extraction.allergies.join(', '),
  );

  const allergyFact = extraction.facts.allergies;
  check(
    'the derived fact says the document did not mention them',
    allergyFact?.presence === 'not_assessed' && allergyFact.values.length === 0,
    `${String(allergyFact?.presence)} / "${String(allergyFact?.label)}"`,
  );
  check(
    'and says it in words that cannot be read as "none"',
    /does not mention/i.test(allergyFact?.label ?? ''),
    String(allergyFact?.label),
  );
  note(`allergies: "${String(allergyFact?.label)}"`);

  const envelopeBlob = JSON.stringify(extraction);
  const invented = leaksIn(envelopeBlob, INVENTED_NEGATIVES);
  check(
    'nowhere in the extraction does it say the patient has no known allergies',
    invented.length === 0,
    invented.join(', '),
  );

  const labBlob = JSON.stringify(labExtraction);
  check(
    'the same holds for the report, which mentions neither allergies nor drugs',
    leaksIn(labBlob, INVENTED_NEGATIVES).length === 0 &&
      labExtraction.facts.medications?.presence === 'not_assessed' &&
      /does not mention/i.test(labExtraction.facts.medications?.label ?? ''),
    `medications: "${String(labExtraction.facts.medications?.label)}"`,
  );

  const storedBlob = JSON.stringify(
    await prisma.patientDocument.findMany({
      where: { patientId: owner.patientId },
      select: { extraction: true, failureReason: true },
    }),
  );
  check(
    'and nothing of the sort reached the database either',
    leaksIn(storedBlob, INVENTED_NEGATIVES).length === 0,
  );

  // ── 6. The original, as evidence ──────────────────────────────────────────
  section('the original is kept, and only its owner can open it');

  const original = await call<OriginalView>(
    'GET',
    `/patient-documents/${prescriptionId}/original`,
    { token: owner.token },
  );
  check(
    'the owner gets a link to the file they uploaded',
    original.status === 200 && Boolean(original.body.data?.url),
    `${original.status} ${String(original.body.message)}`,
  );
  check(
    'and the link expires',
    (original.body.data?.expiresInSeconds ?? 0) > 0 &&
      (original.body.data?.expiresInSeconds ?? 0) <= 900,
    `${String(original.body.data?.expiresInSeconds)}s`,
  );
  check(
    'it is signed rather than a bare object address',
    /[?&]X-Amz-Signature=/.test(original.body.data?.url ?? ''),
    (original.body.data?.url ?? '').split('?')[0],
  );

  if (original.body.data?.url) {
    const fetched = await fetch(original.body.data.url);
    const downloaded = Buffer.from(await fetched.arrayBuffer());
    check(
      'the link returns the bytes that were uploaded, unchanged',
      fetched.status === 200 &&
        sha256(downloaded) === sha256(prescriptionBytes),
      `${fetched.status}, ${downloaded.length} of ${prescriptionBytes.length} bytes`,
    );
  }

  const strangerReads = await call<DocumentView>(
    'GET',
    `/patient-documents/${prescriptionId}`,
    { token: other.token },
  );
  check(
    'another patient cannot read the document',
    strangerReads.status === 404 &&
      strangerReads.body.errorCode === 'PATIENT_DOCUMENT_NOT_FOUND',
    `${strangerReads.status} ${String(strangerReads.body.errorCode)}`,
  );
  check(
    'and nothing of it comes back with the refusal',
    strangerReads.body.data === undefined,
  );

  const strangerOriginal = await call<OriginalView>(
    'GET',
    `/patient-documents/${prescriptionId}/original`,
    { token: other.token },
  );
  check(
    'nor ask for a link to the original',
    strangerOriginal.status === 404 && strangerOriginal.body.data === undefined,
    `${strangerOriginal.status}`,
  );

  const absent = await call<DocumentView>(
    'GET',
    `/patient-documents/cl000000000000000000absent`,
    { token: other.token },
  );
  check(
    'a document that exists and one that does not are refused identically',
    absent.status === strangerReads.status &&
      absent.body.errorCode === strangerReads.body.errorCode &&
      absent.body.message === strangerReads.body.message,
    `${absent.status} ${String(absent.body.errorCode)}`,
  );

  const strangerLists = await call<{ data: DocumentView[] }>(
    'GET',
    `/patient-documents?patientId=${owner.patientId}`,
    { token: other.token },
  );
  const strangerRows = strangerLists.body.data?.data ?? [];
  check(
    "another patient's list holds none of this patient's documents, " +
      'even when it asks for them by id',
    strangerLists.status === 200 &&
      strangerRows.every((row) => row.patientId === other.patientId),
    `${strangerRows.length} rows, ${
      strangerRows.filter((row) => row.patientId === owner.patientId).length
    } of them the owner's`,
  );

  // ── 7. Two confidences, and neither is the model's opinion ────────────────
  section('OCR confidence and extraction confidence stay two numbers');

  check(
    'the recogniser reports a measured confidence',
    typeof prescription.ocrConfidence === 'number' &&
      extraction.confidence.ocr === prescription.ocrConfidence &&
      extraction.confidence.ocrSource === 'measured',
    `${String(prescription.ocrConfidence)} (${extraction.confidence.ocrSource})`,
  );
  check(
    'the extraction carries a separate number, marked as derived here',
    typeof prescription.extractionConfidence === 'number' &&
      extraction.confidence.extraction === prescription.extractionConfidence &&
      extraction.confidence.extractionSource === 'derived',
    `${String(prescription.extractionConfidence)} (${
      extraction.confidence.extractionSource
    })`,
  );
  check(
    'they are stored as two fields, never blended into one score',
    Object.keys(extraction.confidence).sort().join(',') ===
      'extraction,extractionSource,ocr,ocrSource',
    Object.keys(extraction.confidence).join(','),
  );

  // The derivation, recomputed: extraction confidence is the share of extracted
  // values found verbatim in the source text. If it were the model's own
  // number, this arithmetic would not land on it.
  const grounded = extraction.sources.filter(
    (source) => source.grounded,
  ).length;
  const derived =
    extraction.sources.length > 0 ? grounded / extraction.sources.length : null;
  check(
    'and the extraction number is the evidence, recomputed from the provenance',
    derived !== null &&
      Math.abs((prescription.extractionConfidence ?? -1) - derived) < 0.01,
    `${grounded}/${extraction.sources.length} = ${String(derived)} vs stored ${String(
      prescription.extractionConfidence,
    )}`,
  );
  note(
    `ocr ${String(prescription.ocrConfidence)} (measured) · ` +
      `extraction ${String(prescription.extractionConfidence)} (derived from ` +
      `${grounded}/${extraction.sources.length} grounded values)`,
  );

  check(
    'the model is never asked what it thinks of itself',
    !/"(self|model)?confidence"\s*:\s*[0-9]/i.test(
      JSON.stringify(extraction.medications) +
        JSON.stringify(extraction.investigations),
    ) && !/certainty|selfConfidence|modelConfidence/i.test(envelopeBlob),
  );
  check(
    'and a perfect extraction score still does not promote the document',
    prescription.extractionConfidence === 1
      ? prescription.status === 'needs_review'
      : true,
    `${String(prescription.extractionConfidence)} → ${prescription.status}`,
  );
  check(
    'uncertainty is the model’s to report about the reading, not about itself',
    extraction.medications.every(
      (medication) => typeof medication.uncertain === 'boolean',
    ),
    extraction.medications
      .map((m) => `${m.name}:${String(m.uncertain)}`)
      .join(' '),
  );

  // ── 8. Confirming is a person's job ───────────────────────────────────────
  section('the only way out of needs_review is somebody saying so');

  const verified = await call<DocumentView>(
    'POST',
    `/patient-documents/${prescriptionId}/verify`,
    { token: owner.token },
  );
  check(
    'the owner can confirm what was found',
    verified.status === 200 &&
      verified.body.data?.status === 'verified' &&
      Boolean(verified.body.data.verifiedAt),
    `${verified.status} ${String(verified.body.data?.status)}`,
  );
  check(
    'and is told it is now part of their history',
    (verified.body.data?.message ?? '').toLowerCase().includes('confirmed'),
    String(verified.body.data?.message),
  );
  check(
    'confirming does not silently rewrite what was extracted',
    JSON.stringify(verified.body.data?.extraction) ===
      JSON.stringify(extraction),
  );

  const twice = await call<DocumentView>(
    'POST',
    `/patient-documents/${prescriptionId}/verify`,
    { token: owner.token },
  );
  check(
    'there is nothing left to confirm a second time',
    twice.status === 400 &&
      twice.body.errorCode === 'PATIENT_DOCUMENT_NOT_READY',
    `${twice.status} ${String(twice.body.errorCode)}`,
  );

  const strangerVerifies = await call<DocumentView>(
    'POST',
    `/patient-documents/${labId}/verify`,
    { token: other.token },
  );
  check(
    'and another patient cannot confirm this one’s documents',
    strangerVerifies.status === 404,
    `${strangerVerifies.status} ${String(strangerVerifies.body.errorCode)}`,
  );
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
