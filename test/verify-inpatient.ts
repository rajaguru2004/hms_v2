/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Inpatient Module Verification...');

  try {
    // 1. Authenticate / Login
    console.log('\n🔐 Logging in...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@hms.local',
        password: 'Admin@HMS2024!',
      }),
    });

    if (!loginRes.ok) {
      throw new Error(
        `Login failed: ${loginRes.status} ${await loginRes.text()}`,
      );
    }

    const loginData = await loginRes.json();
    const token = loginData.data?.accessToken;
    if (!token) {
      throw new Error('Access token not found in response');
    }
    console.log('✅ Logged in successfully.');

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Create Patient (required for admission connect)
    console.log('\n👤 Creating test patient...');
    const patientRes = await fetch(`${BASE_URL}/patients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Alice',
        lastName: 'Smith',
        dateOfBirth: '1995-05-15',
        gender: 'female',
      }),
    });

    if (!patientRes.ok) {
      throw new Error(
        `Patient creation failed: ${patientRes.status} ${await patientRes.text()}`,
      );
    }

    const patientData = await patientRes.json();
    const patientId = patientData.data.id;
    console.log(`✅ Patient created. ID: ${patientId}`);

    // 3. Create Ward (Compatibility Route)
    console.log('\n🏢 Creating ward (Compatibility Route)...');
    const wardRes = await fetch(`${BASE_URL}/inpatient`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'ward',
        name: 'ICU Ward B',
        code: 'ICU-B',
        type: 'icu',
        capacity: 10,
      }),
    });

    if (!wardRes.ok) {
      throw new Error(
        `Ward creation failed: ${wardRes.status} ${await wardRes.text()}`,
      );
    }

    const wardData = await wardRes.json();
    const wardId = wardData.data.id;
    console.log(`✅ Ward created. ID: ${wardId}, Capacity: ${wardData.data.capacity}`);

    // 4. Create Bed (Compatibility Route)
    console.log('\n🛏️ Creating bed (Compatibility Route)...');
    const bedRes = await fetch(`${BASE_URL}/inpatient`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'bed',
        wardId,
        bedNumber: 'ICU-B01',
        type: 'icu',
        status: 'available',
      }),
    });

    if (!bedRes.ok) {
      throw new Error(
        `Bed creation failed: ${bedRes.status} ${await bedRes.text()}`,
      );
    }

    const bedData = await bedRes.json();
    const bedId = bedData.data.id;
    console.log(`✅ Bed created. ID: ${bedId}, Number: ${bedData.data.bedNumber}`);

    // 5. Query Beds (Compatibility Route)
    console.log('\n🔍 Fetching beds...');
    const getBedsRes = await fetch(
      `${BASE_URL}/inpatient?resource=beds&wardId=${wardId}&status=available`,
      { headers },
    );

    if (!getBedsRes.ok) {
      throw new Error(`Failed to fetch beds: ${getBedsRes.status}`);
    }

    const getBedsData = await getBedsRes.json();
    const foundBed = getBedsData.data.find((b: any) => b.id === bedId);
    if (!foundBed) {
      throw new Error('Created bed was not found in the list');
    }
    console.log(`✅ Found available bed: ${foundBed.bedNumber}`);

    // 6. Create Admission (Compatibility Route)
    console.log('\n🤒 Admitting patient (Compatibility Route)...');
    const admissionRes = await fetch(`${BASE_URL}/inpatient`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'admission',
        patientId,
        bedId,
        admissionType: 'emergency',
        admissionReason: 'Acute cardiac arrest',
      }),
    });

    if (!admissionRes.ok) {
      throw new Error(
        `Admission failed: ${admissionRes.status} ${await admissionRes.text()}`,
      );
    }

    const admissionData = await admissionRes.json();
    const admissionId = admissionData.data.id;
    console.log(
      `✅ Patient admitted. Admission ID: ${admissionId}, Status: ${admissionData.data.status}`,
    );

    // 7. Check Bed Status (Should be occupied now)
    console.log('\n🔍 Re-checking bed status...');
    const reCheckBedsRes = await fetch(
      `${BASE_URL}/inpatient?resource=beds&wardId=${wardId}`,
      { headers },
    );
    if (!reCheckBedsRes.ok) {
      throw new Error(`Failed to fetch beds: ${reCheckBedsRes.status}`);
    }
    const reCheckBedsData = await reCheckBedsRes.json();
    const checkedBed = reCheckBedsData.data.find((b: any) => b.id === bedId);
    if (!checkedBed || checkedBed.status !== 'occupied') {
      throw new Error('Bed status did not transition to occupied!');
    }
    console.log(`✅ Bed status verified as: ${checkedBed.status}`);

    // 8. Fetch Ward Occupancy Stats (Compatibility Route)
    console.log('\n📊 Fetching wards list with occupancy...');
    const getWardsRes = await fetch(`${BASE_URL}/inpatient?resource=wards`, { headers });
    if (!getWardsRes.ok) {
      throw new Error(`Failed to fetch wards: ${getWardsRes.status}`);
    }
    const getWardsData = await getWardsRes.json();
    const targetWard = getWardsData.data.find((w: any) => w.id === wardId);
    if (!targetWard) {
      throw new Error('Target ward not found in occupancy list');
    }
    console.log(`✅ Ward stats:
    - Occupied Beds: ${targetWard.occupiedBeds}
    - Available Beds: ${targetWard.availableBeds}
    - Occupancy Rate: ${targetWard.occupancyRate}%`);

    // 9. Fetch Inpatient Stats (Compatibility Route)
    console.log('\n📈 Fetching inpatient stats...');
    const statsRes = await fetch(`${BASE_URL}/inpatient?resource=stats`, { headers });
    if (!statsRes.ok) {
      throw new Error(`Failed to fetch stats: ${statsRes.status}`);
    }
    const statsData = await statsRes.json();
    console.log(`✅ Inpatient Stats:
    - Total Beds: ${statsData.data.totalBeds}
    - Occupied Beds: ${statsData.data.occupiedBeds}
    - Available Beds: ${statsData.data.availableBeds}
    - Today Admissions: ${statsData.data.todayAdmissions}
    - Today Discharges: ${statsData.data.todayDischarges}
    - Occupancy Rate: ${statsData.data.occupancyRate}%`);

    // 10. Discharge Patient (Compatibility Route - PATCH)
    console.log('\n🚪 Discharging patient (Compatibility Route - PATCH)...');
    const dischargeRes = await fetch(`${BASE_URL}/inpatient`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        resource: 'admission',
        id: admissionId,
        status: 'discharged',
        dischargeReason: 'Cured',
        dischargeSummary: 'Patient discharged in stable condition.',
      }),
    });

    if (!dischargeRes.ok) {
      throw new Error(
        `Discharge failed: ${dischargeRes.status} ${await dischargeRes.text()}`,
      );
    }

    const dischargeData = await dischargeRes.json();
    console.log(
      `✅ Patient discharged. New status: ${dischargeData.data.status}, Discharge Date: ${dischargeData.data.dischargeDate}`,
    );

    // 11. Check Bed is Free Again
    console.log('\n🔍 Final bed status check...');
    const finalBedRes = await fetch(
      `${BASE_URL}/inpatient?resource=beds&wardId=${wardId}`,
      { headers },
    );
    if (!finalBedRes.ok) {
      throw new Error(`Failed to fetch beds: ${finalBedRes.status}`);
    }
    const finalBedData = await finalBedRes.json();
    const finalBed = finalBedData.data.find((b: any) => b.id === bedId);
    if (!finalBed || finalBed.status !== 'available') {
      throw new Error('Bed status was not released to available!');
    }
    console.log(`✅ Bed status released successfully: ${finalBed.status}`);

    console.log(
      '\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS INPATIENT MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
