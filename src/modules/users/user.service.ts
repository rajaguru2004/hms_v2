import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { UserRepository } from './user.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { hashPassword } from '../../common/utils/hash.util';
import { AuditAction } from '../../common/enums/action.enum';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/types/paginated.type';

/**
 * UserService — business logic for user management.
 *
 * Pattern:
 *  Controller → UserService → UserRepository → Prisma
 *
 * Responsibilities:
 * - Validation (email uniqueness, password checks)
 * - Password hashing (never in repository or controller)
 * - Cache management (read-through cache on findById)
 * - Audit logging (all create/update/delete operations)
 * - Never exposes password field in responses
 */
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly CACHE_PREFIX = 'user';

  /**
   * Create a new user.
   * - Checks email uniqueness
   * - Hashes password
   * - Logs audit
   */
  async create(
    dto: CreateUserDto,
    createdBy?: string,
  ): Promise<Omit<User, 'password'>> {
    // Check email uniqueness
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        `Email '${dto.email}' is already registered`,
        ErrorCodes.USER_EMAIL_TAKEN,
      );
    }

    const hashedPassword = await hashPassword(dto.password);

    // Resolve organizationId
    let organizationId = dto.organizationId;
    if (!organizationId) {
      const defaultOrg = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      if (!defaultOrg) {
        // Create default organization
        const newOrg = await this.prisma.organization.create({
          data: {
            name: 'Default Hospital',
            slug: 'default-hospital',
          },
        });
        organizationId = newOrg.id;
      } else {
        organizationId = defaultOrg.id;
      }
    }

    const fullName = `${dto.firstName} ${dto.lastName}`.trim();

    const user = await this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      fullName,
      phone: dto.phone,
      organization: { connect: { id: organizationId } },
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      gender: dto.gender,
      address: dto.address,
      employeeId: dto.employeeId,
      role: dto.role,
      department: dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : undefined,
      specialization: dto.specialization,
      licenseNumber: dto.licenseNumber,
      defaultCalendar: dto.defaultCalendar || 'ethiopian',
      createdBy,
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
            assignedBy: createdBy,
          },
        });
      }
    }

    // Audit: record creation
    void this.auditService.log({
      userId: createdBy,
      action: AuditAction.CREATE,
      entityName: 'User',
      entityId: user.id,
      newValues: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
      },
    });

    return this.sanitize(user);
  }

  /**
   * Find user by ID with cache read-through.
   */
  async findById(id: string): Promise<Omit<User, 'password'>> {
    const cacheKey = AppCacheService.buildKey(this.CACHE_PREFIX, id);

    // Cache read-through
    const cached =
      await this.cacheService.get<Omit<User, 'password'>>(cacheKey);
    if (cached) return cached;

    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    const sanitized = this.sanitize(user);
    await this.cacheService.set(cacheKey, sanitized, 300);

    return sanitized;
  }

  /**
   * Find active staff by role — used for doctor/nurse dropdowns in clinical modules.
   * Requires only PATIENT_READ permission (all clinical roles have this).
   * Returns a slim projection: id, fullName, email, role, specialization.
   */
  async findStaff(
    organizationId: string,
    role?: string,
  ): Promise<
    {
      id: string;
      fullName: string;
      email: string;
      role: string | null;
      specialization: string | null;
    }[]
  > {
    const where: Record<string, unknown> = {
      organizationId,
      isDeleted: false,
      isActive: true,
    };
    if (role) where.role = role;

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        specialization: true,
      },
      orderBy: { fullName: 'asc' },
    });

    return users;
  }

  /**
   * List users with pagination.
   */
  async findAll(
    pagination: PaginationDto,
  ): Promise<PaginatedResult<Omit<User, 'password'>>> {
    const result = await this.userRepository.paginate(
      {},
      {
        page: pagination.page,
        limit: pagination.take,
        orderBy: {
          [pagination.orderBy ?? 'createdAt']: pagination.orderDir ?? 'desc',
        },
      },
    );

    return {
      ...result,
      data: result.data.map((u) => this.sanitize(u)),
    };
  }

  /**
   * Update user profile.
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    updatedBy?: string,
  ): Promise<Omit<User, 'password'>> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    const updateData: Prisma.UserUpdateInput & { updatedBy?: string } = {
      ...dto,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      updatedBy,
    };
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const newFirstName =
        dto.firstName !== undefined ? dto.firstName : existing.firstName;
      const newLastName =
        dto.lastName !== undefined ? dto.lastName : existing.lastName;
      updateData.fullName = `${newFirstName || ''} ${newLastName || ''}`.trim();
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
              assignedBy: updatedBy,
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
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit: record changes
    void this.auditService.log({
      userId: updatedBy,
      action: AuditAction.UPDATE,
      entityName: 'User',
      entityId: id,
      oldValues: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        phone: existing.phone,
      },
      newValues: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
      },
    });

    return this.sanitize(updated);
  }

  /**
   * Soft delete user.
   */
  async remove(id: string, deletedBy?: string): Promise<void> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    await this.userRepository.softDelete(id, deletedBy);

    // Invalidate cache
    await this.cacheService.del(
      AppCacheService.buildKey(this.CACHE_PREFIX, id),
    );

    // Audit
    void this.auditService.log({
      userId: deletedBy,
      action: AuditAction.SOFT_DELETE,
      entityName: 'User',
      entityId: id,
    });
  }

  /**
   * Remove password from user object before returning to client.
   * NEVER return password hash to client, even in internal APIs.
   */
  private sanitize(user: User): Omit<User, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...sanitized } = user;
    return sanitized;
  }
}
