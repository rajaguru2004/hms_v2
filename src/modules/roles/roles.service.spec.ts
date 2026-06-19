/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { RolesRepository } from './roles.repository';
import { UserRepository } from '../users/user.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
} from '../../common/exceptions/app.exception';
import { Role, User } from '@prisma/client';

describe('RolesService', () => {
  let service: RolesService;
  let rolesRepo: jest.Mocked<RolesRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let auditService: jest.Mocked<AuditService>;
  let cacheService: jest.Mocked<AppCacheService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockCustomRole: Role = {
    id: 'role-custom-1',
    name: 'CUSTOM_RECEPTIONIST',
    description: 'Custom receptionist role',
    isSystem: false,
    organizationId: 'org-demo',
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-admin',
    updatedBy: null,
  };

  const mockSystemRole: Role = {
    id: 'role-system-1',
    name: 'DOCTOR',
    description: 'System doctor role',
    isSystem: true,
    organizationId: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
  };

  const mockUser: User = {
    id: 'user-1',
    organizationId: 'org-demo',
    email: 'test@hospital.com',
    password: 'hashedpassword',
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    phone: null,
    dateOfBirth: null,
    gender: null,
    address: null,
    employeeId: null,
    role: null,
    departmentId: null,
    specialization: null,
    licenseNumber: null,
    isActive: true,
    lastLoginAt: null,
    preferences: null,
    defaultCalendar: 'ethiopian',
    invitationToken: null,
    invitationExpiresAt: null,
    invitedById: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
    createdBy: null,
    updatedBy: null,
  };

  beforeEach(async () => {
    const mockRolesRepository = {
      findById: jest.fn(),
      findByIdWithPermissions: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findUsersOfRole: jest.fn(),
    };

    const mockUserRepository = {
      findById: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const mockPrisma: unknown = {
      permission: {
        findMany: jest.fn(),
      },
      rolePermission: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      userRole: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: any) => unknown) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RolesRepository, useValue: mockRolesRepository },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppCacheService, useValue: mockCache },
        {
          provide: PrismaService,
          useValue: mockPrisma as PrismaService,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    rolesRepo = module.get(RolesRepository);
    userRepo = module.get(UserRepository);
    auditService = module.get(AuditService);
    cacheService = module.get(AppCacheService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a custom role successfully if name is unique', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      rolesRepo.create.mockResolvedValue(mockCustomRole);

      const result = await service.create(
        {
          name: 'CUSTOM_RECEPTIONIST',
          description: 'Custom receptionist role',
          organizationId: 'org-demo',
        },
        'user-admin',
      );

      expect(rolesRepo.findOne).toHaveBeenCalledWith({
        name: 'CUSTOM_RECEPTIONIST',
      });
      expect(rolesRepo.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe('role-custom-1');
    });

    it('should throw ConflictException if role name already exists', async () => {
      rolesRepo.findOne.mockResolvedValue(mockCustomRole);

      await expect(
        service.create(
          { name: 'CUSTOM_RECEPTIONIST', organizationId: 'org-demo' },
          'user-admin',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update a custom role', async () => {
      rolesRepo.findById.mockResolvedValue(mockCustomRole);
      rolesRepo.update.mockResolvedValue({
        ...mockCustomRole,
        description: 'New Description',
      });

      const result = await service.update(
        'role-custom-1',
        { description: 'New Description' },
        'user-admin',
      );

      expect(rolesRepo.update).toHaveBeenCalled();
      expect(result.description).toBe('New Description');
    });

    it('should throw ForbiddenException if trying to update a system role', async () => {
      rolesRepo.findById.mockResolvedValue(mockSystemRole);

      await expect(
        service.update(
          'role-system-1',
          { description: 'Blocked' },
          'user-admin',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('softDelete', () => {
    it('should delete role and bust cache for users assigned to it', async () => {
      rolesRepo.findById.mockResolvedValue(mockCustomRole);
      rolesRepo.findUsersOfRole.mockResolvedValue([
        {
          id: 'ur-1',
          userId: 'user-1',
          roleId: 'role-custom-1',
          assignedAt: new Date(),
          assignedBy: null,
          user: {
            id: 'user-1',
            fullName: 'Test User',
            email: 'test@hospital.com',
            isActive: true,
          },
        },
      ]);

      await service.softDelete('role-custom-1', 'user-admin');

      expect(rolesRepo.softDelete).toHaveBeenCalledWith(
        'role-custom-1',
        'user-admin',
      );
      expect(cacheService.del).toHaveBeenCalledWith('auth:user:user-1');
    });

    it('should throw ForbiddenException if trying to delete a system role', async () => {
      rolesRepo.findById.mockResolvedValue(mockSystemRole);

      await expect(
        service.softDelete('role-system-1', 'user-admin'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assignPermissions', () => {
    it('should assign permissions and invalidate assigned users cache', async () => {
      rolesRepo.findById.mockResolvedValue(mockCustomRole);
      (prismaService.permission.findMany as jest.Mock).mockResolvedValue([
        { id: 'perm-1' },
      ]);
      rolesRepo.findUsersOfRole.mockResolvedValue([
        {
          id: 'ur-1',
          userId: 'user-1',
          roleId: 'role-custom-1',
          assignedAt: new Date(),
          assignedBy: null,
          user: {
            id: 'user-1',
            fullName: 'Test User',
            email: 'test@hospital.com',
            isActive: true,
          },
        },
      ]);

      await service.assignPermissions(
        'role-custom-1',
        {
          permissions: [
            {
              permissionId: 'perm-1',
              canRead: true,
              canUpdate: false,
              canCreate: false,
              canDelete: false,
            },
          ],
        },
        'user-admin',
      );

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalledWith('auth:user:user-1');
    });
  });

  describe('assignUserToRole', () => {
    it('should link user to role and invalidate user auth cache', async () => {
      rolesRepo.findById.mockResolvedValue(mockCustomRole);
      userRepo.findById.mockResolvedValue(mockUser);
      (prismaService.userRole.findUnique as jest.Mock).mockResolvedValue(null);

      await service.assignUserToRole('role-custom-1', 'user-1', 'user-admin');

      expect(prismaService.userRole.create).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalledWith('auth:user:user-1');
    });
  });
});
