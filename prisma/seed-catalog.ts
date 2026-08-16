import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { assertLocalDatabase } from './load-env';

assertLocalDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

/**
 * Catalog / reference-data seed.
 *
 * Separate from `seed.ts` (which is the production identity + RBAC bootstrap and must
 * stay shippable). This file seeds the clinical reference data every screen reads from:
 * departments, wards, beds, and the lab / radiology / billing / pharmacy catalogs.
 *
 * Idempotent — every write is an upsert on a FIXED string id. Those ids are the
 * determinism contract that visual regression and Playwright fixtures depend on;
 * never switch them to cuid().
 *
 *   npm run db:seed:catalog
 */

const DEPARTMENTS = [
  {
    id: 'dept-opd',
    name: 'Outpatient Department',
    code: 'OPD',
    description: 'General outpatient consultations',
  },
  {
    id: 'dept-emergency',
    name: 'Emergency Department',
    code: 'ED',
    description: 'Emergency and trauma care',
  },
  {
    id: 'dept-pharmacy',
    name: 'Pharmacy',
    code: 'PHARM',
    description: 'Medication dispensing and inventory',
  },
  {
    id: 'dept-lab',
    name: 'Laboratory',
    code: 'LAB',
    description: 'Clinical laboratory services',
  },
  {
    id: 'dept-radiology',
    name: 'Radiology',
    code: 'RAD',
    description: 'Diagnostic imaging services',
  },
  {
    id: 'dept-inpatient',
    name: 'Inpatient',
    code: 'IP',
    description: 'Inpatient ward management',
  },
] as const;

const WARDS = [
  {
    id: 'ward-general',
    name: 'General Ward',
    code: 'GW',
    type: 'general',
    capacity: 20,
  },
  {
    id: 'ward-private',
    name: 'Private Ward',
    code: 'PW',
    type: 'private',
    capacity: 10,
  },
  { id: 'ward-icu', name: 'ICU', code: 'ICU', type: 'icu', capacity: 5 },
  {
    id: 'ward-maternity',
    name: 'Maternity Ward',
    code: 'MW',
    type: 'maternity',
    capacity: 15,
  },
  {
    id: 'ward-pediatric',
    name: 'Pediatric Ward',
    code: 'PED',
    type: 'pediatric',
    capacity: 10,
  },
] as const;

/**
 * `referenceRanges` is stored as a JSON string (schema declares it String?).
 * Populating it is what makes an "abnormal"/"critical" result meaningful rather than
 * decorative — the laboratory intelligence surfaces read from it.
 */
