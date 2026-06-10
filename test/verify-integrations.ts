/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Integrations Module Verification...');

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

    // 2. Create Patient (required for patient matcher test)
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
    const testMrn = patientData.data.mrn;
    console.log(`✅ Patient created. ID: ${patientId}, MRN: ${testMrn}`);

    // 3. Register Machine Integration
    console.log('\n⚙️ Registering machine integration...');
    const machineRes = await fetch(`${BASE_URL}/integrations/machines`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        machineName: 'Sysmex Verification X1',
        machineType: 'lab_analyzer',
        connectionType: 'file_upload',
        manufacturer: 'Sysmex',
        model: 'X1',
        serialNumber: `SN-${Date.now()}`,
        department: 'laboratory',
        connectionDetails: { source: 'manual-upload-verification' },
        testMapping: { WBC: 'wbc-test-id' },
      }),
    });

    if (!machineRes.ok) {
      throw new Error(
        `Machine registration failed: ${machineRes.status} ${await machineRes.text()}`,
      );
    }

    const machineData = await machineRes.json();
    const machineId = machineData.data.id;
    console.log(`✅ Machine integration created. ID: ${machineId}`);

    // 4. Fetch Machine Integrations
    console.log('\n🔍 Fetching all machine integrations...');
    const machinesListRes = await fetch(`${BASE_URL}/integrations/machines`, {
      headers,
    });
    if (!machinesListRes.ok) {
      throw new Error(
        `Failed to fetch machines list: ${machinesListRes.status}`,
      );
    }
    const machinesListData = await machinesListRes.json();
    const foundMachine = machinesListData.data.find(
      (m: any) => m.id === machineId,
    );
    if (!foundMachine) {
      throw new Error('Created machine was not found in the list');
    }
    console.log(`✅ Found machine in list: ${foundMachine.machineName}`);

    // 5. Fetch Single Machine Integration Details
    console.log(`\n🔍 Fetching details for machine ID: ${machineId}...`);
    const machineDetailsRes = await fetch(
      `${BASE_URL}/integrations/machines/${machineId}`,
      { headers },
    );
    if (!machineDetailsRes.ok) {
      throw new Error(
        `Failed to fetch machine details: ${machineDetailsRes.status}`,
      );
    }
    const machineDetailsData = await machineDetailsRes.json();
    console.log(
      `✅ Machine details read. Status: ${machineDetailsData.data.connectionStatus}`,
    );

    // 6. Upload Mock CSV results file
    console.log('\n📤 Uploading results CSV file...');
    const fileContent = `Patient ID,Patient Name,Test Code,Test Name,Result,Unit,Reference Range,Date
${testMrn},Alice Smith,WBC,White Blood Cell,7.5,10^9/L,4.0-11.0,2026-06-10T12:00:00Z
PT-UNKNOWN-999,Unknown Patient,RBC,Red Blood Cell,4.5,10^12/L,4.3-5.9,2026-06-10T12:00:00Z`;

    const formData = new FormData();
    const blob = new Blob([fileContent], { type: 'text/csv' });
    formData.append('file', blob, 'verification_results.csv');
    formData.append('machineIntegrationId', machineId);

    const uploadRes = await fetch(`${BASE_URL}/integrations/results/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error(
        `Results upload failed: ${uploadRes.status} ${await uploadRes.text()}`,
      );
    }

    const uploadData = await uploadRes.json();
    const matchedCount = uploadData.data.matchedCount;
    console.log(`✅ Results file processed successfully:
    - Total Rows: ${uploadData.data.totalRows}
    - Parsed Rows: ${uploadData.data.parsedRows}
    - Matched Success (Alice Smith): ${matchedCount.success}
    - Matched Failed (Unknown Patient): ${matchedCount.failed}`);

    if (matchedCount.success !== 1 || matchedCount.failed !== 1) {
      throw new Error(
        'Patient matching counts do not align with expected mock results',
      );
    }

    // 7. Verify Results Queue
    console.log('\n🔍 Verifying results queue...');
    const queueRes = await fetch(
      `${BASE_URL}/integrations/results-queue?machineId=${machineId}`,
      { headers },
    );
    if (!queueRes.ok) {
      throw new Error(`Failed to fetch results queue: ${queueRes.status}`);
    }
    const queueData = await queueRes.json();

    const matchedRecord = queueData.data.find(
      (r: any) => r.patientIdentifier === testMrn,
    );
    const failedRecord = queueData.data.find(
      (r: any) => r.patientIdentifier === 'PT-UNKNOWN-999',
    );

    if (!matchedRecord) {
      throw new Error('Matched patient record not found in queue');
    }
    if (
      matchedRecord.status !== 'matched' ||
      matchedRecord.matchedPatientId !== patientId
    ) {
      throw new Error(
        `Matched record status or patient ID incorrect. Status: ${matchedRecord.status}`,
      );
    }
    console.log(
      `✅ Verified matched record: patient identifier = ${matchedRecord.patientIdentifier}, status = ${matchedRecord.status}`,
    );

    if (!failedRecord) {
      throw new Error('Failed patient record not found in queue');
    }
    if (failedRecord.status !== 'failed') {
      throw new Error(
        `Failed record status incorrect. Status: ${failedRecord.status}`,
      );
    }
    console.log(
      `✅ Verified failed record: patient identifier = ${failedRecord.patientIdentifier}, status = ${failedRecord.status}`,
    );

    // 8. Update Machine Integration Configuration (PATCH)
    console.log('\n🔧 Updating machine connection status (PATCH)...');
    const updateRes = await fetch(
      `${BASE_URL}/integrations/machines/${machineId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          connectionStatus: 'connected',
        }),
      },
    );

    if (!updateRes.ok) {
      throw new Error(
        `Machine update failed: ${updateRes.status} ${await updateRes.text()}`,
      );
    }
    const updateData = await updateRes.json();
    console.log(
      `✅ Machine status updated to: ${updateData.data.connectionStatus}`,
    );

    // 9. Delete Machine Integration
    console.log(
      `\n🧹 Cleaning up: deleting machine integration ID: ${machineId}...`,
    );
    const deleteRes = await fetch(
      `${BASE_URL}/integrations/machines/${machineId}`,
      {
        method: 'DELETE',
        headers,
      },
    );

    if (!deleteRes.ok) {
      throw new Error(
        `Failed to delete machine integration: ${deleteRes.status}`,
      );
    }
    console.log('✅ Machine integration deleted.');

    console.log(
      '\n🎉 ALL INTEGRATIONS VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS INTEGRATIONS MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
