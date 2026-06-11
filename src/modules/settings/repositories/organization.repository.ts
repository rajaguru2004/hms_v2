import { Injectable } from '@nestjs/common';
import { Prisma, Organization } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../../common/types/paginated.type';

@Injectable()
export class OrganizationRepository extends BaseRepository<
  Organization,
  Prisma.OrganizationCreateInput,
  Prisma.OrganizationUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'organization');
  }

  override async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({
      where: { id },
    });
  }

  override async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
    } = {},
  ): Promise<Organization[]> {
    const { include, orderBy } = options;
    return this.prisma.organization.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Organization | null> {
    return this.prisma.organization.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override async paginate(
    where: Record<string, unknown> = {},
    options: {
      page?: number;
      limit?: number;
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
    } = {},
  ): Promise<PaginatedResult<Organization>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { name: 'asc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.OrganizationOrderByWithRelationInput
          | Prisma.OrganizationOrderByWithRelationInput[],
      }),
      this.prisma.organization.count({ where }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    return {
      data,
      meta: {
        page,
        limit: safeLimit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.organization.count({ where });
  }

  override async softDelete(id: string): Promise<Organization> {
    // Organization does not have isDeleted. We set isActive = false
    return this.prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
