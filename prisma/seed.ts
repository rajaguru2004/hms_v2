import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
  adapter,
  log: ['info', 'warn', 'error'],
});

/**
 * Database seed — populates initial data.
 *
 * Idempotent: uses upsert so it's safe to run multiple times.
 *
 * Seeds:
 * 1. System permissions (all RESOURCE_ACTION combinations)
 * 2. System roles (SUPER_ADMIN, ADMIN, DOCTOR, NURSE, etc.)
 * 3. Role ↔ Permission mappings
 * 4. Default SUPER_ADMIN user
 */
async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');

  // ── 0. Organization ──────────────────────────────────────────────────────
  const defaultOrg = await prisma.organization.upsert({
    where: { slug: 'system' },
    update: {},
    create: {
      name: 'System Hospital',
      slug: 'system',
    },
  });
  console.log(`✅ Seeded default organization: ${defaultOrg.name}`);

  // ── 1. Permissions ──────────────────────────────────────────────────────
  const permissions = [
    {
      name: 'USER_CREATE',
      resource: 'users',
      action: 'create',
      description: 'Create users',
    },
    {
      name: 'USER_READ',
      resource: 'users',
      action: 'read',
      description: 'Read users',
    },
    {
      name: 'USER_UPDATE',
      resource: 'users',
      action: 'update',
      description: 'Update users',
    },
    {
      name: 'USER_DELETE',
      resource: 'users',
      action: 'delete',
      description: 'Delete users',
    },
    {
      name: 'ROLE_CREATE',
      resource: 'roles',
      action: 'create',
      description: 'Create roles',
    },
    {
      name: 'ROLE_READ',
      resource: 'roles',
      action: 'read',
      description: 'Read roles',
    },
    {
      name: 'ROLE_UPDATE',
      resource: 'roles',
      action: 'update',
      description: 'Update roles',
    },
    {
      name: 'ROLE_DELETE',
      resource: 'roles',
      action: 'delete',
      description: 'Delete roles',
    },
    {
      name: 'PERMISSION_READ',
      resource: 'permissions',
      action: 'read',
      description: 'Read permissions',
    },
    {
      name: 'PERMISSION_ASSIGN',
      resource: 'permissions',
      action: 'assign',
      description: 'Assign permissions',
    },
    {
      name: 'PATIENT_CREATE',
      resource: 'patients',
      action: 'create',
      description: 'Create patients',
    },
    {
      name: 'PATIENT_READ',
      resource: 'patients',
      action: 'read',
      description: 'Read patients',
    },
    {
      name: 'PATIENT_UPDATE',
      resource: 'patients',
      action: 'update',
      description: 'Update patients',
    },
    {
      name: 'PATIENT_DELETE',
      resource: 'patients',
      action: 'delete',
      description: 'Delete patients',
    },
    {
      name: 'APPOINTMENT_CREATE',
      resource: 'appointments',
      action: 'create',
      description: 'Create appointments',
    },
    {
      name: 'APPOINTMENT_READ',
      resource: 'appointments',
      action: 'read',
      description: 'Read appointments',
    },
    {
      name: 'APPOINTMENT_UPDATE',
      resource: 'appointments',
      action: 'update',
      description: 'Update appointments',
    },
    {
      name: 'APPOINTMENT_DELETE',
      resource: 'appointments',
      action: 'delete',
      description: 'Delete appointments',
    },
    {
      name: 'AUDIT_READ',
      resource: 'audit',
      action: 'read',
      description: 'Read audit logs',
    },
    {
      name: 'BILLING_CREATE',
      resource: 'billing',
      action: 'create',
      description: 'Create billing records',
    },
    {
      name: 'BILLING_READ',
      resource: 'billing',
      action: 'read',
      description: 'Read billing records',
    },
    {
      name: 'BILLING_UPDATE',
      resource: 'billing',
      action: 'update',
      description: 'Update billing records',
    },
    {
      name: 'BILLING_DELETE',
      resource: 'billing',
      action: 'delete',
      description: 'Delete billing records',
    },
    {
      name: 'CONSULTATION_CREATE',
      resource: 'consultations',
      action: 'create',
      description: 'Create consultations',
    },
    {
      name: 'CONSULTATION_READ',
      resource: 'consultations',
      action: 'read',
      description: 'Read consultations',
    },
    {
      name: 'CONSULTATION_UPDATE',
      resource: 'consultations',
      action: 'update',
      description: 'Update consultations',
    },
    {
      name: 'CONSULTATION_DELETE',
      resource: 'consultations',
      action: 'delete',
      description: 'Delete consultations',
    },
    {
      name: 'INPATIENT_CREATE',
      resource: 'inpatient',
      action: 'create',
      description: 'Create inpatient records',
    },
    {
      name: 'INPATIENT_READ',
      resource: 'inpatient',
      action: 'read',
      description: 'Read inpatient records',
    },
    {
      name: 'INPATIENT_UPDATE',
      resource: 'inpatient',
      action: 'update',
      description: 'Update inpatient records',
    },
    {
      name: 'INPATIENT_DELETE',
      resource: 'inpatient',
      action: 'delete',
      description: 'Delete inpatient records',
    },
    {
      name: 'INTEGRATION_CREATE',
      resource: 'integrations',
      action: 'create',
      description: 'Create integrations',
    },
    {
      name: 'INTEGRATION_READ',
      resource: 'integrations',
      action: 'read',
      description: 'Read integrations',
    },
    {
      name: 'INTEGRATION_UPDATE',
      resource: 'integrations',
      action: 'update',
      description: 'Update integrations',
    },
    {
      name: 'INTEGRATION_DELETE',
      resource: 'integrations',
      action: 'delete',
      description: 'Delete integrations',
    },
    {
      name: 'LABORATORY_CREATE',
      resource: 'laboratory',
      action: 'create',
      description: 'Create laboratory records',
    },
    {
      name: 'LABORATORY_READ',
      resource: 'laboratory',
      action: 'read',
      description: 'Read laboratory records',
    },
    {
      name: 'LABORATORY_UPDATE',
      resource: 'laboratory',
      action: 'update',
      description: 'Update laboratory records',
    },
    {
      name: 'LABORATORY_DELETE',
      resource: 'laboratory',
      action: 'delete',
      description: 'Delete laboratory records',
    },
    {
      name: 'RADIOLOGY_CREATE',
      resource: 'radiology',
      action: 'create',
      description: 'Create radiology records',
    },
    {
      name: 'RADIOLOGY_READ',
      resource: 'radiology',
      action: 'read',
      description: 'Read radiology records',
    },
    {
      name: 'RADIOLOGY_UPDATE',
      resource: 'radiology',
      action: 'update',
      description: 'Update radiology records',
    },
    {
      name: 'RADIOLOGY_DELETE',
      resource: 'radiology',
      action: 'delete',
      description: 'Delete radiology records',
    },
    {
      name: 'PHARMACY_CREATE',
      resource: 'pharmacy',
      action: 'create',
      description: 'Create pharmacy records',
    },
    {
      name: 'PHARMACY_READ',
      resource: 'pharmacy',
      action: 'read',
      description: 'Read pharmacy records',
    },
    {
      name: 'PHARMACY_UPDATE',
      resource: 'pharmacy',
      action: 'update',
      description: 'Update pharmacy records',
    },
    {
      name: 'PHARMACY_DELETE',
      resource: 'pharmacy',
      action: 'delete',
      description: 'Delete pharmacy records',
    },
    {
      name: 'PRE_TRIAGE_CREATE',
      resource: 'pre-triage',
      action: 'create',
      description: 'Create pre-triage screenings',
    },
    {
      name: 'PRE_TRIAGE_READ',
      resource: 'pre-triage',
      action: 'read',
      description: 'Read pre-triage screenings',
    },
    {
      name: 'PRE_TRIAGE_UPDATE',
      resource: 'pre-triage',
      action: 'update',
      description: 'Update pre-triage screenings',
    },
    {
      name: 'PRE_TRIAGE_DELETE',
      resource: 'pre-triage',
      action: 'delete',
      description: 'Delete pre-triage screenings',
    },
    {
      name: 'QUEUE_CREATE',
      resource: 'queue',
      action: 'create',
      description: 'Create queue records',
    },
    {
      name: 'QUEUE_READ',
      resource: 'queue',
      action: 'read',
      description: 'Read queue records',
    },
    {
      name: 'QUEUE_UPDATE',
      resource: 'queue',
      action: 'update',
      description: 'Update queue records',
    },
    {
      name: 'QUEUE_DELETE',
      resource: 'queue',
      action: 'delete',
      description: 'Delete queue records',
    },
    {
      name: 'DASHBOARD_READ',
      resource: 'dashboard',
      action: 'read',
      description: 'Read dashboard statistics',
    },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ Seeded ${permissions.length} permissions`);

  // ── 2. Roles ─────────────────────────────────────────────────────────────
  const roles = [
    { name: 'SUPER_ADMIN', description: 'Full system access', isSystem: true },
    { name: 'ADMIN', description: 'Administrative access', isSystem: true },
    { name: 'DOCTOR', description: 'Doctor role', isSystem: true },
    { name: 'NURSE', description: 'Nurse role', isSystem: true },
    { name: 'RECEPTIONIST', description: 'Receptionist role', isSystem: true },
    { name: 'PHARMACIST', description: 'Pharmacist role', isSystem: true },
    {
      name: 'LAB_TECHNICIAN',
      description: 'Lab technician role',
      isSystem: true,
    },
    { name: 'RADIOLOGIST', description: 'Radiologist role', isSystem: true },
    {
      name: 'PATIENT',
      description: 'Patient self-service role',
      isSystem: true,
    },
    {
      name: 'BILLING_STAFF',
      description: 'Billing staff role',
      isSystem: true,
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }
  console.log(`✅ Seeded ${roles.length} roles`);

  // ── 3. Role → Permission assignments ─────────────────────────────────────
  const allPermissions = await prisma.permission.findMany();
  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' },
  });
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });

  // SUPER_ADMIN gets ALL permissions
  if (superAdminRole) {
    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: superAdminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: { roleId: superAdminRole.id, permissionId: perm.id },
      });
    }
    console.log(`✅ Assigned all permissions to SUPER_ADMIN`);
  }

  // ADMIN gets user/role management + patient/appointment read
  if (adminRole) {
    const adminPermNames = [
      'USER_CREATE',
      'USER_READ',
      'USER_UPDATE',
      'USER_DELETE',
      'ROLE_READ',
      'PATIENT_READ',
      'APPOINTMENT_READ',
      'AUDIT_READ',
      'DASHBOARD_READ',
    ];
    const adminPerms = allPermissions.filter((p) =>
      adminPermNames.includes(p.name),
    );
    for (const perm of adminPerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }
    console.log(`✅ Assigned ${adminPerms.length} permissions to ADMIN`);
  }

  // ── 4. Default SUPER_ADMIN user ───────────────────────────────────────────
  const defaultAdminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@hms.local';
  const defaultAdminPassword =
    process.env.SEED_ADMIN_PASSWORD || 'Admin@HMS2024!';

  const hashedPassword = await bcrypt.hash(defaultAdminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: defaultAdminEmail },
    update: {},
    create: {
      email: defaultAdminEmail,
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Admin',
      fullName: 'System Admin',
      organizationId: defaultOrg.id,
      isActive: true,
    },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: adminUser.id, roleId: superAdminRole.id },
      },
      update: {},
      create: { userId: adminUser.id, roleId: superAdminRole.id },
    });
  }

  console.log(`✅ Default admin user: ${defaultAdminEmail}`);
  console.log('🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