const LAB_TESTS = [
  {
    code: 'CBC',
    name: 'Complete Blood Count (CBC)',
    category: 'Hematology',
    price: 200,
    specimen: 'Blood',
    tat: 2,
    unit: 'x10^9/L',
    resultType: 'numeric',
    ranges: { male: { min: 4.0, max: 11.0 }, female: { min: 4.0, max: 11.0 } },
  },
  {
    code: 'HGB',
    name: 'Hemoglobin',
    category: 'Hematology',
    price: 50,
    specimen: 'Blood',
    tat: 1,
    unit: 'g/dL',
    resultType: 'numeric',
    ranges: {
      male: { min: 13.0, max: 17.0 },
      female: { min: 12.0, max: 15.0 },
      critical: { low: 7.0, high: 20.0 },
    },
  },
  {
    code: 'BG',
    name: 'Blood Grouping',
    category: 'Hematology',
    price: 30,
    specimen: 'Blood',
    tat: 1,
    resultType: 'text',
  },
  {
    code: 'MRDT',
    name: 'Malaria RDT',
    category: 'Parasitology',
    price: 50,
    specimen: 'Blood',
    tat: 1,
    resultType: 'positive_negative',
  },
  {
    code: 'MMIC',
    name: 'Malaria Microscopy',
    category: 'Parasitology',
    price: 80,
    specimen: 'Blood',
    tat: 1,
    resultType: 'positive_negative',
  },
  {
    code: 'STOOL',
    name: 'Stool Examination',
    category: 'Parasitology',
    price: 60,
    specimen: 'Stool',
    tat: 1,
    resultType: 'text',
  },
  {
    code: 'URIN',
    name: 'Urinalysis',
    category: 'Chemistry',
    price: 60,
    specimen: 'Urine',
    tat: 1,
    resultType: 'text',
  },
  {
    code: 'RBS',
    name: 'Random Blood Sugar',
    category: 'Chemistry',
    price: 40,
    specimen: 'Blood',
    tat: 1,
    unit: 'mg/dL',
    resultType: 'numeric',
    ranges: {
      male: { min: 70, max: 140 },
      female: { min: 70, max: 140 },
      critical: { low: 50, high: 400 },
    },
  },
  {
    code: 'FBS',
    name: 'Fasting Blood Sugar',
    category: 'Chemistry',
    price: 40,
    specimen: 'Blood',
    tat: 1,
    unit: 'mg/dL',
    resultType: 'numeric',
    ranges: {
      male: { min: 70, max: 100 },
      female: { min: 70, max: 100 },
      critical: { low: 50, high: 350 },
    },
  },
  {
    code: 'LIPID',
    name: 'Lipid Profile',
    category: 'Chemistry',
    price: 300,
    specimen: 'Blood',
    tat: 2,
    unit: 'mg/dL',
    resultType: 'numeric',
    ranges: { male: { min: 0, max: 200 }, female: { min: 0, max: 200 } },
  },
  {
    code: 'LFT',
    name: 'Liver Function Test',
    category: 'Chemistry',
    price: 250,
    specimen: 'Blood',
    tat: 2,
    unit: 'U/L',
    resultType: 'numeric',
    ranges: { male: { min: 0, max: 40 }, female: { min: 0, max: 35 } },
  },
  {
    code: 'RFT',
    name: 'Renal Function Test',
    category: 'Chemistry',
    price: 200,
    specimen: 'Blood',
    tat: 2,
    unit: 'mg/dL',
    resultType: 'numeric',
    ranges: {
      male: { min: 0.7, max: 1.3 },
      female: { min: 0.6, max: 1.1 },
      critical: { low: 0, high: 5.0 },
    },
  },
  {
    code: 'HIVR',
    name: 'HIV Rapid Test',
    category: 'Serology',
    price: 50,
    specimen: 'Blood',
    tat: 1,
    resultType: 'positive_negative',
  },
  {
    code: 'HBsAg',
    name: 'Hepatitis B Surface Antigen',
    category: 'Serology',
    price: 100,
    specimen: 'Blood',
    tat: 1,
    resultType: 'positive_negative',
  },
  {
    code: 'WIDAL',
    name: 'Widal Test',
    category: 'Serology',
    price: 80,
    specimen: 'Blood',
    tat: 1,
    resultType: 'text',
  },
] as const;

