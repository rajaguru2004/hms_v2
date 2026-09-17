import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { assertLocalDatabase } from './load-env';
import { hashPassword } from '../src/common/utils/hash.util';
import {
  rebuildState,
  rowDataFromFact,
} from '../src/modules/case-taking/case-state';
import { CONSENT_VERSION } from '../src/modules/case-taking/case-taking.service';
import {
  renderCase,
  renderCaseText,
} from '../src/modules/case-taking/engine/case-renderer';
import { ClinicalState } from '../src/modules/case-taking/engine/clinical-state';
import {
  findField,
  valueSpecFor,
} from '../src/modules/case-taking/engine/field-registry';
import {
  interviewProgress,
  interviewStatus,
  selectNext,
} from '../src/modules/case-taking/engine/question-selector';
import { evaluate } from '../src/modules/case-taking/engine/safety-engine';
import { RULESET_VERSION } from '../src/modules/case-taking/engine/safety-rules';
import {
  AnswerModality,
  FactPresence,
  FactSource,
  FactValue,
  factFromAnswer,
  recorded,
} from '../src/modules/case-taking/engine/tri-state';

assertLocalDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

/**
 * Case-taking demo seed — five patients who tell five different stories.
 *
 * Run order:  npm run db:seed → npm run db:seed:catalog → npm run db:seed:demo
 * (`db:seed:demo` runs `test/seed-demo.ts` and then this file; `db:reset:demo`
 * runs the whole chain from an empty database.)
 *
 * ── Why this writes through Prisma rather than the HTTP API
 *
 * `test/seed-demo.ts` goes through the API on purpose: MRN minting, queue
 * numbering and stock decrement live in NestJS services, and rows inserted
 * behind them render but cannot advance. None of that applies here. The
 * case-taking routes are patient-scoped by construction — `PatientSelfGuard`
 * discards any patient id in the request and substitutes the caller's own — so
 * driving them would mean signing in as each patient and conducting a live
 * interview, one HTTP round trip per question, with a document pipeline that
 * needs OCR and a 4B model to agree with itself twice in a row. That is not a
 * seed, it is a flaky integration test. So the rows are written directly, and
 * everything derived from them is derived **by the engine itself**.
 *
 * ── Why the engine computes the data rather than the author
 *
 * Nothing below hand-writes a presence, a red flag, a progress percentage or a
 * structured case. The script says what the assistant asked and what the
 * patient said; `factFromAnswer` decides the presence exactly as
 * `CaseTakingService.applyAnswer` would, `evaluate` fires the safety rules
 * exactly as `submitTurn` would, and `renderCase` builds the submission exactly
 * as `submit` would. Hand-written fixtures drift from the code the moment a
 * rule changes; data produced by the code cannot. Each scripted answer also
 * declares the presence it expects and the seed refuses to run if the engine
 * disagrees — so a rule change that would have made the demo lie fails here,
 * loudly, instead of on stage.
 *
 * ── Idempotency
 *
 * Every row is upserted on a fixed `case-` id or on the natural key the app
 * itself would have minted (MRN, e-mail). Re-running updates in place and never
 * duplicates; `npm run db:reset:demo` rebuilds the same world.
 *
 * ── Freshness
 *
 * Interview timestamps are offsets from *now*, not from a literal date, so a
 * session seeded this morning still reads as "in progress, last touched four
 * minutes ago" when the demo is given this afternoon. Appointments land on
 * today's date so the patient dashboard is not empty.
 */

// ── Time ─────────────────────────────────────────────────────────────────────

/**
 * Now, or a pinned instant for visual-regression runs:
 *   SEED_ANCHOR_DATE=2026-03-15T08:00:00+05:30 npm run db:seed:case-taking
 */
const NOW = ((): Date => {
  const override = process.env.SEED_ANCHOR_DATE;
  if (!override) return new Date();
  const pinned = new Date(override);
  if (Number.isNaN(pinned.getTime())) {
    throw new Error(`SEED_ANCHOR_DATE is not a valid date: ${override}`);
  }
  return pinned;
})();

/** `minutes` ago. Negative for the future. */
function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

