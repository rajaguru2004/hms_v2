import {
  ApiClient,
  createRng,
  daysFromAnchor,
  isoDate,
  isoTime,
  SEED_ANCHOR,
} from './lib/api-client';

/**
 * Clinical demo data seed — API-driven.
 *
 * Run order:  npm run db:seed  →  npm run db:seed:catalog  →  npm run db:seed:demo
 * The API must be running (npm run start:dev).
 *
 * Everything is generated from a fixed anchor date and a seeded PRNG, so repeated
 * runs against a fresh database produce byte-identical data. That determinism is
 * what makes visual regression and Playwright fixtures viable.
 *
 * Not idempotent by design: the API mints new MRNs/queue numbers/invoice numbers on
 * every POST. Re-running appends. Use `npm run db:reset:demo` for a clean rebuild,
 * or pass --force to append deliberately.
 */

const rng = createRng();

const FIRST_NAMES_M = [
  'Abebe',
  'Bekele',
  'Dawit',
  'Getachew',
  'Haile',
  'Kebede',
  'Mulugeta',
  'Solomon',
  'Tesfaye',
  'Yohannes',
  'Girma',
  'Tadesse',
] as const;
const FIRST_NAMES_F = [
  'Almaz',
  'Birtukan',
  'Genet',
  'Hirut',
  'Kidist',
  'Meseret',
  'Rahel',
  'Selamawit',
  'Tigist',
  'Yeshi',
  'Aster',
  'Bethlehem',
] as const;
const LAST_NAMES = [
  'Abera',
  'Assefa',
  'Bekele',
  'Desta',
  'Fikru',
  'Gebre',
  'Hailu',
  'Lemma',
  'Mekonnen',
  'Negash',
  'Tadesse',
  'Wolde',
] as const;

const REGIONS = [
  {
    region: 'Addis Ababa',
    zone: 'Bole',
    woredas: ['Woreda 03', 'Woreda 07', 'Woreda 11'],
  },
  {
    region: 'Oromia',
    zone: 'East Shewa',
    woredas: ['Adama', 'Bishoftu', 'Mojo'],
  },
  {
    region: 'Amhara',
    zone: 'North Gondar',
    woredas: ['Gondar Zuria', 'Dembia'],
  },
  { region: 'SNNPR', zone: 'Sidama', woredas: ['Hawassa Zuria', 'Shebedino'] },
  { region: 'Tigray', zone: 'Mekelle', woredas: ['Enderta', 'Kilte Awlaelo'] },
] as const;

const COMPLAINTS = [
  'Fever and headache for 3 days',
  'Persistent cough with sputum',
  'Abdominal pain, lower right quadrant',
  'Shortness of breath on exertion',
  'Generalised body weakness and fatigue',
  'Painful urination',
  'Joint pain in both knees',
  'Diarrhoea and vomiting since yesterday',
  'Chest tightness after climbing stairs',
  'Recurrent headaches with blurred vision',
] as const;

