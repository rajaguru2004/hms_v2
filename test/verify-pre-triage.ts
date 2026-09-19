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

    // 6. A routed screening has already been registered and queued
    //
    // `create` auto-registers the patient and puts them on the board whenever
    // `routedTo` is set, which is what routing a walk-in means: the clerk who
    // routes them is not then expected to press "register" as a second step.
    // This section used to call `/convert` here and expect 200; that stopped
    // being the contract when routing grew the auto-registration, and the
    // check failed as PRE_TRIAGE_ALREADY_CONVERTED — the server disagreeing
    // with the test, correctly. What is worth asserting is the handover
    // itself: a patient record exists, the screening points at it, and the
    // patient is on the queue for the area they were routed to.
    console.log(
      '\n👤 Verifying the routed screening auto-registered a patient...',
    );
    const routedRes = await fetch(`${BASE_URL}/pre-triage/${screeningId}`, {
      headers,
    });
    const routedData = await routedRes.json();
    const patientId = routedData.data.patientId;
    if (!patientId) {
      throw new Error(
        'A screening routed to adult_triage did not auto-register a patient',
      );
    }
    console.log(`✅ Auto-registered patient ID: ${patientId}`);

    console.log('\n🔍 Verifying the patient is on the queue...');
    // The board has no patientId filter - `QueueQueryDto` takes serviceArea,
    // status, page, limit and ordering, and nothing else - so the row is found
    // by reading one large page and looking. `limit` is capped at 200 by the
    // DTO, which is also what is asked for here.
    const queueRes = await fetch(`${BASE_URL}/queue?limit=200`, { headers });
    if (!queueRes.ok) {
      throw new Error(`Failed to read the queue: ${queueRes.status}`);
    }
    const queueData = await queueRes.json();
    const entry = (queueData.data?.data ?? []).find(
      (q: any) => q.patientId === patientId,
    );
    if (!entry) {
      throw new Error('Routed patient never reached the queue');
    }
    console.log(
      `✅ On the queue as ${entry.queueNumber} in ${entry.serviceArea}`,
    );

    console.log('\n🚫 Verifying a second conversion is refused...');
    const reconvertRes = await fetch(
      `${BASE_URL}/pre-triage/${screeningId}/convert`,
      { method: 'POST', headers },
    );
    if (reconvertRes.status !== 409) {
      throw new Error(
        `Expected 409 for an already-registered screening, got ${reconvertRes.status}`,
      );
    }
    console.log('✅ Refused with 409, as it should be.');

    // 6b. An unrouted screening still converts by hand
    //
    // The manual door is the one a screening that was never routed goes
    // through, and it is the path that sets `registered_as_patient`. Routing
    // leaves the status at `routed` because the screening is still a screening
    // — the difference is worth holding onto, so both are covered.
    console.log('\n🏥 Creating an unrouted screening to convert by hand...');
    const manualCreateRes = await fetch(`${BASE_URL}/pre-triage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Unrouted',
        age: 41,
        gender: 'male',
        phone: '+251922334466',
        chiefComplaint: 'Ankle pain after a fall',
        briefHistory: 'Tripped on a kerb this morning.',
      }),
    });
    if (!manualCreateRes.ok) {
      throw new Error(
        `Unrouted screening creation failed: ${manualCreateRes.status} ${await manualCreateRes.text()}`,
      );
    }
    const manualId = (await manualCreateRes.json()).data.id;

    const convertRes = await fetch(
      `${BASE_URL}/pre-triage/${manualId}/convert`,
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
    const manualPatientId = convertData.data.patientId;
    const mrn = convertData.data.mrn;
    console.log(
      `✅ Conversion successful. Registered Patient ID: ${manualPatientId}, MRN: ${mrn}`,
    );

    // Verify screening status update
    console.log('\n🔍 Verifying screening status updated after conversion...');
    const verifyStatusRes = await fetch(`${BASE_URL}/pre-triage/${manualId}`, {
      headers,
    });
    const verifyStatusData = await verifyStatusRes.json();
    if (
      verifyStatusData.data.status !== 'registered_as_patient' ||
      verifyStatusData.data.patientId !== manualPatientId
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
    const patientRes = await fetch(`${BASE_URL}/patients/${manualPatientId}`, {
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