/** Today at `hour:minute` local — the shape an appointment is booked in. */
function todayAt(hour: number, minute = 0): Date {
  const d = new Date(NOW);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** "HH:mm", the shape `Appointment.appointmentTime` stores. */
function hhmm(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

/** A birthday `years` ago, on a fixed calendar day so the age band never wobbles. */
function dobFor(years: number, month: number, day: number): Date {
  return new Date(Date.UTC(NOW.getFullYear() - years, month - 1, day, 0, 0, 0));
}

// ── The cast ─────────────────────────────────────────────────────────────────

/**
 * One password for every demo portal account, and the same one the rest of the
 * seed already uses. Somebody running the demo has to be able to read it off a
 * card; five different passwords is five chances to fumble a login on stage.
 */
const PORTAL_PASSWORD = 'Demo@HMS2024!';

interface Persona {
  /** Short handle, used to build every fixed id for this patient. */
  readonly key: string;
  readonly mrn: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly gender: 'male' | 'female';
  readonly ageYears: number;
  /** Fixed birthday, so `social.age_band` is the same on every machine. */
  readonly birthMonth: number;
  readonly birthDay: number;
  readonly phone: string;
  readonly bloodGroup: string;
  readonly city: string;
  readonly state: string;
  readonly district: string;
  readonly locality: string;
  readonly occupation: string;
  readonly allergies: readonly string[];
  readonly chronicConditions: readonly string[];
  readonly currentMedications: readonly string[];
  /** What this patient is here to demonstrate. Printed in the summary table. */
  readonly demonstrates: string;
}

const PERSONAS: readonly Persona[] = [
  {
    key: 'meera',
    mrn: 'CASE-0001',
    email: 'meera.krishnan@hms.local',
    firstName: 'Meera',
    lastName: 'Krishnan',
    gender: 'female',
    ageYears: 34,
    birthMonth: 4,
    birthDay: 12,
    phone: '+919840110021',
    bloodGroup: 'O+',
    city: 'Chennai',
    state: 'Tamil Nadu',
    district: 'Chennai',
    locality: 'T. Nagar',
    occupation: 'School teacher',
    allergies: [],
    chronicConditions: [],
    currentMedications: [],
    demonstrates: 'Interview in progress — lands mid-conversation',
  },
  {
    key: 'rajesh',
    mrn: 'CASE-0002',
    email: 'rajesh.pillai@hms.local',
    firstName: 'Rajesh',
    lastName: 'Pillai',
    gender: 'male',
    ageYears: 57,
    birthMonth: 8,
    birthDay: 3,
    phone: '+919840110022',
    bloodGroup: 'B+',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    district: 'Coimbatore',
    locality: 'R. S. Puram',
    occupation: 'Lorry driver',
    allergies: [],
    chronicConditions: ['Hypertension'],
    currentMedications: ['Telmisartan 40mg OD'],
    demonstrates: 'Red flag raised — ACS screen fired and persisted',
  },
  {
    key: 'ramesh',
    mrn: 'CASE-0003',
    email: 'ramesh.kumar@hms.local',
    // The fixture prescription and lab report are both made out to "Ramesh
    // Kumar, 54 / Male" — see test/fixtures/generate-documents.py. Naming the
    // patient after the paperwork is what keeps the evidence chain readable
    // when somebody opens the original on stage.
    firstName: 'Ramesh',
    lastName: 'Kumar',
    gender: 'male',
    ageYears: 54,
    birthMonth: 1,
    birthDay: 26,
    phone: '+919840110023',
    bloodGroup: 'A+',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    district: 'Coimbatore',
    locality: 'Saibaba Colony',
    occupation: 'Shop owner',
    allergies: [],
    chronicConditions: ['Type 2 diabetes mellitus', 'Hypertension'],
    currentMedications: [],
    demonstrates: 'Uploaded documents — OCR, extraction, a patient correction',
  },
  {
    key: 'lakshmi',
    mrn: 'CASE-0004',
    email: 'lakshmi.venkatesan@hms.local',
    firstName: 'Lakshmi',
    lastName: 'Venkatesan',
    gender: 'female',
    ageYears: 63,
    birthMonth: 11,
    birthDay: 9,
    phone: '+919840110024',
    bloodGroup: 'O-',
    city: 'Madurai',
    state: 'Tamil Nadu',
    district: 'Madurai',
    locality: 'Anna Nagar',
    occupation: 'Retired clerk',
    allergies: ['Penicillin'],
    chronicConditions: [],
    currentMedications: ['Pantoprazole 40mg OD'],
    demonstrates: 'Case submitted — the doctor handoff',
  },
  {
    key: 'arjun',
    mrn: 'CASE-0005',
    email: 'arjun.menon@hms.local',
    firstName: 'Arjun',
    lastName: 'Menon',
    gender: 'male',
    ageYears: 29,
    birthMonth: 6,
    birthDay: 18,
    phone: '+919840110025',
    bloodGroup: 'AB+',
    city: 'Kochi',
    state: 'Kerala',
    district: 'Ernakulam',
    locality: 'Panampilly Nagar',
    occupation: 'Software engineer',
    allergies: [],
    chronicConditions: [],
    currentMedications: [],
    demonstrates: 'Never started — the clean first-run path',
  },
];

// ── The transcripts ──────────────────────────────────────────────────────────

/**
 * One exchange: what the assistant asked, what the patient said back, and the
 * presence the engine must land on.
 *
 * `expect` is not decoration. It is the assertion that keeps this file honest:
 * the whole value of seeding through `factFromAnswer` is that the demo data is
 * produced by the same code the product runs, and the way that goes wrong
 * silently is a phrase list changing under a scripted answer so that "I don't
 * know" quietly becomes an asserted "no". The seed refuses to write a fact
 * whose presence is not the one the script says it means.
 */
interface Exchange {
  readonly fieldPath: string;
  readonly ask: string;
  readonly said: string;
  readonly modality: AnswerModality;
  readonly expect: FactPresence;
  readonly expectValue?: FactValue;
  /** Minutes before `NOW` that this exchange happened. Descending down a script. */
  readonly minutesAgo: number;
}

/**
 * Meera — a respiratory complaint, four minutes into the interview.
 *
 * The point of this one is the *middle* of the conversation: opening the app as
 * Meera has to land on a question that is already on screen with a transcript
 * behind it, not on question one. `past_medical.diabetes` is the tri-state
 * beat — she has genuinely never been tested, which is `unknown`, and must
 * never render as "No".
 */
const MEERA_SCRIPT: readonly Exchange[] = [
  {
    fieldPath: 'chief_complaint.symptom',
    ask: 'What is bothering you the most today?',
    said: 'A cough that will not settle, and a fever, for the last five days',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 6,
  },
  {
    fieldPath: 'hpi.duration',
    ask: 'How long have you had this problem?',
    said: 'five days',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 5,
  },
  {
    fieldPath: 'hpi.onset',
    ask: 'Did this start suddenly, all at once, or did it build up slowly over time?',
    said: 'gradual',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'gradual',
    minutesAgo: 5,
  },
  {
    fieldPath: 'hpi.severity',
    ask: 'On a scale of nothing at all to the worst you can imagine, where would you put it right now? Zero to ten.',
    said: '6',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 6,
    minutesAgo: 3,
  },
  {
    fieldPath: 'hpi.associated.fever',
    ask: 'Have you had a fever along with this?',
    said: 'Yes, mostly in the evenings',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 3,
  },
  {
    fieldPath: 'hpi.associated.breathlessness',
    ask: 'Along with this, are you finding it hard to breathe?',
    said: 'no',
    modality: 'choice',
    // An asserted negative. `none`, never `recorded(false)` — see tri-state.ts.
    expect: 'none',
    minutesAgo: 2,
  },
  {
    fieldPath: 'ros.respiratory.cough',
    ask: 'Do you have a cough?',
    said: 'Yes, with some yellow phlegm',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 2,
  },
  {
    fieldPath: 'ros.respiratory.blood_in_sputum',
    ask: 'Have you coughed up any blood?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 1,
  },
  {
    fieldPath: 'past_medical.diabetes',
    ask: 'Have you ever been told you have diabetes, or sugar?',
    said: 'I do not know, I have never been tested',
    modality: 'voice',
    // The line this whole feature is built around: "the patient does not know"
    // is not "no". If this ever comes back `none`, the demo is a lie.
    expect: 'unknown',
    minutesAgo: 1,
  },
];

/**
 * Rajesh — chest pain with breathlessness and sweating.
 *
 * Seeded so the ACS screen has already fired: the whole point is that the
 * notice can be shown without having to talk the app into a red flag live, in
 * front of an audience, on a model that takes twenty seconds to answer.
 */
const RAJESH_SCRIPT: readonly Exchange[] = [
  {
    fieldPath: 'chief_complaint.symptom',
    ask: 'What is bothering you the most today?',
    said: 'Chest pain and a heavy feeling since this morning, and it is hard to breathe',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 14,
  },
  {
    fieldPath: 'hpi.duration',
    ask: 'How long have you had this problem?',
    said: '3 hours',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 13,
  },
  {
    fieldPath: 'hpi.onset',
    ask: 'Did this start suddenly, all at once, or did it build up slowly over time?',
    said: 'sudden',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'sudden',
    minutesAgo: 13,
  },
  {
    fieldPath: 'hpi.location',
    ask: 'Where exactly do you feel it? You can point or describe it.',
    said: 'In the middle of my chest',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 12,
  },
  {
    fieldPath: 'hpi.character',
    ask: 'How would you describe the feeling — burning, pressing, sharp, dull, cramping or throbbing?',
    said: 'pressing',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'pressing',
    minutesAgo: 12,
  },
  {
    fieldPath: 'hpi.severity',
    ask: 'On a scale of nothing at all to the worst you can imagine, where would you put it right now? Zero to ten.',
    said: '8',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 8,
    minutesAgo: 11,
  },
  {
    fieldPath: 'hpi.associated.breathlessness',
    ask: 'Along with this, are you finding it hard to breathe?',
    said: 'Yes, I cannot get a full breath',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 10,
  },
  {
    fieldPath: 'hpi.associated.sweating',
    ask: 'Have you been sweating a lot with it, even without effort?',
    said: 'Yes, I was soaked through sitting still',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    // The turn that completes the triad. `triggeredAt` on the red flag is
    // pinned to this moment below.
    minutesAgo: 9,
  },
  {
    fieldPath: 'hpi.radiation',
    ask: 'Does the feeling stay in one place, or does it spread anywhere — to your arm, jaw, back or shoulder?',
    said: 'It goes down my left arm and into my jaw',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 8,
  },
];

/**
 * Ramesh — the documents story.
 *
 * The interview is short on purpose: what he mostly did was photograph the
 * paperwork he brought with him. `investigations[0]` carries the HbA1c he
 * remembers being told, which sits beside the haemoglobin and creatinine the
 * lab report contributed — one value from the patient, two from a document,
 * distinguishable by their provenance rather than by anybody's memory.
 */
const RAMESH_SCRIPT: readonly Exchange[] = [
  {
    fieldPath: 'chief_complaint.symptom',
    ask: 'What is bothering you the most today?',
    said: 'I have been very tired for a month and I brought my old reports',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 25,
  },
  {
    fieldPath: 'hpi.duration',
    ask: 'How long have you had this problem?',
    said: 'about a month',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 24,
  },
  {
    fieldPath: 'past_medical.diabetes',
    ask: 'Have you ever been told you have diabetes, or sugar?',
    said: 'Yes, about eight years now',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 23,
  },
  {
    fieldPath: 'medications.any_current',
    ask: 'Are you taking any medicines at the moment, including anything you buy yourself?',
    said: 'Yes, three tablets — they are on the prescription I uploaded',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 23,
  },
  {
    fieldPath: 'allergies.reported',
    ask: 'Do you have any allergies — to a medicine, a food, or anything else?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 22,
  },
  {
    fieldPath: 'investigations.any_previous',
    ask: 'Have you had any tests or scans done for this, or do you have reports with you?',
    said: 'Yes, I have blood reports from the lab',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 22,
  },
  {
    fieldPath: 'investigations[0].name',
    ask: 'Which test was it?',
    said: 'HbA1c',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 21,
  },
  {
    fieldPath: 'investigations[0].value',
    ask: 'Do you know the result?',
    said: '8.2 percent',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 21,
  },
  {
    fieldPath: 'investigations[0].date',
    ask: 'Roughly when was the test done?',
    said: 'I am not sure of the date',
    modality: 'voice',
    // A second `unknown`, in the place it is most ordinary: people remember the
    // number and forget the day.
    expect: 'unknown',
    minutesAgo: 20,
  },
];

/**
 * Lakshmi — a finished case, sent to the hospital.
 *
 * Carries a `declined` as well as an `unknown`, because the review screen for a
 * submitted case is where the six presences are easiest to point at side by
 * side: an answer, an asserted no, a "does not know", a "would rather not say",
 * and — in every section the interview never reached — "not assessed".
 */
const LAKSHMI_SCRIPT: readonly Exchange[] = [
  {
    fieldPath: 'chief_complaint.symptom',
    ask: 'What is bothering you the most today?',
    said: 'Burning stomach pain for two weeks, worse after food',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 135,
  },
  {
    fieldPath: 'hpi.duration',
    ask: 'How long have you had this problem?',
    said: '2 weeks',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 134,
  },
  {
    fieldPath: 'hpi.onset',
    ask: 'Did this start suddenly, all at once, or did it build up slowly over time?',
    said: 'gradual',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'gradual',
    minutesAgo: 134,
  },
  {
    fieldPath: 'hpi.location',
    ask: 'Where exactly do you feel it? You can point or describe it.',
    said: 'Upper abdomen, just below the ribs',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 133,
  },
  {
    fieldPath: 'hpi.character',
    ask: 'How would you describe the feeling — burning, pressing, sharp, dull, cramping or throbbing?',
    said: 'burning',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'burning',
    minutesAgo: 133,
  },
  {
    fieldPath: 'hpi.severity',
    ask: 'On a scale of nothing at all to the worst you can imagine, where would you put it right now? Zero to ten.',
    said: '5',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 5,
    minutesAgo: 132,
  },
  {
    fieldPath: 'hpi.timing',
    ask: 'Is it there all the time, or does it come and go? Is there a time of day it is worse?',
    said: 'worse_after_food',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'worse_after_food',
    minutesAgo: 132,
  },
  {
    fieldPath: 'hpi.progression',
    ask: 'Since it started, is it getting worse, getting better, or staying about the same?',
    said: 'staying_same',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'staying_same',
    minutesAgo: 131,
  },
  {
    fieldPath: 'hpi.relieving_factors',
    ask: 'Is there anything that makes it better — rest, a tablet, a position?',
    said: 'The pantoprazole tablet helps for a few hours',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 131,
  },
  {
    fieldPath: 'hpi.associated.nausea',
    ask: 'Do you feel sick in the stomach along with it?',
    said: 'Yes, in the mornings',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 130,
  },
  {
    fieldPath: 'hpi.associated.fever',
    ask: 'Have you had a fever along with this?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 130,
  },
  {
    fieldPath: 'ros.gastrointestinal.vomiting_blood',
    ask: 'Have you vomited any blood, or something that looked like coffee grounds?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 129,
  },
  {
    fieldPath: 'ros.gastrointestinal.black_stools',
    ask: 'Have your stools been black and sticky, like tar?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 129,
  },
  {
    fieldPath: 'ros.gastrointestinal.abdominal_pain',
    ask: 'Do you have any pain in your stomach or belly?',
    said: 'Yes, that is why I am here',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 128,
  },
  {
    fieldPath: 'past_medical.thyroid_disorder',
    ask: 'Have you been told you have a thyroid problem?',
    said: 'I am not sure, they took blood once but nobody told me the result',
    modality: 'voice',
    expect: 'unknown',
    minutesAgo: 127,
  },
  {
    fieldPath: 'allergies.reported',
    ask: 'Do you have any allergies — to a medicine, a food, or anything else?',
    said: 'Yes, penicillin',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 126,
  },
  {
    fieldPath: 'allergies[0].substance',
    ask: 'What are you allergic to?',
    said: 'Penicillin',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 126,
  },
  {
    fieldPath: 'allergies[0].type',
    ask: 'Is that a medicine, a food, or something else?',
    said: 'drug',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'drug',
    minutesAgo: 125,
  },
  {
    fieldPath: 'allergies[0].reaction',
    ask: 'What happens to you when you have it?',
    said: 'A rash all over my arms and chest',
    modality: 'voice',
    expect: 'recorded',
    minutesAgo: 125,
  },
  {
    fieldPath: 'allergies[0].severity',
    ask: 'How bad was the reaction — mild, moderate, or severe enough to need treatment?',
    said: 'moderate',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'moderate',
    minutesAgo: 124,
  },
  {
    fieldPath: 'medications.any_current',
    ask: 'Are you taking any medicines at the moment, including anything you buy yourself?',
    said: 'Yes, one tablet for the acidity',
    modality: 'voice',
    expect: 'recorded',
    expectValue: true,
    minutesAgo: 124,
  },
  {
    fieldPath: 'medications[0].name',
    ask: 'What is the name of the medicine?',
    said: 'Pantoprazole',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 123,
  },
  {
    fieldPath: 'medications[0].strength',
    ask: 'What strength is it — how many milligrams?',
    said: '40 mg',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 123,
  },
  {
    fieldPath: 'medications[0].frequency',
    ask: 'How many times a day do you take it?',
    said: 'Once a day',
    modality: 'text',
    expect: 'recorded',
    minutesAgo: 122,
  },
  {
    fieldPath: 'medications[0].route',
    ask: 'Is it a tablet, a syrup, an inhaler, or an injection?',
    said: 'oral',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'oral',
    minutesAgo: 122,
  },
  {
    fieldPath: 'medications[0].status',
    ask: 'Are you still taking it, or have you stopped?',
    said: 'current',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'current',
    minutesAgo: 121,
  },
  {
    fieldPath: 'surgical.any_previous',
    ask: 'Have you had any operations or procedures in the past?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 121,
  },
  {
    fieldPath: 'family.any_relevant',
    ask: 'Does anyone in your close family have a long-term illness — like diabetes, blood pressure, heart trouble or cancer?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 120,
  },
  {
    fieldPath: 'social.alcohol',
    ask: 'Do you drink alcohol? If so, roughly how often?',
    said: 'I would rather not say',
    modality: 'voice',
    // Refusal, checked before uncertainty and before negation. A patient who
    // has declined must not be re-asked, and must not be recorded as a "no".
    expect: 'declined',
    minutesAgo: 119,
  },
  {
    fieldPath: 'social.smoking',
    ask: 'Do you smoke, or have you smoked in the past?',
    said: 'never',
    modality: 'choice',
    expect: 'recorded',
    expectValue: 'never',
    minutesAgo: 119,
  },
  {
    fieldPath: 'investigations.any_previous',
    ask: 'Have you had any tests or scans done for this, or do you have reports with you?',
    said: 'no',
    modality: 'choice',
    expect: 'none',
    minutesAgo: 118,
  },
];

// ── The documents ────────────────────────────────────────────────────────────

/**
 * The two fixtures the patient-documents pipeline is itself verified against,
 * with the extraction it actually produced for them.
 *
 * The envelopes below are not invented: they were read back out of a real
 * pipeline run over these exact bytes (OCR by pp-ocrv5-mobile, extraction by
 * the local model) and transcribed here, so the ocrText, the values, the
 * grounding and both confidences all agree with each other and with the pixels.
 * The one addition is the prescription's `diagnosesRecorded` — the model missed
 * a line the page plainly carries, and the two values are verbatim in the OCR
 * text, so they stay grounded and the extraction confidence stays 1.
 *
 * Both land `needs_review`. There is no path to `verified` that does not go
 * through a person, and a seed is not a person.
 */
const FIXTURE_DIR = join(__dirname, '..', 'test', 'fixtures');

const PRESCRIPTION_OCR_TEXT = [
  'SUNRISEMULTISPECIALITYCLINIC',
  '14 Station Road, Coimbatore 641002·Ph 0422 244 1180',
  'PRESCRIPTION',
  'Patient: Ramesh Kumar\tDate: 12/09/2026',
  'Age / Sex: 54 / Male\tOP No: OP-2026-11847',
  'Diagnosis: Type 2 Diabetes Mellitus, Hypertension',
  'Rx',
  '1. Tab. METFORMIN 500 mg',
  '1 tablet - twice daily - oral',
  'After food, 30 days',
  '2.\tTab.AMLODIPINE 5 mg',
  '1 tablet - once daily - oral',
  'Morning, 30 days',
  '3.\tTab.ATORVASTATIN 10 mg',
  '1 tablet - at bedtime - oral',
  '30 days',
  'Advice: Check fasting blood sugar after 2 weeks. Reduce salt intake.',
  'Follow up: Review after 30 days.',
  'Dr.Anitha Raghavan,MD',
  'Reg. No. TN 54821',
].join('\n');

const LAB_REPORT_OCR_TEXT = [
  'METROLAB DIAGNOSTICS',
  'NABL accredited · Report generated 12/09/2026 11:24',
  'COMPLETE BLOODCOUNT',
  'Patient:Ramesh Kumar\tSample No: ML-88213',
  'Age/ Sex: 54 / Male\tCollected:12/09/2026',
  'Referred by: Dr. Anitha Raghavan',
  'TEST\tRESULT\tUNIT\tREFERENCE',
  'Haemoglobin\t11.2\t*\tg/dL\t13.0-17.0',
  'Total WBC Count\t8400\t/uL\t4000\t11000',
  'Platelet Count\t250000\t/uL\t150000\t-410000',
  'Packed Cell Volume\t36.4\t*\t%\t40.0-\t50.0',
  'MCV\t82.1\t*\tfL\t83.0-101.0',
  'Random Blood Sugar\t168\t*\tmg/dL\t70-140',
  'Serum Creatinine\t0.9\tmg/dL\t0.7-1.3',
  '*Outside the stated reference interval.',
  'Verified by: Dr. S. Nandakumar, MD (Pathology)',
].join('\n');

const PRESCRIPTION_OCR_CONFIDENCE = 0.9859;
const LAB_REPORT_OCR_CONFIDENCE = 0.9906;

interface ExtractedMedicationSeed {
  name: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  duration: string | null;
  instructions: string | null;
  startDate: string | null;
  stopDate: string | null;
  uncertain: boolean;
}

const PRESCRIPTION_MEDICATIONS: readonly ExtractedMedicationSeed[] = [
  {
    name: 'Tab. METFORMIN',
    strength: '500 mg',
    dose: '1 tablet',
    frequency: 'twice daily',
    route: 'oral',
    duration: null,
    instructions: 'After food, 30 days',
    startDate: null,
    stopDate: null,
    uncertain: false,
  },
  {
    name: 'Tab.AMLODIPINE',
    strength: '5 mg',
    dose: '1 tablet',
    frequency: 'once daily',
    route: 'oral',
    duration: null,
    instructions: 'Morning, 30 days',
    startDate: null,
    stopDate: null,
    uncertain: false,
  },
  {
    name: 'Tab.ATORVASTATIN',
    strength: '10 mg',
    dose: '1 tablet',
    frequency: 'at bedtime',
    route: 'oral',
    duration: null,
    instructions: '30 days',
    startDate: null,
    stopDate: null,
    uncertain: false,
  },
];

interface ExtractedInvestigationSeed {
  test: string;
  result: string | null;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  date: string | null;
}

/**
 * Exactly what the recogniser and the extractor made of the table, including
 * the `*` that OCR read as a unit because the report prints its out-of-range
 * marker in the unit column. Left in: those four values come back `ungrounded`,
 * which is the reviewer's shortlist working, and a seed that tidied them away
 * would be demonstrating a pipeline nobody has.
 */
const LAB_REPORT_INVESTIGATIONS: readonly ExtractedInvestigationSeed[] = [
  {
    test: 'Haemoglobin',
    result: '11.2',
    unit: '*',
    referenceRange: 'g/dL 13.0-17.0',
    flag: null,
    date: null,
  },
  {
    test: 'Total WBC Count',
    result: '8400',
    unit: '/uL',
    referenceRange: '4000 11000',
    flag: null,
    date: null,
  },
  {
    test: 'Platelet Count',
    result: '250000',
    unit: '/uL',
    referenceRange: '150000 -410000',
    flag: null,
    date: null,
  },
  {
    test: 'Packed Cell Volume',
    result: '36.4',
    unit: '*',
    referenceRange: '% 40.0- 50.0',
    flag: null,
    date: null,
  },
  {
    test: 'MCV',
    result: '82.1',
    unit: '*',
    referenceRange: 'fL 83.0-101.0',
    flag: null,
    date: null,
  },
  {
    test: 'Random Blood Sugar',
    result: '168',
    unit: '*',
    referenceRange: 'mg/dL 70-140',
    flag: null,
    date: null,
  },
  {
    test: 'Serum Creatinine',
    result: '0.9',
    unit: 'mg/dL',
    referenceRange: '0.7-1.3',
    flag: null,
    date: null,
  },
];

/**
 * The prescription values Ramesh read back and agreed with.
 *
 * A `confirm` is what puts a document's reading into the interview draft at
 * all. §2 forbids an upload quietly populating a chart with everything a model
 * thought it saw, so the pipeline writes no case facts — a value only crosses
 * into the case once the patient has looked at it and said something about it.
 * These five are the ones he confirmed; `medications[0].strength` is the one he
 * did not, and it is corrected below.
 *
 * Values are the extraction's own strings, "Tab." and all. Tidying them here
 * would be this seed doing the cleanup the review screen exists to ask a human
 * for.
 */
const PRESCRIPTION_CONFIRMATIONS: ReadonlyArray<{
  readonly path: string;
  readonly value: string;
  readonly factId: string;
}> = [
  {
    path: 'medications[0].name',
    value: 'Tab. METFORMIN',
    factId: 'case-fact-ramesh-doc-med0-name',
  },
  {
    path: 'medications[0].frequency',
    value: 'twice daily',
    factId: 'case-fact-ramesh-doc-med0-freq',
  },
  {
    path: 'medications[0].route',
    value: 'oral',
    factId: 'case-fact-ramesh-doc-med0-route',
  },
  {
    path: 'medications[1].name',
    value: 'Tab.AMLODIPINE',
    factId: 'case-fact-ramesh-doc-med1-name',
  },
  {
    path: 'medications[1].strength',
    value: '5 mg',
    factId: 'case-fact-ramesh-doc-med1-strength',
  },
];

/** Values the extractor produced that are not findable in the OCR text. §17. */
const LAB_REPORT_UNGROUNDED = [
  'investigations[0].unit',
  'investigations[3].unit',
  'investigations[4].unit',
  'investigations[5].unit',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRESENCE_LABEL: Readonly<Record<FactPresence, string>> = {
  recorded: 'recorded',
  none: 'asserted no',
  unknown: 'patient does not know',
  not_applicable: 'not applicable',
  not_assessed: 'nobody asked',
  declined: 'declined to answer',
};

/**
 * `sourceForModality` from the service, which is not exported.
 *
 * Duplicated rather than re-derived: a seed that invented its own mapping would
 * be attributing answers differently from the product, and a fact whose source
 * says `patient_voice` when the product would have said `patient_choice` is a
 * small lie in the one place this system has promised not to tell any.
 */
function sourceForModality(modality: AnswerModality): FactSource {
  switch (modality) {
    case 'voice':
      return 'patient_voice';
    case 'text':
      return 'patient_text';
    case 'correction':
      return 'patient_correction';
    case 'uploaded_document':
      return 'uploaded_document';
    case 'existing_record':
      return 'existing_record';
    default:
      return 'patient_choice';
  }
}

/** `isShortAnswer` from the service, for the same reason as above. */
function isShortAnswer(text: string): boolean {
  if (text.length === 0 || text.length > 120) return false;
  return !/[.!?]\s+\S/.test(text);
}

/** The band the interview reads off the record rather than asking for. */
function ageBandFor(years: number): string {
  if (years < 1) return 'infant';
  if (years < 12) return 'child';
  if (years < 18) return 'adolescent';
  if (years < 65) return 'adult';
  return 'older_adult';
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── Writers ──────────────────────────────────────────────────────────────────

interface SeededPatient {
  readonly persona: Persona;
  readonly patientId: string;
  readonly userId: string;
}

/**
 * A portal account and the record it answers for.
 *
 * `Patient.userId` is the whole of what makes a PATIENT token usable:
 * `PatientSelfGuard` refuses an account it cannot resolve to a record, so an
 * unlinked user is an account nobody can sign into anything with.
 */
async function upsertPortalPatient(
  organizationId: string,
  persona: Persona,
  password: string,
  patientRoleId: string | null,
  createdById: string | null,
): Promise<SeededPatient> {
  const userData = {
    password,
    firstName: persona.firstName,
    lastName: persona.lastName,
    fullName: `${persona.firstName} ${persona.lastName}`,
    organizationId,
    isActive: true,
    role: 'PATIENT',
    phone: persona.phone,
  };

  const user = await prisma.user.upsert({
    where: { email: persona.email },
    update: userData,
    create: {
      id: `case-user-${persona.key}`,
      email: persona.email,
      ...userData,
    },
  });

  if (patientRoleId) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: patientRoleId } },
      update: {},
      create: { userId: user.id, roleId: patientRoleId },
    });
  }

  const patientData = {
    organizationId,
    userId: user.id,
    firstName: persona.firstName,
    lastName: persona.lastName,
    middleName: null,
    dateOfBirth: dobFor(persona.ageYears, persona.birthMonth, persona.birthDay),
    gender: persona.gender,
    bloodGroup: persona.bloodGroup,
    phonePrimary: persona.phone,
    email: persona.email,
    // The address columns still carry their Ethiopian names; the deployment is
    // Indian, so they are read as state / district / city / locality.
    region: persona.state,
    zone: persona.district,
    woreda: persona.city,
    kebele: persona.locality,
    allergies: JSON.stringify(persona.allergies),
    chronicConditions: JSON.stringify(persona.chronicConditions),
    currentMedications: JSON.stringify(persona.currentMedications),
    occupation: persona.occupation,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdById,
    updatedById: createdById,
  };

  const patient = await prisma.patient.upsert({
    where: { mrn: persona.mrn },
    update: patientData,
    create: { id: `case-pat-${persona.key}`, mrn: persona.mrn, ...patientData },
  });

  return { persona, patientId: patient.id, userId: user.id };
}

