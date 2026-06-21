/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { DepartmentRepository } from './repositories/department.repository';
import { OrganizationRepository } from './repositories/organization.repository';
import { UserRepository } from '../users/user.repository';
import { MachineIntegrationRepository } from '../integrations/machine-integration.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import {
  Department,
  MachineIntegration,
  Organization,
  User,
} from '@prisma/client';

describe('SettingsService', () => {
  let service: SettingsService;
  let departmentRepo: jest.Mocked<DepartmentRepository>;
  let organizationRepo: jest.Mocked<OrganizationRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let machineIntegrationRepo: jest.Mocked<MachineIntegrationRepository>;
  let auditService: jest.Mocked<AuditService>;
  let cacheService: jest.Mocked<AppCacheService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockDepartment: Department = {
    id: 'dept-1',
    organizationId: 'org-demo',
    name: 'Cardiology',
    code: 'CARD',
    description: 'Cardiology Department',
    headId: 'user-1',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOrganization: Organization = {
    id: 'org-demo',
    name: 'Default Hospital',
    slug: 'default-hospital',
    logoUrl: null,
    logoTextUrl: null,
    primaryColor: '#2563eb',
    secondaryColor: '#7c3aed',
    email: 'info@hospital.com',
    phone: '123456',
    address: '123 Health St',
    city: 'Addis',
    region: 'Addis',
    country: 'Ethiopia',
    settings: '{}',
    subscriptionTier: 'basic',
    subscriptionStatus: 'active',
    subscriptionStartedAt: null,
    subscriptionEndsAt: null,
    modulesEnabled: '{}',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
  };

  const mockUser: User = {
    id: 'user-1',
    organizationId: 'org-demo',
    email: 'alice@hospital.com',
    password: 'hashedpassword',
    fullName: 'Alice Smith',
    firstName: 'Alice',
    lastName: 'Smith',
    phone: '123456',
    dateOfBirth: null,
    gender: null,
    address: null,
    employeeId: 'EMP001',
    role: 'DOCTOR',
    departmentId: 'dept-1',
    specialization: 'Cardiology',
    licenseNumber: 'LIC12345',
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

  const mockIntegration: MachineIntegration = {
    id: 'mac-1',
    organizationId: 'org-demo',
    machineName: 'Sysmex X1',
    machineType: 'lab_analyzer',
    manufacturer: 'Sysmex',
    model: 'X1',
    serialNumber: 'SN-123',
    department: 'laboratory',
    connectionType: 'file_upload',
    connectionDetails: JSON.stringify({ ipAddress: '127.0.0.1' }),
    testMapping: '{}',
    isActive: true,
    connectionStatus: 'connected',
    lastConnectedAt: null,
    lastResultReceivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  beforeEach(async () => {
    const mockDeptRepository = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const mockOrgRepository = {
      findById: jest.fn(),
      update: jest.fn(),
    };

    const mockUserRepository = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findByEmail: jest.fn(),
    };

    const mockMachineRepository = {
      findById: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      hardDelete: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const mockPrisma = {
      user: {
        count: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      department: {
        findUnique: jest.fn(),
      },
      role: {
        findUnique: jest.fn(),
      },
      userRole: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DepartmentRepository, useValue: mockDeptRepository },
        { provide: OrganizationRepository, useValue: mockOrgRepository },
        { provide: UserRepository, useValue: mockUserRepository },
        {
          provide: MachineIntegrationRepository,
          useValue: mockMachineRepository,
        },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppCacheService, useValue: mockCache },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    departmentRepo = module.get(DepartmentRepository);
    organizationRepo = module.get(OrganizationRepository);
    userRepo = module.get(UserRepository);
    machineIntegrationRepo = module.get(MachineIntegrationRepository);
    auditService = module.get(AuditService);
    cacheService = module.get(AppCacheService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('departments', () => {
    it('should create department and log audit', async () => {
      departmentRepo.create.mockResolvedValue(mockDepartment);
      const result = await service.createDepartment(
        {
          organizationId: 'org-demo',
          name: 'Cardiology',
          code: 'CARD',
        },
        'user-1',
      );

      expect(departmentRepo.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe('dept-1');
    });

    it('should throw if department not found during update', async () => {
      departmentRepo.findById.mockResolvedValue(null);
      await expect(
        service.updateDepartment('invalid-id', { name: 'New Name' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delete department after clearing user association', async () => {
      departmentRepo.findById.mockResolvedValue(mockDepartment);
      await service.deleteDepartment('dept-1', 'user-1');
      expect(prismaService.user.updateMany).toHaveBeenCalledWith({
        where: { departmentId: 'dept-1' },
        data: { departmentId: null },
      });
      expect(departmentRepo.softDelete).toHaveBeenCalledWith('dept-1');
      expect(cacheService.del).toHaveBeenCalled();
    });
  });

  describe('integrations', () => {
    it('should return integration by ID', async () => {
      machineIntegrationRepo.findById.mockResolvedValue(mockIntegration);
      const result = await service.findIntegrationById('mac-1', 'org-demo');
      expect(result.id).toBe('mac-1');
    });
  });

  describe('organization', () => {
    it('should update organization modules and invalidate cache', async () => {
      organizationRepo.findById.mockResolvedValue(mockOrganization);
      organizationRepo.update.mockResolvedValue(mockOrganization);
      const result = await service.updateModules(
        {
          organizationId: 'org-demo',
          modulesEnabled: { pharmacy: true },
        },
        'user-1',
      );
      expect(organizationRepo.update).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalled();
      expect(result.id).toBe('org-demo');
    });
  });

  describe('users', () => {
    it('should create a settings user if email is free', async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);
      userRepo.create.mockResolvedValue(mockUser);
      const result = await service.createUser(
        {
          fullName: 'Alice Smith',
          email: 'alice@hospital.com',
          role: 'DOCTOR',
        },
        'user-1',
      );
      expect(userRepo.create).toHaveBeenCalled();
      expect(result.id).toBe('user-1');
    });

    it('should throw ConflictException if email is taken', async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      await expect(
        service.createUser(
          {
            fullName: 'Alice Smith',
            email: 'alice@hospital.com',
            role: 'DOCTOR',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
