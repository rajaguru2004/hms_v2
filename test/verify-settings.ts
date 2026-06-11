/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Settings Module Verification...');

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

    // Decode token to extract userId
    const payloadBase64 = token.split('.')[1];
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString();
    const decoded = JSON.parse(payloadJson);
    const userId = decoded.sub;

    console.log(`🔐 Logged in user ID: ${userId}`);

    // Fetch user details to get organization ID
    console.log(
      'Fetching logged-in user profile to resolve organization ID...',
    );
    const userRes = await fetch(`${BASE_URL}/users/${userId}`, { headers });
    if (!userRes.ok) {
      throw new Error(
        `Failed to fetch user profile: ${userRes.status} ${await userRes.text()}`,
      );
    }
    const userData = await userRes.json();
    const orgId = userData.data.organizationId;
    console.log(`🏢 Resolved organization ID: ${orgId}`);

    // ── DEPARTMENTS VERIFICATION ─────────────────────────────────────────────
    console.log('\n🏥 Testing Departments endpoints...');

    // Create Department
    console.log('Creating department...');
    const createDeptRes = await fetch(`${BASE_URL}/settings/departments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        organizationId: orgId,
        name: 'Verify Cardiology',
        code: 'V-CARD',
        description: 'Verification Department',
      }),
    });
    if (!createDeptRes.ok) {
      throw new Error(
        `Failed to create department: ${createDeptRes.status} ${await createDeptRes.text()}`,
      );
    }
    const createDeptData = await createDeptRes.json();
    const deptId = createDeptData.data.id;
    console.log(`✅ Department created. ID: ${deptId}`);

    // Fetch Departments List
    console.log('Fetching department list...');
    const getDeptsRes = await fetch(
      `${BASE_URL}/settings/departments?organizationId=${orgId}`,
      { headers },
    );
    if (!getDeptsRes.ok) {
      throw new Error(`Failed to fetch departments: ${getDeptsRes.status}`);
    }
    const getDeptsData = await getDeptsRes.json();
    const foundDept = getDeptsData.data.find((d: any) => d.id === deptId);
    if (!foundDept) {
      throw new Error('Created department not found in list');
    }
    console.log(`✅ Found department: ${foundDept.name} (${foundDept.code})`);

    // Fetch Single Department
    console.log('Fetching single department details...');
    const getSingleDeptRes = await fetch(
      `${BASE_URL}/settings/departments/${deptId}`,
      { headers },
    );
    if (!getSingleDeptRes.ok) {
      throw new Error(
        `Failed to fetch single department: ${getSingleDeptRes.status}`,
      );
    }
    const getSingleDeptData = await getSingleDeptRes.json();
    console.log(`✅ Fetched department. Name: ${getSingleDeptData.data.name}`);

    // Update Department
    console.log('Updating department...');
    const updateDeptRes = await fetch(
      `${BASE_URL}/settings/departments/${deptId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Verify Cardiology Updated',
          code: 'V-CARD-UPD',
        }),
      },
    );
    if (!updateDeptRes.ok) {
      throw new Error(`Failed to update department: ${updateDeptRes.status}`);
    }
    const updateDeptData = await updateDeptRes.json();
    console.log(
      `✅ Department updated. New name: ${updateDeptData.data.name}, New code: ${updateDeptData.data.code}`,
    );

    // ── INTEGRATIONS VERIFICATION ────────────────────────────────────────────
    console.log('\n🔌 Testing Integrations endpoints...');

    // Create Machine Integration
    console.log('Registering machine integration...');
    const createIntRes = await fetch(`${BASE_URL}/settings/integrations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        organizationId: orgId,
        machineName: 'Verify Sysmex',
        machineType: 'lab_analyzer',
        machineModel: 'V-XN-1000',
        manufacturer: 'Sysmex Corporation',
        serialNumber: 'VSN-9999',
        connectionType: 'hl7',
        ipAddress: '10.0.0.99',
        port: 6099,
        apiEndpoint: 'http://sysmex.verify.local',
        apiKey: 'verify-key-xyz',
        department: 'laboratory',
      }),
    });
    if (!createIntRes.ok) {
      throw new Error(
        `Failed to create integration: ${createIntRes.status} ${await createIntRes.text()}`,
      );
    }
    const createIntData = await createIntRes.json();
    const intId = createIntData.data.id;
    console.log(`✅ Integration registered. ID: ${intId}`);

    // Fetch Integrations List
    console.log('Fetching integrations list...');
    const getIntsRes = await fetch(
      `${BASE_URL}/settings/integrations?organizationId=${orgId}`,
      { headers },
    );
    if (!getIntsRes.ok) {
      throw new Error(`Failed to fetch integrations: ${getIntsRes.status}`);
    }
    const getIntsData = await getIntsRes.json();
    const foundInt = getIntsData.data.find((i: any) => i.id === intId);
    if (!foundInt) {
      throw new Error('Created integration not found in list');
    }
    console.log(
      `✅ Found integration: ${foundInt.machineName} - ${foundInt.machineType}`,
    );

    // Fetch Single Integration
    console.log('Fetching single integration details...');
    const getSingleIntRes = await fetch(
      `${BASE_URL}/settings/integrations/${intId}`,
      { headers },
    );
    if (!getSingleIntRes.ok) {
      throw new Error(
        `Failed to fetch single integration: ${getSingleIntRes.status}`,
      );
    }
    const getSingleIntData = await getSingleIntRes.json();
    console.log(
      `✅ Fetched integration details. Connection Type: ${getSingleIntData.data.connectionType}`,
    );

    // Update Integration (including connection detail merging)
    console.log('Updating integration connection settings...');
    const updateIntRes = await fetch(
      `${BASE_URL}/settings/integrations/${intId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          machineName: 'Verify Sysmex Updated',
          ipAddress: '10.0.0.100',
          connectionStatus: 'connected',
        }),
      },
    );
    if (!updateIntRes.ok) {
      throw new Error(`Failed to update integration: ${updateIntRes.status}`);
    }
    const updateIntData = await updateIntRes.json();
    console.log(
      `✅ Integration updated. New Name: ${updateIntData.data.machineName}, Status: ${updateIntData.data.connectionStatus}`,
    );

    // ── ORGANIZATION & MODULES VERIFICATION ──────────────────────────────────
    console.log('\n🏢 Testing Organization & Modules endpoints...');

    // Fetch Organization Settings
    console.log('Fetching organization config...');
    const getOrgRes = await fetch(
      `${BASE_URL}/settings/organization?id=${orgId}`,
      { headers },
    );
    if (!getOrgRes.ok) {
      throw new Error(`Failed to fetch organization: ${getOrgRes.status}`);
    }
    const getOrgData = await getOrgRes.json();
    console.log(
      `✅ Organization fetched: ${getOrgData.data.name}, Address: ${getOrgData.data.address}`,
    );

    // Update Organization Settings
    console.log('Updating organization settings...');
    const updateOrgRes = await fetch(`${BASE_URL}/settings/organization`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: orgId,
        address: '123 New Verification Way',
        settings: { ...getOrgData.data.settings, currency: 'USD' },
      }),
    });
    if (!updateOrgRes.ok) {
      throw new Error(`Failed to update organization: ${updateOrgRes.status}`);
    }
    const updateOrgData = await updateOrgRes.json();
    console.log(
      `✅ Organization updated. New Address: ${updateOrgData.data.address}, Currency: ${updateOrgData.data.settings.currency}`,
    );

    // Update Modules Enabled
    console.log('Updating organization modules...');
    const updateModRes = await fetch(`${BASE_URL}/settings/modules`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        organizationId: orgId,
        modulesEnabled: {
          ...getOrgData.data.modulesEnabled,
          laboratory: true,
          pharmacy: true,
          radiology: false,
        },
      }),
    });
    if (!updateModRes.ok) {
      throw new Error(`Failed to update modules: ${updateModRes.status}`);
    }
    const updateModData = await updateModRes.json();
    console.log(
      `✅ Modules updated. Modules state: ${JSON.stringify(updateModData.data.modulesEnabled)}`,
    );

    // ── USERS VERIFICATION ───────────────────────────────────────────────────
    console.log('\n👥 Testing Users (Staff) endpoints...');

    // Create Settings User (Staff)
    console.log('Creating user...');
    const email = `staff.verify-${Date.now()}@hospital.com`;
    const createUserRes = await fetch(`${BASE_URL}/settings/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        organizationId: orgId,
        fullName: 'Verify Staff Member',
        email,
        role: 'DOCTOR',
        departmentId: deptId,
        specialization: 'Verify Specialist',
        licenseNumber: 'V-LIC-9988',
      }),
    });
    if (!createUserRes.ok) {
      throw new Error(
        `Failed to create settings user: ${createUserRes.status} ${await createUserRes.text()}`,
      );
    }
    const createUserData = await createUserRes.json();
    const staffId = createUserData.data.id;
    console.log(`✅ Staff user created. ID: ${staffId}`);

    // Fetch Users List
    console.log('Fetching users list...');
    const getUsersRes = await fetch(
      `${BASE_URL}/settings/users?organizationId=${orgId}`,
      { headers },
    );
    if (!getUsersRes.ok) {
      throw new Error(`Failed to fetch users: ${getUsersRes.status}`);
    }
    const getUsersData = await getUsersRes.json();
    const foundUser = getUsersData.data.find((u: any) => u.id === staffId);
    if (!foundUser) {
      throw new Error('Created user not found in list');
    }
    console.log(
      `✅ Found user: ${foundUser.fullName} (${foundUser.role}) in Department: ${foundUser.department?.name}`,
    );

    // Fetch Single User details
    console.log('Fetching single user details...');
    const getSingleUserRes = await fetch(
      `${BASE_URL}/settings/users/${staffId}`,
      { headers },
    );
    if (!getSingleUserRes.ok) {
      throw new Error(
        `Failed to fetch user details: ${getSingleUserRes.status}`,
      );
    }
    const getSingleUserData = await getSingleUserRes.json();
    console.log(
      `✅ User details fetched. Full Name: ${getSingleUserData.data.fullName}`,
    );

    // Update User details
    console.log('Updating user...');
    const updateUserRes = await fetch(`${BASE_URL}/settings/users/${staffId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        fullName: 'Verify Staff Member Updated',
        specialization: 'Senior Verify Specialist',
      }),
    });
    if (!updateUserRes.ok) {
      throw new Error(`Failed to update user: ${updateUserRes.status}`);
    }
    const updateUserData = await updateUserRes.json();
    console.log(`✅ User updated. New Name: ${updateUserData.data.fullName}`);

    // ── CLEANUP / DELETIONS ──────────────────────────────────────────────────
    console.log('\n🧹 Cleaning up created resources...');

    // Delete settings user (Soft delete under the hood)
    console.log('Deleting staff user...');
    const deleteUserRes = await fetch(`${BASE_URL}/settings/users/${staffId}`, {
      method: 'DELETE',
      headers,
    });
    if (!deleteUserRes.ok) {
      throw new Error(`Failed to delete staff user: ${deleteUserRes.status}`);
    }
    console.log('✅ Staff user deleted successfully.');

    // Delete integration
    console.log('Deleting integration...');
    const deleteIntRes = await fetch(
      `${BASE_URL}/settings/integrations/${intId}`,
      { method: 'DELETE', headers },
    );
    if (!deleteIntRes.ok) {
      throw new Error(`Failed to delete integration: ${deleteIntRes.status}`);
    }
    console.log('✅ Integration deleted successfully.');

    // Delete department
    console.log('Deleting department...');
    const deleteDeptRes = await fetch(
      `${BASE_URL}/settings/departments/${deptId}`,
      { method: 'DELETE', headers },
    );
    if (!deleteDeptRes.ok) {
      throw new Error(`Failed to delete department: ${deleteDeptRes.status}`);
    }
    console.log('✅ Department deleted successfully.');

    console.log(
      '\n🎉 ALL SETTINGS MODULE VERIFICATION TESTS PASSED SUCCESSFULLY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
