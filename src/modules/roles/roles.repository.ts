import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class RolesRepository extends BaseRepository<
  Role,
  Prisma.RoleCreateInput,
  Prisma.RoleUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'role');
  }

  /**
   * Find role by ID with nested permissions.
   */
  async findByIdWithPermissions(id: string): Promise<
    | (Role & {
        rolePermissions: {
          id: string;
          permissionId: string;
          permission: {
            id: string;
            name: string;
            code: string | null;
            category: string | null;
            description: string | null;
          };
          canCreate: boolean;
          canRead: boolean;
          canUpdate: boolean;
          canDelete: boolean;
        }[];
      })
    | null
  > {
    return this.prisma.role.findFirst({
      where: { id, isDeleted: false },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    }); // Cast safely or define full prisma return type
  }

  /**
   * Find users assigned to a specific role.
   */
  async findUsersOfRole(roleId: string) {
    return this.prisma.userRole.findMany({
      where: { roleId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            isActive: true,
          },
        },
      },
    });
  }
}
