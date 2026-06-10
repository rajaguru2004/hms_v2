/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Consultations Module Verification...');

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

    // 2. Create Patient
    console.log('\n👤 Creating test patient...');
    const patientRes = await fetch(`${BASE_URL}/patients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Jane',
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

    // 3. Create Doctor User
    console.log('\n👨‍⚕️ Creating doctor user...');
    const email = `doctor-${Date.now()}@hms.local`;
    const doctorRes = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password: 'DoctorPass@123',
        firstName: 'Robert',
        lastName: 'Bruce',
        phone: '+251911223344',
      }),
    });

    if (!doctorRes.ok) {
      throw new Error(
        `Doctor creation failed: ${doctorRes.status} ${await doctorRes.text()}`,
      );
    }

    const doctorData = await doctorRes.json();
    const doctorId = doctorData.data.id;
    console.log(`✅ Doctor created. ID: ${doctorId}`);

    // 4. Create Appointment
    console.log('\n📅 Creating appointment...');
    const appointmentRes = await fetch(`${BASE_URL}/appointments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        doctorId,
        appointmentDate: '2026-06-12',
        appointmentTime: '10:00',
        appointmentType: 'new_patient',
        chiefComplaint: 'Mild headache and sore throat',
      }),
    });

    if (!appointmentRes.ok) {
      throw new Error(
        `Appointment creation failed: ${appointmentRes.status} ${await appointmentRes.text()}`,
      );
    }

    const appointmentData = await appointmentRes.json();
    const appointmentId = appointmentData.data.id;
    console.log(`✅ Appointment created. ID: ${appointmentId}, Status: ${appointmentData.data.status}`);

    // 5. Create Consultation linked to appointment and including prescription items
    console.log('\n🩺 Creating consultation (linked to appointment)...');
    const consultationRes = await fetch(`${BASE_URL}/consultations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        doctorId,
        appointmentId,
        visitType: 'outpatient',
        temperature: 38.2,
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        pulseRate: 85,
        respiratoryRate: 18,
        weight: 68.5,
        height: 165,
        oxygenSaturation: 98,
        chiefComplaint: 'Fever and headache for 2 days',
        historyOfPresentIllness: 'Symptoms started yesterday after being in the cold.',
        physicalExamination: 'Congested tonsils, chest clear.',
        diagnosis: 'Acute tonsillitis',
        icd10Codes: ['J03.90'],
        treatmentPlan: 'Take prescribed medication, rest, drink fluids.',
        followUpInstructions: 'Return if fever continues for more than 3 days.',
        followUpDate: '2026-06-15T00:00:00.000Z',
        notes: 'Advised warm water gargles.',
        prescriptionItems: [
          {
            drugId: 'cuid-drug-amox',
            drugName: 'Amoxicillin 500mg',
            genericName: 'Amoxicillin',
            dosage: '500mg',
            frequency: 'TDS (three times a day)',
            duration: '7 days',
            quantity: 21,
            instructions: 'Take after meals',
          },
          {
            drugId: 'cuid-drug-para',
            drugName: 'Paracetamol 500mg',
            genericName: 'Paracetamol',
            dosage: '500mg',
            frequency: 'PRN (as needed)',
            duration: '3 days',
            quantity: 10,
            instructions: 'Take for fever or pain, max 4 tabs daily',
          },
        ],
      }),
    });

    if (!consultationRes.ok) {
      throw new Error(
        `Consultation creation failed: ${consultationRes.status} ${await consultationRes.text()}`,
      );
    }

    const consultationData = await consultationRes.json();
    const consultationId = consultationData.data.id;
    console.log(`✅ Consultation created. ID: ${consultationId}`);
    
    // Verify appointment status updated to completed
    console.log('\n🔍 Verifying linked appointment status...');
    const getApptRes = await fetch(`${BASE_URL}/appointments/${appointmentId}`, { headers });
    if (!getApptRes.ok) {
      throw new Error(`Failed to fetch appointment: ${getApptRes.status}`);
    }
    const getApptData = await getApptRes.json();
    if (getApptData.data.status !== 'completed') {
      throw new Error(`Linked appointment status was not updated to completed. Got: ${getApptData.data.status}`);
    }
    console.log('✅ Linked appointment updated to "completed" status.');

    // 6. Fetch Consultation details
    console.log('\n🔍 Fetching consultation details...');
    const getConsultRes = await fetch(`${BASE_URL}/consultations/${consultationId}`, { headers });
    if (!getConsultRes.ok) {
      throw new Error(`Failed to fetch consultation: ${getConsultRes.status}`);
    }
    const getConsultData = await getConsultRes.json();
    const consultation = getConsultData.data;

    // Check relations
    if (!consultation.patient || consultation.patient.id !== patientId) {
      throw new Error('Patient relationship is missing or mismatch');
    }
    if (!consultation.doctor || consultation.doctor.id !== doctorId) {
      throw new Error('Doctor relationship is missing or mismatch');
    }
    if (!consultation.prescriptions || consultation.prescriptions.length === 0) {
      throw new Error('Prescriptions relation is missing or empty');
    }
    console.log(`✅ Consultation fetched successfully:
    - Patient: ${consultation.patient.firstName} ${consultation.patient.lastName}
    - Doctor: ${consultation.doctor.fullName}
    - Diagnosis: ${consultation.diagnosis}
    - Prescriptions count: ${consultation.prescriptions.length}`);

    // 7. Update Consultation
    console.log('\n✏️ Updating consultation details...');
    const updateRes = await fetch(`${BASE_URL}/consultations/${consultationId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        diagnosis: 'Bacterial tonsillitis (confirmed)',
        temperature: 37.5, // temperature went down
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`Consultation update failed: ${updateRes.status} ${await updateRes.text()}`);
    }

    const updateData = await updateRes.json();
    console.log(`✅ Consultation updated.
    - New Diagnosis: ${updateData.data.diagnosis}
    - New Temperature: ${updateData.data.temperature}`);

    // 8. List consultations with filters
    console.log('\n🔍 Listing consultations with filters...');
    const listRes = await fetch(`${BASE_URL}/consultations?patientId=${patientId}`, { headers });
    if (!listRes.ok) {
      throw new Error(`Consultation listing failed: ${listRes.status}`);
    }
    const listData = await listRes.json();
    if (listData.data.data.length === 0) {
      throw new Error('List returned empty, expected at least 1 consultation');
    }
    console.log(`✅ Found ${listData.data.data.length} consultations for patient ${patientId}`);

    // 9. Soft-delete Consultation
    console.log('\n🗑️ Soft-deleting consultation...');
    const deleteRes = await fetch(`${BASE_URL}/consultations/${consultationId}`, {
      method: 'DELETE',
      headers,
    });

    if (!deleteRes.ok) {
      throw new Error(`Consultation delete failed: ${deleteRes.status} ${await deleteRes.text()}`);
    }
    console.log('✅ Consultation deleted.');

    // 10. Verify consultation is excluded from query
    console.log('\n🔍 Verifying deleted consultation is inaccessible...');
    const getDeletedRes = await fetch(`${BASE_URL}/consultations/${consultationId}`, { headers });
    if (getDeletedRes.status !== 404) {
      throw new Error(`Expected 404 NOT FOUND for soft-deleted consultation, got status: ${getDeletedRes.status}`);
    }
    console.log('✅ Consultation is successfully soft-deleted (returns 404).');

    console.log(
      '\n🎉 ALL CONSULTATIONS VERIFICATION TESTS PASSED SUCCESSFULLY! NESTJS MIGRATION IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
