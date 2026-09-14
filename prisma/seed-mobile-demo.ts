import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { assertLocalDatabase } from './load-env';
import { hashPassword } from '../src/common/utils/hash.util';
import { queuePriorityRank } from '../src/modules/queue/dto/create-queue.dto';
import { mergeOrganizationSettings } from '../src/modules/settings/organization-settings';

assertLocalDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

/**
 * Mobile parity demo seed — every screen of the phone app, for every role.
 *
 * Run order:  npm run db:seed  →  npm run db:seed:catalog  →  npm run db:seed:mobile
 *
 * Unlike `test/seed-demo.ts` (API-driven, deliberately append-only) this writes
 * through Prisma and is **idempotent**: every row is an upsert keyed either on a
 * fixed `mob-` id or on the natural unique key the app itself mints — MRN, queue
 * number, screening number, order number, accession number, invoice number,
 * receipt number. Re-running updates in place; it never duplicates.
 *
 * Two rules make the demo survive the passage of time:
 *
 *   1. **Every timestamp is an offset from `SEED_ANCHOR`**, never a literal date.
 *      The dashboard is built around "today" — today's queue, today's revenue,
 *      today's appointments. Data pinned to a past date renders every tile at
 *      zero, which reads as a broken product rather than a stale seed. Re-running
 *      tomorrow moves the whole demo day to tomorrow.
 *   2. **Every random choice comes from a seeded PRNG**, so two runs produce
 *      identical data and a screenshot diff means a real regression.
 *
 * Depends on the catalog seed's fixed ids (`dept-opd`, `ward-general`,
 * `bed-ward-general-1`, `test-1`, `exam-1`, `svc-1`, `drug-1`, …). Those are a
 * determinism contract — this file looks them up and fails loudly rather than
 * creating its own.
 */

// ── Determinism ──────────────────────────────────────────────────────────────

/**
 * Anchor for every generated timestamp: today at 08:00 local.
 *
 * Pin it for visual regression, alongside the browser clock:
 *   SEED_ANCHOR_DATE=2026-03-15T08:00:00+05:30 npm run db:seed:mobile
 */
