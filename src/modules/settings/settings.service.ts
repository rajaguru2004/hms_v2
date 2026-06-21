import { Injectable } from '@nestjs/common';
import { Department, MachineIntegration, User, Prisma } from '@prisma/client';
import { DepartmentRepository } from './repositories/department.repository';
import { OrganizationRepository } from './repositories/organization.repository';
import { UserRepository } from '../users/user.repository';
import { MachineIntegrationRepository } from '../integrations/machine-integration.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateSettingsIntegrationDto,
  UpdateSettingsIntegrationDto,
  UpdateModulesDto,
  UpdateOrganizationDto,
  CreateSettingsUserDto,
  UpdateSettingsUserDto,
} from './dto/settings.dto';

export interface OrganizationWithModules {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  logoTextUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  settings: Record<string, unknown>;
  subscriptionTier: string;
  subscriptionStatus: string;
  subscriptionStartedAt: Date | null;
  subscriptionEndsAt: Date | null;
  modulesEnabled: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}

export interface DepartmentWithUsers extends Department {
  users: { id: string; fullName: string; role: string | null }[];
}

export interface FormattedDepartment {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  headId: string | null;
  headName: string | null;
  isActive: boolean;
  userCount: number;
  createdAt: Date;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly departmentRepository: DepartmentRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly userRepository: UserRepository,
    private readonly machineIntegrationRepository: MachineIntegrationRepository,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly ORG_CACHE_PREFIX = 'organization';
  private readonly DEPT_CACHE_PREFIX = 'department';
  private readonly USER_CACHE_PREFIX = 'user';

  // ── DEPARTMENTS ────────────────────────────────────────────────────────────

  async findAllDepartments(
    organizationId: string,
  ): Promise<FormattedDepartment[]> {
    const departments = (await this.departmentRepository.findMany(
      { organizationId },
      {
        include: {
          users: {
            select: { id: true, fullName: true, role: true },
          },
        },
        orderBy: { name: 'asc' },
      },
    )) as unknown as DepartmentWithUsers[];

    // Get count of users per department
    const departmentsWithCounts = await Promise.all(
      departments.map(async (dept) => {
        const userCount = await this.prisma.user.count({
          where: { departmentId: dept.id, isDeleted: false },
        });

        const head = dept.headId
          ? dept.users.find((u) => u.id === dept.headId)
          : null;

        return {
          id: dept.id,
          name: dept.name,
          code: dept.code,
          description: dept.description,
          headId: dept.headId,
          headName: head?.fullName || null,
          isActive: dept.isActive,
          userCount,
          createdAt: dept.createdAt,
        };
      }),
    );

    return departmentsWithCounts;
  }

  async findDepartmentById(id: string): Promise<DepartmentWithUsers> {
    const cacheKey = AppCacheService.buildKey(this.DEPT_CACHE_PREFIX, id);
    const cached = await this.cacheService.get<DepartmentWithUsers>(cacheKey);
    if (cached) return cached;

    const department = await this.prisma.department.findUnique({
      where: { id },
      include: {
        users: {
          where: { isDeleted: false },
          select: { id: true, fullName: true, role: true },
        },
      },
    });

    if (!department) {
      throw new NotFoundException(
        'Department not found',
        ErrorCodes.DEPARTMENT_NOT_FOUND,
      );
    }

    const typedDepartment = department;
    await this.cacheService.set(cacheKey, typedDepartment, 300);
    return typedDepartment;
  }

