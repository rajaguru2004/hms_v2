import 'dotenv/config';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  errorCode?: string;
}

interface QueueItem {
  id: string;
  queueNumber: string;
  serviceArea: string;
  status: string;
  priority: string;
  calledAt?: string | null;
  serviceStartedAt?: string | null;
  serviceCompletedAt?: string | null;
  waitTime: number;
  patient?: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
  };
}

async function parseEnvelope<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  const json = JSON.parse(text) as ApiEnvelope<T>;

  if (!res.ok || !json.success) {
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }

  return json.data;
}

/**
 * A list endpoint's rows.
 *
 * `GET /queue` answers with `PaginatedQueueResponseDto` - `data.data` for the
 * rows and `data.meta` for the page - not with a bare array. Reading it as one
 * failed as `list.some is not a function`, which names the symptom and not the
 * contract, so the unwrapping lives here once.
 *
 * The page size is deliberate. The board is ordered by acuity and this file
 * adds one row to a seeded hospital, so a default page can legitimately not
 * contain it; asking for one page big enough to hold the whole board keeps
 * "the row is in the list" a statement about the list rather than about where
 * the row sorted.
 */
interface Paged<T> {
  data: T[];
  meta?: Record<string, unknown>;
}

const PAGE = 'limit=200';

async function parseList<T>(res: Response, label: string): Promise<T[]> {
  const page = await parseEnvelope<Paged<T>>(res, label);
  if (!Array.isArray(page?.data)) {
    throw new Error(`${label} did not answer with a paginated list`);
  }
  return page.data;
}

async function main(): Promise<void> {
  console.log('Starting Queue Module Verification...');

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SEED_ADMIN_EMAIL || 'admin@hms.local',
      password: process.env.SEED_ADMIN_PASSWORD || 'Admin@HMS2024!',
    }),
  });
  const loginData = await parseEnvelope<{ accessToken: string }>(
    loginRes,
    'Login',
  );
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${loginData.accessToken}`,
  };

  const patientRes = await fetch(`${BASE_URL}/patients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      firstName: 'Queue',
      lastName: 'Verify',
      dateOfBirth: '1990-01-01',
      gender: 'male',
      phonePrimary: '+251911000111',
    }),
  });
  const patient = await parseEnvelope<{ id: string }>(
    patientRes,
    'Create patient',
  );
  console.log(`Patient created: ${patient.id}`);

  const createRes = await fetch(`${BASE_URL}/queue`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      patientId: patient.id,
      serviceArea: 'opd',
      serviceType: 'consultation',
      priority: 'urgent',
      assignedRoom: 'Verification Room',
    }),
  });
  const created = await parseEnvelope<QueueItem>(createRes, 'Create queue');
  if (!created.queueNumber.startsWith('OPD')) {
    throw new Error(`Unexpected queue number: ${created.queueNumber}`);
  }
  console.log(`Queue created: ${created.id} ${created.queueNumber}`);

  const listRes = await fetch(`${BASE_URL}/queue?${PAGE}`, { headers });
  const list = await parseList<QueueItem>(listRes, 'List queue');
  if (!list.some((item) => item.id === created.id)) {
    throw new Error('Created queue item missing from list');
  }

  const filteredRes = await fetch(`${BASE_URL}/queue?serviceArea=opd&${PAGE}`, {
    headers,
  });
  const filtered = await parseList<QueueItem>(filteredRes, 'Filter queue');
  if (!filtered.some((item) => item.id === created.id)) {
    throw new Error('Created queue item missing from serviceArea filter');
  }

  const called = await patchStatus(created.id, 'called', headers);
  if (!called.calledAt) {
    throw new Error('calledAt was not set');
  }

  const inService = await patchStatus(created.id, 'in_service', headers);
  if (!inService.serviceStartedAt) {
    throw new Error('serviceStartedAt was not set');
  }

  const completed = await patchStatus(created.id, 'completed', headers);
  if (!completed.serviceCompletedAt) {
    throw new Error('serviceCompletedAt was not set');
  }

  const deleteRes = await fetch(`${BASE_URL}/queue/${created.id}`, {
    method: 'DELETE',
    headers,
  });
  if (!deleteRes.ok) {
    throw new Error(`Delete queue failed: ${deleteRes.status}`);
  }

  const afterDeleteRes = await fetch(`${BASE_URL}/queue?${PAGE}`, { headers });
  const afterDelete = await parseList<QueueItem>(
    afterDeleteRes,
    'List after delete',
  );
  if (afterDelete.some((item) => item.id === created.id)) {
    throw new Error('Deleted queue item still appears in list');
  }

  console.log('Queue Module Verification passed.');
}

async function patchStatus(
  id: string,
  status: string,
  headers: Record<string, string>,
): Promise<QueueItem> {
  const res = await fetch(`${BASE_URL}/queue/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  });
  const item = await parseEnvelope<QueueItem>(res, `Patch ${status}`);
  console.log(`Status updated: ${status}`);
  return item;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
