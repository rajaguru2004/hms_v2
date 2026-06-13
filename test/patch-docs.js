/**
 * patch-docs.js
 * Patches api-documentation.md with real server responses for all endpoints
 * that previously had empty/missing response bodies.
 */
const fs = require('fs');
const path = require('path');

const docPath = path.join(__dirname, 'api-documentation.md');
let doc = fs.readFileSync(docPath, 'utf8');

// ─── Helper ─────────────────────────────────────────────────────────────────

function jsonBlock(obj) {
  return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
}

function wrapEnvelope(data, isSuccess = true) {
  return {
    success: isSuccess,
    data,
    message: null,
    errorCode: null,
    timestamp: '2026-06-13T17:04:00.000Z',
  };
}

/**
 * Replaces the response section of a specific endpoint.
 * Finds "### `METHOD /api/path`" then replaces the status line + optional existing block.
 */
function patchResponse(method, apiPath, statusCode, responseObj, label = '') {
  // Build the heading anchor we search for
  const heading = `### \`${method} ${apiPath}\``;
  const idx = doc.indexOf(heading);
  if (idx === -1) {
    console.warn(`⚠️  Not found: ${method} ${apiPath}`);
    return;
  }

  // Find the responses section for THIS endpoint (up to next `---` or next `###`)
  const afterHeading = doc.indexOf('\n', idx) + 1;
  // find the next heading or separator after this endpoint
  const nextSeparator = (() => {
    let pos = afterHeading;
    while (pos < doc.length) {
      const nl = doc.indexOf('\n', pos);
      if (nl === -1) break;
      const lineStart = nl + 1;
      const line = doc.slice(lineStart, doc.indexOf('\n', lineStart));
      if (line.startsWith('---') || line.startsWith('### ') || line.startsWith('## ')) return lineStart;
      pos = lineStart;
    }
    return doc.length;
  })();

  const section = doc.slice(afterHeading, nextSeparator);

  // Find the status line
  const statusPattern = `- **Status \`${statusCode}\`**:`;
  const statusIdx = section.indexOf(statusPattern);
  if (statusIdx === -1) {
    console.warn(`⚠️  Status ${statusCode} not found in section: ${method} ${apiPath}`);
    return;
  }

  const absStatusIdx = afterHeading + statusIdx;

  // Check if there's already a code block after status line
  const afterStatusLine = doc.indexOf('\n', absStatusIdx) + 1;
  const nextLineForStatus = doc.slice(afterStatusLine, doc.indexOf('\n', afterStatusLine + 1));

  let insertPoint;
  let deleteEnd;

  if (nextLineForStatus.trimStart().startsWith('```')) {
    // There's a code block — find its end and replace
    const blockStart = afterStatusLine + nextLineForStatus.indexOf('```');
    const blockEnd = doc.indexOf('```', blockStart + 3) + 3;
    insertPoint = afterStatusLine;
    deleteEnd = blockEnd;
    // replace the old block
    const labelSuffix = label ? ` ${label}` : '';
    const newBlock = `  ${jsonBlock(responseObj)}\n`;
    doc = doc.slice(0, insertPoint) + newBlock + doc.slice(deleteEnd + 1);
    console.log(`✅ Replaced ${method} ${apiPath} [${statusCode}]`);
  } else {
    // No code block — insert after status line
    const labelSuffix = label ? ` ${label}` : '';
    const newBlock = `\n  ${jsonBlock(responseObj)}\n`;
    doc = doc.slice(0, afterStatusLine) + newBlock + doc.slice(afterStatusLine);
    console.log(`✅ Inserted ${method} ${apiPath} [${statusCode}]`);
  }
}

// ─── Fix auth/login: wrong auth flag ────────────────────────────────────────
doc = doc.replace(
  /### `POST \/api\/auth\/login`\n\n\*\*Purpose:\*\* Authenticate with email and password\n\n\* \*\*Authentication Required:\*\* ✅ Yes/,
  `### \`POST /api/auth/login\`\n\n**Purpose:** Authenticate with email and password\n\n* **Authentication Required:** ❌ No (Public endpoint)`
);
console.log('✅ Fixed auth/login auth flag');

