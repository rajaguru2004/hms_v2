import { Injectable } from '@nestjs/common';
import { Prisma, Department } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../../common/types/paginated.type';

@Injectable()
export class DepartmentRepository extends BaseRepository<
  Department,
  Prisma.DepartmentCreateInput,
  Prisma.DepartmentUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'department');
  }

  override async findById(id: string): Promise<Department | null> {
    return this.prisma.department.findUnique({
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
  ): Promise<Department[]> {
    const { include, orderBy } = options;
    return this.prisma.department.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Department | null> {
    return this.prisma.department.findFirst({
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
  ): Promise<PaginatedResult<Department>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { name: 'asc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.DepartmentOrderByWithRelationInput
          | Prisma.DepartmentOrderByWithRelationInput[],
      }),
      this.prisma.department.count({ where }),
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
    return this.prisma.department.count({ where });
  }

  override async softDelete(id: string): Promise<Department> {
    // Department does not have isDeleted/deletedAt in schema.
    // We can hard delete it, or toggle isActive to false.
    // To preserve compatibility with Next.js DELETE route, we hard delete:
    return this.prisma.department.delete({
      where: { id },
    });
  }
}