const DIAGNOSES = [
  'Uncomplicated malaria',
  'Community-acquired pneumonia',
  'Acute gastroenteritis',
  'Hypertension, stage 2',
  'Type 2 diabetes mellitus',
  'Urinary tract infection',
  'Iron deficiency anaemia',
  'Peptic ulcer disease',
  'Acute bronchitis',
  'Migraine without aura',
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
const ALLERGY_POOL = [
  'Penicillin',
  'Sulfa drugs',
  'Peanuts',
  'Aspirin',
  'Latex',
] as const;
const CHRONIC_POOL = [
  'Hypertension',
  'Diabetes mellitus',
  'Asthma',
  'Epilepsy',
] as const;

/** Drug ids match the fixed ids assigned in prisma/seed-catalog.ts. */
const PRESCRIBABLE = [
  {
    drugId: 'drug-1',
    drugName: 'Amoxicillin 500mg',
    genericName: 'Amoxicillin',
    dosage: '500mg',
    frequency: 'Three times daily',
    duration: '7 days',
    quantity: 21,
    instructions: 'Take after meals',
  },
  {
    drugId: 'drug-2',
    drugName: 'Paracetamol 500mg',
    genericName: 'Paracetamol',
    dosage: '500mg',
    frequency: 'As needed, max 4x daily',
    duration: '5 days',
    quantity: 20,
    instructions: 'Do not exceed 4g per day',
  },
  {
    drugId: 'drug-6',
    drugName: 'Artemether/Lumefantrine 20/120mg',
    genericName: 'Artemether/Lumefantrine',
    dosage: '20/120mg',
    frequency: 'Twice daily',
    duration: '3 days',
    quantity: 24,
    instructions: 'Take with fatty food',
  },
  {
    drugId: 'drug-10',
    drugName: 'Metformin 500mg',
    genericName: 'Metformin',
    dosage: '500mg',
    frequency: 'Twice daily',
    duration: '30 days',
    quantity: 60,
    instructions: 'Take with meals',
  },
  {
    drugId: 'drug-9',
    drugName: 'Omeprazole 20mg',
    genericName: 'Omeprazole',
    dosage: '20mg',
    frequency: 'Once daily',
    duration: '14 days',
    quantity: 14,
    instructions: 'Take before breakfast',
  },
] as const;

interface Created {
  id: string;
  [k: string]: unknown;
}

const PATIENT_COUNT = 60;

/**
 * Records payments against invoices that don't have one yet.
 *
 * Split out so payment data can be repaired without a destructive reset — the
 * invoices themselves are fine, and `prisma migrate reset` would throw away
 * every other entity to fix one step.
 */
async function topUpPayments(api: ApiClient): Promise<void> {
  const res = await api.get<{ data?: Created[] } | Created[]>(
    '/billing/invoices?page=1&limit=200',
  );
  const invoices = Array.isArray(res) ? res : (res?.data ?? []);

  let added = 0;
  for (const [i, inv] of invoices.entries()) {
    const paid = Number((inv as { amountPaid?: number }).amountPaid ?? 0);
    const total = Number((inv as { totalAmount?: number }).totalAmount ?? 0);
    if (paid > 0 || total <= 0) continue;

    // Same 1/3 full, 1/3 partial, 1/3 outstanding distribution as the main seed.
    const mode = i % 3;
    if (mode === 2) continue;

    const method = rng.pick(['cash', 'mobile_money', 'bank_transfer']);
    const ok = await api.tryPost<Created>('/billing/payments', {
      invoiceId: inv.id,
      amount: mode === 0 ? total : Math.round(total / 2),
      paymentMethod: method,
      ...(method === 'mobile_money'
        ? { mobileMoneyProvider: rng.pick(['CBE Birr', 'M-Birr']) }
        : {}),
      notes: mode === 0 ? 'Paid in full' : 'Partial payment',
    });
    if (ok) added++;
  }
  console.log(
    `✅ Payments recorded: ${added} (of ${invoices.length} invoices)`,
  );
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const paymentsOnly = process.argv.includes('--payments-only');
  const api = new ApiClient();

  console.log('🌱 Demo seed — waiting for API...');
  await api.waitForHealth();
  await api.login();
  console.log('✅ Authenticated');

  if (paymentsOnly) {
    await topUpPayments(api);
    return;
  }

  // Guard against accidental duplication.
  const existing = await api.get<{ meta?: { total?: number } } | unknown[]>(
    '/patients?page=1&limit=1',
  );
  const existingTotal = Array.isArray(existing)
    ? existing.length
    : (existing?.meta?.total ?? 0);

  if (existingTotal >= PATIENT_COUNT && !force) {
    console.log(
      `\n⏭  ${existingTotal} patients already present — skipping.\n` +
        '   Use `npm run db:reset:demo` for a clean rebuild, or --force to append.',
    );
    return;
  }

  // ── Reference data ─────────────────────────────────────────────────────────
  const staff = await api
    .get<Created[]>('/users?limit=100')
    .catch(() => [] as Created[]);
  const list = Array.isArray(staff)
    ? staff
    : ((staff as { data?: Created[] })?.data ?? []);

  const findByEmail = (email: string): string | undefined =>
    list.find((u) => (u as { email?: string }).email === email)?.id;

  const doctorId = findByEmail('doctor@hms.local');
  const nurseId = findByEmail('nurse@hms.local');

  if (!doctorId) {
    throw new Error(
      'Could not resolve doctor@hms.local. Run `npm run db:seed` first.',
    );
  }
  console.log(`✅ Resolved doctor${nurseId ? ' and nurse' : ''}`);

  const counts = {
    patients: 0,
    appointments: 0,
    queue: 0,
    preTriage: 0,
    consultations: 0,
    labOrders: 0,
    radOrders: 0,
    admissions: 0,
    invoices: 0,
    payments: 0,
  };

  // ── Patients ───────────────────────────────────────────────────────────────
  const patients: Created[] = [];
  for (let i = 0; i < PATIENT_COUNT; i++) {
    const isMale = i % 2 === 0;
    // Name and gender must agree — a "Yeshi" recorded as male reads as broken data
    // to any Ethiopian user and undermines the whole demo.
    const firstName = isMale
      ? FIRST_NAMES_M[i % FIRST_NAMES_M.length]
      : FIRST_NAMES_F[i % FIRST_NAMES_F.length];
    const lastName = LAST_NAMES[(i * 5) % LAST_NAMES.length];
    const loc = REGIONS[i % REGIONS.length];
    const age = rng.int(1, 84);

    // Spread birthdays across the whole year. Deriving DOB purely by subtracting
    // `age * 365` days from the anchor put every patient on the same calendar day.
    const birthYear = SEED_ANCHOR.getFullYear() - age;
    const birthMonth = rng.int(1, 12);
    const birthDay = rng.int(1, 28); // 28 keeps every month valid
    const dateOfBirth = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;

    const patient = await api.tryPost<Created>('/patients', {
      firstName,
      lastName,
      middleName: LAST_NAMES[(i * 3) % LAST_NAMES.length],
      dateOfBirth,
      gender: isMale ? 'male' : 'female',
      bloodGroup: rng.pick(BLOOD_GROUPS),
      phonePrimary: `+2519${String(11000000 + i * 137).slice(0, 8)}`,
      region: loc.region,
      zone: loc.zone,
      woreda: rng.pick(loc.woredas),
      kebele: `Kebele ${rng.int(1, 20)}`,
      houseNumber: `${rng.int(100, 999)}`,
      emergencyContactName: `${rng.pick(FIRST_NAMES_F)} ${lastName}`,
      emergencyContactPhone: `+2519${String(22000000 + i * 211).slice(0, 8)}`,
      emergencyContactRelationship: rng.pick([
        'Spouse',
        'Parent',
        'Sibling',
        'Child',
      ]),
      // ~25% carry allergies / chronic conditions so clinical banners have something to show.
      allergies: rng.next() < 0.25 ? [rng.pick(ALLERGY_POOL)] : [],
      chronicConditions: rng.next() < 0.25 ? [rng.pick(CHRONIC_POOL)] : [],
      hasInsurance: rng.next() < 0.3,
    });

    if (patient) {
      patients.push(patient);
      counts.patients++;
    }
  }
  console.log(`✅ Patients: ${counts.patients}`);

  if (patients.length === 0) throw new Error('No patients created — aborting.');

  const patientAt = (i: number): Created => patients[i % patients.length];

  // ── Appointments — spread across a fixed week, centred on the anchor ────────
  for (let i = 0; i < 40; i++) {
    const day = (i % 7) - 2; // -2..+4 → past, today and upcoming
    const slot = daysFromAnchor(day, 8 + (i % 8), (i % 4) * 15);
    const created = await api.tryPost<Created>('/appointments', {
      patientId: patientAt(i).id,
      doctorId,
      appointmentDate: isoDate(slot),
      appointmentTime: isoTime(slot),
      durationMinutes: 30,
      appointmentType: rng.pick(['consultation', 'follow_up', 'checkup']),
      chiefComplaint: rng.pick(COMPLAINTS),
    });
    if (created) counts.appointments++;
  }
  console.log(`✅ Appointments: ${counts.appointments}`);

  // ── Queue — mixed service areas and priorities ─────────────────────────────
  const serviceAreas = ['opd', 'emergency', 'laboratory', 'pharmacy'] as const;
  for (let i = 0; i < 25; i++) {
    const created = await api.tryPost<Created>('/queue', {
      patientId: patientAt(i + 3).id,
      serviceArea: serviceAreas[i % serviceAreas.length],
      serviceType: 'consultation',
      // Mostly normal, with a genuine minority of urgent/emergency cases.
      priority: i % 9 === 0 ? 'emergency' : i % 4 === 0 ? 'urgent' : 'normal',
      assignedRoom: `Room ${rng.int(1, 12)}`,
    });
    if (created) counts.queue++;
  }
  console.log(`✅ Queue entries: ${counts.queue}`);

  // ── Pre-triage screenings with ETAT-relevant vitals ─────────────────────────
  for (let i = 0; i < 15; i++) {
    const p = patientAt(i + 7);
    const severe = i % 5 === 0; // ~20% land in the red zone
    const created = await api.tryPost<Created>('/pre-triage', {
      firstName: (p as { firstName?: string }).firstName,
      lastName: (p as { lastName?: string }).lastName,
      age: rng.int(2, 80),
      gender: i % 2 === 0 ? 'male' : 'female',
      phone: `+2519${String(33000000 + i * 173).slice(0, 8)}`,
      chiefComplaint: rng.pick(COMPLAINTS),
      temperature: severe ? 39.5 + rng.next() : 36.5 + rng.next(),
      bloodPressureSystolic: severe ? rng.int(150, 180) : rng.int(105, 130),
      bloodPressureDiastolic: severe ? rng.int(95, 110) : rng.int(65, 85),
      pulseRate: severe ? rng.int(115, 140) : rng.int(62, 92),
      routedTo: severe ? 'emergency' : 'opd',
    });
    if (created) counts.preTriage++;
  }
  console.log(`✅ Pre-triage screenings: ${counts.preTriage}`);

  // ── Consultations ──────────────────────────────────────────────────────────
  const consultations: Created[] = [];
  for (let i = 0; i < 20; i++) {
    const created = await api.tryPost<Created>('/consultations', {
      patientId: patientAt(i).id,
      doctorId,
      visitType: rng.pick(['opd', 'follow_up']),
      temperature: 36.4 + rng.next() * 1.6,
      bloodPressureSystolic: rng.int(105, 145),
      bloodPressureDiastolic: rng.int(65, 95),
      pulseRate: rng.int(60, 100),
      respiratoryRate: rng.int(14, 22),
      weight: rng.int(45, 95),
      height: rng.int(150, 185),
      oxygenSaturation: rng.int(94, 100),
      chiefComplaint: rng.pick(COMPLAINTS),
      historyOfPresentIllness:
        'Symptoms began gradually; no prior similar episodes reported.',
      physicalExamination:
        'Alert and oriented. Chest clear. Abdomen soft, non-tender.',
      diagnosis: rng.pick(DIAGNOSES),
      treatmentPlan:
        'Supportive care, prescribed medication, review in one week.',
      followUpDate: isoDate(daysFromAnchor(7)),
      // Prescriptions feed the pharmacy queue — without them the "pending
      // prescriptions" tile and the dispense workflow have nothing to show.
      prescriptionItems: [PRESCRIBABLE[i % PRESCRIBABLE.length]],
    });
    if (created) {
      consultations.push(created);
      counts.consultations++;
    }
  }
  console.log(`✅ Consultations: ${counts.consultations}`);

  // ── Lab orders — mixed priority, a few explicitly urgent ────────────────────
  const LAB_TESTS: ReadonlyArray<[string, string]> = [
    ['test-1', 'Complete Blood Count (CBC)'],
    ['test-2', 'Hemoglobin'],
    ['test-4', 'Malaria RDT'],
    ['test-7', 'Urinalysis'],
    ['test-8', 'Random Blood Sugar'],
    ['test-12', 'Renal Function Test'],
  ];
  for (let i = 0; i < 30; i++) {
    const [testId, testName] = LAB_TESTS[i % LAB_TESTS.length];
    const urgent = i % 10 === 0; // 3 of 30 are STAT
    const created = await api.tryPost<Created>('/laboratory/orders', {
      patientId: patientAt(i + 1).id,
      consultationId: consultations[i % Math.max(consultations.length, 1)]?.id,
      tests: [{ testId, testName, urgency: urgent ? 'stat' : 'routine' }],
      clinicalIndication: rng.pick(COMPLAINTS),
      provisionalDiagnosis: rng.pick(DIAGNOSES),
      priority: urgent ? 'stat' : 'routine',
    });
    if (created) counts.labOrders++;
  }
  console.log(`✅ Lab orders: ${counts.labOrders}`);

  // ── Radiology orders ───────────────────────────────────────────────────────
  for (let i = 0; i < 20; i++) {
    const created = await api.tryPost<Created>('/radiology/orders', {
      patientId: patientAt(i + 5).id,
      examId: `exam-${(i % 10) + 1}`,
      clinicalIndication: rng.pick(COMPLAINTS),
      provisionalDiagnosis: rng.pick(DIAGNOSES),
      urgency: i % 8 === 0 ? 'stat' : 'routine',
    });
    if (created) counts.radOrders++;
  }
  console.log(`✅ Radiology orders: ${counts.radOrders}`);

  // ── Admissions — spread across wards so the bed map is partly occupied ──────
  const BEDS = [
    ...Array.from({ length: 8 }, (_, i) => `bed-ward-general-${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `bed-ward-icu-${i + 1}`),
    ...Array.from({ length: 2 }, (_, i) => `bed-ward-private-${i + 1}`),
    ...Array.from({ length: 2 }, (_, i) => `bed-ward-maternity-${i + 1}`),
  ];
  for (const [i, bedId] of BEDS.entries()) {
    const created = await api.tryPost<Created>('/inpatient/admissions', {
      patientId: patientAt(i + 11).id,
      bedId,
      admissionType: i % 4 === 0 ? 'emergency' : 'elective',
      admissionReason: rng.pick(DIAGNOSES),
      admittingDoctorId: doctorId,
      attendingDoctorId: doctorId,
    });
    if (created) counts.admissions++;
  }
  console.log(`✅ Admissions: ${counts.admissions}`);

  // ── Invoices and payments — full / partial / unpaid mix ─────────────────────
  const SERVICES: ReadonlyArray<[string, string, number]> = [
    ['svc-1', 'General Consultation', 150],
    ['svc-2', 'Specialist Consultation', 300],
    ['svc-3', 'Emergency Consultation', 200],
    ['svc-7', 'Dressing', 50],
    ['svc-8', 'Injection', 30],
  ];
  for (let i = 0; i < 30; i++) {
    const [refId, description, unitPrice] = SERVICES[i % SERVICES.length];
    const quantity = rng.int(1, 3);
    const total = unitPrice * quantity;

    const invoice = await api.tryPost<Created>('/billing/invoices', {
      patientId: patientAt(i + 2).id,
      items: [
        {
          type: 'service',
          referenceId: refId,
          description,
          quantity,
          unitPrice,
          total,
        },
      ],
      dueDate: isoDate(daysFromAnchor(14)),
    });
    if (!invoice) continue;
    counts.invoices++;

    // 1/3 paid in full, 1/3 partially paid, 1/3 left outstanding.
    const mode = i % 3;
    if (mode === 2) continue;
    const amount = mode === 0 ? total : Math.round(total / 2);

    const method = rng.pick(['cash', 'mobile_money', 'bank_transfer']);
    const payment = await api.tryPost<Created>('/billing/payments', {
      invoiceId: invoice.id,
      amount,
      paymentMethod: method,
      // Ethiopian mobile-money providers — the frontend already offers these.
      ...(method === 'mobile_money'
        ? { mobileMoneyProvider: rng.pick(['CBE Birr', 'M-Birr']) }
        : {}),
      notes: mode === 0 ? 'Paid in full' : 'Partial payment',
    });
    if (payment) counts.payments++;
  }
  console.log(
    `✅ Invoices: ${counts.invoices} (${counts.payments} with payments)`,
  );

  console.log(
    `\n🎉 Demo seed complete (anchor ${SEED_ANCHOR.toISOString()})\n` +
      Object.entries(counts)
        .map(([k, v]) => `   ${k.padEnd(14)} ${v}`)
        .join('\n'),
  );
}

main().catch((e: unknown) => {
  console.error('❌ Demo seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
