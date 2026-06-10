import { Injectable } from '@nestjs/common';
import { Prisma, BillingService } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import {
  PaginatedResult,
  PaginationMeta,
} from '../../common/types/paginated.type';

@Injectable()
export class BillingServiceRepository extends BaseRepository<
  BillingService,
  Prisma.BillingServiceCreateInput,
  Prisma.BillingServiceUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'billingService');
  }

  override async findById(id: string): Promise<BillingService | null> {
    return this.prisma.billingService.findFirst({
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
      includeDeleted?: boolean;
    } = {},
  ): Promise<BillingService[]> {
    const { include, orderBy } = options;
    return this.prisma.billingService.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<BillingService | null> {
    return this.prisma.billingService.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<BillingService> {
    // For BillingService, soft delete corresponds to setting isActive = false
    return this.prisma.billingService.update({
      where: { id },
      data: {
        isActive: false,
      },
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
      includeDeleted?: boolean;
    } = {},
  ): Promise<PaginatedResult<BillingService>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.billingService.findMany({
        where: where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.BillingServiceOrderByWithRelationInput
          | Prisma.BillingServiceOrderByWithRelationInput[],
      }),
      this.prisma.billingService.count({
        where: where,
      }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    const meta: PaginationMeta = {
      page,
      limit: safeLimit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return { data, meta };
  }

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.billingService.count({
      where: where,
    });
  }
}