const RADIOLOGY_EXAMS = [
  {
    code: 'CXR',
    name: 'Chest X-ray',
    category: 'X-ray',
    modality: 'DR',
    bodyPart: 'Chest',
    price: 200,
    duration: 15,
  },
  {
    code: 'AXR',
    name: 'Abdominal X-ray',
    category: 'X-ray',
    modality: 'DR',
    bodyPart: 'Abdomen',
    price: 250,
    duration: 15,
  },
  {
    code: 'SKX',
    name: 'Skull X-ray',
    category: 'X-ray',
    modality: 'DR',
    bodyPart: 'Head',
    price: 200,
    duration: 15,
  },
  {
    code: 'EXR',
    name: 'Extremity X-ray',
    category: 'X-ray',
    modality: 'DR',
    bodyPart: 'Extremity',
    price: 150,
    duration: 10,
  },
  {
    code: 'USABD',
    name: 'Abdominal Ultrasound',
    category: 'Ultrasound',
    modality: 'US',
    bodyPart: 'Abdomen',
    price: 500,
    duration: 30,
  },
  {
    code: 'USOB',
    name: 'Obstetric Ultrasound',
    category: 'Ultrasound',
    modality: 'US',
    bodyPart: 'Pelvis',
    price: 600,
    duration: 30,
  },
  {
    code: 'USTH',
    name: 'Thyroid Ultrasound',
    category: 'Ultrasound',
    modality: 'US',
    bodyPart: 'Neck',
    price: 400,
    duration: 20,
  },
  {
    code: 'CTH',
    name: 'CT Head',
    category: 'CT',
    modality: 'CT',
    bodyPart: 'Head',
    price: 3000,
    duration: 30,
  },
  {
    code: 'CTA',
    name: 'CT Abdomen',
    category: 'CT',
    modality: 'CT',
    bodyPart: 'Abdomen',
    price: 4000,
    duration: 30,
    contrast: true,
  },
  {
    code: 'CTC',
    name: 'CT Chest',
    category: 'CT',
    modality: 'CT',
    bodyPart: 'Chest',
    price: 3500,
    duration: 30,
    contrast: true,
  },
] as const;

const BILLING_SERVICES = [
  {
    code: 'GC',
    name: 'General Consultation',
    category: 'Consultation',
    price: 150,
    department: 'dept-opd',
  },
  {
    code: 'SC',
    name: 'Specialist Consultation',
    category: 'Consultation',
    price: 300,
    department: 'dept-opd',
  },
  {
    code: 'EC',
    name: 'Emergency Consultation',
    category: 'Consultation',
    price: 200,
    department: 'dept-emergency',
  },
  {
    code: 'FC',
    name: 'Follow-up Consultation',
    category: 'Consultation',
    price: 100,
    department: 'dept-opd',
  },
  { code: 'MP', name: 'Minor Procedure', category: 'Procedures', price: 500 },
  { code: 'MPR', name: 'Major Procedure', category: 'Procedures', price: 2000 },
  { code: 'DRS', name: 'Dressing', category: 'Procedures', price: 50 },
  { code: 'INJ', name: 'Injection', category: 'Procedures', price: 30 },
  { code: 'IVF', name: 'IV Fluid', category: 'Procedures', price: 100 },
  {
    code: 'RCG',
    name: 'Room Charge (General)',
    category: 'Room Charges',
    price: 200,
  },
  {
    code: 'RCP',
    name: 'Room Charge (Private)',
    category: 'Room Charges',
    price: 500,
  },
  {
    code: 'RCI',
    name: 'Room Charge (ICU)',
    category: 'Room Charges',
    price: 1000,
  },
] as const;

/**
 * Stock levels are deliberately varied: the legacy seed set every drug to 0, which
 * renders the pharmacy screens uniformly empty. Here some items sit below `reorderLevel`
 * so low-stock and out-of-stock states are actually exercised in the UI.
 */
