import 'dotenv/config';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

interface AuthData {
  accessToken: string;
}

interface PatientData {
  id: string;
}

interface ExamData {
  id: string;
  examName: string;
  examCategory?: string;
  price?: number;
}

interface OrderData {
  id: string;
  orderNumber: string;
  status: string;
}

interface ReportData {
  id: string;
  orderId: string;
  status: string;
  verifiedAt?: string | null;
}

interface StatsData {
  pending: number;
  inProgress: number;
  completedToday: number;
  criticalFindings: number;
  totalExams: number;
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function parseEnvelope<T>(
  res: Response,
  label: string,
): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }

  const body = JSON.parse(text) as ApiEnvelope<T>;
  if (!body.success) {
    throw new Error(`${label} returned success=false: ${text}`);
  }
  if (body.data === undefined || body.data === null) {
    throw new Error(`${label} missing data: ${text}`);
  }
  return body;
}

async function request<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const envelope = await parseEnvelope<T>(
    res,
    `${options.method || 'GET'} ${path}`,
  );
  return envelope.data;
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.VERIFY_EMAIL || 'admin@hms.local',
      password: process.env.VERIFY_PASSWORD || 'Admin@HMS2024!',
    }),
  });

  const envelope = await parseEnvelope<AuthData>(res, 'POST /auth/login');
  if (!envelope.data.accessToken) {
    throw new Error('Login response missing accessToken');
  }
  return envelope.data.accessToken;
}

