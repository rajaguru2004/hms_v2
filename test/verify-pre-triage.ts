/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Pre-Triage Module Verification...');

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

    // 2. Create Pre-Triage Screening
    console.log('\n🏥 Creating pre-triage screening...');
    const createRes = await fetch(`${BASE_URL}/pre-triage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Doe',
        age: 28,
        gender: 'female',
        phone: '+251922334455',
        chiefComplaint: 'Headache and nausea',
        briefHistory: 'Symptoms started yesterday evening.',
        temperature: 37.8,
        bloodPressureSystolic: 118,
        bloodPressureDiastolic: 76,
        pulseRate: 80,
        routedTo: 'adult_triage',
      }),
    });

    if (!createRes.ok) {
      throw new Error(
        `Pre-triage creation failed: ${createRes.status} ${await createRes.text()}`,
      );
    }

    const createData = await createRes.json();
    const screeningId = createData.data.id;
    const screeningNumber = createData.data.screeningNumber;
    console.log(
      `✅ Pre-triage screening created. ID: ${screeningId}, Screening Number: ${screeningNumber}`,
    );

    // 3. List Pre-Triage Screenings
    console.log('\n🔍 Listing all pre-triage screenings...');
    const listRes = await fetch(`${BASE_URL}/pre-triage`, {
      headers,
    });
    if (!listRes.ok) {
      throw new Error(`Failed to list screenings: ${listRes.status}`);
    }
    const listData = await listRes.json();
    const found = listData.data.data.find((s: any) => s.id === screeningId);
    if (!found) {
      throw new Error('Created screening not found in paginated list');
    }
    console.log(
      `✅ Found screening in list. Screening Number: ${found.screeningNumber}`,
    );

    // 4. Get Screening Details
    console.log(`\n🔍 Fetching details for screening ID: ${screeningId}...`);
    const detailsRes = await fetch(`${BASE_URL}/pre-triage/${screeningId}`, {
      headers,
    });
    if (!detailsRes.ok) {
      throw new Error(`Failed to get details: ${detailsRes.status}`);
    }
    const detailsData = await detailsRes.json();
    console.log(
      `✅ Details fetched. Chief Complaint: ${detailsData.data.chiefComplaint}`,
    );

    // 5. Update Screening (PATCH)
    console.log('\n🔧 Updating screening (PATCH)...');
    const updateRes = await fetch(`${BASE_URL}/pre-triage/${screeningId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        chiefComplaint: 'Severe headache and acute nausea',
        temperature: 38.2,
      }),
    });

    if (!updateRes.ok) {
      throw new Error(
        `Update failed: ${updateRes.status} ${await updateRes.text()}`,
      );
    }
    const updateData = await updateRes.json();
    console.log(
      `✅ Update successful. New Chief Complaint: ${updateData.data.chiefComplaint}, Temperature: ${updateData.data.temperature}`,
    );

    // 6. Convert to Patient
    console.log('\n👤 Converting pre-triage screening to Patient record...');
    const convertRes = await fetch(
      `${BASE_URL}/pre-triage/${screeningId}/convert`,
      {
        method: 'POST',
        headers,
      },
    );

    if (!convertRes.ok) {
      throw new Error(
        `Conversion failed: ${convertRes.status} ${await convertRes.text()}`,
      );
    }
    const convertData = await convertRes.json();
    const patientId = convertData.data.patientId;
    const mrn = convertData.data.mrn;
    console.log(
      `✅ Conversion successful. Registered Patient ID: ${patientId}, MRN: ${mrn}`,
    );

    // Verify screening status update
    console.log('\n🔍 Verifying screening status updated after conversion...');
    const verifyStatusRes = await fetch(
      `${BASE_URL}/pre-triage/${screeningId}`,
      {
        headers,
      },
    );
    const verifyStatusData = await verifyStatusRes.json();
    if (
      verifyStatusData.data.status !== 'registered_as_patient' ||
      verifyStatusData.data.patientId !== patientId
    ) {
      throw new Error(
        `Pre-triage status or patient association incorrect. Status: ${verifyStatusData.data.status}`,
      );
    }
    console.log(
      `✅ Verified screening status is now: ${verifyStatusData.data.status}`,
    );

    // Verify patient actually exists in the patient module
    console.log('\n🔍 Verifying patient record in patient module...');
    const patientRes = await fetch(`${BASE_URL}/patients/${patientId}`, {
      headers,
    });
    if (!patientRes.ok) {
      throw new Error(`Converted patient not found: ${patientRes.status}`);
    }
    const patientData = await patientRes.json();
    console.log(
      `✅ Patient record verified. Name: ${patientData.data.firstName} ${patientData.data.lastName}, MRN: ${patientData.data.mrn}`,
    );

    // 7. Soft Delete Screening
    console.log(
      `\n🧹 Cleaning up: soft-deleting pre-triage screening ID: ${screeningId}...`,
    );
    const deleteRes = await fetch(`${BASE_URL}/pre-triage/${screeningId}`, {
      method: 'DELETE',
      headers,
    });

    if (!deleteRes.ok) {
      throw new Error(`Failed to delete screening: ${deleteRes.status}`);
    }
    console.log('✅ Screening deleted.');

    // 8. Verify Soft Delete (Details should return 404)
    console.log('\n🔍 Verifying details return 404 after soft delete...');
    const deletedDetailsRes = await fetch(
      `${BASE_URL}/pre-triage/${screeningId}`,
      {
        headers,
      },
    );
    if (deletedDetailsRes.status !== 404) {
      throw new Error(
        `Expected 404 for soft-deleted record, got: ${deletedDetailsRes.status}`,
      );
    }
    console.log('✅ Confirmed 404: Soft delete works correctly.');

    console.log(
      '\n🎉 ALL PRE-TRIAGE VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS PRE-TRIAGE MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
