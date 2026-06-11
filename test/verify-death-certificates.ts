/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Death Certificates Module Verification...');

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

    // Decode JWT token payload to retrieve authenticated user ID
    const payloadBase64 = token.split('.')[1];
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    const jwtPayload = JSON.parse(payloadJson);
    const userId = jwtPayload.sub;
    if (!userId) {
      throw new Error('User ID (sub) not found in JWT payload');
    }
    console.log(`👤 Decoded User ID: ${userId}`);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Create Patient (Required dependency)
    console.log('\n👤 Creating test patient...');
    const patientRes = await fetch(`${BASE_URL}/patients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1970-01-01',
        gender: 'male',
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

    // 3. Create Death Certificate
    console.log('\n📝 Creating death certificate...');
    const createRes = await fetch(`${BASE_URL}/death-certificates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        dateOfDeath: '2026-06-11',
        timeOfDeath: '14:30',
        placeOfDeath: 'inpatient',
        locationDetails: 'ICU Bed 3',
        ageAtDeathYears: 56,
        sex: 'male',
        maritalStatus: 'married',
        occupation: 'Engineer',
        address: 'Addis Ababa, Ethiopia',
        immediateCause: 'Cardiopulmonary arrest',
        antecedentCauseB: 'Myocardial infarction',
        antecedentCauseC: 'Coronary artery disease',
        mannerOfDeath: 'natural',
        autopsyPerformed: false,
        isMaternalDeath: false,
        certifiedById: userId,
        certifierQualification: 'MD, Cardiologist',
        licenseNumber: 'LIC-998877',
      }),
    });

    if (!createRes.ok) {
      throw new Error(
        `Death certificate creation failed: ${createRes.status} ${await createRes.text()}`,
      );
    }

    const createData = await createRes.json();
    const certificate = createData.data;
    const certificateId = certificate.id;
    const certificateNumber = certificate.certificateNumber;
    console.log(
      `✅ Death certificate created. ID: ${certificateId}, Number: ${certificateNumber}`,
    );

    // 4. List and Search Death Certificates
    console.log('\n🔍 Searching death certificates by number...');
    const listRes = await fetch(
      `${BASE_URL}/death-certificates?search=${certificateNumber}`,
      { headers },
    );
    if (!listRes.ok) {
      throw new Error(`Failed to list/search certificates: ${listRes.status}`);
    }
    const listData = await listRes.json();
    const foundCertificate = listData.data.find(
      (c: any) => c.id === certificateId,
    );
    if (!foundCertificate) {
      throw new Error('Created death certificate not found in list search');
    }
    console.log(
      `✅ Found certificate in list. Number: ${foundCertificate.certificateNumber}`,
    );

    // 5. Get Certificate Details
    console.log(
      `\n🔍 Fetching details for certificate ID: ${certificateId}...`,
    );
    const detailsRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}`,
      {
        headers,
      },
    );
    if (!detailsRes.ok) {
      throw new Error(`Failed to get details: ${detailsRes.status}`);
    }
    const detailsData = await detailsRes.json();
    console.log(
      `✅ Details fetched. Immediate Cause: ${detailsData.data.immediateCause}`,
    );

    // 6. Update Death Certificate
    console.log('\n🔧 Updating death certificate (PATCH)...');
    const updateRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          immediateCause: 'Acute cardiopulmonary failure',
          otherConditions: 'Type 2 Diabetes',
        }),
      },
    );

    if (!updateRes.ok) {
      throw new Error(
        `Update failed: ${updateRes.status} ${await updateRes.text()}`,
      );
    }
    const updateData = await updateRes.json();
    console.log(
      `✅ Update successful. New Immediate Cause: ${updateData.data.immediateCause}`,
    );

    // 7. Record Certificate Issuance
    console.log('\n✉️ Recording certificate issuance...');
    const issueRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}/issue`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          issuedTo: 'Mary Doe',
          issuedToRelationship: 'Spouse',
          issuedToNationalId: 'NID-11223344',
          issuedById: userId,
        }),
      },
    );

    if (!issueRes.ok) {
      throw new Error(
        `Issuance failed: ${issueRes.status} ${await issueRes.text()}`,
      );
    }
    const issueData = await issueRes.json();
    console.log(
      `✅ Issuance recorded successfully. Issued To: ${issueData.data.issuedTo}`,
    );

    // 8. Verify Print HTML View
    console.log('\n🖨️ Verifying print HTML view...');
    const printRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}/print`,
      { headers },
    );
    if (!printRes.ok) {
      throw new Error(`Print view failed: ${printRes.status}`);
    }
    const printHtml = await printRes.text();
    if (
      !printHtml.includes('<title>Death Certificate') ||
      !printHtml.includes('Mary Doe')
    ) {
      throw new Error(
        'Print view HTML does not contain expected certificate data',
      );
    }
    console.log('✅ Print HTML view verified successfully.');

    // 9. Delete Death Certificate
    console.log(
      `\n🧹 Cleaning up: deleting death certificate ID: ${certificateId}...`,
    );
    const deleteRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}`,
      {
        method: 'DELETE',
        headers,
      },
    );

    if (!deleteRes.ok) {
      throw new Error(`Failed to delete certificate: ${deleteRes.status}`);
    }
    console.log('✅ Death certificate deleted.');

    // 10. Verify Delete (Details should return 404)
    console.log('\n🔍 Verifying details return 404 after deletion...');
    const deletedDetailsRes = await fetch(
      `${BASE_URL}/death-certificates/${certificateId}`,
      { headers },
    );
    if (deletedDetailsRes.status !== 404) {
      throw new Error(
        `Expected 404 for deleted record, got: ${deletedDetailsRes.status}`,
      );
    }
    console.log('✅ Confirmed 404: Delete works correctly.');

    // 11. Clean up Patient
    console.log(`\n🧹 Cleaning up: deleting patient ID: ${patientId}...`);
    const deletePatientRes = await fetch(`${BASE_URL}/patients/${patientId}`, {
      method: 'DELETE',
      headers,
    });
    if (deletePatientRes.ok) {
      console.log('✅ Patient deleted successfully.');
    } else {
      console.warn(
        `⚠️ Warning: Failed to delete patient: ${deletePatientRes.status}`,
      );
    }

    console.log(
      '\n🎉 ALL DEATH CERTIFICATES VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
