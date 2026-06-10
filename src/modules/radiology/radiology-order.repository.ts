import { Injectable } from '@nestjs/common';
import { Prisma, RadiologyOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class RadiologyOrderRepository extends BaseRepository<
  RadiologyOrder,
  Prisma.RadiologyOrderCreateInput,
  Prisma.RadiologyOrderUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'radiologyOrder');
  }

  override async findById(id: string): Promise<RadiologyOrder | null> {
    return this.prisma.radiologyOrder.findFirst({ where: { id } });
  }

  override async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
    } = {},
  ): Promise<RadiologyOrder[]> {
    const { include, orderBy } = options;
    return this.prisma.radiologyOrder.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && {
        orderBy: orderBy as
          | Prisma.RadiologyOrderOrderByWithRelationInput
          | Prisma.RadiologyOrderOrderByWithRelationInput[],
      }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<RadiologyOrder | null> {
    return this.prisma.radiologyOrder.findFirst({
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
  ): Promise<PaginatedResult<RadiologyOrder>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.radiologyOrder.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.RadiologyOrderOrderByWithRelationInput
          | Prisma.RadiologyOrderOrderByWithRelationInput[],
      }),
      this.prisma.radiologyOrder.count({ where }),
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
    return this.prisma.radiologyOrder.count({ where });
  }
}