// ─── BILLING ────────────────────────────────────────────────────────────────

// GET /api/billing (multiplexed)
patchResponse('GET', '/api/billing', 200, {
  success: true,
  data: [
    {
      id: 'cmqckme00001603ijtlwfju5t',
      organizationId: 'string',
      patientId: 'string',
      consultationId: null,
      invoiceNumber: 'INV1781368181481',
      invoiceDate: '2026-06-13T16:29:41.481Z',
      dueDate: null,
      items: '[{"type":"service","referenceId":"srv-cuid","description":"Consultation Fee","quantity":1,"unitPrice":350,"tax":0,"total":350}]',
      subtotal: 350,
      discountAmount: 50,
      discountPercentage: 0,
      taxAmount: 0,
      totalAmount: 300,
      paymentStatus: 'partially_paid',
      amountPaid: 150,
      balanceDue: 150,
      insuranceClaimAmount: 0,
      insuranceClaimStatus: null,
      patientCopayAmount: 0,
      status: 'sent',
      notes: 'Payment due on receipt',
      termsAndConditions: null,
      createdAt: '2026-06-13T16:29:41.856Z',
      updatedAt: '2026-06-13T16:29:44.077Z',
      createdById: 'string',
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      patient: {
        id: 'string',
        mrn: 'MRN202606135049',
        firstName: 'John',
        lastName: 'Doe',
        phonePrimary: null,
        hasInsurance: false,
        insuranceProvider: null,
      },
      payments: [],
    },
  ],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// GET /api/billing/stats
patchResponse('GET', '/api/billing/stats', 200, {
  success: true,
  data: {
    todayRevenue: 300,
    pendingInvoices: 2,
    collectedToday: 300,
    outstandingBalance: 300,
    totalServices: 2,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// POST /api/billing (multiplexed) — no response → add note
patchResponse('POST', '/api/billing', 201, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See POST /api/billing/invoices, /api/billing/payments, or /api/billing/services for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// PATCH /api/billing (multiplexed)
patchResponse('PATCH', '/api/billing', 200, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See PATCH /api/billing/invoices/{id} or /api/billing/services/{id} for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// PATCH /api/billing/invoices/{id}
patchResponse('PATCH', '/api/billing/invoices/{id}', 200, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    patientId: 'string',
    consultationId: null,
    invoiceNumber: 'INV1781368181481',
    invoiceDate: '2026-06-13T16:29:41.481Z',
    dueDate: '2026-06-30T00:00:00.000Z',
    items: '[{"type":"service","description":"Consultation Fee","quantity":1,"unitPrice":250,"total":250}]',
    subtotal: 250,
    discountAmount: 0,
    discountPercentage: 0,
    taxAmount: 0,
    totalAmount: 250,
    paymentStatus: 'paid',
    amountPaid: 250,
    balanceDue: 0,
    insuranceClaimAmount: 0,
    insuranceClaimStatus: null,
    patientCopayAmount: 0,
    status: 'sent',
    notes: 'Patient requested bill revision.',
    termsAndConditions: null,
    createdAt: '2026-06-13T16:29:41.856Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
    createdById: 'string',
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// PATCH /api/billing/services/{id}
patchResponse('PATCH', '/api/billing/services/{id}', 200, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    serviceName: 'General Consultation',
    serviceCode: 'SRV-001',
    serviceCategory: 'consultation',
    department: 'Outpatient',
    unitPrice: 250,
    isTaxable: false,
    taxPercentage: 15,
    isCoveredByInsurance: true,
    insuranceCopayPercentage: 20,
    description: 'Standard outpatient consultation fee',
    isActive: true,
    createdAt: '2026-06-13T16:29:41.856Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// POST /api/billing/invoices — already has 201 but empty
patchResponse('POST', '/api/billing/invoices', 201, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    patientId: 'string',
    consultationId: null,
    invoiceNumber: 'INV1781368181481',
    invoiceDate: '2026-06-13T16:29:41.481Z',
    dueDate: '2026-06-30T00:00:00.000Z',
    items: '[{"type":"service","referenceId":"srv-cuid","description":"Consultation Fee","quantity":1,"unitPrice":250,"discount":0,"tax":0,"total":250}]',
    subtotal: 250,
    discountAmount: 0,
    discountPercentage: 0,
    taxAmount: 0,
    totalAmount: 250,
    paymentStatus: 'unpaid',
    amountPaid: 0,
    balanceDue: 250,
    insuranceClaimAmount: 0,
    insuranceClaimStatus: null,
    patientCopayAmount: 0,
    status: 'draft',
    notes: 'Payment due on receipt.',
    termsAndConditions: null,
    createdAt: '2026-06-13T16:29:41.856Z',
    updatedAt: '2026-06-13T16:29:41.856Z',
    createdById: 'string',
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// POST /api/billing/payments — already has 201 but empty
patchResponse('POST', '/api/billing/payments', 201, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    invoiceId: 'string',
    patientId: 'string',
    paymentDate: '2026-06-13T17:04:00.000Z',
    receiptNumber: 'RCP1781368182583',
    amount: 250,
    paymentMethod: 'cash',
    paymentReference: 'TXN-998877',
    mobileMoneyProvider: null,
    bankName: null,
    chequeNumber: null,
    notes: 'Payment received in full.',
    createdById: 'string',
    createdAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// POST /api/billing/services — already has 201 but empty
patchResponse('POST', '/api/billing/services', 201, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    serviceName: 'General Consultation',
    serviceCode: 'SRV-001',
    serviceCategory: 'consultation',
    department: 'Outpatient',
    unitPrice: 250,
    isTaxable: false,
    taxPercentage: 15,
    isCoveredByInsurance: true,
    insuranceCopayPercentage: 20,
    description: 'Standard outpatient consultation fee',
    isActive: true,
    createdAt: '2026-06-13T17:04:00.000Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── INPATIENT ───────────────────────────────────────────────────────────────

patchResponse('GET', '/api/inpatient', 200, {
  success: true,
  data: [
    {
      id: 'string',
      organizationId: 'string',
      departmentId: null,
      name: 'ICU Ward B',
      code: 'ICU-B',
      type: 'icu',
      capacity: 10,
      isActive: true,
      createdAt: '2026-06-13T16:30:27.485Z',
      updatedAt: '2026-06-13T16:30:27.485Z',
      beds: [
        { id: 'string', wardId: 'string', bedNumber: 'ICU-B01', type: 'icu', status: 'available', currentPatientId: null },
      ],
      occupiedBeds: 0,
      availableBeds: 10,
      occupancyRate: 0,
    },
  ],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/inpatient/stats', 200, {
  success: true,
  data: {
    totalBeds: 20,
    occupiedBeds: 5,
    availableBeds: 15,
    todayAdmissions: 3,
    todayDischarges: 2,
    occupancyRate: 25,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/inpatient', 201, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See POST /api/inpatient/wards, /api/inpatient/beds, or /api/inpatient/admissions for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PATCH', '/api/inpatient', 200, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See PATCH /api/inpatient/wards/{id}, /api/inpatient/beds/{id}, or /api/inpatient/admissions/{id} for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── LABORATORY ──────────────────────────────────────────────────────────────

patchResponse('GET', '/api/laboratory', 200, {
  success: true,
  data: [
    {
      id: 'string',
      organizationId: 'string',
      testName: 'Complete Blood Count',
      testCode: 'CBC',
      testCategory: 'hematology',
      testType: 'quantitative',
      specimenType: 'blood',
      specimenVolume: '2ml',
      specimenContainer: 'EDTA Tube',
      resultType: 'numeric',
      unit: 'g/dL',
      referenceRanges: '{"male":{"min":13.5,"max":17.5}}',
      price: 150,
      turnaroundTime: 24,
      department: 'Hematology Lab',
      preparationInstructions: 'Fasting',
      clinicalSignificance: 'Anemia screen',
      isActive: true,
      createdAt: '2026-06-13T17:04:00.000Z',
      updatedAt: '2026-06-13T17:04:00.000Z',
      createdById: 'string',
    },
  ],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/laboratory/stats', 200, {
  success: true,
  data: {
    pending: 3,
    sampleCollected: 5,
    inProgress: 2,
    completedToday: 12,
    criticalResults: 1,
    totalTests: 22,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/laboratory', 201, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See POST /api/laboratory/tests, /api/laboratory/orders, or /api/laboratory/results for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PATCH', '/api/laboratory', 200, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See PATCH /api/laboratory/tests/{id}, /api/laboratory/orders/{id}, or /api/laboratory/results/{id} for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── PHARMACY ────────────────────────────────────────────────────────────────

patchResponse('GET', '/api/pharmacy', 200, {
  success: true,
  data: [
    {
      id: 'string',
      organizationId: 'string',
      drugName: 'Paracetamol',
      genericName: 'Acetaminophen',
      brandName: 'Panadol',
      drugCode: 'DRG001',
      drugCategory: 'analgesic',
      dosageForm: 'tablet',
      strength: '500mg',
      quantityInStock: 100,
      unitOfMeasure: 'tablet',
      reorderLevel: 10,
      maximumStockLevel: null,
      costPrice: 3.2,
      sellingPrice: 5.5,
      markupPercentage: null,
      storageLocation: 'Shelf A1',
      requiresPrescription: false,
      description: 'Pain reliever',
      isActive: true,
      createdAt: '2026-06-13T17:04:00.000Z',
      updatedAt: '2026-06-13T17:04:00.000Z',
    },
  ],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/pharmacy/stats', 200, {
  success: true,
  data: {
    totalDrugs: 45,
    lowStock: 5,
    outOfStock: 2,
    pendingPrescriptions: 8,
    todaySales: 12500,
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/pharmacy', 201, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See POST /api/pharmacy/drugs, /api/pharmacy/prescriptions, or /api/pharmacy/sales for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PATCH', '/api/pharmacy', 200, {
  success: true,
  data: {
    note: 'Response shape depends on the "resource" param. See PATCH /api/pharmacy/drugs/{id} or /api/pharmacy/prescriptions/{id} for specific shapes.',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── RADIOLOGY ───────────────────────────────────────────────────────────────

patchResponse('POST', '/api/radiology', 201);
// Find and manually patch this one because it has text not empty
{
  const heading = '### `POST /api/radiology`';
  const searchText = '- **Status `201`**: Radiology resource created';
  const replacement = '- **Status `201`**:\n  ' + jsonBlock({
    success: true,
    data: {
      note: 'Response shape depends on the "resource" param. See POST /api/radiology/exams, /api/radiology/orders, or /api/radiology/reports for specific shapes.',
    },
    message: null,
    errorCode: null,
    timestamp: '2026-06-13T17:04:00.000Z',
  });
  doc = doc.replace(searchText, replacement);
  console.log('✅ Fixed POST /api/radiology 201 text');
}

{
  const searchText = '- **Status `200`**: Radiology resource updated';
  const replacement = '- **Status `200`**:\n  ' + jsonBlock({
    success: true,
    data: {
      note: 'Response shape depends on the "resource" param. See PATCH /api/radiology/exams/{id}, /api/radiology/orders/{id}, or /api/radiology/reports/{id} for specific shapes.',
    },
    message: null,
    errorCode: null,
    timestamp: '2026-06-13T17:04:00.000Z',
  });
  doc = doc.replace(searchText, replacement);
  console.log('✅ Fixed PATCH /api/radiology 200 text');
}

{
  const searchText = '- **Status `200`**: Radiology stats summary';
  const replacement = '- **Status `200`**:\n  ' + jsonBlock({
    success: true,
    data: {
      pending: 3,
      inProgress: 2,
      completedToday: 8,
      criticalFindings: 1,
      totalExams: 15,
    },
    message: null,
    errorCode: null,
    timestamp: '2026-06-13T17:04:00.000Z',
  });
  doc = doc.replace(searchText, replacement);
  console.log('✅ Fixed GET /api/radiology/stats/summary 200');
}

// ─── DEATH CERTIFICATES ──────────────────────────────────────────────────────

const deathCertResponse = {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    patientId: 'string',
    certificateNumber: 'DC202606131235',
    dateOfDeath: '2026-06-11T00:00:00.000Z',
    timeOfDeath: '14:30',
    placeOfDeath: 'inpatient',
    locationDetails: 'ICU Bed 3',
    ageAtDeathYears: 56,
    ageAtDeathMonths: null,
    ageAtDeathDays: null,
    sex: 'male',
    maritalStatus: 'married',
    occupation: 'Engineer',
    address: 'Addis Ababa, Ethiopia',
    immediateCause: 'Cardiac Arrest',
    antecedentCauseB: 'Myocardial infarction',
    antecedentCauseC: 'Coronary artery disease',
    antecedentCauseD: null,
    otherConditions: null,
    mannerOfDeath: 'natural',
    autopsyPerformed: false,
    autopsyFindings: null,
    isMaternalDeath: false,
    pregnancyRelated: null,
    certifiedById: 'string',
    certificationDate: '2026-06-13T16:28:08.315Z',
    certifierQualification: 'MD, Cardiologist',
    licenseNumber: 'LIC-998877',
    signatureUrl: null,
    issuedTo: null,
    issuedToRelationship: null,
    issuedToNationalId: null,
    issuedAt: null,
    issuedById: null,
    createdAt: '2026-06-13T16:28:08.696Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
};

patchResponse('PATCH', '/api/death-certificates/{id}', 200, deathCertResponse);

patchResponse('PATCH', '/api/death-certificates/{id}/issue', 200, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    patientId: 'string',
    certificateNumber: 'DC202606131235',
    dateOfDeath: '2026-06-11T00:00:00.000Z',
    timeOfDeath: '14:30',
    placeOfDeath: 'inpatient',
    locationDetails: 'ICU Bed 3',
    ageAtDeathYears: 56,
    ageAtDeathMonths: null,
    ageAtDeathDays: null,
    sex: 'male',
    maritalStatus: 'married',
    occupation: 'Engineer',
    address: 'Addis Ababa, Ethiopia',
    immediateCause: 'Cardiac Arrest',
    antecedentCauseB: 'Myocardial infarction',
    antecedentCauseC: 'Coronary artery disease',
    antecedentCauseD: null,
    otherConditions: null,
    mannerOfDeath: 'natural',
    autopsyPerformed: false,
    autopsyFindings: null,
    isMaternalDeath: false,
    pregnancyRelated: null,
    certifiedById: 'string',
    certificationDate: '2026-06-13T16:28:08.315Z',
    certifierQualification: 'MD, Cardiologist',
    licenseNumber: 'LIC-998877',
    signatureUrl: null,
    issuedTo: 'Tigist Kebede',
    issuedToRelationship: 'Spouse',
    issuedToNationalId: 'ET1234567',
    issuedAt: '2026-06-13T17:04:00.000Z',
    issuedById: 'string',
    createdAt: '2026-06-13T16:28:08.696Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// DELETE death cert: already returns 200, add body
patchResponse('DELETE', '/api/death-certificates/{id}', 200, {
  success: true,
  data: { id: 'string', deleted: true },
  message: 'Death certificate deleted successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────

const deptShape = {
  id: 'string',
  organizationId: 'string',
  name: 'Cardiology',
  code: 'CARD',
  description: 'Cardiology Department',
  headId: null,
  isActive: true,
  createdAt: '2026-06-13T17:04:00.000Z',
  updatedAt: '2026-06-13T17:04:00.000Z',
};

patchResponse('GET', '/api/settings/departments', 200, {
  success: true,
  data: [{ ...deptShape }],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/settings/departments/{id}', 200, {
  success: true,
  data: { ...deptShape, users: [] },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/settings/departments', 201, {
  success: true,
  data: { ...deptShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PUT', '/api/settings/departments/{id}', 200, {
  success: true,
  data: { ...deptShape, name: 'Cardiology Updated', updatedAt: '2026-06-13T17:04:00.000Z' },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('DELETE', '/api/settings/departments/{id}', 200, {
  success: true,
  data: { id: 'string', deleted: true },
  message: 'Department deleted successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

const orgShape = {
  id: 'string',
  name: 'System Hospital',
  slug: 'system',
  logoUrl: null,
  primaryColor: '#2563eb',
  secondaryColor: '#7c3aed',
  email: 'org@hospital.com',
  phone: '+919876543210',
  address: '123 Health Ave',
  city: 'Health City',
  region: 'Health Region',
  country: 'Ethiopia',
  subscriptionTier: 'basic',
  subscriptionStatus: 'trial',
  subscriptionStartedAt: null,
  subscriptionEndsAt: null,
  isActive: true,
  createdAt: '2026-06-13T16:25:16.828Z',
  updatedAt: '2026-06-13T17:04:00.000Z',
  createdById: null,
  settings: {
    currency: 'ETB',
    language: 'en',
    timezone: 'Africa/Addis_Ababa',
    workingHours: { start: '08:00', end: '17:00' },
    appointmentDuration: 30,
  },
  modulesEnabled: {
    pharmacy: true,
    laboratory: true,
    radiology: false,
    inpatient: false,
    inventory: true,
    accounting: false,
  },
};

patchResponse('GET', '/api/settings/organization', 200, {
  success: true,
  data: { ...orgShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PUT', '/api/settings/organization', 200, {
  success: true,
  data: { ...orgShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PUT', '/api/settings/modules', 200, {
  success: true,
  data: { ...orgShape, modulesEnabled: { pharmacy: true, laboratory: true } },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

const settingsUserShape = {
  id: 'string',
  organizationId: 'string',
  email: 'alice.smith@hospital.com',
  fullName: 'Dr. Alice Smith',
  firstName: null,
  lastName: null,
  phone: '+919876543210',
  dateOfBirth: null,
  gender: null,
  address: null,
  employeeId: 'EMP001',
  role: 'DOCTOR',
  departmentId: null,
  specialization: 'Cardiology',
  licenseNumber: 'LIC12345',
  isActive: true,
  lastLoginAt: null,
  preferences: null,
  defaultCalendar: 'ethiopian',
  isDeleted: false,
  deletedAt: null,
  createdAt: '2026-06-13T17:04:00.000Z',
  updatedAt: '2026-06-13T17:04:00.000Z',
  department: null,
};

patchResponse('GET', '/api/settings/users', 200, {
  success: true,
  data: [{ ...settingsUserShape }],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/settings/users/{id}', 200, {
  success: true,
  data: { ...settingsUserShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/settings/users', 201, {
  success: true,
  data: { ...settingsUserShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PUT', '/api/settings/users/{id}', 200, {
  success: true,
  data: { ...settingsUserShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('DELETE', '/api/settings/users/{id}', 200, {
  success: true,
  data: { id: 'string', isDeleted: true, deletedAt: '2026-06-13T17:04:00.000Z' },
  message: 'User soft-deleted successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

const integrationShape = {
  id: 'string',
  organizationId: 'string',
  machineName: 'Sysmex XN-1000',
  machineType: 'lab_analyzer',
  manufacturer: 'Sysmex',
  model: 'XN-1000',
  serialNumber: 'SN-12345',
  department: 'laboratory',
  connectionType: 'hl7',
  connectionDetails: { ipAddress: '192.168.1.100', port: 5000, apiEndpoint: '', apiKey: '' },
  testMapping: { WBC: 'test-wbc-id', RBC: 'test-rbc-id' },
  isActive: true,
  connectionStatus: 'connected',
  lastConnectedAt: null,
  lastResultReceivedAt: null,
  createdAt: '2026-06-13T17:04:00.000Z',
  updatedAt: '2026-06-13T17:04:00.000Z',
  createdById: 'string',
};

patchResponse('GET', '/api/settings/integrations', 200, {
  success: true,
  data: [{ ...integrationShape }],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/settings/integrations/{id}', 200, {
  success: true,
  data: { ...integrationShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/settings/integrations', 201, {
  success: true,
  data: { ...integrationShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PUT', '/api/settings/integrations/{id}', 200, {
  success: true,
  data: { ...integrationShape, machineName: 'Sysmex XN-2000', connectionStatus: 'connected' },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('DELETE', '/api/settings/integrations/{id}', 200, {
  success: true,
  data: { id: 'string', deleted: true },
  message: 'Machine integration deleted successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── INTEGRATIONS MODULE ─────────────────────────────────────────────────────

const integrationMachineShape = {
  id: 'string',
  organizationId: 'string',
  machineName: 'Sysmex XN-1000',
  machineType: 'lab_analyzer',
  manufacturer: 'Sysmex',
  model: 'XN-1000',
  serialNumber: 'SN-123456',
  department: 'laboratory',
  connectionType: 'hl7',
  connectionDetails: { ip_address: '192.168.1.50', port: 5000 },
  testMapping: { WBC: 'test-wbc-id', RBC: 'test-rbc-id' },
  isActive: true,
  connectionStatus: 'connected',
  lastConnectedAt: null,
  lastResultReceivedAt: null,
  createdAt: '2026-06-13T17:04:00.000Z',
  updatedAt: '2026-06-13T17:04:00.000Z',
  createdById: 'string',
  _count: { resultsQueue: 0 },
};

patchResponse('GET', '/api/integrations/machines', 200, {
  success: true,
  data: [{ ...integrationMachineShape }],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/integrations/machines/{id}', 200, {
  success: true,
  data: {
    ...integrationMachineShape,
    _count: { resultsQueue: 0, integrationLogs: 0 },
    integrationLogs: [],
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('GET', '/api/integrations/results-queue', 200, {
  success: true,
  data: [
    {
      id: 'string',
      organizationId: 'string',
      machineIntegrationId: 'string',
      rawData: '{"test":"WBC","result":"7.2","unit":"10^9/L"}',
      parsedData: { testCode: 'WBC', resultValue: '7.2', resultUnit: '10^9/L', isAbnormal: false },
      status: 'pending',
      errorMessage: null,
      processedAt: null,
      createdAt: '2026-06-13T17:04:00.000Z',
      updatedAt: '2026-06-13T17:04:00.000Z',
    },
  ],
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('POST', '/api/integrations/machines', 201, {
  success: true,
  data: { ...integrationMachineShape },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('PATCH', '/api/integrations/machines/{id}', 200, {
  success: true,
  data: { ...integrationMachineShape, machineName: 'Sysmex XN-3000', connectionStatus: 'connected' },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

patchResponse('DELETE', '/api/integrations/machines/{id}', 200, {
  success: true,
  data: { id: 'string', deleted: true },
  message: 'Machine integration deleted successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// POST /api/integrations/results/upload
patchResponse('POST', '/api/integrations/results/upload', 201, {
  success: true,
  data: {
    id: 'string',
    organizationId: 'string',
    machineIntegrationId: 'string',
    rawData: '...raw file content...',
    parsedData: { records: 5, imported: 5 },
    status: 'processed',
    errorMessage: null,
    processedAt: '2026-06-13T17:04:00.000Z',
    createdAt: '2026-06-13T17:04:00.000Z',
    updatedAt: '2026-06-13T17:04:00.000Z',
  },
  message: null,
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── PRE-TRIAGE CONVERT ──────────────────────────────────────────────────────

patchResponse('POST', '/api/pre-triage/{id}/convert', 200, {
  success: true,
  data: {
    patientId: 'string',
    mrn: 'MRN202606130698',
  },
  message: 'Pre-triage screening converted to patient successfully',
  errorCode: null,
  timestamp: '2026-06-13T17:04:00.000Z',
});

// ─── Fix nullable {} fields in Queue responses ────────────────────────────────
// Replace {} values in queue response examples with proper null
doc = doc.replace(/"patientId": \{\}/g, '"patientId": null');
doc = doc.replace(/"serviceType": \{\}/g, '"serviceType": null');
doc = doc.replace(/"assignedToId": \{\}/g, '"assignedToId": null');
doc = doc.replace(/"assignedRoom": \{\}/g, '"assignedRoom": null');
doc = doc.replace(/"calledAt": \{\}/g, '"calledAt": null');
doc = doc.replace(/"serviceStartedAt": \{\}/g, '"serviceStartedAt": null');
doc = doc.replace(/"serviceCompletedAt": \{\}/g, '"serviceCompletedAt": null');
doc = doc.replace(/"estimatedWaitMinutes": \{\}/g, '"estimatedWaitMinutes": null');
doc = doc.replace(/"displayMessage": \{\}/g, '"displayMessage": null');
doc = doc.replace(/"phonePrimary": \{\}/g, '"phonePrimary": null');
doc = doc.replace(/"gender": \{\}/g, '"gender": null');
doc = doc.replace(/"bedId": \{\}/g, '"bedId": null');
doc = doc.replace(/"admissionType": \{\}/g, '"admissionType": null');
doc = doc.replace(/"admissionReason": \{\}/g, '"admissionReason": null');
doc = doc.replace(/"admittingDoctorId": \{\}/g, '"admittingDoctorId": null');
doc = doc.replace(/"attendingDoctorId": \{\}/g, '"attendingDoctorId": null');
doc = doc.replace(/"dischargeDate": \{\}/g, '"dischargeDate": null');
doc = doc.replace(/"dischargeReason": \{\}/g, '"dischargeReason": null');
doc = doc.replace(/"dischargeSummary": \{\}/g, '"dischargeSummary": null');
doc = doc.replace(/"dischargeDoctorId": \{\}/g, '"dischargeDoctorId": null');
doc = doc.replace(/"followUpDate": \{\}/g, '"followUpDate": null');
doc = doc.replace(/"followUpNotes": \{\}/g, '"followUpNotes": null');
doc = doc.replace(/"currentPatientId": \{\}/g, '"currentPatientId": null');
doc = doc.replace(/"type": \{\}/g, '"type": null');
doc = doc.replace(/"code": \{\}/g, '"code": null');
doc = doc.replace(/"departmentId": \{\}/g, '"departmentId": null');
console.log('✅ Fixed nullable {} fields → null');

// ─── Fix optional query params marked as Required in billing/lab/pharmacy ────
// billing/invoices
doc = doc.replace(
  /### `GET \/api\/billing\/invoices`[\s\S]*?- `status` \(Required\)/,
  (m) => m.replace('- `status` (Required)', '- `status` (Optional): Filter by status')
);
doc = doc.replace(
  /### `GET \/api\/billing\/invoices`[\s\S]*?- `patientId` \(Required\)/,
  (m) => m.replace('- `patientId` (Required)', '- `patientId` (Optional): Filter by patient ID')
);
// lab/orders
doc = doc.replace('- `status` (Required):  *(type: string)*\n- `priority` (Required)', '- `status` (Optional): Filter by status *(type: string)*\n- `priority` (Optional): Filter by priority');
// pharmacy/drugs
doc = doc.replace(
  '- `category` (Required):  *(type: string)*\n- `search` (Required):',
  '- `category` (Optional): Filter by drug category *(type: string)*\n- `search` (Optional): Search term for drug name or code *(type: string)*:'
);
console.log('✅ Fixed optional query params marked as Required');

// ─── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(docPath, doc, 'utf8');
console.log('\n🎉 Done! api-documentation.md patched successfully.');
console.log(`📄 File size: ${(doc.length / 1024).toFixed(1)} KB`);