const SEED_ANCHOR = ((): Date => {
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

/** Anchor day + `days`, at `hour:minute` local. */
function at(days: number, hour: number, minute = 0): Date {
  const d = new Date(SEED_ANCHOR);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Anchor ± minutes. Negative is "this many minutes ago". */
function mins(offset: number): Date {
  return new Date(SEED_ANCHOR.getTime() + offset * 60_000);
}

/** "HH:mm", the shape `Appointment.appointmentTime` stores. */
function hhmm(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

/** HL7 MSH-7 / OBR-7 timestamp: YYYYMMDDHHMMSS. */
function hl7Stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Deterministic xorshift PRNG — the same one `test/lib/api-client.ts` uses, so
 * both seeds draw from an identical stream. Copied rather than imported because
 * `tsconfig.build.json` excludes `test/` and a prisma/ → test/ import would put
 * the whole test tree back into the build graph.
 */
function createRng(seed = 20260315) {
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

const rng = createRng();

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const money = (n: number): number => Math.round(n * 100) / 100;
const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── India-first demographics ─────────────────────────────────────────────────

/**
 * The patient roster is spelled out rather than generated.
 *
 * The brief is a *distribution* — two children, three over 75, both genders,
 * a VIP — and a PRNG that happens to satisfy it today stops satisfying it the
 * moment anything upstream of it consumes one extra random number.
 *
 * Indices 0–29 are MRN MOB-0001…MOB-0030, the demo cohort. Indices 30–35 exist
 * because the ward brief asks for 36 occupied beds and a bed may hold exactly
 * one live admission: 36 beds need 36 distinct inpatients, and 30 patients in
 * 36 beds is precisely the "one patient in two beds" defect the brief warns
 * about. They carry MOB-0031…MOB-0036 and are otherwise ordinary patients.
 */
const PATIENT_ROSTER = [
  { first: 'Aarav', last: 'Sharma', gender: 'male', age: 41 },
  { first: 'Priya', last: 'Iyer', gender: 'female', age: 34 },
  { first: 'Rohan', last: 'Reddy', gender: 'male', age: 57 },
  { first: 'Ananya', last: 'Patel', gender: 'female', age: 29 },
  { first: 'Vikram', last: 'Nair', gender: 'male', age: 4 },
  { first: 'Lakshmi', last: 'Banerjee', gender: 'female', age: 63 },
  { first: 'Arjun', last: 'Gupta', gender: 'male', age: 38 },
  { first: 'Kavita', last: 'Khan', gender: 'female', age: 78 },
  { first: 'Karthik', last: 'Deshmukh', gender: 'male', age: 45 },
  { first: 'Meera', last: 'Menon', gender: 'female', age: 31 },
  { first: 'Sanjay', last: 'Singh', gender: 'male', age: 52 },
  { first: 'Sunita', last: 'Rao', gender: 'female', age: 9 },
  { first: 'Rajesh', last: 'Chatterjee', gender: 'male', age: 66 },
  { first: 'Fatima', last: 'Verma', gender: 'female', age: 27 },
  { first: 'Imran', last: 'Pillai', gender: 'male', age: 35 },
  { first: 'Divya', last: 'Joshi', gender: 'female', age: 24 },
  { first: 'Manish', last: "D'Souza", gender: 'male', age: 49 },
  { first: 'Neha', last: 'Kulkarni', gender: 'female', age: 33 },
  { first: 'Deepak', last: 'Sharma', gender: 'male', age: 61 },
  { first: 'Anjali', last: 'Iyer', gender: 'female', age: 83 },
  { first: 'Suresh', last: 'Reddy', gender: 'male', age: 44 },
  { first: 'Rekha', last: 'Patel', gender: 'female', age: 39 },
  { first: 'Anil', last: 'Nair', gender: 'male', age: 28 },
  { first: 'Shreya', last: 'Banerjee', gender: 'female', age: 22 },
  { first: 'Harpreet', last: 'Gupta', gender: 'male', age: 54 },
  { first: 'Gurpreet', last: 'Khan', gender: 'female', age: 30 },
  { first: 'Nikhil', last: 'Deshmukh', gender: 'male', age: 47 },
  { first: 'Pooja', last: 'Menon', gender: 'female', age: 36 },
  { first: 'Prakash', last: 'Singh', gender: 'male', age: 88 },
  { first: 'Sarita', last: 'Rao', gender: 'female', age: 43 },
  { first: 'Venkatesh', last: 'Chatterjee', gender: 'male', age: 59 },
  { first: 'Aishwarya', last: 'Verma', gender: 'female', age: 26 },
  { first: 'Joseph', last: 'Pillai', gender: 'male', age: 37 },
  { first: 'Mary', last: 'Joshi', gender: 'female', age: 32 },
  { first: 'Ramesh', last: "D'Souza", gender: 'male', age: 50 },
  { first: 'Radha', last: 'Kulkarni', gender: 'female', age: 25 },
] as const;

/** `region` = state, `zone` = district, `woreda` = city, `kebele` = locality. */
const LOCALITIES = [
  {
    region: 'Maharashtra',
    zone: 'Mumbai Suburban',
    woreda: 'Mumbai',
    kebele: 'Andheri East',
    landmark: 'Near Chakala Metro Station',
  },
  {
    region: 'Delhi',
    zone: 'South West Delhi',
    woreda: 'New Delhi',
    kebele: 'Dwarka Sector 12',
    landmark: 'Opposite Dwarka Sector 12 Metro',
  },
  {
    region: 'Karnataka',
    zone: 'Bengaluru Urban',
    woreda: 'Bengaluru',
    kebele: 'Koramangala 5th Block',
    landmark: 'Behind Forum Mall',
  },
  {
    region: 'Tamil Nadu',
    zone: 'Chennai',
    woreda: 'Chennai',
    kebele: 'T. Nagar',
    landmark: 'Near Panagal Park',
  },
  {
    region: 'Telangana',
    zone: 'Rangareddy',
    woreda: 'Hyderabad',
    kebele: 'Gachibowli',
    landmark: 'Near DLF Cyber City',
  },
  {
    region: 'West Bengal',
    zone: 'Kolkata',
    woreda: 'Kolkata',
    kebele: 'Salt Lake Sector V',
    landmark: 'Near College More',
  },
  {
    region: 'Maharashtra',
    zone: 'Pune',
    woreda: 'Pune',
    kebele: 'Kothrud',
    landmark: 'Near Mhatre Bridge',
  },
  {
    region: 'Rajasthan',
    zone: 'Jaipur',
    woreda: 'Jaipur',
    kebele: 'Malviya Nagar',
    landmark: 'Near Gaurav Tower',
  },
  {
    region: 'Gujarat',
    zone: 'Ahmedabad',
    woreda: 'Ahmedabad',
    kebele: 'Navrangpura',
    landmark: 'Near Gujarat University',
  },
  {
    region: 'Uttar Pradesh',
    zone: 'Lucknow',
    woreda: 'Lucknow',
    kebele: 'Gomti Nagar',
    landmark: 'Near Lohia Park',
  },
  {
    region: 'Kerala',
    zone: 'Ernakulam',
    woreda: 'Kochi',
    kebele: 'Panampilly Nagar',
    landmark: 'Near Girinagar Junction',
  },
  {
    region: 'Odisha',
    zone: 'Khordha',
    woreda: 'Bhubaneswar',
    kebele: 'Patia',
    landmark: 'Near KIIT Square',
  },
] as const;

const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'O+',
  'O-',
  'AB+',
  'AB-',
] as const;
const ALLERGIES = [
  'Penicillin',
  'Sulfa drugs',
  'Iodinated contrast',
  'Peanuts',
  'Aspirin',
  'Latex',
] as const;
const CHRONIC = [
  'Type 2 diabetes mellitus',
  'Hypertension',
  'Bronchial asthma',
  'Hypothyroidism',
] as const;
const INSURERS = [
  { provider: 'Star Health & Allied Insurance', prefix: 'SHAI' },
  { provider: 'Ayushman Bharat PM-JAY', prefix: 'PMJAY' },
  { provider: 'HDFC ERGO Health', prefix: 'HDFC' },
] as const;
const RELATIONSHIPS = [
  'Spouse',
  'Father',
  'Mother',
  'Son',
  'Daughter',
  'Brother',
] as const;
const OCCUPATIONS = [
  'Software engineer',
  'Schoolteacher',
  'Shopkeeper',
  'Auto-rickshaw driver',
  'Homemaker',
  'Farmer',
  'Bank clerk',
  'Retired',
] as const;
const MARITAL = ['single', 'married', 'widowed'] as const;

const COMPLAINTS = [
  'Fever with chills for three days',
  'Productive cough and breathlessness',
  'Right lower abdominal pain since morning',
  'Burning micturition for two days',
  'Generalised weakness and giddiness',
  'Loose stools and vomiting since last night',
  'Chest tightness on climbing stairs',
  'Headache with blurring of vision',
  'Swelling of both ankles',
  'Pain in both knees on walking',
] as const;

const DIAGNOSES = [
  'Dengue fever with thrombocytopenia',
  'Community-acquired pneumonia',
  'Acute gastroenteritis with dehydration',
  'Essential hypertension, stage 2',
  'Type 2 diabetes mellitus with diabetic foot ulcer',
  'Urinary tract infection',
  'Iron deficiency anaemia',
  'Enteric fever',
  'COPD with acute exacerbation',
  'Acute coronary syndrome',
] as const;

/** Two children and three over-75s, placed by index so the mix is guaranteed. */
const VIP_INDEX = 0;
const ALLERGY_INDEXES = [2, 9, 17, 24];
const CHRONIC_INDEXES = [5, 13, 21];
const INSURED_INDEXES = [1, 11, 26];

// ── Catalog ids this seed depends on ─────────────────────────────────────────

const WARD_BEDS = {
  general: 20,
  private: 10,
  icu: 5,
  maternity: 15,
  pediatric: 10,
} as const;

const bedId = (ward: keyof typeof WARD_BEDS, n: number): string =>
  `bed-ward-${ward}-${n}`;

const range = (n: number, from = 1): number[] =>
  Array.from({ length: n }, (_, i) => i + from);

/**
 * 36 occupied, 3 reserved, 3 maintenance, 18 left available out of 60.
 *
 * The paediatric ward takes exactly the two children on the roster rather than
 * its full five beds: filling it to a target number would have meant admitting
 * adults to it, and a paediatric ward holding a 28-year-old is the first thing a
 * clinician spots. The freed beds go to maternity, which has women enough.
 */
const OCCUPIED_BEDS: Array<{ ward: keyof typeof WARD_BEDS; bed: string }> = [
  ...range(15).map((n) => ({
    ward: 'general' as const,
    bed: bedId('general', n),
  })),
  ...range(6).map((n) => ({
    ward: 'private' as const,
    bed: bedId('private', n),
  })),
  ...range(3).map((n) => ({ ward: 'icu' as const, bed: bedId('icu', n) })),
  ...range(10).map((n) => ({
    ward: 'maternity' as const,
    bed: bedId('maternity', n),
  })),
  ...range(2).map((n) => ({
    ward: 'pediatric' as const,
    bed: bedId('pediatric', n),
  })),
];
const RESERVED_BEDS = [
  bedId('general', 16),
  bedId('private', 7),
  bedId('maternity', 11),
];
const MAINTENANCE_BEDS = [
  bedId('general', 17),
  bedId('icu', 4),
  bedId('pediatric', 3),
];
/** Beds the closed admissions used to sit in; they stay `available`. */
const HISTORICAL_BEDS = [
  bedId('general', 18),
  bedId('general', 19),
  bedId('icu', 5),
];

/** Every bed the catalog seed creates — the set this seed owns and resets. */
const ALL_CATALOG_BEDS = (
  Object.keys(WARD_BEDS) as Array<keyof typeof WARD_BEDS>
).flatMap((ward) => range(WARD_BEDS[ward]).map((n) => bedId(ward, n)));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** +91 followed by ten digits starting 9/8/7 — the shape an Indian phone takes. */
function phone(series: number, i: number): string {
  const prefix = [98, 97, 96, 88, 77][series % 5];
  return `+91${prefix}${pad(30_000_000 + i * 137_541, 8).slice(0, 8)}`;
}

function dobFor(age: number): Date {
  const year = SEED_ANCHOR.getFullYear() - age;
  // 28 keeps every month valid; spread across the year so the patient list is
  // not one enormous shared birthday.
  return new Date(year, rng.int(0, 11), rng.int(1, 28), 12, 0, 0, 0);
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 Seeding mobile parity demo data...');
  console.log(
    `   Anchor: ${SEED_ANCHOR.toISOString()} (${SEED_ANCHOR.toString()})`,
  );

  const counts = {
    patients: 0,
    queue: 0,
    appointments: 0,
    preTriage: 0,
    beds: 0,
    admissions: 0,
    labOrders: 0,
    labResults: 0,
    radiologyOrders: 0,
    radiologyReports: 0,
    prescriptions: 0,
    pharmacySales: 0,
    invoices: 0,
    payments: 0,
    roles: 0,
    users: 0,
    integrations: 0,
  };

  // ── 0. Preconditions ───────────────────────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { slug: 'system' },
  });
  if (!org) {
    throw new Error(
      'Default organization (slug "system") not found. Run `npm run db:seed` first.',
    );
  }
  const organizationId = org.id;

  // The schema ships `inpatient: false`, which is right for a site that has no
  // beds and wrong for this demo — it admits thirty-nine patients below, and a
  // site with a switched-off ward module hides the ward board while the
  // dashboard counts occupied beds. The demo owns the demo's shape.
  const enabledModules = {
    ...(JSON.parse(org.modulesEnabled || '{}') as Record<string, boolean>),
    inpatient: true,
    laboratory: true,
    radiology: true,
    pharmacy: true,
  };
  await prisma.organization.update({
    where: { id: organizationId },
    data: { modulesEnabled: JSON.stringify(enabledModules) },
  });

  const [dept, ward, bed, labTest, exam, service, drug] = await Promise.all([
    prisma.department.findUnique({ where: { id: 'dept-opd' } }),
    prisma.ward.findUnique({ where: { id: 'ward-general' } }),
    prisma.bed.findUnique({ where: { id: bedId('general', 1) } }),
    prisma.labTest.findUnique({ where: { id: 'test-1' } }),
    prisma.radiologyExam.findUnique({ where: { id: 'exam-1' } }),
    prisma.billingService.findUnique({ where: { id: 'svc-1' } }),
    prisma.pharmacyDrug.findUnique({ where: { id: 'drug-1' } }),
  ]);
  const missing = [
    ['dept-opd', dept],
    ['ward-general', ward],
    [bedId('general', 1), bed],
    ['test-1', labTest],
    ['exam-1', exam],
    ['svc-1', service],
    ['drug-1', drug],
  ]
    .filter(([, row]) => !row)
    .map(([id]) => id as string);
  if (missing.length > 0) {
    throw new Error(
      `Catalog reference data missing (${missing.join(', ')}). ` +
        'Run `npm run db:seed:catalog` first.',
    );
  }
  console.log('✅ Organization and catalog reference data resolved');

  // Staff. The base seed ships exactly one DOCTOR account, so the "mixed
  // admitting/attending" spread below alternates between it and the radiologist
  // — those are the only two clinician logins that exist.
  const staff = await prisma.user.findMany({
    where: {
      email: {
        in: [
          'admin@hms.local',
          'doctor@hms.local',
          'nurse@hms.local',
          'receptionist@hms.local',
          'pharmacist@hms.local',
          'lab-tech@hms.local',
          'radiologist@hms.local',
          'billing@hms.local',
        ],
      },
    },
  });
  const byEmail = new Map(staff.map((u) => [u.email, u.id]));
  const staffId = (email: string): string =>
    must(
      byEmail.get(email),
      `User ${email} not found. Run \`npm run db:seed\` first.`,
    );

  const doctorId = staffId('doctor@hms.local');
  const nurseId = staffId('nurse@hms.local');
  const receptionistId = staffId('receptionist@hms.local');
  const pharmacistId = staffId('pharmacist@hms.local');
  const labTechId = staffId('lab-tech@hms.local');
  const radiologistId = staffId('radiologist@hms.local');
  const billingId = staffId('billing@hms.local');
  console.log(`✅ Resolved ${staff.length} staff accounts`);

  // ── 1. Patients ────────────────────────────────────────────────────────────
  const patientIds: string[] = [];

  for (const [i, person] of PATIENT_ROSTER.entries()) {
    const mrn = `MOB-${pad(i + 1, 4)}`;
    const id = `mob-pat-${pad(i + 1)}`;
    const loc = LOCALITIES[i % LOCALITIES.length];
    const insurerIdx = INSURED_INDEXES.indexOf(i);
    const insurer = insurerIdx >= 0 ? INSURERS[insurerIdx] : null;
    const isChild = person.age < 18;

    const data = {
      organizationId,
      mrn,
      firstName: person.first,
      lastName: person.last,
      middleName: null,
      dateOfBirth: dobFor(person.age),
      gender: person.gender,
      bloodGroup: rng.pick(BLOOD_GROUPS),
      phonePrimary: phone(i, i + 1),
      phoneSecondary: i % 5 === 0 ? phone(i + 2, i + 40) : null,
      email: `${person.first}.${person.last}`
        .toLowerCase()
        .replace(/[^a-z.]/g, '')
        .concat(`${i + 1}@example.in`),
      region: loc.region,
      zone: loc.zone,
      woreda: loc.woreda,
      kebele: loc.kebele,
      houseNumber: `${rng.int(1, 40)}/${rng.int(100, 899)}`,
      addressDescription: loc.landmark,
      emergencyContactName: `${rng.pick(PATIENT_ROSTER).first} ${person.last}`,
      emergencyContactPhone: phone(i + 1, i + 80),
      emergencyContactRelationship: isChild
        ? 'Father'
        : rng.pick(RELATIONSHIPS),
      allergies: ALLERGY_INDEXES.includes(i)
        ? JSON.stringify([
            ALLERGIES[ALLERGY_INDEXES.indexOf(i) % ALLERGIES.length],
            ...(i === 17 ? ['Latex'] : []),
          ])
        : JSON.stringify([]),
      chronicConditions: CHRONIC_INDEXES.includes(i)
        ? JSON.stringify([CHRONIC[CHRONIC_INDEXES.indexOf(i) % CHRONIC.length]])
        : JSON.stringify([]),
      currentMedications: CHRONIC_INDEXES.includes(i)
        ? JSON.stringify(['Metformin 500mg BD'])
        : JSON.stringify([]),
      hasInsurance: insurer !== null,
      insuranceProvider: insurer?.provider ?? null,
      insuranceId: insurer
        ? `${insurer.prefix}-${pad(900_000 + i * 733, 6)}`
        : null,
      insuranceExpiryDate: insurer ? at(280, 12) : null,
      insuranceCoverageDetails: insurer
        ? JSON.stringify({
            sumInsuredINR: 500_000,
            copayPercent: 10,
            roomRentCapINR: 5000,
          })
        : null,
      maritalStatus: isChild ? null : rng.pick(MARITAL),
      occupation: isChild ? 'Student' : rng.pick(OCCUPATIONS),
      isActive: true,
      isVip: i === VIP_INDEX,
      notes:
        i === VIP_INDEX
          ? 'VIP — board member. Route to private ward, notify administration on admission.'
          : null,
      isDeleted: false,
      deletedAt: null,
      createdById: receptionistId,
      updatedById: receptionistId,
    };

    const patient = await prisma.patient.upsert({
      where: { mrn },
      update: data,
      create: { id, ...data },
    });
    patientIds.push(patient.id);
    counts.patients++;
  }
  const childCount = PATIENT_ROSTER.filter((p) => p.age < 18).length;
  const elderCount = PATIENT_ROSTER.filter((p) => p.age > 75).length;
  console.log(
    `✅ Patients: ${counts.patients} (MOB-0001…MOB-${pad(PATIENT_ROSTER.length, 4)}; ` +
      `${childCount} children, ${elderCount} over 75, ${ALLERGY_INDEXES.length} with allergies, ` +
      `${CHRONIC_INDEXES.length} chronic, ${INSURED_INDEXES.length} insured, 1 VIP)`,
  );

  // ── 2. Today's queue ───────────────────────────────────────────────────────
  //
  // `waitBreachMinutes` defaults to 30 (see DEFAULT_ORGANIZATION_SETTINGS), so
  // the three waiting rows joined 45, 60 and 90 minutes ago are what gives the
  // board's breach flag something to raise.
  const QUEUE = [
    {
      area: 'opd',
      status: 'waiting',
      priority: 'p4',
      joined: -90,
      room: 'Room 3',
      staff: doctorId,
    },
    {
      area: 'opd',
      status: 'waiting',
      priority: 'p3',
      joined: -60,
      room: 'Room 3',
      staff: doctorId,
    },
    {
      area: 'emergency',
      status: 'waiting',
      priority: 'p1',
      joined: -45,
      room: 'Resus Bay 1',
      staff: doctorId,
    },
    {
      area: 'emergency',
      status: 'in_service',
      priority: 'p2',
      joined: -35,
      called: -30,
      started: -28,
      room: 'Resus Bay 2',
      staff: doctorId,
    },
    {
      area: 'mch',
      status: 'waiting',
      priority: 'p3',
      joined: -25,
      room: 'MCH Room 1',
      staff: nurseId,
    },
    {
      area: 'mch',
      status: 'called',
      priority: 'p4',
      joined: -20,
      called: -5,
      room: 'MCH Room 2',
      staff: nurseId,
    },
    {
      area: 'pediatric',
      status: 'waiting',
      priority: 'p2',
      joined: -18,
      room: 'Paed OPD 1',
      staff: nurseId,
    },
    {
      area: 'pediatric',
      status: 'completed',
      priority: 'p4',
      joined: -120,
      called: -110,
      started: -105,
      completed: -80,
      room: 'Paed OPD 2',
      staff: nurseId,
    },
    {
      area: 'laboratory',
      status: 'waiting',
      priority: 'p5',
      joined: -15,
      room: 'Sample Room',
      staff: labTechId,
    },
    {
      area: 'laboratory',
      status: 'in_service',
      priority: 'p3',
      joined: -50,
      called: -40,
      started: -38,
      room: 'Sample Room',
      staff: labTechId,
    },
    {
      area: 'radiology',
      status: 'waiting',
      priority: 'p4',
      joined: -12,
      room: 'X-ray 1',
      staff: radiologistId,
    },
    {
      area: 'radiology',
      status: 'called',
      priority: 'p3',
      joined: -22,
      called: -3,
      room: 'Ultrasound 1',
      staff: radiologistId,
    },
    {
      area: 'pharmacy',
      status: 'waiting',
      priority: 'p5',
      joined: -8,
      room: 'Counter 2',
      staff: pharmacistId,
    },
    {
      area: 'pharmacy',
      status: 'no_show',
      priority: 'p5',
      joined: -150,
      called: -140,
      room: 'Counter 1',
      staff: pharmacistId,
    },
  ] as const;

  // Ticket numbers run per service area, not per row: "now serving EME-03" on a
  // board that has only ever issued two emergency tickets is the kind of detail
  // that makes a demo look like a mock-up.
  const ticketSeq = new Map<string, number>();

  for (const [i, q] of QUEUE.entries()) {
    const prefix = q.area.slice(0, 3).toUpperCase();
    const seq = (ticketSeq.get(prefix) ?? 0) + 1;
    ticketSeq.set(prefix, seq);
    const queueNumber = `MOB-${prefix}-${pad(seq)}`;
    const called = 'called' in q ? mins(q.called) : null;
    const started = 'started' in q ? mins(q.started) : null;
    const completed = 'completed' in q ? mins(q.completed) : null;

    const data = {
      organizationId,
      patientId: patientIds[i],
      serviceArea: q.area,
      serviceType: q.area === 'pharmacy' ? 'dispensing' : 'consultation',
      priority: q.priority,
      // Derived, never invented: the board orders on this column and a rank that
      // disagrees with its priority string is a patient nobody can see.
      priorityRank: queuePriorityRank(q.priority),
      assignedToId: q.staff,
      assignedRoom: q.room,
      status: q.status,
      joinedQueueAt: mins(q.joined),
      calledAt: called,
      serviceStartedAt: started,
      serviceCompletedAt: completed,
      estimatedWaitMinutes: rng.int(5, 40),
      displayMessage:
        q.status === 'called' ? `Please proceed to ${q.room}` : null,
      isDeleted: false,
      deletedAt: null,
      createdBy: receptionistId,
      updatedBy: receptionistId,
    };

    await prisma.queueManagement.upsert({
      where: { queueNumber },
      update: data,
      create: {
        id: `mob-q-${prefix.toLowerCase()}-${pad(seq)}`,
        queueNumber,
        ...data,
      },
    });
    counts.queue++;
  }
  console.log(
    `✅ Queue: ${counts.queue} today (8 waiting incl. 3 past the 30-min breach threshold, ` +
      '2 called, 2 in_service, 1 completed, 1 no_show)',
  );

  // ── 3. Appointments ────────────────────────────────────────────────────────
  //
  // One of every status for today so the day view exercises each chip, plus six
  // spread across the coming week so a month grid is not a wall of blanks.
  const APPOINTMENTS = [
    { id: 'mob-appt-01', day: 0, hour: 9, minute: 0, status: 'scheduled' },
    { id: 'mob-appt-02', day: 0, hour: 9, minute: 30, status: 'confirmed' },
    { id: 'mob-appt-03', day: 0, hour: 10, minute: 0, status: 'checked_in' },
    { id: 'mob-appt-04', day: 0, hour: 10, minute: 30, status: 'in_progress' },
    { id: 'mob-appt-05', day: 0, hour: 11, minute: 0, status: 'completed' },
    { id: 'mob-appt-06', day: 0, hour: 11, minute: 30, status: 'cancelled' },
    { id: 'mob-appt-07', day: 0, hour: 12, minute: 0, status: 'no_show' },
    { id: 'mob-appt-08', day: 0, hour: 12, minute: 30, status: 'rescheduled' },
    { id: 'mob-appt-09', day: 1, hour: 9, minute: 0, status: 'scheduled' },
    { id: 'mob-appt-10', day: 2, hour: 10, minute: 30, status: 'confirmed' },
    { id: 'mob-appt-11', day: 3, hour: 11, minute: 0, status: 'scheduled' },
    { id: 'mob-appt-12', day: 4, hour: 14, minute: 30, status: 'scheduled' },
    { id: 'mob-appt-13', day: 6, hour: 9, minute: 30, status: 'confirmed' },
    { id: 'mob-appt-14', day: 7, hour: 15, minute: 0, status: 'scheduled' },
  ] as const;

  for (const [i, a] of APPOINTMENTS.entries()) {
    const slot = at(a.day, a.hour, a.minute);
    const checkedIn =
      a.status === 'checked_in' ||
      a.status === 'in_progress' ||
      a.status === 'completed'
        ? new Date(slot.getTime() - 9 * 60_000)
        : null;
    const started =
      a.status === 'in_progress' || a.status === 'completed'
        ? new Date(slot.getTime() + 4 * 60_000)
        : null;
    const completed =
      a.status === 'completed' ? new Date(slot.getTime() + 26 * 60_000) : null;
    const cancelled = a.status === 'cancelled' ? at(0, 8, 40) : null;

    const data = {
      organizationId,
      patientId: patientIds[(i * 3) % patientIds.length],
      doctorId,
      appointmentDate: slot,
      appointmentTime: hhmm(slot),
      durationMinutes: 30,
      appointmentType:
        i % 3 === 0 ? 'new_patient' : i % 3 === 1 ? 'follow_up' : 'emergency',
      departmentId: a.status === 'no_show' ? 'dept-emergency' : 'dept-opd',
      status: a.status,
      chiefComplaint: rng.pick(COMPLAINTS),
      notes: null,
      consultationNotes:
        a.status === 'completed'
          ? 'Vitals stable. Advised hydration and review in one week. Prescription issued.'
          : null,
      checkedInAt: checkedIn,
      checkedInById: checkedIn ? receptionistId : null,
      startedAt: started,
      completedAt: completed,
      cancelledAt: cancelled,
      cancelledById: cancelled ? receptionistId : null,
      cancellationReason: cancelled
        ? 'Patient called to cancel — travelling out of station'
        : null,
      // The rescheduled row and the slot it moved to point at each other, so the
      // "moved from / moved to" affordance resolves instead of dangling.
      rescheduledFromId: a.id === 'mob-appt-09' ? 'mob-appt-08' : null,
      rescheduledToId: a.status === 'rescheduled' ? 'mob-appt-09' : null,
      reminderSent: a.status === 'no_show' || a.status === 'confirmed',
      reminderSentAt:
        a.status === 'no_show' || a.status === 'confirmed'
          ? at(a.day - 1, 18, 0)
          : null,
      isDeleted: false,
      deletedAt: null,
      createdById: receptionistId,
    };

    await prisma.appointment.upsert({
      where: { id: a.id },
      update: data,
      create: { id: a.id, ...data },
    });
    counts.appointments++;
  }
  console.log(
    `✅ Appointments: ${counts.appointments} (8 today, one per status; 6 across the next 7 days)`,
  );

  // ── 4. Pre-triage screenings ───────────────────────────────────────────────
  //
  // Two rows carry deliberately out-of-range vitals — one septic-looking, one
  // hypothermic and hypotensive — because clinical flagging with nothing to flag
  // is indistinguishable from clinical flagging that is broken.
  const SCREENINGS = [
    {
      n: 1,
      status: 'screening',
      first: 'Sameer',
      last: 'Kulkarni',
      age: 34,
      gender: 'male',
      complaint: 'Fever with body ache for two days',
      vitals: { temp: 37.4, sys: 118, dia: 76, pulse: 82 },
      minutes: -110,
    },
    {
      n: 2,
      status: 'screening',
      first: 'Bhavna',
      last: 'Shetty',
      age: 58,
      gender: 'female',
      complaint: 'High fever with rigors and confusion',
      // Septic picture: pyrexia, tachycardia, hypertensive crisis range.
      vitals: { temp: 39.8, sys: 180, dia: 110, pulse: 132 },
      minutes: -95,
    },
    {
      n: 3,
      status: 'screening',
      first: 'Ravi',
      last: 'Thakur',
      age: 71,
      gender: 'male',
      complaint: 'Found drowsy at home, cold to touch',
      // Hypothermic and hypotensive — the other end of the same alarm.
      vitals: { temp: 35.1, sys: 85, dia: 50, pulse: 48 },
      minutes: -80,
    },
    {
      n: 4,
      status: 'screening',
      first: 'Nusrat',
      last: 'Ali',
      age: 26,
      gender: 'female',
      complaint: 'Cut on left forearm from kitchen knife, bleeding controlled',
      // Complaint recorded, vitals not taken yet — the screen must tolerate it.
      vitals: null,
      minutes: -40,
    },
    {
      n: 5,
      status: 'routed',
      first: 'Ganesh',
      last: 'Mhatre',
      age: 47,
      gender: 'male',
      complaint: 'Chest discomfort radiating to left arm',
      vitals: { temp: 36.9, sys: 148, dia: 94, pulse: 104 },
      minutes: -70,
      routedTo: 'adult_triage',
    },
    {
      n: 6,
      status: 'routed',
      first: 'Sneha',
      last: 'Bhosale',
      age: 28,
      gender: 'female',
      complaint: '36 weeks pregnant, reduced foetal movements since morning',
      vitals: { temp: 36.8, sys: 126, dia: 82, pulse: 92 },
      minutes: -55,
      routedTo: 'mch_triage',
    },
    {
      n: 7,
      status: 'registered_as_patient',
      patientIndex: 30,
      complaint: 'Breathlessness on exertion, known COPD',
      vitals: { temp: 37.1, sys: 134, dia: 86, pulse: 98 },
      minutes: -160,
    },
    {
      n: 8,
      status: 'registered_as_patient',
      patientIndex: 31,
      complaint: 'Painful swelling of right ankle after a fall',
      vitals: { temp: 36.6, sys: 122, dia: 78, pulse: 84 },
      minutes: -135,
    },
  ] as const;

  for (const s of SCREENINGS) {
    const screeningNumber = `MOB-SCR-${pad(s.n)}`;
    const linked =
      'patientIndex' in s ? PATIENT_ROSTER[s.patientIndex as number] : null;
    const patientId =
      'patientIndex' in s ? patientIds[s.patientIndex as number] : null;
    const routedAt = 'routedTo' in s ? mins((s.minutes as number) + 12) : null;

    const data = {
      organizationId,
      firstName: linked
        ? linked.first
        : 'first' in s
          ? (s.first as string)
          : null,
      lastName: linked ? linked.last : 'last' in s ? (s.last as string) : null,
      age: linked ? linked.age : 'age' in s ? (s.age as number) : null,
      gender: linked
        ? linked.gender
        : 'gender' in s
          ? (s.gender as string)
          : null,
      phone: phone(s.n, 200 + s.n),
      chiefComplaint: s.complaint,
      briefHistory:
        s.vitals === null
          ? 'Walked in unaccompanied. Vitals pending — triage nurse to review.'
          : 'No significant past history volunteered at screening.',
      temperature: s.vitals?.temp ?? null,
      bloodPressureSystolic: s.vitals?.sys ?? null,
      bloodPressureDiastolic: s.vitals?.dia ?? null,
      pulseRate: s.vitals?.pulse ?? null,
      routedTo: 'routedTo' in s ? (s.routedTo as string) : null,
      status: s.status,
      patientId,
      screenedAt: mins(s.minutes),
      screenedById: nurseId,
      routedAt,
      routedById: routedAt ? nurseId : null,
      updatedBy: nurseId,
      isDeleted: false,
      deletedAt: null,
    };

    await prisma.preTriage.upsert({
      where: { screeningNumber },
      update: data,
      create: { id: `mob-scr-${pad(s.n)}`, screeningNumber, ...data },
    });
    counts.preTriage++;
  }
  console.log(
    `✅ Pre-triage: ${counts.preTriage} (4 screening, 2 routed, 2 registered; ` +
      '2 with out-of-range vitals, 1 with no vitals recorded)',
  );

  // ── 5. Inpatient: beds and admissions ──────────────────────────────────────
  //
  // The invariant that matters: an `occupied` bed has exactly one live admission
  // and its `currentPatientId` set, and no patient appears in two beds. Break it
  // and the ward screen shows the same person twice.
  const pool36 = patientIds.map((id, i) => ({ id, i, ...PATIENT_ROSTER[i] }));
  const taken = new Set<number>();
  const take = (
    count: number,
    predicate: (p: (typeof pool36)[number]) => boolean,
  ): string[] => {
    const picked: string[] = [];
    for (const p of pool36) {
      if (picked.length === count) break;
      if (taken.has(p.i) || !predicate(p)) continue;
      taken.add(p.i);
      picked.push(p.id);
    }
    return picked;
  };

  // Children into the paediatric ward, women of childbearing age into maternity,
  // the oldest into ICU, then everybody else — a ward map that contradicts its
  // own patients reads as fake to any clinician who opens it. The private ward
  // is drawn half and half so it does not come out as six men by accident of
  // roster order.
  const paediatric = take(2, (p) => p.age < 18);
  const maternity = take(
    10,
    (p) => p.gender === 'female' && p.age >= 18 && p.age <= 45,
  );
  const icu = take(3, (p) => p.age >= 55);
  const privateWard = [
    ...take(3, (p) => p.gender === 'female'),
    ...take(3, (p) => p.gender === 'male'),
  ];
  const general = take(15, () => true);
  const wardAssignment = [
    ...general,
    ...privateWard,
    ...icu,
    ...maternity,
    ...paediatric,
  ];

  if (wardAssignment.length !== OCCUPIED_BEDS.length) {
    throw new Error(
      `Ward assignment produced ${wardAssignment.length} patients for ${OCCUPIED_BEDS.length} beds.`,
    );
  }
  if (new Set(wardAssignment).size !== wardAssignment.length) {
    throw new Error('Ward assignment placed the same patient in two beds.');
  }

  // Clear the whole catalog bed map first, exactly as seed-catalog.ts does.
  // Without it a bed occupied by a previous run of *this* file with a different
  // distribution stays occupied for ever, and the ward totals drift a little
  // further from the admission list every time the layout is edited.
  await prisma.bed.updateMany({
    where: { organizationId, id: { in: ALL_CATALOG_BEDS } },
    data: { status: 'available', currentPatientId: null },
  });

  // The order of OCCUPIED_BEDS is general → private → icu → maternity →
  // paediatric, which is the order `wardAssignment` was built in.
  for (const [i, slot] of OCCUPIED_BEDS.entries()) {
    const patientId = wardAssignment[i];
    const admissionId = `mob-adm-${pad(i + 1)}`;
    const daysBack = i % 10; // 0–9 days back, as briefed
    const admittedAt = at(-daysBack, 9 + (i % 8), (i % 4) * 15);
    const useRadiologist = i % 5 === 0;

    const data = {
      organizationId,
      patientId,
      bedId: slot.bed,
      admissionDate: admittedAt,
      admissionType:
        i % 4 === 0 ? 'emergency' : i % 7 === 0 ? 'transfer' : 'elective',
      admissionReason: DIAGNOSES[i % DIAGNOSES.length],
      admittingDoctorId: useRadiologist ? radiologistId : doctorId,
      attendingDoctorId: doctorId,
      status: 'admitted',
      dischargeDate: null,
      dischargeReason: null,
      dischargeSummary: null,
      dischargeDoctorId: null,
      followUpDate: null,
      followUpNotes: null,
    };

    await prisma.admission.upsert({
      where: { id: admissionId },
      update: data,
      create: { id: admissionId, ...data },
    });
    counts.admissions++;

    await prisma.bed.update({
      where: { id: slot.bed },
      data: { status: 'occupied', currentPatientId: patientId },
    });
    counts.beds++;
  }

  for (const id of RESERVED_BEDS) {
    await prisma.bed.update({
      where: { id },
      data: { status: 'reserved', currentPatientId: null },
    });
    counts.beds++;
  }
  for (const id of MAINTENANCE_BEDS) {
    await prisma.bed.update({
      where: { id },
      data: { status: 'maintenance', currentPatientId: null },
    });
    counts.beds++;
  }
  // The beds behind the closed admissions stay available: that is exactly what
  // the discharge path in InpatientService does to a bed it releases.
  for (const id of HISTORICAL_BEDS) {
    await prisma.bed.update({
      where: { id },
      data: { status: 'available', currentPatientId: null },
    });
    counts.beds++;
  }

  // Closed admissions. Their `bedId` is retained (the service does not clear it
  // on discharge) but those beds are available, so the live-admission invariant
  // still holds. Every discharge predates every live admission, so nobody is in
  // two places at once.
  const CLOSED_ADMISSIONS = [
    {
      id: 'mob-adm-37',
      patientIndex: 0,
      bed: HISTORICAL_BEDS[0],
      admitted: -14,
      discharged: -11,
      status: 'discharged',
      reason: 'Recovered — discharged on request',
      summary:
        'Admitted with dengue fever and thrombocytopenia. Platelets recovered to 1.4 lakh/µL ' +
        'over three days of supportive care. Afebrile for 48 hours before discharge. ' +
        'Advised oral hydration, paracetamol SOS and platelet recheck in 72 hours.',
    },
    {
      id: 'mob-adm-38',
      patientIndex: 3,
      bed: HISTORICAL_BEDS[1],
      admitted: -21,
      discharged: -17,
      status: 'discharged',
      reason: 'Recovered',
      summary:
        'Community-acquired pneumonia, right lower lobe. Completed five days of IV ceftriaxone, ' +
        'stepped down to oral amoxicillin. Chest radiograph on discharge showed clearing ' +
        'consolidation. Review in OPD after one week.',
    },
    {
      id: 'mob-adm-39',
      patientIndex: 6,
      bed: HISTORICAL_BEDS[2],
      admitted: -30,
      discharged: -28,
      status: 'transferred',
      reason: 'Transferred to tertiary cardiac centre for primary angioplasty',
      summary:
        'Acute coronary syndrome with ongoing chest pain and dynamic ECG changes. ' +
        'Thrombolysis deferred; transferred by advanced cardiac ambulance with ' +
        'accompanying medical officer. Handover documentation sent with the patient.',
    },
  ] as const;

  for (const a of CLOSED_ADMISSIONS) {
    const data = {
      organizationId,
      patientId: patientIds[a.patientIndex],
      bedId: a.bed,
      admissionDate: at(a.admitted, 10, 30),
      admissionType: a.status === 'transferred' ? 'emergency' : 'elective',
      admissionReason: DIAGNOSES[a.patientIndex % DIAGNOSES.length],
      admittingDoctorId: doctorId,
      attendingDoctorId: doctorId,
      status: a.status,
      dischargeDate: at(a.discharged, 11, 15),
      dischargeReason: a.reason,
      dischargeSummary: a.summary,
      dischargeDoctorId: doctorId,
      followUpDate:
        a.status === 'discharged' ? at(a.discharged + 21, 10, 0) : null,
      followUpNotes:
        a.status === 'discharged'
          ? 'Review in OPD with repeat blood counts.'
          : null,
    };

    await prisma.admission.upsert({
      where: { id: a.id },
      update: data,
      create: { id: a.id, ...data },
    });
    counts.admissions++;
  }
  console.log(
    `✅ Inpatient: ${OCCUPIED_BEDS.length} beds occupied (one live admission each), ` +
      `${RESERVED_BEDS.length} reserved, ${MAINTENANCE_BEDS.length} maintenance; ` +
      `${counts.admissions} admissions total (2 discharged, 1 transferred)`,
  );

  // ── 6. Laboratory ──────────────────────────────────────────────────────────
  const LAB_ORDERS = [
    {
      n: 1,
      status: 'pending',
      tests: [['test-1', 'Complete Blood Count (CBC)', 'CBC']],
      priority: 'routine',
      hours: -3,
    },
    {
      n: 2,
      status: 'pending',
      tests: [['test-7', 'Urinalysis', 'URIN']],
      priority: 'urgent',
      hours: -2,
    },
    {
      n: 3,
      status: 'sample_collected',
      tests: [
        ['test-2', 'Hemoglobin', 'HGB'],
        ['test-8', 'Random Blood Sugar', 'RBS'],
      ],
      priority: 'routine',
      hours: -4,
    },
    {
      n: 4,
      status: 'sample_collected',
      tests: [['test-4', 'Malaria RDT', 'MRDT']],
      priority: 'urgent',
      hours: -3,
    },
    {
      n: 5,
      status: 'in_progress',
      tests: [['test-11', 'Liver Function Test', 'LFT']],
      priority: 'routine',
      hours: -5,
    },
    {
      n: 6,
      status: 'in_progress',
      tests: [['test-15', 'Widal Test', 'WIDAL']],
      priority: 'stat',
      hours: -6,
    },
    {
      n: 7,
      status: 'completed',
      tests: [['test-2', 'Hemoglobin', 'HGB']],
      priority: 'routine',
      hours: -7,
    },
    {
      n: 8,
      status: 'completed',
      tests: [['test-8', 'Random Blood Sugar', 'RBS']],
      priority: 'stat',
      hours: -5,
    },
    {
      n: 9,
      status: 'completed',
      tests: [
        ['test-12', 'Renal Function Test', 'RFT'],
        ['test-1', 'Complete Blood Count (CBC)', 'CBC'],
      ],
      priority: 'routine',
      hours: -8,
    },
    {
      n: 10,
      status: 'cancelled',
      tests: [['test-10', 'Lipid Profile', 'LIPID']],
      priority: 'routine',
      hours: -9,
    },
  ] as const;

  const COLLECTED = ['sample_collected', 'in_progress', 'completed'];

  for (const o of LAB_ORDERS) {
    const orderNumber = `MOB-LAB-${pad(o.n, 4)}`;
    const orderDate = mins(o.hours * 60);
    const collected = COLLECTED.includes(o.status);
    const done = o.status === 'completed';
    // Order 8 is the critical one; its result is deliberately left unverified.
    const verified = done && o.n !== 8;

    const data = {
      organizationId,
      patientId: patientIds[(o.n * 2) % patientIds.length],
      requestedById: doctorId,
      orderDate,
      tests: JSON.stringify(
        o.tests.map(([testId, testName, testCode]) => ({
          testId,
          testName,
          testCode,
          urgency: o.priority,
        })),
      ),
      clinicalIndication: COMPLAINTS[o.n % COMPLAINTS.length],
      provisionalDiagnosis: DIAGNOSES[o.n % DIAGNOSES.length],
      priority: o.priority,
      status: o.status,
      sampleCollectedAt: collected
        ? new Date(orderDate.getTime() + 20 * 60_000)
        : null,
      sampleCollectedById: collected ? labTechId : null,
      accessionNumber: collected ? `MOB-ACC-${pad(o.n, 4)}` : null,
      resultsEnteredAt: done
        ? new Date(orderDate.getTime() + 95 * 60_000)
        : null,
      resultsEnteredById: done ? labTechId : null,
      resultsVerifiedAt: verified
        ? new Date(orderDate.getTime() + 130 * 60_000)
        : null,
      resultsVerifiedById: verified ? doctorId : null,
      resultsReportedAt: verified
        ? new Date(orderDate.getTime() + 135 * 60_000)
        : null,
      notes: null,
      rejectionReason:
        o.status === 'cancelled'
          ? 'Sample haemolysed in transit — recollection requested'
          : null,
      createdById: doctorId,
    };

    await prisma.labOrder.upsert({
      where: { orderNumber },
      update: data,
      create: { id: `mob-lab-${pad(o.n)}`, orderNumber, ...data },
    });
    counts.labOrders++;
  }

  /**
   * Values are placed against the catalog's own `referenceRanges`, not invented:
   * HGB 13–17 (critical < 7), RBS 70–140 (critical > 400), creatinine 0.7–1.3.
   * Exactly one result is critical *and* unverified — that pair is what the
   * dashboard's critical-alerts tile counts.
   */
  const LAB_RESULTS = [
    {
      n: 1,
      order: 7,
      testId: 'test-2',
      value: '9.1',
      unit: 'g/dL',
      abnormal: true,
      critical: false,
      flag: 'L',
      min: 13.0,
      max: 17.0,
      rangeText: '13.0 – 17.0 g/dL (adult male)',
      verified: true,
      comment: 'Microcytic hypochromic picture. Suggest iron studies.',
      instrument: 'Sysmex XN-550',
    },
    {
      n: 2,
      order: 8,
      testId: 'test-8',
      value: '412',
      unit: 'mg/dL',
      abnormal: true,
      critical: true,
      flag: 'H',
      min: 70,
      max: 140,
      rangeText: '70 – 140 mg/dL (random); critical above 400',
      verified: false,
      comment:
        'CRITICAL — above the catalog critical high of 400 mg/dL. Ward informed by phone; awaiting pathologist verification.',
      instrument: 'Roche Cobas c311',
    },
    {
      n: 3,
      order: 9,
      testId: 'test-12',
      value: '2.4',
      unit: 'mg/dL',
      abnormal: true,
      critical: false,
      flag: 'H',
      min: 0.7,
      max: 1.3,
      rangeText: '0.7 – 1.3 mg/dL (serum creatinine, adult male)',
      verified: true,
      comment:
        'Raised creatinine. Correlate clinically; repeat after hydration.',
      instrument: 'Roche Cobas c311',
    },
    {
      n: 4,
      order: 9,
      testId: 'test-1',
      value: '7.8',
      unit: 'x10^9/L',
      abnormal: false,
      critical: false,
      flag: 'N',
      min: 4.0,
      max: 11.0,
      rangeText: '4.0 – 11.0 x10^9/L',
      verified: true,
      comment: 'Within reference range.',
      instrument: 'Sysmex XN-550',
    },
  ] as const;

  for (const r of LAB_RESULTS) {
    const id = `mob-labres-${pad(r.n)}`;
    const order = must(
      await prisma.labOrder.findUnique({
        where: { orderNumber: `MOB-LAB-${pad(r.order, 4)}` },
      }),
      `Lab order MOB-LAB-${pad(r.order, 4)} missing`,
    );

    const data = {
      organizationId,
      orderId: order.id,
      testId: r.testId,
      resultValue: r.value,
      resultUnit: r.unit,
      isAbnormal: r.abnormal,
      isCritical: r.critical,
      flag: r.flag,
      referenceRangeMin: r.min,
      referenceRangeMax: r.max,
      referenceRangeText: r.rangeText,
      qcLevel: 'Level 2',
      qcPassed: true,
      methodUsed: r.testId === 'test-1' ? 'Flow cytometry' : 'Photometric',
      instrumentUsed: r.instrument,
      enteredById: labTechId,
      enteredAt: must(order.resultsEnteredAt, 'resultsEnteredAt missing'),
      verifiedById: r.verified ? doctorId : null,
      verifiedAt: r.verified ? order.resultsVerifiedAt : null,
      comment: r.comment,
      technicianNotes: null,
    };

    await prisma.labResult.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    counts.labResults++;
  }
  console.log(
    `✅ Laboratory: ${counts.labOrders} orders across all five statuses, ` +
      `${counts.labResults} results (3 abnormal with H/L flags, 1 critical and unverified)`,
  );

  // ── 7. Radiology ───────────────────────────────────────────────────────────
  const RAD_ORDERS = [
    {
      n: 1,
      examId: 'exam-1',
      status: 'pending',
      urgency: 'routine',
      hours: -2,
    },
    { n: 2, examId: 'exam-4', status: 'pending', urgency: 'urgent', hours: -3 },
    {
      n: 3,
      examId: 'exam-6',
      status: 'scheduled',
      urgency: 'routine',
      hours: -4,
    },
    {
      n: 4,
      examId: 'exam-5',
      status: 'in_progress',
      urgency: 'routine',
      hours: -5,
    },
    {
      n: 5,
      examId: 'exam-2',
      status: 'completed',
      urgency: 'urgent',
      hours: -6,
    },
    {
      n: 6,
      examId: 'exam-1',
      status: 'reported',
      urgency: 'routine',
      hours: -7,
    },
    { n: 7, examId: 'exam-8', status: 'reported', urgency: 'stat', hours: -8 },
    {
      n: 8,
      examId: 'exam-10',
      status: 'cancelled',
      urgency: 'routine',
      hours: -9,
    },
  ] as const;

  for (const o of RAD_ORDERS) {
    const orderNumber = `MOB-RAD-${pad(o.n, 4)}`;
    const orderDate = mins(o.hours * 60);
    const performed = ['in_progress', 'completed', 'reported'].includes(
      o.status,
    );
    const reported = o.status === 'reported';

    const data = {
      organizationId,
      patientId: patientIds[(o.n * 4) % patientIds.length],
      requestedById: doctorId,
      examId: o.examId,
      orderDate,
      clinicalIndication: COMPLAINTS[(o.n + 3) % COMPLAINTS.length],
      provisionalDiagnosis: DIAGNOSES[(o.n + 2) % DIAGNOSES.length],
      relevantHistory:
        o.n === 7
          ? 'Fall from two-wheeler, brief loss of consciousness.'
          : null,
      urgency: o.urgency,
      status: o.status,
      scheduledDate: o.status === 'scheduled' ? at(0, 14, 0) : null,
      examPerformedAt: performed
        ? new Date(orderDate.getTime() + 45 * 60_000)
        : null,
      performedById: performed ? radiologistId : null,
      reportCreatedAt: reported
        ? new Date(orderDate.getTime() + 80 * 60_000)
        : null,
      reportedById: reported ? radiologistId : null,
      reportVerifiedAt: reported
        ? new Date(orderDate.getTime() + 95 * 60_000)
        : null,
      verifiedById: reported ? radiologistId : null,
      notes: null,
      cancellationReason:
        o.status === 'cancelled'
          ? 'Patient declined contrast study — eGFR below protocol threshold'
          : null,
      createdById: doctorId,
    };

    await prisma.radiologyOrder.upsert({
      where: { orderNumber },
      update: data,
      create: { id: `mob-rad-${pad(o.n)}`, orderNumber, ...data },
    });
    counts.radiologyOrders++;
  }

  const RAD_REPORTS = [
    {
      n: 1,
      order: 6,
      technique: 'PA erect chest radiograph.',
      findings:
        'Lung fields clear. Cardiothoracic ratio within normal limits. Both costophrenic angles ' +
        'sharp. No pneumothorax or pleural effusion. Bony thorax unremarkable.',
      impression: 'Normal chest radiograph.',
      recommendations: 'No radiological follow-up indicated.',
      critical: false,
    },
    {
      n: 2,
      order: 7,
      technique: 'Non-contrast CT of the brain, 5 mm axial sections.',
      findings:
        'Hyperdense crescentic collection along the right fronto-parietal convexity measuring ' +
        '11 mm in maximal thickness, with 6 mm midline shift to the left and effacement of the ' +
        'right lateral ventricle. No skull fracture on bone windows.',
      impression:
        'Acute right fronto-parietal subdural haematoma with mass effect and midline shift.',
      recommendations: 'Urgent neurosurgical consultation.',
      critical: true,
    },
  ] as const;

  for (const rep of RAD_REPORTS) {
    const order = must(
      await prisma.radiologyOrder.findUnique({
        where: { orderNumber: `MOB-RAD-${pad(rep.order, 4)}` },
      }),
      `Radiology order MOB-RAD-${pad(rep.order, 4)} missing`,
    );

    const data = {
      organizationId,
      orderId: order.id,
      technique: rep.technique,
      findings: rep.findings,
      impression: rep.impression,
      recommendations: rep.recommendations,
      hasCriticalFindings: rep.critical,
      criticalFindings: rep.critical
        ? 'Acute subdural haematoma with 6 mm midline shift — requires immediate neurosurgical review.'
        : null,
      criticalNotifiedTo: rep.critical
        ? 'Dr Gregory House (on-call physician)'
        : null,
      criticalNotifiedAt: rep.critical ? order.reportCreatedAt : null,
      comparedWithPrevious: false,
      comparisonNotes: null,
      images: JSON.stringify([]),
      dicomStudyUid: `1.2.840.113619.2.55.3.${pad(604_000 + rep.n, 6)}`,
      templateUsed: rep.critical ? 'CT Head — Trauma' : 'Chest X-ray — Routine',
      reportedById: radiologistId,
      reportedAt: must(order.reportCreatedAt, 'reportCreatedAt missing'),
      verifiedById: radiologistId,
      verifiedAt: order.reportVerifiedAt,
      status: 'final',
      amendmentReason: null,
      amendedAt: null,
      amendedById: null,
    };

    await prisma.radiologyReport.upsert({
      where: { orderId: order.id },
      update: data,
      create: { id: `mob-radrep-${pad(rep.n)}`, ...data },
    });
    counts.radiologyReports++;
  }
  console.log(
    `✅ Radiology: ${counts.radiologyOrders} orders across all six statuses, ` +
      `${counts.radiologyReports} reports (1 with critical findings and notification)`,
  );

  // ── 8. Pharmacy ────────────────────────────────────────────────────────────
  //
  // `items` is a JSON *string* on the model, not a JSON column — the pharmacy
  // service stringifies before writing and the app parses on read.
  const RX_ITEMS = {
    amox: {
      drugId: 'drug-1',
      drugName: 'Amoxicillin 500mg',
      dosage: '500mg',
      frequency: 'Three times daily',
      duration: '7 days',
      quantity: 21,
      instructions: 'Take after food',
      unitPrice: 25,
    },
    para: {
      drugId: 'drug-2',
      drugName: 'Paracetamol 500mg',
      dosage: '500mg',
      frequency: 'SOS, maximum four times daily',
      duration: '5 days',
      quantity: 15,
      instructions: 'Do not exceed 4 g in 24 hours',
      unitPrice: 5,
    },
    metformin: {
      drugId: 'drug-10',
      drugName: 'Metformin 500mg',
      dosage: '500mg',
      frequency: 'Twice daily',
      duration: '30 days',
      quantity: 60,
      instructions: 'Take with meals',
      unitPrice: 20,
    },
    omeprazole: {
      drugId: 'drug-9',
      drugName: 'Omeprazole 20mg',
      dosage: '20mg',
      frequency: 'Once daily',
      duration: '14 days',
      quantity: 14,
      instructions: 'Take before breakfast',
      unitPrice: 45,
    },
    ors: {
      drugId: 'drug-7',
      drugName: 'Oral Rehydration Salts',
      dosage: '1 sachet',
      frequency: 'After every loose stool',
      duration: '3 days',
      quantity: 10,
      instructions: 'Dissolve in one litre of clean water',
      unitPrice: 15,
    },
    salbutamol: {
      drugId: 'drug-12',
      drugName: 'Salbutamol Inhaler',
      dosage: '2 puffs',
      frequency: 'SOS',
      duration: '30 days',
      quantity: 1,
      instructions: 'Rinse mouth after use',
      unitPrice: 150,
    },
  } as const;

  const PRESCRIPTIONS = [
    {
      n: 1,
      status: 'pending',
      items: [RX_ITEMS.amox, RX_ITEMS.para],
      hours: -1,
    },
    {
      n: 2,
      status: 'pending',
      items: [RX_ITEMS.ors, RX_ITEMS.para],
      hours: -2,
    },
    {
      n: 3,
      status: 'partially_dispensed',
      items: [RX_ITEMS.metformin, RX_ITEMS.omeprazole],
      hours: -4,
    },
    {
      n: 4,
      status: 'partially_dispensed',
      items: [RX_ITEMS.salbutamol, RX_ITEMS.para],
      hours: -5,
    },
    {
      n: 5,
      status: 'fully_dispensed',
      items: [RX_ITEMS.amox, RX_ITEMS.para],
      hours: -6,
    },
    { n: 6, status: 'fully_dispensed', items: [RX_ITEMS.metformin], hours: -7 },
  ] as const;

  for (const rx of PRESCRIPTIONS) {
    const id = `mob-rx-${pad(rx.n)}`;
    const dispensed = rx.status !== 'pending';
    const prescribedAt = mins(rx.hours * 60);

    const data = {
      organizationId,
      patientId: patientIds[(rx.n * 5) % patientIds.length],
      doctorId,
      prescriptionDate: prescribedAt,
      items: JSON.stringify(
        rx.items.map((item) => ({
          drugId: item.drugId,
          drugName: item.drugName,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity,
          instructions: item.instructions,
        })),
      ),
      status: rx.status,
      dispensedById: dispensed ? pharmacistId : null,
      dispensedAt: dispensed
        ? new Date(prescribedAt.getTime() + 35 * 60_000)
        : null,
      notes:
        rx.status === 'partially_dispensed'
          ? 'Second item out of stock — patient advised to collect tomorrow.'
          : null,
      isRefill: false,
      refillsAllowed: rx.status === 'fully_dispensed' ? 1 : 0,
      refillsRemaining: rx.status === 'fully_dispensed' ? 1 : 0,
      createdById: doctorId,
    };

    await prisma.prescription.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    counts.prescriptions++;
  }

  const SALES = [
    { n: 1, rx: 5, items: [RX_ITEMS.amox, RX_ITEMS.para], method: 'cash' },
    { n: 2, rx: 6, items: [RX_ITEMS.metformin], method: 'mobile_money' },
  ] as const;

  for (const sale of SALES) {
    const receiptNumber = `MOB-PHR-${pad(sale.n, 4)}`;
    const rx = must(
      await prisma.prescription.findUnique({
        where: { id: `mob-rx-${pad(sale.rx)}` },
      }),
      `Prescription mob-rx-${pad(sale.rx)} missing`,
    );
    const lines = sale.items.map((item) => ({
      drugId: item.drugId,
      drugName: item.drugName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: money(item.quantity * item.unitPrice),
    }));
    const subtotal = money(lines.reduce((sum, l) => sum + l.total, 0));

    const data = {
      organizationId,
      patientId: rx.patientId,
      prescriptionId: rx.id,
      servedById: pharmacistId,
      saleDate: mins(-30 * sale.n),
      saleType: 'prescription',
      items: JSON.stringify(lines),
      subtotal,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: subtotal,
      paymentStatus: 'paid',
      paymentMethod: sale.method,
      amountPaid: subtotal,
      amountDue: 0,
      createdById: pharmacistId,
    };

    await prisma.pharmacySale.upsert({
      where: { receiptNumber },
      update: data,
      create: { id: `mob-sale-${pad(sale.n)}`, receiptNumber, ...data },
    });
    counts.pharmacySales++;
  }
  console.log(
    `✅ Pharmacy: ${counts.prescriptions} prescriptions (2 pending, 2 partial, 2 fully dispensed), ` +
      `${counts.pharmacySales} sales`,
  );

  // ── 9. Billing ─────────────────────────────────────────────────────────────
  //
  // Tax is modelled the way an Indian invoice reads: an 18% GST split into CGST
  // 9% + SGST 9% on the taxable lines, consultations left exempt. The invoice
  // totals follow BillingService.createInvoice — subtotal is the sum of the
  // pre-tax line totals, `taxAmount` the sum of the line taxes.
  interface Line {
    svc: string;
    description: string;
    unitPrice: number;
    quantity: number;
    gst: number;
    hsn: string;
  }

  const INVOICES: Array<{
    n: number;
    patientIndex: number;
    lines: Line[];
    paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
    status: string;
  }> = [
    {
      n: 1,
      patientIndex: 2,
      paymentStatus: 'unpaid',
      status: 'sent',
      lines: [
        {
          svc: 'svc-1',
          description: 'General Consultation',
          unitPrice: 150,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
        {
          svc: 'svc-8',
          description: 'Injection',
          unitPrice: 30,
          quantity: 2,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      n: 2,
      patientIndex: 5,
      paymentStatus: 'unpaid',
      status: 'sent',
      lines: [
        {
          svc: 'svc-2',
          description: 'Specialist Consultation',
          unitPrice: 300,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
        {
          svc: 'svc-5',
          description: 'Minor Procedure',
          unitPrice: 500,
          quantity: 1,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      n: 3,
      patientIndex: 8,
      paymentStatus: 'unpaid',
      status: 'draft',
      lines: [
        {
          svc: 'svc-3',
          description: 'Emergency Consultation',
          unitPrice: 200,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
        {
          svc: 'svc-7',
          description: 'Dressing',
          unitPrice: 50,
          quantity: 3,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      n: 4,
      patientIndex: 12,
      paymentStatus: 'partially_paid',
      status: 'sent',
      lines: [
        {
          svc: 'svc-10',
          description: 'Room Charge (General)',
          unitPrice: 200,
          quantity: 4,
          gst: 18,
          hsn: '996311',
        },
        {
          svc: 'svc-9',
          description: 'IV Fluid',
          unitPrice: 100,
          quantity: 3,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      n: 5,
      patientIndex: 16,
      paymentStatus: 'partially_paid',
      status: 'sent',
      lines: [
        {
          svc: 'svc-11',
          description: 'Room Charge (Private)',
          unitPrice: 500,
          quantity: 3,
          gst: 18,
          hsn: '996311',
        },
        {
          svc: 'svc-6',
          description: 'Major Procedure',
          unitPrice: 2000,
          quantity: 1,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      n: 6,
      patientIndex: 20,
      paymentStatus: 'paid',
      status: 'paid',
      lines: [
        {
          svc: 'svc-4',
          description: 'Follow-up Consultation',
          unitPrice: 100,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
        {
          svc: 'svc-8',
          description: 'Injection',
          unitPrice: 30,
          quantity: 1,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
    {
      // The insured patient, so the insurance payment below has a policy behind it.
      n: 7,
      patientIndex: 11,
      paymentStatus: 'paid',
      status: 'paid',
      lines: [
        {
          svc: 'svc-12',
          description: 'Room Charge (ICU)',
          unitPrice: 1000,
          quantity: 2,
          gst: 18,
          hsn: '996311',
        },
        {
          svc: 'svc-2',
          description: 'Specialist Consultation',
          unitPrice: 300,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
      ],
    },
    {
      n: 8,
      patientIndex: 24,
      paymentStatus: 'paid',
      status: 'paid',
      lines: [
        {
          svc: 'svc-1',
          description: 'General Consultation',
          unitPrice: 150,
          quantity: 1,
          gst: 0,
          hsn: '999312',
        },
        {
          svc: 'svc-5',
          description: 'Minor Procedure',
          unitPrice: 500,
          quantity: 1,
          gst: 18,
          hsn: '999316',
        },
      ],
    },
  ];

  const PAYMENTS = [
    { n: 1, invoice: 4, fraction: 0.5, method: 'cash', hours: 1 },
    { n: 2, invoice: 5, fraction: 0.4, method: 'bank_transfer', hours: 2 },
    { n: 3, invoice: 6, fraction: 1, method: 'mobile_money', hours: 3 },
    { n: 4, invoice: 7, fraction: 1, method: 'insurance', hours: 4 },
    { n: 5, invoice: 8, fraction: 1, method: 'cash', hours: 5 },
  ] as const;

  const invoiceTotals = new Map<number, { id: string; total: number }>();

  for (const inv of INVOICES) {
    const invoiceNumber = `MOB-INV-${pad(inv.n, 4)}`;
    const items = inv.lines.map((l) => {
      const lineTotal = money(l.unitPrice * l.quantity);
      const tax = money((lineTotal * l.gst) / 100);
      return {
        type: 'service',
        referenceId: l.svc,
        description: l.description,
        hsnCode: l.hsn,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: 0,
        taxRate: l.gst,
        cgst: money(tax / 2),
        sgst: money(tax / 2),
        tax,
        total: lineTotal,
      };
    });
    const subtotal = money(items.reduce((s, it) => s + it.total, 0));
    const taxAmount = money(items.reduce((s, it) => s + it.tax, 0));
    const totalAmount = money(subtotal + taxAmount);

    const payment = PAYMENTS.find((p) => p.invoice === inv.n);
    const amountPaid = payment ? money(totalAmount * payment.fraction) : 0;
    const isInsurance = payment?.method === 'insurance';

    const data = {
      organizationId,
      patientId: patientIds[inv.patientIndex],
      invoiceNumber,
      invoiceDate: mins(-90 - inv.n * 15),
      dueDate: at(14, 17, 0),
      items: JSON.stringify(items),
      subtotal,
      discountAmount: 0,
      discountPercentage: 0,
      taxAmount,
      totalAmount,
      paymentStatus: inv.paymentStatus,
      amountPaid,
      balanceDue: money(totalAmount - amountPaid),
      insuranceClaimAmount: isInsurance ? money(totalAmount * 0.9) : 0,
      insuranceClaimStatus: isInsurance ? 'approved' : null,
      patientCopayAmount: isInsurance ? money(totalAmount * 0.1) : 0,
      status: inv.status,
      notes: null,
      termsAndConditions:
        'Payable within 14 days. GST charged at applicable rates; consultation services exempt.',
      createdById: billingId,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
    };

    const invoice = await prisma.invoice.upsert({
      where: { invoiceNumber },
      update: data,
      create: { id: `mob-inv-${pad(inv.n)}`, ...data },
    });
    invoiceTotals.set(inv.n, { id: invoice.id, total: totalAmount });
    counts.invoices++;
  }

  let todayRevenue = 0;
  for (const p of PAYMENTS) {
    const receiptNumber = `MOB-RCP-${pad(p.n, 4)}`;
    const target = must(
      invoiceTotals.get(p.invoice),
      `Invoice ${p.invoice} missing`,
    );
    const invoice = must(
      await prisma.invoice.findUnique({ where: { id: target.id } }),
      `Invoice ${target.id} missing`,
    );
    const amount = money(target.total * p.fraction);

    const data = {
      organizationId,
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      // Today, so the dashboard's revenue tile is never zero.
      paymentDate: mins(p.hours * 60),
      amount,
      paymentMethod: p.method,
      paymentReference:
        p.method === 'mobile_money'
          ? `UPI/${pad(413_000_000 + p.n * 7717, 9)}`
          : p.method === 'bank_transfer'
            ? `NEFT/HDFC/${pad(88_120_000 + p.n * 311, 8)}`
            : p.method === 'insurance'
              ? `CLAIM/PMJAY/${pad(70_400 + p.n, 6)}`
              : null,
      cardLastFour: null,
      // UPI is India's mobile money; the provider string is what the receipt prints.
      mobileMoneyProvider: p.method === 'mobile_money' ? 'PhonePe UPI' : null,
      bankName: p.method === 'bank_transfer' ? 'HDFC Bank' : null,
      chequeNumber: null,
      chequeDate: null,
      processedById: billingId,
      isRefund: false,
      refundReason: null,
      originalPaymentId: null,
      notes: p.fraction === 1 ? 'Paid in full' : 'Part payment received',
      createdById: billingId,
    };

    await prisma.payment.upsert({
      where: { receiptNumber },
      update: data,
      create: { id: `mob-pay-${pad(p.n)}`, receiptNumber, ...data },
    });
    todayRevenue += amount;
    counts.payments++;
  }
  console.log(
    `✅ Billing: ${counts.invoices} invoices (3 unpaid, 2 partial, 3 paid), ` +
      `${counts.payments} payments today totalling ${inr(money(todayRevenue))}`,
  );

  // ── 10. Custom roles and their users ───────────────────────────────────────
  //
  // Both are org-scoped and `isSystem: false` — a system role is part of the
  // product, these two are this hospital's own.
  const NURSE_PERMISSIONS = [
    'PATIENT_READ',
    'APPOINTMENT_READ',
    'CONSULTATION_READ',
    'INPATIENT_CREATE',
    'INPATIENT_READ',
    'INPATIENT_UPDATE',
    'PRE_TRIAGE_CREATE',
    'PRE_TRIAGE_READ',
    'PRE_TRIAGE_UPDATE',
    'QUEUE_CREATE',
    'QUEUE_READ',
    'QUEUE_UPDATE',
    'DASHBOARD_READ',
  ];
  const RECEPTIONIST_PERMISSIONS = [
    'PATIENT_CREATE',
    'PATIENT_READ',
    'PATIENT_UPDATE',
    'APPOINTMENT_CREATE',
    'APPOINTMENT_READ',
    'APPOINTMENT_UPDATE',
    'APPOINTMENT_DELETE',
    'QUEUE_CREATE',
    'QUEUE_READ',
    'QUEUE_UPDATE',
    'QUEUE_DELETE',
    'BILLING_READ',
    'DASHBOARD_READ',
  ];

  const CUSTOM_ROLES = [
    {
      name: 'TRIAGE_NURSE',
      description:
        'Nurse who screens and registers walk-ins. NURSE plus patient create/update — ' +
        "without those two a screening can never become a patient, which is the app's " +
        'heaviest workflow.',
      permissions: [...NURSE_PERMISSIONS, 'PATIENT_CREATE', 'PATIENT_UPDATE'],
      user: {
        email: 'triage-nurse@hms.local',
        firstName: 'Anita',
        lastName: 'Kulkarni',
        fullName: 'Nurse Anita Kulkarni',
      },
    },
    {
      name: 'WARD_CLERK',
      description:
        'Front-desk clerk who also manages ward admissions. RECEPTIONIST plus inpatient ' +
        'create/read/update.',
      permissions: [
        ...RECEPTIONIST_PERMISSIONS,
        'INPATIENT_CREATE',
        'INPATIENT_READ',
        'INPATIENT_UPDATE',
      ],
      user: {
        email: 'ward-clerk@hms.local',
        firstName: 'Sunil',
        lastName: 'Prabhu',
        fullName: 'Sunil Prabhu',
      },
    },
  ] as const;

  const allPermissions = await prisma.permission.findMany();
  const demoPassword = await hashPassword('Demo@HMS2024!');

  for (const spec of CUSTOM_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: spec.name },
      update: {
        description: spec.description,
        isSystem: false,
        organizationId,
      },
      create: {
        id: `mob-role-${spec.name.toLowerCase().replace(/_/g, '-')}`,
        name: spec.name,
        description: spec.description,
        isSystem: false,
        organizationId,
      },
    });

    const matched = allPermissions.filter((p) =>
      spec.permissions.includes(p.name),
    );
    if (matched.length !== spec.permissions.length) {
      const found = new Set(matched.map((p) => p.name));
      throw new Error(
        `Permissions missing for ${spec.name}: ` +
          `${spec.permissions.filter((n) => !found.has(n)).join(', ')}. ` +
          'Run `npm run db:seed` first.',
      );
    }

    for (const perm of matched) {
      // Same derivation seed.ts uses: the granular flags follow the permission's
      // own action, so the Next.js-facing columns agree with the NestJS name.
      const flags = {
        canCreate: perm.action === 'create',
        canRead: perm.action === 'read',
        canUpdate: perm.action === 'update',
        canDelete: perm.action === 'delete',
        roleName: spec.name,
      };
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: perm.id },
        },
        update: flags,
        create: { roleId: role.id, permissionId: perm.id, ...flags },
      });
    }
    counts.roles++;

    // Legacy `role` column and the `userRoles` junction are kept in lockstep the
    // way seed.ts does it: both written on create, the column re-asserted on
    // update, and the junction row upserted.
    const user = await prisma.user.upsert({
      where: { email: spec.user.email },
      update: { role: spec.name, isActive: true, organizationId },
      create: {
        id: `mob-user-${spec.name.toLowerCase().replace(/_/g, '-')}`,
        email: spec.user.email,
        password: demoPassword,
        firstName: spec.user.firstName,
        lastName: spec.user.lastName,
        fullName: spec.user.fullName,
        phone: phone(spec.name.length, 500 + counts.users),
        organizationId,
        departmentId:
          spec.name === 'TRIAGE_NURSE' ? 'dept-emergency' : 'dept-inpatient',
        isActive: true,
        defaultCalendar: 'gregorian',
        role: spec.name,
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
    counts.users++;
    console.log(
      `✅ Role ${spec.name}: ${matched.length} permissions → ${spec.user.email}`,
    );
  }

  // ── 11. Department heads ───────────────────────────────────────────────────
  await prisma.department.update({
    where: { id: 'dept-opd' },
    data: { headId: doctorId },
  });
  await prisma.department.update({
    where: { id: 'dept-radiology' },
    data: { headId: radiologistId },
  });
  console.log(
    '✅ Department heads: dept-opd → doctor, dept-radiology → radiologist',
  );

  // ── 12. Machine integration ────────────────────────────────────────────────
  const analyserPatient = must(
    await prisma.patient.findUnique({ where: { mrn: 'MOB-0007' } }),
    'Patient MOB-0007 missing',
  );
  const receivedAt = mins(-25);

  const machineData = {
    organizationId,
    machineName: 'Sysmex XN-550 Haematology Analyser',
    machineType: 'lab_analyzer' as const,
    manufacturer: 'Sysmex Corporation',
    model: 'XN-550',
    serialNumber: 'XN550-IN-004821',
    department: 'laboratory',
    connectionType: 'hl7' as const,
    connectionDetails: JSON.stringify({
      host: '192.168.10.42',
      port: 6661,
      protocolVersion: '2.5',
      encoding: 'UTF-8',
      ackMode: 'AL',
    }),
    // Machine test code → catalog LabTest id. Without this the results queue can
    // parse a message and still have nowhere to put the numbers.
    testMapping: JSON.stringify({
      WBC: 'test-1',
      HGB: 'test-2',
      GLU: 'test-8',
      CREA: 'test-12',
    }),
    isActive: true,
    connectionStatus: 'connected' as const,
    lastConnectedAt: at(0, 7, 45),
    lastResultReceivedAt: receivedAt,
    createdById: labTechId,
  };

  const machine = await prisma.machineIntegration.upsert({
    where: { id: 'mob-machine-01' },
    update: machineData,
    create: { id: 'mob-machine-01', ...machineData },
  });
  counts.integrations++;

  const rawHl7 = [
    `MSH|^~\\&|SYSMEX-XN550|LAB|HMS|HOSP|${hl7Stamp(receivedAt)}||ORU^R01|MOB00001|P|2.5`,
    `PID|1||${analyserPatient.mrn}||${analyserPatient.lastName}^${analyserPatient.firstName}||19480712|F`,
    `OBR|1||MOB-ACC-0007|CBC^Complete Blood Count^L|||${hl7Stamp(mins(-40))}`,
    'OBX|1|NM|HGB^Hemoglobin^L||9.1|g/dL|13.0-17.0|L|||F',
    'OBX|2|NM|WBC^White Blood Cells^L||7.8|x10^9/L|4.0-11.0|N|||F',
  ].join('\r');

  const queueData = {
    organizationId,
    machineIntegrationId: machine.id,
    rawData: rawHl7,
    parsedData: JSON.stringify({
      messageType: 'ORU^R01',
      accession: 'MOB-ACC-0007',
      patientIdentifier: analyserPatient.mrn,
    }),
    patientIdentifier: analyserPatient.mrn,
    matchedPatientId: analyserPatient.id,
    testResults: JSON.stringify([
      { code: 'HGB', testId: 'test-2', value: '9.1', unit: 'g/dL', flag: 'L' },
      {
        code: 'WBC',
        testId: 'test-1',
        value: '7.8',
        unit: 'x10^9/L',
        flag: 'N',
      },
    ]),
    status: 'pending' as const,
    errorMessage: null,
    receivedAt,
    processedAt: null,
  };

  await prisma.machineResultsQueue.upsert({
    where: { id: 'mob-mrq-01' },
    update: queueData,
    create: { id: 'mob-mrq-01', ...queueData },
  });
  counts.integrations++;

  const logData = {
    organizationId,
    machineIntegrationId: machine.id,
    logDate: receivedAt,
    logType: 'result_import' as const,
    message:
      'ORU^R01 received from SYSMEX-XN550; patient matched on MRN, awaiting review.',
    details: JSON.stringify({
      accession: 'MOB-ACC-0007',
      matchedBy: 'mrn',
      observations: 2,
    }),
    resultsImported: 2,
    resultsFailed: 0,
  };

  await prisma.integrationLog.upsert({
    where: { id: 'mob-intlog-01' },
    update: logData,
    create: { id: 'mob-intlog-01', ...logData },
  });
  counts.integrations++;
  console.log(
    '✅ Integrations: 1 HL7 lab analyser, 1 pending results-queue row (patient matched), 1 log entry',
  );

  // ── 13. Organization settings ──────────────────────────────────────────────
  //
  // Merged leaf by leaf through the same helper the settings API uses. Replacing
  // the column would wipe whatever the console or a phone wrote into it — the
  // exact data loss `mergeOrganizationSettings` exists to prevent. The column is
  // a JSON *string*, so it is stringified on the way back in.
  const mergedSettings = mergeOrganizationSettings(org.settings, {
    locale: {
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      dateFormat: 'dd/MM/yyyy',
      use24HourClock: true,
      calendar: 'gregorian',
    },
  });

  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: JSON.stringify(mergedSettings) },
  });
  console.log(
    '✅ Organization settings: locale merged to INR / ₹ / Asia/Kolkata / dd/MM/yyyy / 24h',
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  const [occupiedBeds, availableBeds, liveAdmissions, criticalUnverified] =
    await Promise.all([
      prisma.bed.count({ where: { organizationId, status: 'occupied' } }),
      prisma.bed.count({ where: { organizationId, status: 'available' } }),
      prisma.admission.count({ where: { organizationId, status: 'admitted' } }),
      prisma.labResult.count({ where: { isCritical: true, verifiedAt: null } }),
    ]);

  // The ward invariant, asserted rather than assumed: one live admission per
  // occupied bed, agreeing on the patient, and nobody admitted to two beds. A
  // silent violation here is "the same patient in two beds" on the ward screen,
  // and it is far cheaper to fail the seed than to debug the screen.
  const [occupiedRows, liveRows] = await Promise.all([
    prisma.bed.findMany({
      where: { organizationId, status: 'occupied' },
      select: { id: true, currentPatientId: true },
    }),
    prisma.admission.findMany({
      where: { organizationId, status: 'admitted' },
      select: { bedId: true, patientId: true },
    }),
  ]);
  const liveByBed = new Map<string, string[]>();
  for (const a of liveRows) {
    if (!a.bedId) continue;
    liveByBed.set(a.bedId, [...(liveByBed.get(a.bedId) ?? []), a.patientId]);
  }
  const problems: string[] = [];
  for (const b of occupiedRows) {
    const admitted = liveByBed.get(b.id) ?? [];
    if (admitted.length !== 1) {
      problems.push(`bed ${b.id} has ${admitted.length} live admissions`);
    } else if (admitted[0] !== b.currentPatientId) {
      problems.push(
        `bed ${b.id} currentPatientId disagrees with its admission`,
      );
    }
  }
  const admittedPatients = liveRows.map((a) => a.patientId);
  if (new Set(admittedPatients).size !== admittedPatients.length) {
    problems.push('a patient holds more than one live admission');
  }
  if (occupiedBeds !== liveAdmissions) {
    problems.push(
      `${occupiedBeds} occupied beds but ${liveAdmissions} live admissions`,
    );
  }
  if (problems.length > 0) {
    throw new Error(`Ward invariant broken: ${problems.join('; ')}.`);
  }

  console.log(
    `\n🎉 Mobile demo seed complete (anchor ${SEED_ANCHOR.toISOString()})\n` +
      Object.entries(counts)
        .map(([k, v]) => `   ${k.padEnd(18)} ${v}`)
        .join('\n') +
      `\n   ${'—'.repeat(28)}` +
      `\n   ${'beds occupied'.padEnd(18)} ${occupiedBeds} / ${occupiedBeds + availableBeds + RESERVED_BEDS.length + MAINTENANCE_BEDS.length}` +
      `\n   ${'critical alerts'.padEnd(18)} ${criticalUnverified}` +
      `\n   ${"today's revenue".padEnd(18)} ${inr(money(todayRevenue))}` +
      '\n\n   Logins: triage-nurse@hms.local / ward-clerk@hms.local — Demo@HMS2024!' +
      // This seed writes through Prisma, so the API's own cache invalidation
      // never runs. The organisation block is cached for five minutes, and a
      // demo that opens on the shape the site had *before* the seed is a
      // demo nobody trusts.
      '\n   Then: docker exec hms_v2_redis_local redis-cli FLUSHDB' +
      '\n         (this seed writes straight to Postgres, so the API still' +
      ' holds the old organisation for five minutes)',
  );
}

main()
  .catch((e) => {
    console.error('❌ Mobile demo seed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