interface InterviewResult {
  readonly sessionId: string;
  readonly state: ClinicalState;
  readonly turnCount: number;
  readonly factCount: number;
  readonly redFlagCount: number;
}

/**
 * Write one interview: the session, its transcript, its facts, and — derived
 * from those by the engine — its red flags and its projection.
 *
 * The order matters and mirrors the service exactly. Facts are written first
 * because `rebuildState` is the authority on what the interview knows;
 * `evaluate` then runs over that state rather than over the script, so a red
 * flag exists here only if the rules would really have fired on this patient.
 */
async function seedInterview(input: {
  organizationId: string;
  seeded: SeededPatient;
  script: readonly Exchange[];
  startedMinutesAgo: number;
  /** `in_progress`, `review` or `submitted`. */
  status: string;
  /** Append a trailing unanswered question, so the app opens mid-conversation. */
  leaveQuestionOnScreen: boolean;
  appointmentId?: string | null;
  /**
   * Facts that did not come from a scripted exchange — the ones an uploaded
   * document contributed, and the correction that supersedes one. Written here
   * rather than by the caller afterwards, because everything below this point
   * is *derived* from the session's facts: the question left on screen, the
   * safety evaluation and the progress percentage. A fact that lands after the
   * projection is a fact the projection does not know about, and the symptom is
   * a demo whose progress bar reads 18% on the first run and 19% on the second.
   *
   * Returns the ids it wrote, so the stale-row sweep keeps them.
   */
  extraFacts?: (context: {
    sessionId: string;
    patientId: string;
  }) => Promise<readonly string[]>;
}): Promise<InterviewResult> {
  const { organizationId, seeded, script } = input;
  const sessionId = `case-sess-${seeded.persona.key}`;
  const startedAt = ago(input.startedMinutesAgo);
  const lastAnswerAt = ago(script[script.length - 1]?.minutesAgo ?? 0);

  const sessionData = {
    organizationId,
    patientId: seeded.patientId,
    appointmentId: input.appointmentId ?? null,
    kind: 'new_consultation',
    language: 'en',
    status: input.status,
    // Consent is a moment plus the wording that was agreed to; both, or the row
    // is a claim that somebody agreed to something nobody can name.
    consentGivenAt: new Date(startedAt.getTime() + 20_000),
    consentVersion: CONSENT_VERSION,
    startedAt,
    lastActiveAt: lastAnswerAt,
    submittedAt: null as Date | null,
    isDeleted: false,
    deletedAt: null,
  };

  await prisma.caseSession.upsert({
    where: { id: sessionId },
    update: sessionData,
    create: { id: sessionId, ...sessionData },
  });

  // ── Transcript and facts, one scripted exchange at a time ─────────────────
  let sequence = 0;
  let factIndex = 0;
  const liveFactIds = new Set<string>();

  // The age band the service seeds from the record when a session opens. Not a
  // question — `social.age_band` is `NEVER_ASKED` in the registry — but the
  // paediatric rules are gated on it, so a session without it has them off.
  const ageFactId = `case-fact-${seeded.persona.key}-age`;
  await upsertFact({
    id: ageFactId,
    sessionId,
    patientId: seeded.patientId,
    row: rowDataFromFact(
      'social.age_band',
      recorded(ageBandFor(seeded.persona.ageYears), {
        source: 'existing_record',
        verification: 'unverified',
        recordedAt: startedAt.toISOString(),
      }),
    ),
    createdAt: startedAt,
  });
  liveFactIds.add(ageFactId);

  // A throwaway state, used only so `findField` can see the repeated-group
  // fields (`allergies[0].substance`, `medications[0].name`) that only exist
  // once their gate question has been answered yes. Rebuilt after every write.
  let state = await readState(sessionId);

  for (const exchange of script) {
    const askedAt = ago(exchange.minutesAgo);

    const field = findField(state, exchange.fieldPath);
    if (!field) {
      throw new Error(
        `${seeded.persona.key}: the registry has no field "${exchange.fieldPath}" ` +
          'in this state. A gate question ("any_current", "reported", ' +
          '"any_previous") has to be answered yes before its list items exist.',
      );
    }

    sequence += 1;
    const assistantTurnId = `case-turn-${seeded.persona.key}-${sequence}`;
    await upsertTurn({
      id: assistantTurnId,
      sessionId,
      sequence,
      role: 'assistant',
      section: field.section,
      fieldKey: field.key,
      questionText: exchange.ask,
      answerRaw: null,
      answerModality: null,
      createdAt: askedAt,
    });

    sequence += 1;
    const patientTurnId = `case-turn-${seeded.persona.key}-${sequence}`;
    await upsertTurn({
      id: patientTurnId,
      sessionId,
      sequence,
      role: 'patient',
      section: field.section,
      fieldKey: field.key,
      questionText: null,
      answerRaw: exchange.said,
      answerModality: exchange.modality,
      createdAt: new Date(askedAt.getTime() + 8_000),
    });

    // The engine decides what the answer means. Not this file.
    const { fact, derivation } = factFromAnswer(
      {
        modality: exchange.modality,
        utterance: exchange.said || undefined,
        evidenceSpan: isShortAnswer(exchange.said) ? exchange.said : undefined,
        extractedValue: exchange.said || undefined,
        field: valueSpecFor(field),
        language: 'en',
      },
      {
        source: sourceForModality(exchange.modality),
        verification: 'unverified',
        recordedAt: askedAt.toISOString(),
      },
    );

    if (derivation.presence !== exchange.expect) {
      throw new Error(
        `${seeded.persona.key} / ${exchange.fieldPath}: the script says this answer means ` +
          `"${exchange.expect}" (${PRESENCE_LABEL[exchange.expect]}) but the engine read it as ` +
          `"${derivation.presence}" (${PRESENCE_LABEL[derivation.presence]}, rule ${derivation.reason}). ` +
          'Fix the scripted answer or the expectation — do not seed a presence the engine disagrees with.',
      );
    }
    if (
      exchange.expectValue !== undefined &&
      derivation.value !== exchange.expectValue
    ) {
      throw new Error(
        `${seeded.persona.key} / ${exchange.fieldPath}: expected the value ` +
          `${JSON.stringify(exchange.expectValue)}, engine produced ${JSON.stringify(derivation.value)}.`,
      );
    }
    if (fact.presence === 'not_assessed') {
      throw new Error(
        `${seeded.persona.key} / ${exchange.fieldPath}: produced no fact. ` +
          'The absence of a row already means "nobody asked"; there is nothing to write.',
      );
    }

    factIndex += 1;
    const factId = `case-fact-${seeded.persona.key}-${factIndex}`;
    await upsertFact({
      id: factId,
      sessionId,
      patientId: seeded.patientId,
      row: rowDataFromFact(field.key, fact, patientTurnId),
      createdAt: new Date(askedAt.getTime() + 9_000),
    });
    liveFactIds.add(factId);

    state = await readState(sessionId);
  }

  // ── Facts from outside the conversation ──────────────────────────────────
  const extraFactIds = input.extraFacts
    ? await input.extraFacts({ sessionId, patientId: seeded.patientId })
    : [];
  if (extraFactIds.length > 0) {
    state = await readState(sessionId);
  }

  // ── The question on screen ───────────────────────────────────────────────
  //
  // Chosen by the selector rather than by this file, so the patient lands on
  // the question the interview would really have asked next. A trailing
  // assistant turn with no answer is what `currentQuestionFrom` reads.
  if (input.leaveQuestionOnScreen) {
    const next = selectNext(state);
    if (!next) {
      throw new Error(
        `${seeded.persona.key}: the interview has nothing left to ask, so it ` +
          'cannot be left mid-question. Shorten the script.',
      );
    }
    sequence += 1;
    await upsertTurn({
      id: `case-turn-${seeded.persona.key}-${sequence}`,
      sessionId,
      sequence,
      role: 'assistant',
      section: next.field.section,
      fieldKey: next.field.key,
      questionText: next.fallbackPrompt,
      answerRaw: null,
      answerModality: null,
      createdAt: ago(0.5),
    });
    await prisma.caseSession.update({
      where: { id: sessionId },
      data: { lastActiveAt: ago(0.5) },
    });
    state = await readState(sessionId);
  }

  // Anything left over from a previous, longer script would otherwise sit in
  // the session forever: fixed ids make re-runs update in place, they do not
  // remove rows the script no longer produces.
  await prisma.caseFact.deleteMany({
    where: {
      sessionId,
      id: { notIn: [...liveFactIds, ...extraFactIds] },
    },
  });
  await prisma.caseTurn.deleteMany({
    where: { sessionId, sequence: { gt: sequence } },
  });

  // ── Safety, over the state as it now stands ──────────────────────────────
  const safety = evaluate(state);
  const redFlagIds: string[] = [];
  for (const rule of safety.triggered) {
    const flagId = `case-flag-${seeded.persona.key}-${rule.ruleId.toLowerCase()}`;
    const flagData = {
      sessionId,
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      severity: rule.severity,
      matchedFacts: rule.matched as unknown as Prisma.InputJsonValue,
      // What the patient was shown. Stored because it is what they read, and
      // because it must never have contained a diagnosis.
      message: rule.patientMessage,
      triggeredAt: lastAnswerAt,
    };
    await prisma.caseRedFlag.upsert({
      where: { id: flagId },
      update: flagData,
      create: { id: flagId, ...flagData },
    });
    redFlagIds.push(flagId);
  }
  await prisma.caseRedFlag.deleteMany({
    where: { sessionId, id: { notIn: redFlagIds.length ? redFlagIds : ['-'] } },
  });

  // ── The projection ───────────────────────────────────────────────────────
  const progress = interviewProgress(state);
  const next = selectNext(state);
  await prisma.caseSession.update({
    where: { id: sessionId },
    data: {
      progressPercent: progress.percent,
      currentSection: next?.field.section ?? null,
      clinicalState: {
        revision: state.revision,
        interviewStatus: interviewStatus(state),
        highestSeverity: safety.highestSeverity,
        facts: Object.fromEntries(
          Object.entries(state.facts).map(([path, fact]) => [
            path,
            fact.presence === 'recorded'
              ? { presence: fact.presence, value: fact.value }
              : { presence: fact.presence },
          ]),
        ),
      },
      sectionStatus: progress.sections as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    sessionId,
    state,
    turnCount: sequence,
    factCount: liveFactIds.size,
    redFlagCount: redFlagIds.length,
  };
}

/** The session's facts and turns, as `CaseTakingService.loadState` reads them. */
async function readState(sessionId: string): Promise<ClinicalState> {
  const session = await prisma.caseSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const [facts, turns] = await Promise.all([
    prisma.caseFact.findMany({
      where: { sessionId, supersededById: null },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.caseTurn.findMany({
      where: { sessionId },
      orderBy: { sequence: 'asc' },
    }),
  ]);
  return rebuildState({
    sessionId,
    startedAt: session.startedAt,
    language: session.language,
    facts,
    turns,
  });
}

async function upsertTurn(input: {
  id: string;
  sessionId: string;
  sequence: number;
  role: string;
  section: string | null;
  fieldKey: string | null;
  questionText: string | null;
  answerRaw: string | null;
  answerModality: string | null;
  createdAt: Date;
}): Promise<void> {
  const { id, ...data } = input;
  await prisma.caseTurn.upsert({
    where: { id },
    update: data,
    create: { id, ...data },
  });
}

async function upsertFact(input: {
  id: string;
  sessionId: string;
  patientId: string;
  row: ReturnType<typeof rowDataFromFact>;
  createdAt: Date;
  supersededById?: string | null;
  supersededAt?: Date | null;
}): Promise<void> {
  const data = {
    sessionId: input.sessionId,
    patientId: input.patientId,
    ...input.row,
    valueJson:
      input.row.valueJson === null
        ? Prisma.DbNull
        : (input.row.valueJson as Prisma.InputJsonValue),
    createdAt: input.createdAt,
    supersededById: input.supersededById ?? null,
    supersededAt: input.supersededAt ?? null,
  };
  await prisma.caseFact.upsert({
    where: { id: input.id },
    update: data,
    create: { id: input.id, ...data },
  });
}

/** The §26 envelope, assembled the way `DocumentPipelineService` assembles it. */
function buildEnvelope(input: {
  documentId: string;
  docType: 'prescription' | 'laboratory_report';
  ocrConfidence: number;
  extractionConfidence: number;
  medications: readonly ExtractedMedicationSeed[];
  investigations: readonly ExtractedInvestigationSeed[];
  diagnosesRecorded: readonly string[];
  followUp: readonly string[];
  ungrounded: readonly string[];
  contradictions: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  const sources: Record<string, unknown>[] = [];
  const push = (field: string, value: string | null): void => {
    if (value === null) return;
    const grounded = !input.ungrounded.includes(field);
    sources.push({
      field,
      value,
      source: 'uploaded_document',
      documentId: input.documentId,
      page: grounded ? 1 : null,
      grounded,
      ocrConfidence: grounded ? input.ocrConfidence : null,
      verification: 'unverified',
    });
  };

  input.medications.forEach((med, index) => {
    push(`medications[${index}].name`, med.name);
    push(`medications[${index}].strength`, med.strength);
    push(`medications[${index}].dose`, med.dose);
    push(`medications[${index}].frequency`, med.frequency);
    push(`medications[${index}].route`, med.route);
    push(`medications[${index}].instructions`, med.instructions);
  });
  input.investigations.forEach((test, index) => {
    push(`investigations[${index}].test`, test.test);
    push(`investigations[${index}].result`, test.result);
    push(`investigations[${index}].unit`, test.unit);
    push(`investigations[${index}].referenceRange`, test.referenceRange);
  });
  input.diagnosesRecorded.forEach((value, index) => {
    push(`diagnosesRecorded[${index}]`, value);
  });

  // §19 in one line: a topic a document does not speak to is `not_assessed`,
  // never `none`. A prescription that lists no allergies has not said the
  // patient has none — it has said nothing, and the label says so.
  const topic = (
    values: readonly string[],
    notAssessedLabel: string,
  ): Record<string, unknown> =>
    values.length > 0
      ? { presence: 'recorded', label: 'Recorded', values: [...values] }
      : { presence: 'not_assessed', label: notAssessedLabel, values: [] };

  return {
    document: {
      type: input.docType,
      date: null,
      facility: null,
      author: null,
    },
    patient: { name: null, identifier: null },
    medications: input.medications.map((m) => ({ ...m })),
    investigations: input.investigations.map((i) => ({ ...i })),
    diagnosesRecorded: [...input.diagnosesRecorded],
    procedures: [],
    followUp: [...input.followUp],
    allergies: [],
    admission: null,
    facts: {
      allergies: topic([], 'This document does not mention allergies'),
      medications: topic(
        input.medications.map((m) => m.name),
        'This document does not mention medications',
      ),
      diagnoses: topic(
        input.diagnosesRecorded,
        'This document does not record a diagnosis',
      ),
      procedures: topic([], 'This document does not mention procedures'),
      investigations: topic(
        input.investigations.map((i) => i.test),
        'This document does not include test results',
      ),
    },
    sources,
    ungrounded: [...input.ungrounded],
    contradictions: input.contradictions.map((c) => ({ ...c })),
    // §17's two stages, kept apart. A recogniser's character confidence is a
    // measurement; the grounding score is this module's own arithmetic. They
    // are never blended, and each says which it is.
    confidence: {
      ocr: input.ocrConfidence,
      ocrSource: 'measured',
      extraction: input.extractionConfidence,
      extractionSource: 'derived',
    },
    verificationStatus: 'unverified',
  };
}

async function upsertDocument(input: {
  id: string;
  organizationId: string;
  patientId: string;
  sessionId: string;
  fixture: string;
  docType: 'prescription' | 'laboratory_report';
  docTypeConfidence: number;
  ocrConfidence: number;
  extractionConfidence: number;
  ocrText: string;
  extraction: Record<string, unknown>;
  corrections: readonly Record<string, unknown>[];
  uploadedAt: Date;
}): Promise<{ id: string; fileKey: string; bytes: Buffer }> {
  const bytes = readFileSync(join(FIXTURE_DIR, input.fixture));
  // Keyed the way `ObjectStorageService.uploadObject` keys an upload, but with
  // a fixed suffix instead of a timestamp so a re-run overwrites one object
  // rather than littering the bucket with a new one every time.
  const fileKey = `${input.organizationId}/patient-documents/${input.id}.png`;

  const data = {
    organizationId: input.organizationId,
    patientId: input.patientId,
    sessionId: input.sessionId,
    fileKey,
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    pageCount: 1,
    sha256: sha256Of(bytes),
    // Never `verified`. There is no path from here to verified that does not go
    // through a person, and a seed is not a person — the point of the screen is
    // that somebody confirms what was read.
    status: 'needs_review',
    docType: input.docType,
    docTypeConfidence: input.docTypeConfidence,
    ocrEngine: 'pp-ocrv5-mobile',
    ocrConfidence: input.ocrConfidence,
    ocrText: input.ocrText,
    ocrBlocks: Prisma.DbNull,
    extraction: input.extraction as unknown as Prisma.InputJsonValue,
    extractionConfidence: input.extractionConfidence,
    corrections: input.corrections as unknown as Prisma.InputJsonValue,
    visionFallbackUsed: false,
    duplicateOfId: null,
    failureReason: null,
    uploadedAt: input.uploadedAt,
    processedAt: new Date(input.uploadedAt.getTime() + 15_000),
    verifiedAt: null,
    isDeleted: false,
    deletedAt: null,
  };

  await prisma.patientDocument.upsert({
    where: { id: input.id },
    update: data,
    create: { id: input.id, ...data },
  });

  return { id: input.id, fileKey, bytes };
}

/**
 * Put the fixture bytes where the API expects them, so "show me the original"
 * works on stage.
 *
 * Best effort on purpose. MinIO being down is a reason for one button to fail,
 * not a reason for the demo database to be empty, so a failure here is a
 * warning and the seed carries on.
 */
async function uploadOriginals(
  objects: readonly { fileKey: string; bytes: Buffer }[],
): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
  const bucket = process.env.S3_BUCKET ?? 'hmsbucket';
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'minio_admin',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'minio_password',
    },
    forcePathStyle: true,
  });

  try {
    for (const object of objects) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.fileKey,
          Body: object.bytes,
          ContentType: 'image/png',
        }),
      );
    }
    console.log(`✅ Originals stored in ${bucket} (${objects.length} objects)`);
  } catch (error) {
    console.warn(
      `⚠️  Could not store the document originals at ${endpoint}: ` +
        `${error instanceof Error ? error.message : 'unknown'}. ` +
        'The rows are seeded; only "view the original" will fail.',
    );
  } finally {
    client.destroy();
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 Case-taking demo seed…');

  const organization = await prisma.organization.findUnique({
    where: { slug: 'system' },
  });
  if (!organization) {
    throw new Error(
      'No "system" organization. Run `npm run db:seed` first — this seed ' +
        'extends the base world, it does not create it.',
    );
  }
  const organizationId = organization.id;

  // Real doctors, by role rather than by e-mail, so the appointments point at
  // whoever the base seed actually created. Sorted for determinism.
  const doctors = await prisma.user.findMany({
    where: { organizationId, role: 'DOCTOR', isActive: true },
    orderBy: { email: 'asc' },
    select: { id: true, email: true, fullName: true },
  });
  if (doctors.length === 0) {
    throw new Error(
      'No DOCTOR accounts. Run `npm run db:seed` first — an appointment with ' +
        'no doctor is the empty dashboard this seed exists to prevent.',
    );
  }

  const receptionist = await prisma.user.findUnique({
    where: { email: 'receptionist@hms.local' },
    select: { id: true },
  });
  const patientRole = await prisma.role.findUnique({
    where: { name: 'PATIENT' },
    select: { id: true },
  });
  const opd = await prisma.department.findUnique({
    where: { id: 'dept-opd' },
    select: { id: true },
  });

  // Hashed once. bcrypt at cost 12 is deliberately slow, and five identical
  // passwords do not need five hashes.
  const password = await hashPassword(PORTAL_PASSWORD);

  const seeded: SeededPatient[] = [];
  for (const persona of PERSONAS) {
    seeded.push(
      await upsertPortalPatient(
        organizationId,
        persona,
        password,
        patientRole?.id ?? null,
        receptionist?.id ?? null,
      ),
    );
  }
  console.log(
    `✅ Portal patients: ${seeded.length} (${PERSONAS[0].mrn}…${PERSONAS[PERSONAS.length - 1].mrn})`,
  );

  const byKey = new Map(seeded.map((s) => [s.persona.key, s]));
  const need = (key: string): SeededPatient => {
    const found = byKey.get(key);
    if (!found) throw new Error(`persona "${key}" is missing`);
    return found;
  };

  // ── Today's clinic ───────────────────────────────────────────────────────
  //
  // Slots spread across the working day, a couple already checked in, so the
  // patient dashboard has something on it and the queue looks like a morning
  // that has been running for a while rather than a fixture.
  const APPOINTMENTS: ReadonlyArray<{
    key: string;
    hour: number;
    minute: number;
    type: string;
    status: string;
    complaint: string;
  }> = [
    {
      key: 'rajesh',
      hour: 9,
      minute: 30,
      type: 'emergency',
      status: 'checked_in',
      complaint: 'Chest pain and breathlessness since this morning',
    },
    {
      key: 'ramesh',
      hour: 10,
      minute: 0,
      type: 'follow_up',
      status: 'checked_in',
      complaint: 'Diabetes and blood pressure review, brought old reports',
    },
    {
      key: 'meera',
      hour: 11,
      minute: 15,
      type: 'consultation',
      status: 'scheduled',
      complaint: 'Cough and fever for five days',
    },
    {
      key: 'lakshmi',
      hour: 12,
      minute: 0,
      type: 'consultation',
      status: 'scheduled',
      complaint: 'Burning stomach pain for two weeks',
    },
    {
      key: 'arjun',
      hour: 16,
      minute: 30,
      type: 'consultation',
      status: 'scheduled',
      complaint: 'Recurring headaches at the end of the working day',
    },
  ];

  const appointmentIds = new Map<string, string>();
  for (const [index, slot] of APPOINTMENTS.entries()) {
    const patient = need(slot.key);
    const doctor = doctors[index % doctors.length];
    const at = todayAt(slot.hour, slot.minute);
    const id = `case-appt-${slot.key}`;
    const data = {
      organizationId,
      patientId: patient.patientId,
      doctorId: doctor.id,
      appointmentDate: at,
      appointmentTime: hhmm(at),
      durationMinutes: 30,
      appointmentType: slot.type,
      departmentId: opd?.id ?? null,
      status: slot.status,
      chiefComplaint: slot.complaint,
      checkedInAt: slot.status === 'checked_in' ? ago(35) : null,
      checkedInById: slot.status === 'checked_in' ? receptionist?.id : null,
      createdById: receptionist?.id ?? null,
      isDeleted: false,
      deletedAt: null,
    };
    await prisma.appointment.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    appointmentIds.set(slot.key, id);
  }
  console.log(
    `✅ Appointments today: ${APPOINTMENTS.length} with ${doctors.length} doctor(s) ` +
      `(${doctors.map((d) => d.email).join(', ')})`,
  );

  // ── 1. Mid-interview ─────────────────────────────────────────────────────
  const meera = await seedInterview({
    organizationId,
    seeded: need('meera'),
    script: MEERA_SCRIPT,
    startedMinutesAgo: 7,
    status: 'in_progress',
    leaveQuestionOnScreen: true,
    appointmentId: appointmentIds.get('meera'),
  });
  console.log(
    `✅ Meera Krishnan — in progress: ${meera.turnCount} turns, ` +
      `${meera.factCount} facts, question on screen`,
  );

  // ── 2. Red flag ──────────────────────────────────────────────────────────
  const rajesh = await seedInterview({
    organizationId,
    seeded: need('rajesh'),
    script: RAJESH_SCRIPT,
    startedMinutesAgo: 15,
    status: 'in_progress',
    leaveQuestionOnScreen: true,
    appointmentId: appointmentIds.get('rajesh'),
  });
  const rajeshFlags = await prisma.caseRedFlag.findMany({
    where: { sessionId: rajesh.sessionId },
    select: { ruleId: true, severity: true },
  });
  if (!rajeshFlags.some((flag) => flag.ruleId === 'ACS_TRIAD')) {
    throw new Error(
      'The ACS screen did not fire for Rajesh Pillai. The whole point of this ' +
        'patient is that the notice is demonstrable without talking the app ' +
        'into it live, so a seed that quietly produced no flag is worse than ' +
        `no seed. Fired: ${rajeshFlags.map((f) => f.ruleId).join(', ') || 'nothing'}.`,
    );
  }
  console.log(
    `✅ Rajesh Pillai — red flags: ${rajeshFlags
      .map((f) => `${f.ruleId} (${f.severity})`)
      .join(', ')}`,
  );

  // ── 3. Documents ─────────────────────────────────────────────────────────
  const prescriptionId = 'case-doc-ramesh-rx';
  const labReportId = 'case-doc-ramesh-lab';

  /**
   * The correction, as the evidence chain §22 asks for.
   *
   * Ramesh's clinic doubled the metformin last month and the printed sheet he
   * photographed is the old one. The document's reading is written as a fact in
   * its own right and superseded in the same breath, so the history reads "the
   * document said 500 mg → the patient said 1000 mg" rather than starting at
   * 1000 mg with nothing to argue with. Two rows, never an edit.
   */
  const documentFactId = 'case-fact-ramesh-doc-metformin';
  const correctedFactId = 'case-fact-ramesh-fix-metformin';
  const correctedAt = ago(18);

  const ramesh = await seedInterview({
    organizationId,
    seeded: need('ramesh'),
    script: RAMESH_SCRIPT,
    startedMinutesAgo: 26,
    status: 'in_progress',
    leaveQuestionOnScreen: true,
    appointmentId: appointmentIds.get('ramesh'),
    extraFacts: async ({ sessionId, patientId }) => {
      // The replacement is written first, because the old row points
      // *forwards* at it: `supersededById` is a foreign key, so the row it
      // names has to exist. That the older row carries the pointer is what
      // lets a reader walk a path's history in the order it happened.
      await upsertFact({
        id: correctedFactId,
        sessionId,
        patientId,
        row: rowDataFromFact(
          'medications[0].strength',
          recorded('1000 mg', {
            source: 'patient_correction',
            verification: 'patient_confirmed',
            documentId: prescriptionId,
          }),
          prescriptionId,
        ),
        createdAt: new Date(correctedAt.getTime() + 1_000),
      });
      await upsertFact({
        id: documentFactId,
        sessionId,
        patientId,
        row: rowDataFromFact(
          'medications[0].strength',
          recorded('500 mg', {
            source: 'uploaded_document',
            verification: 'unverified',
            // The recogniser's measurement, tagged as one, so nothing
            // downstream can compare it against a language model's
            // self-report.
            confidence: PRESCRIPTION_OCR_CONFIDENCE,
            confidenceSource: 'ocr',
            documentId: prescriptionId,
          }),
          prescriptionId,
        ),
        createdAt: correctedAt,
        supersededById: correctedFactId,
        supersededAt: correctedAt,
      });
      // Everything he read back and agreed with. Source stays
      // `uploaded_document` — a patient agreeing with a document has not
      // become the author of what it says — and only the verification status
      // changes, which is the distinction §17 keeps a separate column for.
      // No confidence: there is no measurement of how sure a patient is, and a
      // number invented here would sit in the same column as an OCR engine's.
      for (const confirmed of PRESCRIPTION_CONFIRMATIONS) {
        await upsertFact({
          id: confirmed.factId,
          sessionId,
          patientId,
          row: rowDataFromFact(
            confirmed.path,
            recorded(confirmed.value, {
              source: 'uploaded_document',
              verification: 'patient_confirmed',
              documentId: prescriptionId,
            }),
            prescriptionId,
          ),
          createdAt: new Date(correctedAt.getTime() - 60_000),
        });
      }

      return [
        correctedFactId,
        documentFactId,
        ...PRESCRIPTION_CONFIRMATIONS.map((c) => c.factId),
      ];
    },
  });

  const prescriptionCorrection = {
    path: 'medications[0].strength',
    kind: 'correct',
    originalValue: '500 mg',
    patientValue: '1000 mg',
    presence: 'recorded',
    presenceReason: 'extracted_value',
    note: 'Dose was doubled at the last review; this sheet is the old one.',
    correctedByUserId: need('ramesh').userId,
    correctedAt: correctedAt.toISOString(),
    target: 'case_fact',
    documentOnlyReason: null,
    caseFieldPath: 'medications[0].strength',
    caseFactId: correctedFactId,
    supersededFactId: documentFactId,
    // Outstanding: the patient has disputed a value and not yet re-confirmed
    // the document as a whole, which is exactly the state worth showing.
    acknowledgedAt: null,
  };

  const prescription = await upsertDocument({
    id: prescriptionId,
    organizationId,
    patientId: need('ramesh').patientId,
    sessionId: ramesh.sessionId,
    fixture: 'prescription.png',
    docType: 'prescription',
    docTypeConfidence: 0.9643,
    ocrConfidence: PRESCRIPTION_OCR_CONFIDENCE,
    extractionConfidence: 1,
    ocrText: PRESCRIPTION_OCR_TEXT,
    extraction: buildEnvelope({
      documentId: prescriptionId,
      docType: 'prescription',
      ocrConfidence: PRESCRIPTION_OCR_CONFIDENCE,
      extractionConfidence: 1,
      medications: PRESCRIPTION_MEDICATIONS,
      investigations: [],
      // §14: what the *document* records, never a diagnosis this system made.
      diagnosesRecorded: ['Type 2 Diabetes Mellitus', 'Hypertension'],
      followUp: ['Review after 30 days'],
      ungrounded: [],
      contradictions: PRESCRIPTION_MEDICATIONS.map((med) => ({
        topic: 'medications',
        kind: 'absent_from_record',
        documentValue: `${med.name} ${med.strength ?? ''}`.trim(),
        recordValues: [],
        // Not a conflict — a first entry. The record listed no medications, so
        // wording this as a disagreement would tell the patient their own file
        // contradicts itself on their first upload.
        recordHadEntries: false,
        message:
          'This document contains information that differs from your current record. Please review it.',
      })),
    }),
    corrections: [
      ...PRESCRIPTION_CONFIRMATIONS.map((confirmed) => ({
        path: confirmed.path,
        kind: 'confirm',
        originalValue: confirmed.value,
        // Null, and it has to be: confirming is agreeing with words already on
        // the page, not supplying new ones.
        patientValue: null,
        presence: 'recorded',
        presenceReason: 'extracted_value',
        note: null,
        correctedByUserId: need('ramesh').userId,
        correctedAt: new Date(correctedAt.getTime() - 60_000).toISOString(),
        target: 'case_fact',
        documentOnlyReason: null,
        caseFieldPath: confirmed.path,
        caseFactId: confirmed.factId,
        // Nothing to supersede — the patient agreed, so one row carrying the
        // document's value and their confirmation is the whole of what happened.
        supersededFactId: null,
        acknowledgedAt: null,
      })),
      prescriptionCorrection,
    ],
    uploadedAt: ago(22),
  });

  const labReport = await upsertDocument({
    id: labReportId,
    organizationId,
    patientId: need('ramesh').patientId,
    sessionId: ramesh.sessionId,
    fixture: 'lab-report.png',
    docType: 'laboratory_report',
    docTypeConfidence: 0.9545,
    ocrConfidence: LAB_REPORT_OCR_CONFIDENCE,
    // Six of forty-two values could not be found verbatim in the source text.
    // Reported, not hidden: it is the number that tells a reviewer how much of
    // this extraction is quotation and how much is reconstruction.
    extractionConfidence: 0.8571,
    ocrText: LAB_REPORT_OCR_TEXT,
    extraction: buildEnvelope({
      documentId: labReportId,
      docType: 'laboratory_report',
      ocrConfidence: LAB_REPORT_OCR_CONFIDENCE,
      extractionConfidence: 0.8571,
      medications: [],
      investigations: LAB_REPORT_INVESTIGATIONS,
      diagnosesRecorded: [],
      followUp: [],
      ungrounded: LAB_REPORT_UNGROUNDED,
      contradictions: [],
    }),
    corrections: [],
    uploadedAt: ago(20),
  });

  await prisma.patientDocument.deleteMany({
    where: {
      patientId: need('ramesh').patientId,
      id: { notIn: [prescriptionId, labReportId] },
    },
  });

  await uploadOriginals([prescription, labReport]);
  console.log(
    '✅ Ramesh Kumar — 2 documents needing review, ' +
      '1 correction superseding a document-derived fact',
  );

  // ── 4. Submitted ─────────────────────────────────────────────────────────
  const lakshmi = await seedInterview({
    organizationId,
    seeded: need('lakshmi'),
    script: LAKSHMI_SCRIPT,
    startedMinutesAgo: 136,
    status: 'submitted',
    leaveQuestionOnScreen: false,
    appointmentId: appointmentIds.get('lakshmi'),
  });

  // Rendered by the engine, exactly as `CaseTakingService.submit` renders it —
  // including §36's `missingInformation`, which is printed rather than omitted
  // because an omitted line reads as "nothing to report".
  const lakshmiSafety = evaluate(lakshmi.state);
  const rendered = renderCase(lakshmi.state, { safety: lakshmiSafety });
  const submittedAt = ago(115);
  const structuredCase = {
    rulesetVersion: RULESET_VERSION,
    consentVersion: CONSENT_VERSION,
    language: 'en',
    renderedAt: submittedAt.toISOString(),
    percentComplete: rendered.percentComplete,
    missingInformation: rendered.missingInformation,
    sections: rendered.sections,
    safety: {
      rulesetVersion: lakshmiSafety.rulesetVersion,
      highestSeverity: lakshmiSafety.highestSeverity,
      triggered: lakshmiSafety.triggered,
    },
    text: renderCaseText(rendered),
  };

  const submissionData = {
    organizationId,
    sessionId: lakshmi.sessionId,
    patientId: need('lakshmi').patientId,
    structuredCase: structuredCase as unknown as Prisma.InputJsonValue,
    // Null on purpose. Submitting an intake does not open a consultation, a
    // queue entry or a screening — it is a document waiting to be read.
    consultationId: null,
    preTriageId: null,
    queueId: null,
    submittedAt,
  };
  await prisma.caseSubmission.upsert({
    where: { id: 'case-sub-lakshmi' },
    update: submissionData,
    create: { id: 'case-sub-lakshmi', ...submissionData },
  });
  await prisma.caseSession.update({
    where: { id: lakshmi.sessionId },
    data: { status: 'submitted', submittedAt, lastActiveAt: submittedAt },
  });
  console.log(
    `✅ Lakshmi Venkatesan — submitted: ${rendered.percentComplete}% complete, ` +
      `${rendered.sections.length} sections, ` +
      `${rendered.missingInformation.length} questions printed as not assessed`,
  );

  // ── 5. Never started ─────────────────────────────────────────────────────
  //
  // No session, no facts, no documents. Deleted rather than merely not created,
  // so a demo given after somebody has clicked through Arjun's first run still
  // starts from a clean first run the next time this seed is applied.
  const arjun = need('arjun');
  await prisma.patientDocument.deleteMany({
    where: { patientId: arjun.patientId },
  });
  await prisma.caseSession.deleteMany({
    where: { patientId: arjun.patientId },
  });
  console.log('✅ Arjun Menon — no interview, clean first-run path');

  // ── The card for whoever is running the demo ─────────────────────────────
  const rows = await Promise.all(
    PERSONAS.map(async (persona) => {
      const patient = need(persona.key);
      const session = await prisma.caseSession.findFirst({
        where: { patientId: patient.patientId },
        orderBy: { startedAt: 'desc' },
      });
      const documents = await prisma.patientDocument.count({
        where: { patientId: patient.patientId, isDeleted: false },
      });
      const flags = session
        ? await prisma.caseRedFlag.count({ where: { sessionId: session.id } })
        : 0;
      return {
        name: `${persona.firstName} ${persona.lastName}`,
        email: persona.email,
        mrn: persona.mrn,
        status: session?.status ?? 'no session',
        progress: session ? `${session.progressPercent}%` : '—',
        documents,
        flags,
        demonstrates: persona.demonstrates,
      };
    }),
  );

  const width = (pick: (r: (typeof rows)[number]) => string): number =>
    Math.max(...rows.map((r) => pick(r).length));
  const nameWidth = width((r) => r.name);
  const emailWidth = width((r) => r.email);

  console.log(
    `\n🎉 Case-taking demo seed complete. Password: ${PORTAL_PASSWORD}\n`,
  );
  for (const row of rows) {
    console.log(
      `   ${row.name.padEnd(nameWidth)}  ${row.email.padEnd(emailWidth)}  ` +
        `${row.mrn}  ${row.status.padEnd(11)} ${row.progress.padStart(4)}  ` +
        `docs ${row.documents}  flags ${row.flags}  — ${row.demonstrates}`,
    );
  }
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error(
      '❌ Case-taking demo seed failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