  async createDepartment(
    dto: CreateDepartmentDto,
    userId?: string,
  ): Promise<Department> {
    const department = await this.departmentRepository.create({
      organization: { connect: { id: dto.organizationId } },
      name: dto.name,
      code: dto.code,
      description: dto.description,
      headId: dto.headId,
      isActive: dto.isActive ?? true,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Department',
      entityId: department.id,
      newValues: {
        name: department.name,
        code: department.code,
      },
      metadata: { organizationId: dto.organizationId },
    });

    return department;
  }

  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    userId?: string,
  ): Promise<Department> {
    const existing = await this.departmentRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(
        'Department not found',
        ErrorCodes.DEPARTMENT_NOT_FOUND,
      );
    }

    const updated = await this.departmentRepository.update(id, dto);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.DEPT_CACHE_PREFIX, id),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Department',
      entityId: id,
      oldValues: {
        name: existing.name,
        code: existing.code,
        headId: existing.headId,
        isActive: existing.isActive,
      },
      newValues: {
        name: updated.name,
        code: updated.code,
        headId: updated.headId,
        isActive: updated.isActive,
      },
      metadata: { organizationId: existing.organizationId },
    });

    return updated;
  }

  async deleteDepartment(id: string, userId?: string): Promise<void> {
    const existing = await this.departmentRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(
        'Department not found',
        ErrorCodes.DEPARTMENT_NOT_FOUND,
      );
    }

    // First remove department association from users
    await this.prisma.user.updateMany({
      where: { departmentId: id },
      data: { departmentId: null },
    });

    await this.departmentRepository.softDelete(id);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.DEPT_CACHE_PREFIX, id),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      entityName: 'Department',
      entityId: id,
      metadata: { organizationId: existing.organizationId },
    });
  }

  // ── INTEGRATIONS ───────────────────────────────────────────────────────────

  async findAllIntegrations(
    organizationId: string,
  ): Promise<MachineIntegration[]> {
    return this.machineIntegrationRepository.findMany(
      { organizationId },
      { orderBy: { createdAt: 'desc' } },
    );
  }

  async findIntegrationById(
    id: string,
    organizationId: string,
  ): Promise<MachineIntegration> {
    const integration = await this.machineIntegrationRepository.findById(id);
    if (!integration || integration.organizationId !== organizationId) {
      throw new NotFoundException(
        'Machine integration not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }
    return integration;
  }

  async createIntegration(
    dto: CreateSettingsIntegrationDto,
    userId?: string,
  ): Promise<MachineIntegration> {
    const connectionDetails = JSON.stringify({
      ipAddress: dto.ipAddress || '',
      port: dto.port || null,
      apiEndpoint: dto.apiEndpoint || '',
      apiKey: dto.apiKey || '',
    });

    const integration = await this.machineIntegrationRepository.create({
      organization: { connect: { id: dto.organizationId } },
      machineName: dto.machineName,
      machineType: dto.machineType,
      model: dto.machineModel,
      manufacturer: dto.manufacturer,
      serialNumber: dto.serialNumber,
      connectionType: dto.connectionType,
      connectionDetails,
      testMapping: JSON.stringify({}),
      department: dto.department,
      isActive: dto.isActive ?? true,
      connectionStatus: 'disconnected',
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'MachineIntegration',
      entityId: integration.id,
      newValues: {
        machineName: integration.machineName,
        machineType: integration.machineType,
      },
      metadata: { organizationId: dto.organizationId },
    });

    return integration;
  }

  async updateIntegration(
    id: string,
    organizationId: string,
    dto: UpdateSettingsIntegrationDto,
    userId?: string,
  ): Promise<MachineIntegration> {
    const existing = await this.machineIntegrationRepository.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException(
        'Machine integration not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }

    const updateData: Record<
      string,
      string | number | boolean | null | undefined
    > = {};
    if (dto.machineName !== undefined) updateData.machineName = dto.machineName;
    if (dto.machineType !== undefined) updateData.machineType = dto.machineType;
    if (dto.machineModel !== undefined) updateData.model = dto.machineModel;
    if (dto.manufacturer !== undefined)
      updateData.manufacturer = dto.manufacturer;
    if (dto.serialNumber !== undefined)
      updateData.serialNumber = dto.serialNumber;
    if (dto.connectionType !== undefined)
      updateData.connectionType = dto.connectionType;
    if (dto.department !== undefined) updateData.department = dto.department;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.connectionStatus !== undefined)
      updateData.connectionStatus = dto.connectionStatus;

    if (
      dto.ipAddress !== undefined ||
      dto.port !== undefined ||
      dto.apiEndpoint !== undefined ||
      dto.apiKey !== undefined
    ) {
      const current = existing.connectionDetails
        ? (JSON.parse(existing.connectionDetails) as Record<
            string,
            string | number | null
          >)
        : {};
      updateData.connectionDetails = JSON.stringify({
        ...current,
        ipAddress:
          dto.ipAddress !== undefined ? dto.ipAddress : current.ipAddress,
        port: dto.port !== undefined ? dto.port : current.port,
        apiEndpoint:
          dto.apiEndpoint !== undefined ? dto.apiEndpoint : current.apiEndpoint,
        apiKey: dto.apiKey !== undefined ? dto.apiKey : current.apiKey,
      });
    }

    // Cast payload explicitly at the call site to fit Repository generic parameter
    const updated = await this.machineIntegrationRepository.update(
      id,
      updateData,
    );

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'MachineIntegration',
      entityId: id,
      oldValues: {
        machineName: existing.machineName,
        isActive: existing.isActive,
        connectionStatus: existing.connectionStatus,
      },
      newValues: {
        machineName: updated.machineName,
        isActive: updated.isActive,
        connectionStatus: updated.connectionStatus,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  async deleteIntegration(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    const existing = await this.machineIntegrationRepository.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException(
        'Machine integration not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }

    // Hard delete to preserve Next.js behavior
    await this.machineIntegrationRepository.hardDelete(id);

    void this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      entityName: 'MachineIntegration',
      entityId: id,
      metadata: { organizationId },
    });
  }

  // ── MODULES ────────────────────────────────────────────────────────────────

  async updateModules(
    dto: UpdateModulesDto,
    userId?: string,
  ): Promise<OrganizationWithModules> {
    const org = await this.organizationRepository.findById(dto.organizationId);
    if (!org) {
      throw new NotFoundException(
        'Organization not found',
        ErrorCodes.ORGANIZATION_NOT_FOUND,
      );
    }

    const updated = await this.organizationRepository.update(
      dto.organizationId,
      {
        modulesEnabled: JSON.stringify(dto.modulesEnabled),
      },
    );

    // Invalidate organization cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.ORG_CACHE_PREFIX, dto.organizationId),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Organization',
      entityId: dto.organizationId,
      oldValues: { modulesEnabled: org.modulesEnabled },
      newValues: { modulesEnabled: updated.modulesEnabled },
      metadata: { organizationId: dto.organizationId },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logoUrl: updated.logoUrl,
      logoTextUrl: updated.logoTextUrl,
      primaryColor: updated.primaryColor,
      secondaryColor: updated.secondaryColor,
      email: updated.email,
      phone: updated.phone,
      address: updated.address,
      city: updated.city,
      region: updated.region,
      country: updated.country,
      subscriptionTier: updated.subscriptionTier,
      subscriptionStatus: updated.subscriptionStatus,
      subscriptionStartedAt: updated.subscriptionStartedAt,
      subscriptionEndsAt: updated.subscriptionEndsAt,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      createdById: updated.createdById,
      modulesEnabled: JSON.parse(updated.modulesEnabled || '{}') as Record<
        string,
        unknown
      >,
      settings: JSON.parse(updated.settings || '{}') as Record<string, unknown>,
    };
  }

  // ── ORGANIZATION ───────────────────────────────────────────────────────────

  async findOrganizationById(id: string): Promise<OrganizationWithModules> {
    const cacheKey = AppCacheService.buildKey(this.ORG_CACHE_PREFIX, id);
    const cached =
      await this.cacheService.get<OrganizationWithModules>(cacheKey);
    if (cached) return cached;

    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException(
        'Organization not found',
        ErrorCodes.ORGANIZATION_NOT_FOUND,
      );
    }

    const response: OrganizationWithModules = {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl,
      logoTextUrl: organization.logoTextUrl,
      primaryColor: organization.primaryColor,
      secondaryColor: organization.secondaryColor,
      email: organization.email,
      phone: organization.phone,
      address: organization.address,
      city: organization.city,
      region: organization.region,
      country: organization.country,
      subscriptionTier: organization.subscriptionTier,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionStartedAt: organization.subscriptionStartedAt,
      subscriptionEndsAt: organization.subscriptionEndsAt,
      isActive: organization.isActive,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      createdById: organization.createdById,
      settings: JSON.parse(organization.settings || '{}') as Record<
        string,
        unknown
      >,
      modulesEnabled: JSON.parse(organization.modulesEnabled || '{}') as Record<
        string,
        unknown
      >,
    };

    await this.cacheService.set(cacheKey, response, 300);
    return response;
  }

  async updateOrganization(
    dto: UpdateOrganizationDto,
    userId?: string,
  ): Promise<OrganizationWithModules> {
    const existing = await this.organizationRepository.findById(dto.id);
    if (!existing) {
      throw new NotFoundException(
        'Organization not found',
        ErrorCodes.ORGANIZATION_NOT_FOUND,
      );
    }

    const { id, settings, modulesEnabled, ...updateData } = dto;
    const updatePayload: Record<string, string | boolean | undefined> = {
      ...updateData,
    };

    if (settings !== undefined) {
      updatePayload.settings = JSON.stringify(settings);
    }
    if (modulesEnabled !== undefined) {
      updatePayload.modulesEnabled = JSON.stringify(modulesEnabled);
    }

    const updated = await this.organizationRepository.update(id, updatePayload);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.ORG_CACHE_PREFIX, id),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Organization',
      entityId: id,
      oldValues: {
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
      },
      newValues: {
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
      },
      metadata: { organizationId: id },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logoUrl: updated.logoUrl,
      logoTextUrl: updated.logoTextUrl,
      primaryColor: updated.primaryColor,
      secondaryColor: updated.secondaryColor,
      email: updated.email,
      phone: updated.phone,
      address: updated.address,
      city: updated.city,
      region: updated.region,
      country: updated.country,
      subscriptionTier: updated.subscriptionTier,
      subscriptionStatus: updated.subscriptionStatus,
      subscriptionStartedAt: updated.subscriptionStartedAt,
      subscriptionEndsAt: updated.subscriptionEndsAt,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      createdById: updated.createdById,
      settings: JSON.parse(updated.settings || '{}') as Record<string, unknown>,
      modulesEnabled: JSON.parse(updated.modulesEnabled || '{}') as Record<
        string,
        unknown
      >,
    };
  }

  // ── USERS ──────────────────────────────────────────────────────────────────

  async findAllUsers(organizationId: string, role?: string): Promise<User[]> {
    const where: Record<string, string> = { organizationId };
    if (role) {
      where.role = role;
    }

    return this.userRepository.findMany(where, {
      include: {
        department: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUserById(id: string): Promise<User> {
    const cacheKey = AppCacheService.buildKey(this.USER_CACHE_PREFIX, id);
    const cached = await this.cacheService.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.userRepository.findOne(
      { id },
      {
        department: {
          select: { id: true, name: true },
        },
      },
    );

    if (!user) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    await this.cacheService.set(cacheKey, user, 300);
    return user;
  }

  async createUser(dto: CreateSettingsUserDto, userId?: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(
        'Email already in use',
        ErrorCodes.USER_EMAIL_TAKEN,
      );
    }

    const organizationId = dto.organizationId || 'org-demo';

    const user = await this.userRepository.create({
      organization: { connect: { id: organizationId } },
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      employeeId: dto.employeeId,
      role: dto.role,
      ...(dto.departmentId && {
        department: { connect: { id: dto.departmentId } },
      }),
      specialization: dto.specialization,
      licenseNumber: dto.licenseNumber,
      isActive: dto.isActive ?? true,
      createdById: userId,
    });

    if (dto.role) {
      const role = await this.prisma.role.findUnique({
        where: { name: dto.role },
      });
      if (role) {
        await this.prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            assignedBy: userId,
          },
        });
      }
    }

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'User',
      entityId: user.id,
      newValues: {
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      metadata: { organizationId },
    });

    return user;
  }

  async updateUser(
    id: string,
    dto: UpdateSettingsUserDto,
    userId?: string,
  ): Promise<User> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    const updateData: Prisma.UserUpdateInput & { updatedBy?: string } = {};
    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.employeeId !== undefined) updateData.employeeId = dto.employeeId;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.specialization !== undefined)
      updateData.specialization = dto.specialization;
    if (dto.licenseNumber !== undefined)
      updateData.licenseNumber = dto.licenseNumber;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    if (dto.departmentId !== undefined) {
      if (dto.departmentId) {
        updateData.department = { connect: { id: dto.departmentId } };
      } else {
        updateData.department = { disconnect: true };
      }
    }

    const updated = await this.userRepository.update(id, updateData);

    if (dto.role !== undefined) {
      if (dto.role) {
        const role = await this.prisma.role.findUnique({
          where: { name: dto.role },
        });
        if (role) {
          await this.prisma.userRole.deleteMany({
            where: { userId: id },
          });
          await this.prisma.userRole.create({
            data: {
              userId: id,
              roleId: role.id,
              assignedBy: userId,
            },
          });
        }
      } else {
        await this.prisma.userRole.deleteMany({
          where: { userId: id },
        });
      }
    }

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.USER_CACHE_PREFIX, id),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'User',
      entityId: id,
      oldValues: {
        fullName: existing.fullName,
        isActive: existing.isActive,
      },
      newValues: {
        fullName: updated.fullName,
        isActive: updated.isActive,
      },
      metadata: { organizationId: existing.organizationId },
    });

    return updated;
  }

  async deleteUser(id: string, userId?: string): Promise<void> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    // Soft delete compliant with rules.md
    await this.userRepository.softDelete(id, userId);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.USER_CACHE_PREFIX, id),
    );

    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'User',
      entityId: id,
      metadata: { organizationId: existing.organizationId },
    });
  }
}
