import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

/**
 * UserRepository — concrete repository for User entity.
 *
 * Extends BaseRepository for standard CRUD/paginate/softDelete.
 * Add domain-specific query methods here only.
 * Services NEVER call prisma directly.
 */
@Injectable()
export class UserRepository extends BaseRepository<
  User,
  Prisma.UserCreateInput,
  Prisma.UserUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'user');
  }

  /**
   * Find user by email — used in auth for login validation.
   * Includes active check.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
  }

  /**
   * Find user with their roles and permissions — used in JWT strategy.
   * Returns the user object with nested roles → permissions.
   */
  async findByIdWithRolesAndPermissions(id: string): Promise<
    | (User & {
        userRoles: {
          role: {
            name: string;
            rolePermissions: { permission: { name: string } }[];
          };
        }[];
      })
    | null
  > {
    return this.prisma.user.findFirst({
      where: { id, isDeleted: false },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Search users by name or email — for admin user search.
   */
  async searchUsers(query: string, page: number, limit: number) {
    const where: Prisma.UserWhereInput = {
      isDeleted: false,
      OR: [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total };
  }
}
