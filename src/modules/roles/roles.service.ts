import { Injectable } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { RolesRepository } from './roles.repository';
import { UserRepository } from '../users/user.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { AuthCacheService } from '../../cache/auth-cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
} from './dto/roles.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly authCache: AuthCacheService,
    private readonly rolesRepository: RolesRepository,
    private readonly userRepository: UserRepository,
    private readonly auditService: AuditService,
    private readonly cacheService: AppCacheService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly ROLE_CACHE_PREFIX = 'role';

  async findAll(organizationId: string): Promise<Role[]> {
    return this.rolesRepository.findMany(
      {
        OR: [
          { organizationId },
          { organizationId: null }, // System roles have null org
        ],
      },
      { orderBy: { name: 'asc' } },
    );
  }

  async findById(id: string) {
    const role = await this.rolesRepository.findByIdWithPermissions(id);
    if (!role) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }
    return role;
  }

  async create(dto: CreateRoleDto, userId?: string): Promise<Role> {
    const nameUpper = dto.name.toUpperCase();
    const existing = await this.rolesRepository.findOne({ name: nameUpper });
    if (existing) {
      throw new ConflictException(
        'Role with this name already exists',
        ErrorCodes.ROLE_ALREADY_EXISTS,
      );
    }

    const role = await this.rolesRepository.create({
      name: nameUpper,
      description: dto.description,
      isSystem: false,
      organization: dto.organizationId
        ? { connect: { id: dto.organizationId } }
        : undefined,
      createdBy: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'Role',
      entityId: role.id,
      newValues: {
        name: role.name,
        description: role.description,
      },
      metadata: { organizationId: dto.organizationId },
    });

    return role;
  }

  async update(id: string, dto: UpdateRoleDto, userId?: string): Promise<Role> {
    const existing = await this.rolesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }

    if (existing.isSystem) {
      throw new ForbiddenException(
        'Cannot modify system roles',
        ErrorCodes.ROLE_SYSTEM_PROTECTED,
      );
    }

    const updatePayload: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) {
      const nameUpper = dto.name.toUpperCase();
      if (nameUpper !== existing.name) {
        const nameCollision = await this.rolesRepository.findOne({
          name: nameUpper,
        });
        if (nameCollision) {
          throw new ConflictException(
            'Role with this name already exists',
            ErrorCodes.ROLE_ALREADY_EXISTS,
          );
        }
        updatePayload.name = nameUpper;
      }
    }
    if (dto.description !== undefined) {
      updatePayload.description = dto.description;
    }

    const updated = await this.rolesRepository.update(id, {
      ...updatePayload,
      updatedBy: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'Role',
      entityId: id,
      oldValues: { name: existing.name, description: existing.description },
      newValues: { name: updated.name, description: updated.description },
      metadata: { organizationId: existing.organizationId ?? undefined },
    });

    return updated;
  }

  async softDelete(id: string, userId?: string): Promise<void> {
    const existing = await this.rolesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }

    if (existing.isSystem) {
      throw new ForbiddenException(
        'Cannot delete system roles',
        ErrorCodes.ROLE_SYSTEM_PROTECTED,
      );
    }

    // Soft delete role
    await this.rolesRepository.softDelete(id, userId);

    // Also bust cache for any users assigned this role since their roles list changes
    const assignedUsers = await this.rolesRepository.findUsersOfRole(id);
    await this.authCache.invalidateUsers(assignedUsers.map((ur) => ur.userId));

    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'Role',
      entityId: id,
      metadata: { organizationId: existing.organizationId ?? undefined },
    });
  }

  async assignPermissions(
    roleId: string,
    dto: AssignPermissionsDto,
    userId?: string,
  ): Promise<void> {
    const role = await this.rolesRepository.findById(roleId);
    if (!role) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }

    if (role.isSystem) {
      throw new ForbiddenException(
        'Cannot modify system roles permissions',
        ErrorCodes.ROLE_SYSTEM_PROTECTED,
      );
    }

    // Verify all permission IDs exist
    const permissionIds = dto.permissions.map((p) => p.permissionId);
    const existingPermissions = await this.prisma.permission.findMany({
      where: {
        id: { in: permissionIds },
        isDeleted: false,
      },
      select: { id: true },
    });

    if (existingPermissions.length !== permissionIds.length) {
      throw new NotFoundException(
        'One or more permissions not found',
        ErrorCodes.PERMISSION_NOT_FOUND,
      );
    }

    // Perform inside a transaction
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete all existing RolePermission rows
      await tx.rolePermission.deleteMany({
        where: { roleId },
      });

      // 2. Create new RolePermission rows
      for (const perm of dto.permissions) {
        await tx.rolePermission.create({
          data: {
            roleId,
            permissionId: perm.permissionId,
            roleName: role.name,
            canCreate: perm.canCreate,
            canRead: perm.canRead,
            canUpdate: perm.canUpdate,
            canDelete: perm.canDelete,
            assignedBy: userId,
          },
        });
      }
    });

    // Targeted Cache Invalidation:
    // Find all users assigned this role, then invalidate their jwt/auth cache
    const assignedUsers = await this.rolesRepository.findUsersOfRole(roleId);
    await this.authCache.invalidateUsers(assignedUsers.map((ur) => ur.userId));

    void this.auditService.log({
      userId,
      action: AuditAction.PERMISSION_ASSIGN,
      entityName: 'Role',
      entityId: roleId,
      newValues: {
        permissionCount: dto.permissions.length,
      },
      metadata: { organizationId: role.organizationId ?? undefined },
    });
  }

  async assignUserToRole(
    roleId: string,
    targetUserId: string,
    userId?: string,
  ): Promise<void> {
    const role = await this.rolesRepository.findById(roleId);
    if (!role) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }

    const user = await this.userRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    const existingUserRole = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: targetUserId,
          roleId,
        },
      },
    });

    if (!existingUserRole) {
      await this.prisma.userRole.create({
        data: {
          userId: targetUserId,
          roleId,
          assignedBy: userId,
        },
      });
    }

    // Invalidate the target user's auth cache
    await this.authCache.invalidateUser(targetUserId);

    void this.auditService.log({
      userId,
      action: AuditAction.ROLE_ASSIGN,
      entityName: 'User',
      entityId: targetUserId,
      newValues: { roleId, roleName: role.name },
      metadata: { organizationId: role.organizationId ?? undefined },
    });
  }

  async removeUserFromRole(
    roleId: string,
    targetUserId: string,
    userId?: string,
  ): Promise<void> {
    const role = await this.rolesRepository.findById(roleId);
    if (!role) {
      throw new NotFoundException('Role not found', ErrorCodes.ROLE_NOT_FOUND);
    }

    const user = await this.userRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundException('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    const userRole = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: targetUserId,
          roleId,
        },
      },
    });

    if (userRole) {
      await this.prisma.userRole.delete({
        where: {
          id: userRole.id,
        },
      });
    }

    // Invalidate the target user's auth cache
    await this.authCache.invalidateUser(targetUserId);

    void this.auditService.log({
      userId,
      action: AuditAction.ROLE_REVOKE,
      entityName: 'User',
      entityId: targetUserId,
      oldValues: { roleId, roleName: role.name },
      metadata: { organizationId: role.organizationId ?? undefined },
    });
  }
}
