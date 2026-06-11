import 'dotenv/config';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  errorCode?: string;
}

interface DashboardData {
  stats: {
    totalPatients: number;
    todayAppointments: number;
    pendingLabOrders: number;
    pendingPrescriptions: number;
    todayRevenue: number;
    occupiedBeds: number;
    availableBeds: number;
    queueWaiting: number;
    criticalAlerts: number;
  };
  appointmentStatuses: Record<string, number>;
  queueByService: Record<string, number>;
  recentPatients: Array<unknown>;
  upcomingAppointments: Array<unknown>;
}

async function parseEnvelope<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `${label} response is not valid JSON: ${res.status} ${text}`,
    );
  }

  if (!res.ok || !json.success) {
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }

  return json.data;
}

async function main(): Promise<void> {
  console.log('Starting Dashboard Module Verification...');

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

  const dashboardRes = await fetch(`${BASE_URL}/dashboard`, {
    method: 'GET',
    headers,
  });

  const dashboardData = await parseEnvelope<DashboardData>(
    dashboardRes,
    'Get Dashboard Data',
  );

  // Assert stats presence and structure
  if (!dashboardData.stats) {
    throw new Error('Dashboard stats missing');
  }

  const requiredStatsKeys: (keyof DashboardData['stats'])[] = [
    'totalPatients',
    'todayAppointments',
    'pendingLabOrders',
    'pendingPrescriptions',
    'todayRevenue',
    'occupiedBeds',
    'availableBeds',
    'queueWaiting',
    'criticalAlerts',
  ];

  for (const key of requiredStatsKeys) {
    if (typeof dashboardData.stats[key] !== 'number') {
      throw new Error(`Dashboard stats.${key} is missing or not a number`);
    }
  }

  // Assert other structures
  if (
    !dashboardData.appointmentStatuses ||
    typeof dashboardData.appointmentStatuses !== 'object'
  ) {
    throw new Error('Dashboard appointmentStatuses missing or invalid');
  }

  if (
    !dashboardData.queueByService ||
    typeof dashboardData.queueByService !== 'object'
  ) {
    throw new Error('Dashboard queueByService missing or invalid');
  }

  if (!Array.isArray(dashboardData.recentPatients)) {
    throw new Error('Dashboard recentPatients is not an array');
  }

  if (!Array.isArray(dashboardData.upcomingAppointments)) {
    throw new Error('Dashboard upcomingAppointments is not an array');
  }

  console.log('Dashboard statistics validation:');
  console.log(JSON.stringify(dashboardData.stats, null, 2));

  console.log('Dashboard Module Verification passed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