async function runVerification(): Promise<void> {
  console.log('Starting Radiology Module Verification...');

  const token = await login();
  console.log('Logged in');

  const patient = await request<PatientData>('/patients', token, {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Radiology',
      lastName: uniqueId('Verify'),
      dateOfBirth: '1990-01-01',
      gender: 'male',
    }),
  });
  console.log(`Patient created: ${patient.id}`);

  const compatExam = await request<ExamData>('/radiology', token, {
    method: 'POST',
    body: JSON.stringify({
      resource: 'exam',
      examName: uniqueId('Chest X-Ray'),
      examCode: uniqueId('CXR'),
      examCategory: 'x-ray',
      bodyPart: 'Chest',
      modality: 'DR',
      price: 500,
      estimatedDuration: 15,
      contrastRequired: false,
      description: 'Verification exam',
    }),
  });
  console.log(`Compat exam created: ${compatExam.id}`);

  const directExam = await request<ExamData>('/radiology/exams', token, {
    method: 'POST',
    body: JSON.stringify({
      examName: uniqueId('CT Brain'),
      examCode: uniqueId('CTB'),
      examCategory: 'ct',
      bodyPart: 'Head',
      modality: 'CT',
      price: 2500,
      estimatedDuration: 30,
      contrastRequired: false,
    }),
  });
  console.log(`Direct exam created: ${directExam.id}`);

  const compatExamList = await request<ExamData[]>(
    '/radiology?resource=exams&category=x-ray',
    token,
  );
  if (!compatExamList.some((exam) => exam.id === compatExam.id)) {
    throw new Error('Compat exam list missing created exam');
  }

  const directExamList = await request<ExamData[]>(
    '/radiology/exams?category=ct',
    token,
  );
  if (!directExamList.some((exam) => exam.id === directExam.id)) {
    throw new Error('Direct exam list missing created exam');
  }

  const fetchedExam = await request<ExamData>(
    `/radiology/exams/${directExam.id}`,
    token,
  );
  if (fetchedExam.id !== directExam.id) {
    throw new Error('Direct exam detail returned wrong exam');
  }

  const patchedExam = await request<ExamData>('/radiology', token, {
    method: 'PATCH',
    body: JSON.stringify({
      resource: 'exam',
      id: compatExam.id,
      price: 550,
      description: 'Updated verification exam',
    }),
  });
  if (patchedExam.price !== 550) {
    throw new Error('Compat exam patch did not update price');
  }

  await request<ExamData>(`/radiology/exams/${directExam.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ price: 2600 }),
  });

  const compatOrder = await request<OrderData>('/radiology', token, {
    method: 'POST',
    body: JSON.stringify({
      resource: 'order',
      patientId: patient.id,
      examId: compatExam.id,
      clinicalIndication: 'Cough',
      provisionalDiagnosis: 'Pneumonia',
      relevantHistory: 'Fever',
      urgency: 'routine',
      notes: 'Compat order',
    }),
  });
  console.log(`Compat order created: ${compatOrder.id}`);

  const directOrder = await request<OrderData>('/radiology/orders', token, {
    method: 'POST',
    body: JSON.stringify({
      patientId: patient.id,
      examId: directExam.id,
      clinicalIndication: 'Headache',
      provisionalDiagnosis: 'Rule out bleed',
      urgency: 'urgent',
      notes: 'Direct order',
    }),
  });
  console.log(`Direct order created: ${directOrder.id}`);

  const compatOrders = await request<OrderData[]>(
    '/radiology?resource=orders&status=pending',
    token,
  );
  if (!compatOrders.some((order) => order.id === compatOrder.id)) {
    throw new Error('Compat orders list missing created order');
  }

  const directOrders = await request<OrderData[]>(
    '/radiology/orders?status=pending&urgency=urgent',
    token,
  );
  if (!directOrders.some((order) => order.id === directOrder.id)) {
    throw new Error('Direct orders list missing created order');
  }

  const fetchedOrder = await request<OrderData>(
    `/radiology/orders/${directOrder.id}`,
    token,
  );
  if (fetchedOrder.id !== directOrder.id) {
    throw new Error('Direct order detail returned wrong order');
  }

  const patchedOrder = await request<OrderData>('/radiology', token, {
    method: 'PATCH',
    body: JSON.stringify({
      resource: 'order',
      id: compatOrder.id,
      status: 'in_progress',
      notes: 'Compat order updated',
    }),
  });
  if (patchedOrder.status !== 'in_progress') {
    throw new Error('Compat order patch did not update status');
  }

  await request<OrderData>(`/radiology/orders/${directOrder.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'scheduled' }),
  });

  const compatReport = await request<ReportData>('/radiology', token, {
    method: 'POST',
    body: JSON.stringify({
      resource: 'report',
      orderId: compatOrder.id,
      technique: 'PA chest radiograph',
      findings: 'No focal consolidation',
      impression: 'No acute cardiopulmonary abnormality',
      recommendations: 'Clinical follow-up',
      hasCriticalFindings: false,
      comparedWithPrevious: false,
    }),
  });
  console.log(`Compat report created: ${compatReport.id}`);

  const directReport = await request<ReportData>('/radiology/reports', token, {
    method: 'POST',
    body: JSON.stringify({
      orderId: directOrder.id,
      technique: 'Axial CT brain',
      findings: 'No acute hemorrhage',
      impression: 'No acute intracranial abnormality',
      hasCriticalFindings: false,
    }),
  });
  console.log(`Direct report created: ${directReport.id}`);

  const compatReports = await request<ReportData[]>(
    `/radiology?resource=reports&orderId=${compatOrder.id}`,
    token,
  );
  if (!compatReports.some((report) => report.id === compatReport.id)) {
    throw new Error('Compat reports list missing created report');
  }

  const directReports = await request<ReportData[]>(
    `/radiology/reports?orderId=${directOrder.id}`,
    token,
  );
  if (!directReports.some((report) => report.id === directReport.id)) {
    throw new Error('Direct reports list missing created report');
  }

  const fetchedReport = await request<ReportData>(
    `/radiology/reports/${directReport.id}`,
    token,
  );
  if (fetchedReport.id !== directReport.id) {
    throw new Error('Direct report detail returned wrong report');
  }

  const verifiedAt = new Date().toISOString();
  const patchedReport = await request<ReportData>('/radiology', token, {
    method: 'PATCH',
    body: JSON.stringify({
      resource: 'report',
      id: compatReport.id,
      reportStatus: 'final',
      verifiedAt,
    }),
  });
  if (patchedReport.status !== 'final') {
    throw new Error('Compat report patch did not update status');
  }

  await request<ReportData>(`/radiology/reports/${directReport.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'final', verifiedAt }),
  });

  const compatStats = await request<StatsData>(
    '/radiology?resource=stats',
    token,
  );
  if (typeof compatStats.totalExams !== 'number') {
    throw new Error('Compat stats missing totalExams');
  }

  const directStats = await request<StatsData>(
    '/radiology/stats/summary',
    token,
  );
  if (typeof directStats.pending !== 'number') {
    throw new Error('Direct stats missing pending');
  }

  console.log('Radiology verification passed');
  console.log(
    JSON.stringify(
      {
        patientId: patient.id,
        exams: [compatExam.id, directExam.id],
        orders: [compatOrder.id, directOrder.id],
        reports: [compatReport.id, directReport.id],
        stats: directStats,
      },
      null,
      2,
    ),
  );
}

void runVerification().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Radiology verification failed: ${message}`);
  process.exit(1);
});