const DRUGS = [
  {
    code: 'AMOX500',
    name: 'Amoxicillin 500mg',
    generic: 'Amoxicillin',
    category: 'Antibiotics',
    form: 'Capsule',
    strength: '500mg',
    cost: 18,
    price: 25,
    stock: 1240,
    reorder: 200,
    rx: true,
  },
  {
    code: 'PARA500',
    name: 'Paracetamol 500mg',
    generic: 'Paracetamol',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '500mg',
    cost: 3,
    price: 5,
    stock: 4820,
    reorder: 500,
  },
  {
    code: 'IBU400',
    name: 'Ibuprofen 400mg',
    generic: 'Ibuprofen',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '400mg',
    cost: 9,
    price: 15,
    stock: 2130,
    reorder: 300,
  },
  {
    code: 'CIPRO500',
    name: 'Ciprofloxacin 500mg',
    generic: 'Ciprofloxacin',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '500mg',
    cost: 24,
    price: 35,
    stock: 145,
    reorder: 200,
    rx: true,
  },
  {
    code: 'METRO500',
    name: 'Metronidazole 500mg',
    generic: 'Metronidazole',
    category: 'Antibiotics',
    form: 'Tablet',
    strength: '500mg',
    cost: 13,
    price: 20,
    stock: 890,
    reorder: 200,
    rx: true,
  },
  {
    code: 'ALU2012',
    name: 'Artemether/Lumefantrine 20/120mg',
    generic: 'Artemether/Lumefantrine',
    category: 'Antimalarials',
    form: 'Tablet',
    strength: '20/120mg',
    cost: 110,
    price: 150,
    stock: 640,
    reorder: 150,
    rx: true,
  },
  {
    code: 'ORS',
    name: 'Oral Rehydration Salts',
    generic: 'ORS',
    category: 'Rehydration',
    form: 'Sachet',
    cost: 9,
    price: 15,
    stock: 1500,
    reorder: 250,
  },
  {
    code: 'MVIT',
    name: 'Multivitamins',
    generic: 'Multivitamin',
    category: 'Vitamins',
    form: 'Tablet',
    cost: 19,
    price: 30,
    stock: 2400,
    reorder: 300,
  },
  {
    code: 'OME20',
    name: 'Omeprazole 20mg',
    generic: 'Omeprazole',
    category: 'Gastrointestinal',
    form: 'Capsule',
    strength: '20mg',
    cost: 30,
    price: 45,
    stock: 76,
    reorder: 150,
    rx: true,
  },
  {
    code: 'MET500',
    name: 'Metformin 500mg',
    generic: 'Metformin',
    category: 'Antidiabetics',
    form: 'Tablet',
    strength: '500mg',
    cost: 13,
    price: 20,
    stock: 1120,
    reorder: 200,
    rx: true,
  },
  {
    code: 'CEFT1G',
    name: 'Ceftriaxone 1g',
    generic: 'Ceftriaxone',
    category: 'Antibiotics',
    form: 'Injection',
    strength: '1g',
    cost: 62,
    price: 85,
    stock: 0,
    reorder: 100,
    rx: true,
  },
  {
    code: 'SALINH',
    name: 'Salbutamol Inhaler',
    generic: 'Salbutamol',
    category: 'Respiratory',
    form: 'Inhaler',
    cost: 115,
    price: 150,
    stock: 58,
    reorder: 40,
    rx: true,
  },
  {
    code: 'DIAZ5',
    name: 'Diazepam 5mg',
    generic: 'Diazepam',
    category: 'Other',
    form: 'Tablet',
    strength: '5mg',
    cost: 6,
    price: 10,
    stock: 310,
    reorder: 80,
    rx: true,
  },
  {
    code: 'ALB400',
    name: 'Albendazole 400mg',
    generic: 'Albendazole',
    category: 'Antihelminthics',
    form: 'Tablet',
    strength: '400mg',
    cost: 3,
    price: 5,
    stock: 1760,
    reorder: 250,
  },
  {
    code: 'DICLO50',
    name: 'Diclofenac 50mg',
    generic: 'Diclofenac',
    category: 'Analgesics',
    form: 'Tablet',
    strength: '50mg',
    cost: 7,
    price: 12,
    stock: 930,
    reorder: 200,
  },
] as const;

