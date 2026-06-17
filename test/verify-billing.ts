/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Billing Module Verification...');

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

    // 2. Create Patient (required for invoice connect)
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

    // 3. Create Billing Service Catalog entry (Compatibility Route)
    console.log('\n🛠️ Creating billing service (Compatibility Route)...');
    const serviceRes = await fetch(`${BASE_URL}/billing`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'service',
        serviceName: 'Consultation Fee',
        serviceCode: 'SRV-CONS-VERIFY',
        serviceCategory: 'consultation',
        unitPrice: 350.0,
        isTaxable: false,
      }),
    });

    if (!serviceRes.ok) {
      throw new Error(
        `Service creation failed: ${serviceRes.status} ${await serviceRes.text()}`,
      );
    }

    const serviceData = await serviceRes.json();
    const serviceId = serviceData.data.id;
    console.log(`✅ Billing Service created. ID: ${serviceId}`);

    // 4. Query Billing Services (Compatibility Route)
    console.log('\n🔍 Fetching billing services...');
    const getServicesRes = await fetch(
      `${BASE_URL}/billing?resource=services&category=consultation`,
      {
        headers,
      },
    );

    if (!getServicesRes.ok) {
      throw new Error(`Failed to fetch services: ${getServicesRes.status}`);
    }

    const getServicesData = await getServicesRes.json();
    const foundService = getServicesData.data.find(
      (s: any) => s.id === serviceId,
    );
    if (!foundService) {
      throw new Error('Created service was not found in the list');
    }
    console.log(
      `✅ Found billing service: ${foundService.serviceName} - $${foundService.unitPrice}`,
    );

    // 5. Create Draft Invoice (Compatibility Route)
    console.log('\n📄 Creating invoice (Compatibility Route)...');
    const invoiceRes = await fetch(`${BASE_URL}/billing`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'invoice',
        patientId,
        items: [
          {
            type: 'service',
            referenceId: serviceId,
            description: 'Consultation Fee',
            quantity: 1,
            unitPrice: 350.0,
            tax: 0,
            total: 350.0,
          },
        ],
        discountAmount: 50.0,
        notes: 'Verification test invoice',
      }),
    });

    if (!invoiceRes.ok) {
      throw new Error(
        `Invoice creation failed: ${invoiceRes.status} ${await invoiceRes.text()}`,
      );
    }

    const invoiceData = await invoiceRes.json();
    const invoiceId = invoiceData.data.id;
    console.log(
      `✅ Invoice created. ID: ${invoiceId}, Total: $${invoiceData.data.totalAmount}, Balance Due: $${invoiceData.data.balanceDue}`,
    );

    // 6. Query Invoices (Compatibility Route)
    console.log('\n🔍 Fetching invoices...');
    const getInvoicesRes = await fetch(
      `${BASE_URL}/billing?resource=invoices&status=draft`,
      {
        headers,
      },
    );

    if (!getInvoicesRes.ok) {
      throw new Error(`Failed to fetch invoices: ${getInvoicesRes.status}`);
    }

    const getInvoicesData = await getInvoicesRes.json();
    const foundInvoice = getInvoicesData.data.find(
      (i: any) => i.id === invoiceId,
    );
    if (!foundInvoice) {
      throw new Error('Created invoice was not found in the list');
    }
    console.log(
      `✅ Found invoice: Number: ${foundInvoice.invoiceNumber}, Status: ${foundInvoice.status}`,
    );

    // 6.5. Get Invoice by ID (RESTful Route)
    console.log('\n🔍 Fetching single invoice by ID (RESTful)...');
    const getInvoiceRes = await fetch(
      `${BASE_URL}/billing/invoices/${invoiceId}`,
      { headers },
    );
    if (!getInvoiceRes.ok) {
      throw new Error(
        `Failed to fetch single invoice: ${getInvoiceRes.status}`,
      );
    }
    const getInvoiceData = await getInvoiceRes.json();
    console.log(
      `✅ Single Invoice: Number: ${getInvoiceData.data.invoiceNumber}, Total: $${getInvoiceData.data.totalAmount}`,
    );

    // 7. Record Payment (Compatibility Route)
    console.log('\n💳 Recording payment (Compatibility Route)...');
    const paymentRes = await fetch(`${BASE_URL}/billing`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resource: 'payment',
        invoiceId,
        amount: 150.0,
        paymentMethod: 'cash',
        notes: 'Partial cash payment',
      }),
    });

    if (!paymentRes.ok) {
      throw new Error(
        `Payment recording failed: ${paymentRes.status} ${await paymentRes.text()}`,
      );
    }

    const paymentData = await paymentRes.json();
    console.log(
      `✅ Payment recorded. Receipt: ${paymentData.data.receiptNumber}, Amount: $${paymentData.data.amount}`,
    );

    // 8. Query Payments (Compatibility Route)
    console.log('\n🔍 Fetching payments...');
    const getPaymentsRes = await fetch(
      `${BASE_URL}/billing?resource=payments&invoiceId=${invoiceId}`,
      {
        headers,
      },
    );

    if (!getPaymentsRes.ok) {
      throw new Error(`Failed to fetch payments: ${getPaymentsRes.status}`);
    }

    const getPaymentsData = await getPaymentsRes.json();
    expectNotEmpty(getPaymentsData.data, 'Payments list should not be empty');
    console.log(
      `✅ Found payments for invoice. First payment amount: $${getPaymentsData.data[0].amount}`,
    );

    const paymentId = getPaymentsData.data[0].id;
    // 8.5. Get Payment by ID (RESTful Route)
    console.log('\n🔍 Fetching single payment by ID (RESTful)...');
    const getPaymentRes = await fetch(
      `${BASE_URL}/billing/payments/${paymentId}`,
      { headers },
    );
    if (!getPaymentRes.ok) {
      throw new Error(
        `Failed to fetch single payment: ${getPaymentRes.status}`,
      );
    }
    const getPaymentData = await getPaymentRes.json();
    console.log(
      `✅ Single Payment: Receipt: ${getPaymentData.data.receiptNumber}, Amount: $${getPaymentData.data.amount}`,
    );

    // 9. Fetch stats (Compatibility Route)
    console.log('\n📊 Fetching billing stats...');
    const statsRes = await fetch(`${BASE_URL}/billing?resource=stats`, {
      headers,
    });

    if (!statsRes.ok) {
      throw new Error(`Failed to fetch stats: ${statsRes.status}`);
    }

    const statsData = await statsRes.json();
    console.log(`✅ Billing Stats:
   - Today's Revenue: $${statsData.data.todayRevenue}
   - Pending Invoices: ${statsData.data.pendingInvoices}
   - Outstanding Balance: $${statsData.data.outstandingBalance}
   - Total Active Services: ${statsData.data.totalServices}`);

    // 10. Cancel Invoice (Compatibility Route - PATCH)
    console.log('\n🚫 Cancelling invoice (Compatibility Route - PATCH)...');
    const patchRes = await fetch(`${BASE_URL}/billing`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        resource: 'invoice',
        id: invoiceId,
        status: 'cancelled',
      }),
    });

    if (!patchRes.ok) {
      throw new Error(
        `Invoice PATCH failed: ${patchRes.status} ${await patchRes.text()}`,
      );
    }

    const patchData = await patchRes.json();
    console.log(
      `✅ Invoice status updated. New status: ${patchData.data.status}`,
    );

    console.log(
      '\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! MIGRATED NESTJS BILLING MODULE IS PRODUCTION-READY!',
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
