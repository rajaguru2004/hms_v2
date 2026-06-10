/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Pharmacy Module Verification...');

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

    // Decode JWT token to get doctor/user ID (sub)
    const payloadPart = token.split('.')[1];
    const decodedPayload = JSON.parse(
      Buffer.from(payloadPart, 'base64').toString(),
    );
    const doctorId = decodedPayload.sub;
    if (!doctorId) {
      throw new Error('User ID (sub) not found in JWT token');
    }
    console.log(`👤 Decoded User ID from token: ${doctorId}`);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Create Patient (required for prescriptions & sales)
    console.log('\n👤 Creating test patient...');
    const patientRes = await fetch(`${BASE_URL}/patients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1992-05-15',
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

    // =========================================================================
    // PART 1: TEST COMPATIBILITY MULTIPLEXED ENDPOINTS
    // =========================================================================

    // 3. Create Drug (Compatibility Route)
    console.log('\n💊 Creating pharmacy drug (Compatibility Route)...');
    const drugRes = await fetch(`${BASE_URL}/pharmacy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'drug',
        drugName: 'Aspirin Test',
        genericName: 'Acetylsalicylic Acid',
        brandName: 'Bayer',
        drugCode: 'ASP-VERIFY',
        drugCategory: 'analgesic',
        dosageForm: 'tablet',
        strength: '325mg',
        quantityInStock: 200,
        reorderLevel: 20,
        sellingPrice: 4.5,
        costPrice: 2.0,
      }),
    });

    if (!drugRes.ok) {
      throw new Error(
        `Drug creation failed: ${drugRes.status} ${await drugRes.text()}`,
      );
    }

    const drugData = await drugRes.json();
    const drugId = drugData.data.id;
    console.log(`✅ Pharmacy Drug catalog entry created. ID: ${drugId}`);

    // 4. Query Pharmacy Drugs (Compatibility Route)
    console.log('\n🔍 Fetching pharmacy drugs...');
    const getDrugsRes = await fetch(
      `${BASE_URL}/pharmacy?resource=drugs&search=Aspirin`,
      {
        headers,
      },
    );

    if (!getDrugsRes.ok) {
      throw new Error(`Failed to fetch drugs: ${getDrugsRes.status}`);
    }

    const getDrugsData = await getDrugsRes.json();
    const foundDrug = getDrugsData.data.find((d: any) => d.id === drugId);
    if (!foundDrug) {
      throw new Error('Created drug was not found in the list');
    }
    console.log(
      `✅ Found drug: ${foundDrug.drugName} - $${foundDrug.sellingPrice} (In Stock: ${foundDrug.quantityInStock})`,
    );

    // 5. Create Prescription (Compatibility Route)
    console.log('\n📜 Creating prescription (Compatibility Route)...');
    const prescriptionRes = await fetch(`${BASE_URL}/pharmacy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'prescription',
        patientId,
        doctorId,
        items: [
          {
            drugId,
            drugName: 'Aspirin Test',
            dosage: '325mg',
            frequency: 'Once daily',
            duration: '30 days',
            quantity: 30,
            instructions: 'Take after meals',
          },
        ],
        notes: 'Take daily',
      }),
    });

    if (!prescriptionRes.ok) {
      throw new Error(
        `Prescription creation failed: ${prescriptionRes.status} ${await prescriptionRes.text()}`,
      );
    }

    const prescriptionData = await prescriptionRes.json();
    const prescriptionId = prescriptionData.data.id;
    console.log(
      `✅ Prescription created. ID: ${prescriptionId}, Status: ${prescriptionData.data.status}`,
    );

    // 6. Query Prescriptions (Compatibility Route)
    console.log('\n🔍 Fetching prescriptions...');
    const getPrescriptionsRes = await fetch(
      `${BASE_URL}/pharmacy?resource=prescriptions&status=pending`,
      {
        headers,
      },
    );

    if (!getPrescriptionsRes.ok) {
      throw new Error(
        `Failed to fetch prescriptions: ${getPrescriptionsRes.status}`,
      );
    }

    const getPrescriptionsData = await getPrescriptionsRes.json();
    const foundPrescription = getPrescriptionsData.data.find(
      (p: any) => p.id === prescriptionId,
    );
    if (!foundPrescription) {
      throw new Error('Created prescription was not found in the list');
    }
    console.log(
      `✅ Found prescription: ID: ${foundPrescription.id}, Status: ${foundPrescription.status}`,
    );

    // 7. Process Sale (Compatibility Route)
    console.log('\n💰 Processing sale (Compatibility Route)...');
    const saleRes = await fetch(`${BASE_URL}/pharmacy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'sale',
        patientId,
        prescriptionId,
        items: [
          {
            drugId,
            drugName: 'Aspirin Test',
            quantity: 30,
            unitPrice: 4.5,
            total: 135.0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      }),
    });

    if (!saleRes.ok) {
      throw new Error(
        `Sale execution failed: ${saleRes.status} ${await saleRes.text()}`,
      );
    }

    const saleData = await saleRes.json();
    const saleId = saleData.data.id;
    console.log(
      `✅ Pharmacy Sale completed. ID: ${saleId}, Total Amount: $${saleData.data.totalAmount}, Receipt: ${saleData.data.receiptNumber}`,
    );

    // 8. Query Pharmacy Sales (Compatibility Route)
    console.log('\n🔍 Fetching pharmacy sales...');
    const getSalesRes = await fetch(`${BASE_URL}/pharmacy?resource=sales`, {
      headers,
    });

    if (!getSalesRes.ok) {
      throw new Error(`Failed to fetch sales: ${getSalesRes.status}`);
    }

    const getSalesData = await getSalesRes.json();
    const foundSale = getSalesData.data.find((s: any) => s.id === saleId);
    if (!foundSale) {
      throw new Error('Completed sale was not found in the list');
    }
    console.log(
      `✅ Found sale: Receipt: ${foundSale.receiptNumber}, Amount: $${foundSale.totalAmount}`,
    );

    // 9. Verify Prescription status auto-updated to fully_dispensed
    console.log('\n🔍 Verifying prescription status change...');
    const getDispensedPresRes = await fetch(
      `${BASE_URL}/pharmacy?resource=prescriptions&status=fully_dispensed`,
      {
        headers,
      },
    );
    const getDispensedPresData = await getDispensedPresRes.json();
    const verifiedPres = getDispensedPresData.data.find(
      (p: any) => p.id === prescriptionId,
    );
    if (!verifiedPres) {
      throw new Error(
        'Prescription was not marked as fully_dispensed after sale',
      );
    }
    console.log(
      '✅ Prescription status successfully updated to fully_dispensed.',
    );

    // 10. Verify Drug stock was decremented
    console.log('\n🔍 Verifying drug stock decrement...');
    const verifyStockRes = await fetch(
      `${BASE_URL}/pharmacy?resource=drugs&search=Aspirin`,
      {
        headers,
      },
    );
    const verifyStockData = await verifyStockRes.json();
    const stockDrug = verifyStockData.data.find((d: any) => d.id === drugId);
    if (!stockDrug) {
      throw new Error('Drug not found during stock verification');
    }
    if (stockDrug.quantityInStock !== 170) {
      throw new Error(
        `Stock decrement failed. Expected 170, got: ${stockDrug.quantityInStock}`,
      );
    }
    console.log(
      `✅ Drug stock successfully decremented from 200 to ${stockDrug.quantityInStock}.`,
    );

    // 11. Fetch Stats (Compatibility Route)
    console.log('\n📊 Fetching pharmacy stats...');
    const statsRes = await fetch(`${BASE_URL}/pharmacy?resource=stats`, {
      headers,
    });

    if (!statsRes.ok) {
      throw new Error(`Failed to fetch stats: ${statsRes.status}`);
    }

    const statsData = await statsRes.json();
    console.log(`✅ Pharmacy Stats:
    - Total Drugs in Catalog: ${statsData.data.totalDrugs}
    - Low Stock Items: ${statsData.data.lowStock}
    - Out of Stock Items: ${statsData.data.outOfStock}
    - Pending Prescriptions: ${statsData.data.pendingPrescriptions}
    - Today's Sales: $${statsData.data.todaySales}`);

    // 12. Patch drug catalog (Compatibility Route - PATCH)
    console.log(
      '\n🔧 Updating drug selling price (Compatibility Route - PATCH)...',
    );
    const patchDrugRes = await fetch(`${BASE_URL}/pharmacy`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        resource: 'drug',
        id: drugId,
        sellingPrice: 5.0,
      }),
    });

    if (!patchDrugRes.ok) {
      throw new Error(
        `Drug PATCH failed: ${patchDrugRes.status} ${await patchDrugRes.text()}`,
      );
    }
    const patchDrugData = await patchDrugRes.json();
    console.log(
      `✅ Drug selling price updated. New price: $${patchDrugData.data.sellingPrice}`,
    );

    // =========================================================================
    // PART 2: TEST ENHANCED RESTFUL ENDPOINTS
    // =========================================================================
    console.log('\n--- RESTful API endpoints verification ---');

    // 13. Create drug entry
    console.log('💊 Creating pharmacy drug (REST)...');
    const restDrugRes = await fetch(`${BASE_URL}/pharmacy/drugs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        drugName: 'Ibuprofen Test',
        genericName: 'Ibuprofen',
        drugCategory: 'analgesic',
        quantityInStock: 150,
        sellingPrice: 3.5,
      }),
    });

    if (!restDrugRes.ok) {
      throw new Error(`REST Drug creation failed: ${restDrugRes.status}`);
    }
    const restDrugData = await restDrugRes.json();
    const restDrugId = restDrugData.data.id;
    console.log(`✅ Drug created via REST. ID: ${restDrugId}`);

    // 14. Query drug catalog
    console.log('🔍 Fetching drugs list (REST)...');
    const restGetDrugsRes = await fetch(
      `${BASE_URL}/pharmacy/drugs?category=analgesic`,
      {
        headers,
      },
    );
    const restGetDrugsData = await restGetDrugsRes.json();
    const foundRestDrug = restGetDrugsData.data.find(
      (d: any) => d.id === restDrugId,
    );
    if (!foundRestDrug) {
      throw new Error('REST created drug was not found in analgesic list');
    }
    console.log(
      `✅ Found rest drug in analgesic list: ${foundRestDrug.drugName}`,
    );

    // 15. Update drug entry
    console.log('🔧 Updating drug catalog (REST)...');
    const restUpdateDrugRes = await fetch(
      `${BASE_URL}/pharmacy/drugs/${restDrugId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sellingPrice: 3.8,
        }),
      },
    );
    const restUpdateDrugData = await restUpdateDrugRes.json();
    console.log(
      `✅ Drug updated via REST. New selling price: $${restUpdateDrugData.data.sellingPrice}`,
    );

    // 16. Create Prescription (REST)
    console.log('📜 Creating prescription (REST)...');
    const restPrescriptionRes = await fetch(
      `${BASE_URL}/pharmacy/prescriptions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          patientId,
          doctorId,
          items: [
            {
              drugId: restDrugId,
              drugName: 'Ibuprofen Test',
              quantity: 10,
              dosage: '400mg',
            },
          ],
          notes: 'Take after meals',
        }),
      },
    );

    if (!restPrescriptionRes.ok) {
      throw new Error(
        `REST Prescription creation failed: ${restPrescriptionRes.status}`,
      );
    }
    const restPrescriptionData = await restPrescriptionRes.json();
    const restPrescriptionId = restPrescriptionData.data.id;
    console.log(`✅ Prescription created via REST. ID: ${restPrescriptionId}`);

    // 17. Update prescription (REST)
    console.log('🔧 Updating prescription status (REST)...');
    const restUpdatePrescriptionRes = await fetch(
      `${BASE_URL}/pharmacy/prescriptions/${restPrescriptionId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'partially_dispensed',
        }),
      },
    );
    const restUpdatePrescriptionData = await restUpdatePrescriptionRes.json();
    console.log(
      `✅ Prescription updated via REST. New status: ${restUpdatePrescriptionData.data.status}`,
    );

    // 18. Process Sale (REST)
    console.log('💰 Processing sale (REST)...');
    const restSaleRes = await fetch(`${BASE_URL}/pharmacy/sales`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        prescriptionId: restPrescriptionId,
        items: [
          {
            drugId: restDrugId,
            drugName: 'Ibuprofen Test',
            quantity: 10,
            unitPrice: 3.8,
            total: 38.0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      }),
    });

    if (!restSaleRes.ok) {
      throw new Error(
        `REST Sale failed: ${restSaleRes.status} ${await restSaleRes.text()}`,
      );
    }
    const restSaleData = await restSaleRes.json();
    console.log(
      `✅ Sale processed via REST. Receipt: ${restSaleData.data.receiptNumber}`,
    );

    // 19. Query sales list (REST)
    console.log('🔍 Querying sales list (REST)...');
    const restGetSalesRes = await fetch(`${BASE_URL}/pharmacy/sales`, {
      headers,
    });
    const restGetSalesData = await restGetSalesRes.json();
    expectNotEmpty(
      restGetSalesData.data,
      'REST sales list should not be empty',
    );
    console.log(
      `✅ Found sales via REST: ${restGetSalesData.data[0].receiptNumber} - $${restGetSalesData.data[0].totalAmount}`,
    );

    // 20. Fetch stats (REST)
    console.log('📊 Fetching stats (REST)...');
    const restStatsRes = await fetch(`${BASE_URL}/pharmacy/stats`, {
      headers,
    });
    const restStatsData = await restStatsRes.json();
    console.log(
      `✅ Stats fetched via REST. Today's sales count: $${restStatsData.data.todaySales}`,
    );

    console.log(
      '\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS PHARMACY MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

function expectNotEmpty(arr: any[], message: string) {
  if (!arr || arr.length === 0) {
    throw new Error(message);
  }
}

runVerification();
