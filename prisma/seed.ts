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
    { name: 'USER_CREATE', resource: 'users', action: 'create', description: 'Create users' },
    { name: 'USER_READ', resource: 'users', action: 'read', description: 'Read users' },
    { name: 'USER_UPDATE', resource: 'users', action: 'update', description: 'Update users' },
    { name: 'USER_DELETE', resource: 'users', action: 'delete', description: 'Delete users' },
    { name: 'ROLE_CREATE', resource: 'roles', action: 'create', description: 'Create roles' },
    { name: 'ROLE_READ', resource: 'roles', action: 'read', description: 'Read roles' },
    { name: 'ROLE_UPDATE', resource: 'roles', action: 'update', description: 'Update roles' },
    { name: 'ROLE_DELETE', resource: 'roles', action: 'delete', description: 'Delete roles' },
    { name: 'PERMISSION_READ', resource: 'permissions', action: 'read', description: 'Read permissions' },
    { name: 'PERMISSION_ASSIGN', resource: 'permissions', action: 'assign', description: 'Assign permissions' },
    { name: 'PATIENT_CREATE', resource: 'patients', action: 'create', description: 'Create patients' },
    { name: 'PATIENT_READ', resource: 'patients', action: 'read', description: 'Read patients' },
    { name: 'PATIENT_UPDATE', resource: 'patients', action: 'update', description: 'Update patients' },
    { name: 'PATIENT_DELETE', resource: 'patients', action: 'delete', description: 'Delete patients' },
    { name: 'APPOINTMENT_CREATE', resource: 'appointments', action: 'create', description: 'Create appointments' },
    { name: 'APPOINTMENT_READ', resource: 'appointments', action: 'read', description: 'Read appointments' },
    { name: 'APPOINTMENT_UPDATE', resource: 'appointments', action: 'update', description: 'Update appointments' },
    { name: 'APPOINTMENT_DELETE', resource: 'appointments', action: 'delete', description: 'Delete appointments' },
    { name: 'AUDIT_READ', resource: 'audit', action: 'read', description: 'Read audit logs' },
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
    { name: 'LAB_TECHNICIAN', description: 'Lab technician role', isSystem: true },
    { name: 'RADIOLOGIST', description: 'Radiologist role', isSystem: true },
    { name: 'PATIENT', description: 'Patient self-service role', isSystem: true },
    { name: 'BILLING_STAFF', description: 'Billing staff role', isSystem: true },
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
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });

  // SUPER_ADMIN gets ALL permissions
  if (superAdminRole) {
    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: superAdminRole.id, permissionId: perm.id },
      });
    }
    console.log(`✅ Assigned all permissions to SUPER_ADMIN`);
  }

  // ADMIN gets user/role management + patient/appointment read
  if (adminRole) {
    const adminPermNames = ['USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE',
      'ROLE_READ', 'PATIENT_READ', 'APPOINTMENT_READ', 'AUDIT_READ'];
    const adminPerms = allPermissions.filter((p) => adminPermNames.includes(p.name));
    for (const perm of adminPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }
    console.log(`✅ Assigned ${adminPerms.length} permissions to ADMIN`);
  }

  // ── 4. Default SUPER_ADMIN user ───────────────────────────────────────────
  const defaultAdminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@hms.local';
  const defaultAdminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@HMS2024!';

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
      where: { userId_roleId: { userId: adminUser.id, roleId: superAdminRole.id } },
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
