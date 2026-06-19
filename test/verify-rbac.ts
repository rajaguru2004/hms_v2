/* eslint-disable */
import 'dotenv/config';

const BASE_URL = 'http://localhost:3000/api';

async function runVerification() {
  console.log('🏁 Starting Dynamic RBAC Verification...');

  try {
    // 1. Authenticate as Doctor to get initial state
    console.log('\n🔐 Logging in as Doctor...');
    const doctorLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'doctor@hms.local',
        password: 'Doctor@HMS2024!',
      }),
    });

    if (!doctorLoginRes.ok) {
      throw new Error(`Doctor Login failed: ${await doctorLoginRes.text()}`);
    }

    const doctorLoginData = await doctorLoginRes.json();
    const doctorToken = doctorLoginData.data.accessToken;
    const doctorHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorToken}`,
    };

    // Decode doctor token to get doctor userId
    const docPayload = JSON.parse(
      Buffer.from(doctorToken.split('.')[1], 'base64').toString(),
    );
    const doctorUserId = docPayload.sub;
    console.log(`✅ Logged in as Doctor. User ID: ${doctorUserId}`);

    // Call /auth/me/access to check initial access map
    console.log('Checking Doctor initial access map...');
    const docAccessRes = await fetch(`${BASE_URL}/auth/me/access`, {
      headers: doctorHeaders,
    });
    if (!docAccessRes.ok) {
      throw new Error(
        `Failed to fetch Doctor initial access map: ${await docAccessRes.text()}`,
      );
    }
    const docAccessData = await docAccessRes.json();
    console.log('Doctor initial access map fetched successfully.');
    const initialLabAccess = docAccessData.data.modules.laboratory || {
      canRead: false,
      canCreate: false,
    };
    console.log(
      `Laboratory initial access: ${JSON.stringify(initialLabAccess)}`,
    );

    // 2. Authenticate as Admin
    console.log('\n🔐 Logging in as Admin...');
    const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@hms.local',
        password: 'Admin@HMS2024!',
      }),
    });

    if (!adminLoginRes.ok) {
      throw new Error(`Admin Login failed: ${await adminLoginRes.text()}`);
    }

    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.data.accessToken;
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };
    console.log('✅ Logged in as Admin successfully.');

    // 3. Fetch Permissions List
    console.log('\nFetching permissions list...');
    const permRes = await fetch(`${BASE_URL}/permissions`, {
      headers: adminHeaders,
    });
    if (!permRes.ok) {
      throw new Error(
        `Failed to fetch permissions list: ${await permRes.text()}`,
      );
    }
    const permData = await permRes.json();
    const allPerms = permData.data;
    console.log(`✅ Fetched ${allPerms.length} permissions.`);

    // Find LABORATORY_CREATE and LABORATORY_READ permissions
    const labReadPerm = allPerms.find((p: any) => p.name === 'LABORATORY_READ');
    const labCreatePerm = allPerms.find(
      (p: any) => p.name === 'LABORATORY_CREATE',
    );
    if (!labReadPerm || !labCreatePerm) {
      throw new Error(
        'Could not find LABORATORY permissions in the seeded list',
      );
    }
    console.log(
      `Resolved permission IDs: Read = ${labReadPerm.id}, Create = ${labCreatePerm.id}`,
    );

    // 4. Check Admin me/access (Super Admin should have all true)
    console.log('\nChecking Admin (Super Admin) access map...');
    const adminAccessRes = await fetch(`${BASE_URL}/auth/me/access`, {
      headers: adminHeaders,
    });
    if (!adminAccessRes.ok) {
      throw new Error(
        `Failed to fetch Admin access map: ${await adminAccessRes.text()}`,
      );
    }
    const adminAccessData = await adminAccessRes.json();
    const patientsAccess = adminAccessData.data.modules.patients;
    if (
      !patientsAccess ||
      !patientsAccess.canRead ||
      !patientsAccess.canUpdate
    ) {
      throw new Error('Super Admin access map does not grant full control!');
    }
    console.log('✅ Super Admin access map validated successfully (all true).');

    // 5. Create a new custom role
    console.log('\nCreating custom role...');
    const createRoleRes = await fetch(`${BASE_URL}/roles`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: `VERIFY_CUSTOM_ROLE_${Date.now()}`,
        description: 'Verification custom role',
      }),
    });
    if (!createRoleRes.ok) {
      throw new Error(
        `Failed to create custom role: ${await createRoleRes.text()}`,
      );
    }
    const createRoleData = await createRoleRes.json();
    const roleId = createRoleData.data.id;
    const roleName = createRoleData.data.name;
    console.log(`✅ Custom role created. ID: ${roleId}, Name: ${roleName}`);

    // 6. Assign Permissions to the custom role (Laboratory READ and CREATE)
    console.log('\nAssigning permissions to custom role...');
    const assignPermsRes = await fetch(
      `${BASE_URL}/roles/${roleId}/permissions`,
      {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          permissions: [
            {
              permissionId: labReadPerm.id,
              canRead: true,
              canUpdate: false,
              canCreate: false,
              canDelete: false,
            },
            {
              permissionId: labCreatePerm.id,
              canRead: false,
              canUpdate: false,
              canCreate: true,
              canDelete: false,
            },
          ],
        }),
      },
    );
    if (!assignPermsRes.ok) {
      throw new Error(
        `Failed to assign permissions to custom role: ${await assignPermsRes.text()}`,
      );
    }
    console.log('✅ Permissions assigned successfully.');

    // 7. Assign Doctor user to the custom role
    console.log('\nAssigning Doctor user to custom role...');
    const assignUserRes = await fetch(`${BASE_URL}/roles/${roleId}/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        userId: doctorUserId,
      }),
    });
    if (!assignUserRes.ok) {
      throw new Error(
        `Failed to assign Doctor to custom role: ${await assignUserRes.text()}`,
      );
    }
    console.log('✅ Doctor assigned to custom role successfully.');

    // 8. Re-authenticate as Doctor and verify access map updated dynamically
    console.log(
      '\n🔐 Re-authenticating as Doctor to verify permission updates (Cache Invalidation)...',
    );
    const doctorLoginRes2 = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'doctor@hms.local',
        password: 'Doctor@HMS2024!',
      }),
    });
    if (!doctorLoginRes2.ok) {
      throw new Error(
        `Doctor Re-Login failed: ${await doctorLoginRes2.text()}`,
      );
    }
    const doctorLoginData2 = await doctorLoginRes2.json();
    const doctorToken2 = doctorLoginData2.data.accessToken;
    const doctorHeaders2 = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorToken2}`,
    };

    console.log('Checking Doctor updated access map...');
    const docAccessRes2 = await fetch(`${BASE_URL}/auth/me/access`, {
      headers: doctorHeaders2,
    });
    if (!docAccessRes2.ok) {
      throw new Error(
        `Failed to fetch Doctor updated access map: ${await docAccessRes2.text()}`,
      );
    }
    const docAccessData2 = await docAccessRes2.json();
    const updatedLabAccess = docAccessData2.data.modules.laboratory;
    console.log(
      `Doctor updated laboratory access: ${JSON.stringify(updatedLabAccess)}`,
    );

    if (
      !updatedLabAccess ||
      !updatedLabAccess.canRead ||
      !updatedLabAccess.canCreate
    ) {
      throw new Error(
        'Access map did not update with the new assigned role permissions!',
      );
    }
    console.log(
      '✅ Access map dynamic update and cache invalidation verified successfully!',
    );

    // ── CLEANUP ─────────────────────────────────────────────────────────────
    console.log('\n🧹 Starting cleanup...');

    // Remove Doctor from the custom role
    console.log('Removing Doctor from custom role...');
    const removeUserRes = await fetch(
      `${BASE_URL}/roles/${roleId}/users/${doctorUserId}`,
      {
        method: 'DELETE',
        headers: adminHeaders,
      },
    );
    if (!removeUserRes.ok) {
      throw new Error(
        `Failed to remove Doctor from custom role: ${await removeUserRes.text()}`,
      );
    }
    console.log('✅ Doctor removed from custom role.');

    // Delete custom role
    console.log('Deleting custom role...');
    const deleteRoleRes = await fetch(`${BASE_URL}/roles/${roleId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    if (!deleteRoleRes.ok) {
      throw new Error(
        `Failed to delete custom role: ${await deleteRoleRes.text()}`,
      );
    }
    console.log('✅ Custom role deleted successfully.');

    // Verify access map goes back to initial state
    console.log('Verifying Doctor access map reverted...');
    const doctorLoginRes3 = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'doctor@hms.local',
        password: 'Doctor@HMS2024!',
      }),
    });
    const doctorLoginData3 = await doctorLoginRes3.json();
    const doctorHeaders3 = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorLoginData3.data.accessToken}`,
    };
    const docAccessRes3 = await fetch(`${BASE_URL}/auth/me/access`, {
      headers: doctorHeaders3,
    });
    const docAccessData3 = await docAccessRes3.json();
    const finalLabAccess = docAccessData3.data.modules.laboratory;
    console.log(
      `Doctor final laboratory access: ${JSON.stringify(finalLabAccess)}`,
    );

    console.log(
      '\n🎉 ALL DYNAMIC RBAC VERIFICATION TESTS PASSED SUCCESSFULLY!',
    );
  } catch (error: any) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message || error);
    process.exit(1);
  }
}

runVerification();
