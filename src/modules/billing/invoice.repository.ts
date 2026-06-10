import { Injectable } from '@nestjs/common';
import { Prisma, Invoice } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import {
  PaginatedResult,
  PaginationMeta,
} from '../../common/types/paginated.type';

@Injectable()
export class InvoiceRepository extends BaseRepository<
  Invoice,
  Prisma.InvoiceCreateInput,
  Prisma.InvoiceUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'invoice');
  }

  override async findById(id: string): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
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
  ): Promise<Invoice[]> {
    const { include, orderBy } = options;
    return this.prisma.invoice.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string, deletedBy?: string): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledById: deletedBy,
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
  ): Promise<PaginatedResult<Invoice>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.InvoiceOrderByWithRelationInput
          | Prisma.InvoiceOrderByWithRelationInput[],
      }),
      this.prisma.invoice.count({ where: where }),
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
    return this.prisma.invoice.count({
      where: where,
    });
  }

  async sumOutstandingBalance(organizationId: string): Promise<number> {
    const result = await this.prisma.invoice.aggregate({
      where: {
        organizationId,
        paymentStatus: { in: ['unpaid', 'partially_paid'] },
      },
      _sum: { balanceDue: true },
    });
    return result._sum.balanceDue || 0;
  }
}