async function main(): Promise<void> {
  console.log('🌱 Seeding catalog / reference data...');

  const org = await prisma.organization.findFirst({
    where: { slug: 'system' },
  });
  if (!org) {
    throw new Error(
      'Default organization (slug "system") not found. Run `npm run db:seed` first.',
    );
  }
  const organizationId = org.id;

  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, code: d.code, description: d.description },
      create: { ...d, organizationId },
    });
  }
  console.log(`✅ Departments: ${DEPARTMENTS.length}`);

  let bedCount = 0;
  for (const w of WARDS) {
    await prisma.ward.upsert({
      where: { id: w.id },
      update: {
        name: w.name,
        code: w.code,
        type: w.type,
        capacity: w.capacity,
      },
      create: {
        id: w.id,
        organizationId,
        departmentId: 'dept-inpatient',
        name: w.name,
        code: w.code,
        type: w.type,
        capacity: w.capacity,
      },
    });

    for (let i = 1; i <= w.capacity; i++) {
      const bedId = `bed-${w.id}-${i}`;
      await prisma.bed.upsert({
        where: { id: bedId },
        // Reset occupancy so re-running gives a clean, deterministic bed map.
        update: { status: 'available', currentPatientId: null },
        create: {
          id: bedId,
          organizationId,
          wardId: w.id,
          bedNumber: `${w.code}-${String(i).padStart(2, '0')}`,
          type:
            w.type === 'private'
              ? 'special'
              : w.type === 'icu'
                ? 'icu'
                : 'standard',
          status: 'available',
        },
      });
      bedCount++;
    }
  }
  console.log(`✅ Wards: ${WARDS.length} (${bedCount} beds)`);

  for (const [i, t] of LAB_TESTS.entries()) {
    await prisma.labTest.upsert({
      where: { id: `test-${i + 1}` },
      update: {},
      create: {
        id: `test-${i + 1}`,
        organizationId,
        testName: t.name,
        testCode: t.code,
        testCategory: t.category,
        specimenType: t.specimen,
        resultType: t.resultType,
        unit: 'unit' in t ? t.unit : null,
        referenceRanges: 'ranges' in t ? JSON.stringify(t.ranges) : null,
        price: t.price,
        turnaroundTime: t.tat,
        department: 'Laboratory',
        isActive: true,
      },
    });
  }
  console.log(`✅ Lab tests: ${LAB_TESTS.length}`);

  for (const [i, e] of RADIOLOGY_EXAMS.entries()) {
    await prisma.radiologyExam.upsert({
      where: { id: `exam-${i + 1}` },
      update: {},
      create: {
        id: `exam-${i + 1}`,
        organizationId,
        examName: e.name,
        examCode: e.code,
        examCategory: e.category,
        modality: e.modality,
        bodyPart: e.bodyPart,
        price: e.price,
        estimatedDuration: e.duration,
        contrastRequired: 'contrast' in e ? e.contrast : false,
        isActive: true,
      },
    });
  }
  console.log(`✅ Radiology exams: ${RADIOLOGY_EXAMS.length}`);

  for (const [i, s] of BILLING_SERVICES.entries()) {
    await prisma.billingService.upsert({
      where: { id: `svc-${i + 1}` },
      update: { unitPrice: s.price },
      create: {
        id: `svc-${i + 1}`,
        organizationId,
        serviceName: s.name,
        serviceCode: s.code,
        serviceCategory: s.category,
        unitPrice: s.price,
        department: 'department' in s ? s.department : null,
        isActive: true,
      },
    });
  }
  console.log(`✅ Billing services: ${BILLING_SERVICES.length}`);

  for (const [i, d] of DRUGS.entries()) {
    await prisma.pharmacyDrug.upsert({
      where: { id: `drug-${i + 1}` },
      update: { quantityInStock: d.stock, sellingPrice: d.price },
      create: {
        id: `drug-${i + 1}`,
        organizationId,
        drugName: d.name,
        genericName: d.generic,
        drugCode: d.code,
        drugCategory: d.category,
        dosageForm: d.form,
        strength: 'strength' in d ? d.strength : null,
        unitOfMeasure: d.form,
        quantityInStock: d.stock,
        reorderLevel: d.reorder,
        costPrice: d.cost,
        sellingPrice: d.price,
        requiresPrescription: 'rx' in d ? d.rx : false,
        isActive: true,
      },
    });
  }
  const lowStock = DRUGS.filter((d) => d.stock <= d.reorder).length;
  console.log(
    `✅ Pharmacy drugs: ${DRUGS.length} (${lowStock} at/below reorder level)`,
  );

  console.log('🎉 Catalog seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Catalog seed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
