import { Injectable } from '@nestjs/common';
import { Prisma, IntegrationLog } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class IntegrationLogRepository extends BaseRepository<
  IntegrationLog,
  Prisma.IntegrationLogCreateInput,
  Prisma.IntegrationLogUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'integrationLog');
  }

  override async findById(id: string): Promise<IntegrationLog | null> {
    return this.prisma.integrationLog.findUnique({
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
  ): Promise<IntegrationLog[]> {
    const { include, orderBy } = options;
    return this.prisma.integrationLog.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<IntegrationLog | null> {
    return this.prisma.integrationLog.findFirst({
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
  ): Promise<PaginatedResult<IntegrationLog>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { logDate: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.integrationLog.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.IntegrationLogOrderByWithRelationInput
          | Prisma.IntegrationLogOrderByWithRelationInput[],
      }),
      this.prisma.integrationLog.count({ where }),
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
    return this.prisma.integrationLog.count({ where });
  }

  override async softDelete(id: string): Promise<IntegrationLog> {
    return this.prisma.integrationLog.delete({
      where: { id },
    });
  }
}
