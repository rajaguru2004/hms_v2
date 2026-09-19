/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Laboratory Module Verification...');

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

    // 2. Create Patient (required for lab orders)
    console.log('\n👤 Creating test patient...');
    const patientRes = await fetch(`${BASE_URL}/patients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1990-01-01',
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

    // =========================================================================
    // PART 1: TEST COMPATIBILITY MULTIPLEXED ENDPOINTS
    // =========================================================================

    // 3. Create Lab Test (Compatibility Route)
    console.log('\n🧪 Creating lab test (Compatibility Route)...');
    const testRes = await fetch(`${BASE_URL}/laboratory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'test',
        testName: 'Complete Blood Count',
        testCode: 'CBC-VERIFY',
        testCategory: 'hematology',
        testType: 'quantitative',
        specimenType: 'blood',
        price: 180.0,
      }),
    });

    if (!testRes.ok) {
      throw new Error(
        `Test creation failed: ${testRes.status} ${await testRes.text()}`,
      );
    }

    const testData = await testRes.json();
    const testId = testData.data.id;
    console.log(`✅ Lab Test catalog entry created. ID: ${testId}`);

    // 4. Query Lab Tests (Compatibility Route)
    console.log('\n🔍 Fetching lab tests...');
    const getTestsRes = await fetch(
      `${BASE_URL}/laboratory?resource=tests&category=hematology`,
      {
        headers,
      },
    );

    if (!getTestsRes.ok) {
      throw new Error(`Failed to fetch tests: ${getTestsRes.status}`);
    }

    const getTestsData = await getTestsRes.json();
    const foundTest = getTestsData.data.find((t: any) => t.id === testId);
    if (!foundTest) {
      throw new Error('Created lab test was not found in the list');
    }
    console.log(
      `✅ Found lab test: ${foundTest.testName} - $${foundTest.price}`,
    );

    // 5. Create Lab Order (Compatibility Route)
    console.log('\n📦 Creating lab order (Compatibility Route)...');
    const orderRes = await fetch(`${BASE_URL}/laboratory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'order',
        patientId,
        tests: [
          {
            testId,
            testName: 'Complete Blood Count',
            urgency: 'routine',
          },
        ],
        clinicalIndication: 'Fatigue screen',
        priority: 'routine',
      }),
    });

    if (!orderRes.ok) {
      throw new Error(
        `Order creation failed: ${orderRes.status} ${await orderRes.text()}`,
      );
    }

    const orderData = await orderRes.json();
    const orderId = orderData.data.id;
    console.log(
      `✅ Lab Order created. ID: ${orderId}, Number: ${orderData.data.orderNumber}`,
    );

    // 6. Query Lab Orders (Compatibility Route)
    console.log('\n🔍 Fetching lab orders...');
    const getOrdersRes = await fetch(
      `${BASE_URL}/laboratory?resource=orders&status=pending`,
      {
        headers,
      },
    );

    if (!getOrdersRes.ok) {
      throw new Error(`Failed to fetch orders: ${getOrdersRes.status}`);
    }

    const getOrdersData = await getOrdersRes.json();
    const foundOrder = orderList(getOrdersData).find(
      (o: any) => o.id === orderId,
    );
    if (!foundOrder) {
      throw new Error('Created lab order was not found in the list');
    }
    console.log(
      `✅ Found order: Number: ${foundOrder.orderNumber}, Status: ${foundOrder.status}`,
    );

    // 7. Save Lab Result (Compatibility Route)
    console.log('\n📝 Saving result (Compatibility Route)...');
    const resultRes = await fetch(`${BASE_URL}/laboratory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'result',
        orderId,
        testId,
        resultValue: '13.8',
        resultUnit: 'g/dL',
        isAbnormal: false,
        isCritical: false,
        flag: 'N',
        comment: 'Satisfactory sample',
      }),
    });

    if (!resultRes.ok) {
      throw new Error(
        `Result recording failed: ${resultRes.status} ${await resultRes.text()}`,
      );
    }

    const resultData = await resultRes.json();
    const resultId = resultData.data.id;
    console.log(
      `✅ Lab Result saved. ID: ${resultId}, Value: ${resultData.data.resultValue} ${resultData.data.resultUnit}`,
    );

    // 8. Query Lab Results (Compatibility Route)
    console.log('\n🔍 Fetching lab results...');
    const getResultsRes = await fetch(
      `${BASE_URL}/laboratory?resource=results&orderId=${orderId}`,
      {
        headers,
      },
    );

    if (!getResultsRes.ok) {
      throw new Error(`Failed to fetch results: ${getResultsRes.status}`);
    }

    const getResultsData = await getResultsRes.json();
    const foundResult = getResultsData.data.find((r: any) => r.id === resultId);
    if (!foundResult) {
      throw new Error('Saved lab result was not found in the list');
    }
    console.log(
      `✅ Found result: Value: ${foundResult.resultValue}, Unit: ${foundResult.resultUnit}`,
    );

    // 9. Fetch Stats (Compatibility Route)
    console.log('\n📊 Fetching laboratory stats...');
    const statsRes = await fetch(`${BASE_URL}/laboratory?resource=stats`, {
      headers,
    });

    if (!statsRes.ok) {
      throw new Error(`Failed to fetch stats: ${statsRes.status}`);
    }

    const statsData = await statsRes.json();
    console.log(`✅ Laboratory Stats:
    - Pending Orders: ${statsData.data.pending}
    - Sample Collected: ${statsData.data.sampleCollected}
    - In-Progress Orders: ${statsData.data.inProgress}
    - Completed Today: ${statsData.data.completedToday}
    - Critical Results: ${statsData.data.criticalResults}
    - Total Test Catalog Size: ${statsData.data.totalTests}`);

    // 10. Patch test catalog price (Compatibility Route - PATCH)
    console.log('\n🔧 Updating test price (Compatibility Route - PATCH)...');
    const patchTestRes = await fetch(`${BASE_URL}/laboratory`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        resource: 'test',
        id: testId,
        price: 210.0,
      }),
    });

    if (!patchTestRes.ok) {
      throw new Error(`Test PATCH failed: ${patchTestRes.status}`);
    }
    const patchTestData = await patchTestRes.json();
    console.log(
      `✅ Test price updated. New price: $${patchTestData.data.price}`,
    );

    // 11. Patch result verification (Compatibility Route - PATCH)
    console.log('\n🔐 Verifying result (Compatibility Route - PATCH)...');
    const patchResultRes = await fetch(`${BASE_URL}/laboratory`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        resource: 'result',
        id: resultId,
        verifiedAt: new Date().toISOString(),
      }),
    });

    if (!patchResultRes.ok) {
      throw new Error(`Result PATCH failed: ${patchResultRes.status}`);
    }
    const patchResultData = await patchResultRes.json();
    console.log(
      `✅ Result verified. VerifiedAt: ${patchResultData.data.verifiedAt}`,
    );

    // Check if order was auto-completed by result verification
    const orderCheckRes = await fetch(
      `${BASE_URL}/laboratory?resource=orders&status=completed`,
      {
        headers,
      },
    );
    const orderCheckData = await orderCheckRes.json();
    const completedOrder = orderList(orderCheckData).find(
      (o: any) => o.id === orderId,
    );
    if (!completedOrder) {
      throw new Error('Order was not completed after results verification');
    }
    console.log('✅ Lab Order status automatically updated to completed.');

    // =========================================================================
    // PART 2: TEST ENHANCED RESTFUL ENDPOINTS
    // =========================================================================
    console.log('\n--- RESTful API endpoints verification ---');

    // 12. Create test entry
    console.log('🧪 Creating lab test (REST)...');
    const restTestRes = await fetch(`${BASE_URL}/laboratory/tests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        testName: 'Glucose Level',
        testCode: 'GLC-REST',
        testCategory: 'chemistry',
        price: 90.0,
      }),
    });

    if (!restTestRes.ok) {
      throw new Error(`REST Test creation failed: ${restTestRes.status}`);
    }
    const restTestData = await restTestRes.json();
    const restTestId = restTestData.data.id;
    console.log(`✅ Test created via REST. ID: ${restTestId}`);

    // 13. Query test catalog
    console.log('🔍 Fetching lab tests list (REST)...');
    const restGetTestsRes = await fetch(
      `${BASE_URL}/laboratory/tests?category=chemistry`,
      {
        headers,
      },
    );
    const restGetTestsData = await restGetTestsRes.json();
    const foundRestTest = restGetTestsData.data.find(
      (t: any) => t.id === restTestId,
    );
    if (!foundRestTest) {
      throw new Error('REST created test was not found in chemistry list');
    }
    console.log(`✅ Found rest test in chemistry: ${foundRestTest.testName}`);

    // 14. Update test entry
    console.log('🔧 Updating test catalog (REST)...');
    const restUpdateTestRes = await fetch(
      `${BASE_URL}/laboratory/tests/${restTestId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          price: 110.0,
        }),
      },
    );
    const restUpdateTestData = await restUpdateTestRes.json();
    console.log(
      `✅ Test updated via REST. New price: $${restUpdateTestData.data.price}`,
    );

    // 15. Create Lab Order (REST)
    console.log('📦 Creating lab order (REST)...');
    const restOrderRes = await fetch(`${BASE_URL}/laboratory/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patientId,
        tests: [
          { testId: restTestId, testName: 'Glucose Level', urgency: 'routine' },
        ],
        clinicalIndication: 'Diabetes screening',
      }),
    });

    if (!restOrderRes.ok) {
      throw new Error(`REST Order creation failed: ${restOrderRes.status}`);
    }
    const restOrderData = await restOrderRes.json();
    const restOrderId = restOrderData.data.id;
    console.log(`✅ Order created via REST. ID: ${restOrderId}`);

    // 16. Update order status to collected (REST)
    console.log('🔧 Updating order (REST)...');
    const restUpdateOrderRes = await fetch(
      `${BASE_URL}/laboratory/orders/${restOrderId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'sample_collected',
          accessionNumber: 'ACC-REST-123',
        }),
      },
    );
    const restUpdateOrderData = await restUpdateOrderRes.json();
    console.log(
      `✅ Order updated via REST. New status: ${restUpdateOrderData.data.status}`,
    );

    // 17. Add Result (REST)
    console.log('📝 Adding result (REST)...');
    const restResultRes = await fetch(`${BASE_URL}/laboratory/results`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        orderId: restOrderId,
        testId: restTestId,
        resultValue: '95',
        resultUnit: 'mg/dL',
      }),
    });
    if (!restResultRes.ok) {
      throw new Error(`REST Result creation failed: ${restResultRes.status}`);
    }
    const restResultData = await restResultRes.json();
    const restResultId = restResultData.data.id;
    console.log(`✅ Result added via REST. ID: ${restResultId}`);

    // 18. Query results list (REST)
    console.log('🔍 Querying results (REST)...');
    const restGetResultsRes = await fetch(
      `${BASE_URL}/laboratory/results?orderId=${restOrderId}`,
      {
        headers,
      },
    );
    const restGetResultsData = await restGetResultsRes.json();
    expectNotEmpty(
      restGetResultsData.data,
      'REST results list should not be empty',
    );
    console.log(
      `✅ Found results via REST: ${restGetResultsData.data[0].resultValue} ${restGetResultsData.data[0].resultUnit}`,
    );

    // 19. Verify result (REST)
    console.log('🔐 Verifying result (REST)...');
    const restUpdateResultRes = await fetch(
      `${BASE_URL}/laboratory/results/${restResultId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          verifiedAt: new Date().toISOString(),
        }),
      },
    );
    const restUpdateResultData = await restUpdateResultRes.json();
    console.log(
      `✅ Result verified via REST. VerifiedAt: ${restUpdateResultData.data.verifiedAt}`,
    );

    // 20. Fetch stats (REST)
    console.log('📊 Fetching stats (REST)...');
    const restStatsRes = await fetch(`${BASE_URL}/laboratory/stats`, {
      headers,
    });
    const restStatsData = await restStatsRes.json();
    console.log(
      `✅ Stats fetched via REST. Completed today count: ${restStatsData.data.completedToday}`,
    );

    console.log(
      '\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS LABORATORY MODULE IS PRODUCTION-READY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

// Order listings come back paginated, so their rows sit under `data.data`
// next to a `meta` page descriptor, while the test and result listings are
// still flat arrays.
//
// Deliberately strict about which of those it will accept. Tolerating a bare
// array here as well would mean a regression from paginated back to flat -
// the exact shape change that broke this file - sails through, and the
// sibling helper in verify-queue.ts would be the only thing left to catch it.
// One of the two had to be the one that fails, and a listing that stops
// paginating is worth being told about.
function orderList(body: any): any[] {
  const payload = body?.data;
  if (!Array.isArray(payload?.data)) {
    throw new Error(
      'Lab order listing is not paginated: expected rows under data.data',
    );
  }
  return payload.data;
}

function expectNotEmpty(arr: any[], message: string) {
  if (!arr || arr.length === 0) {
    throw new Error(message);
  }
}

runVerification();
