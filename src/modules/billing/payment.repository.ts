import { Injectable } from '@nestjs/common';
import { Prisma, Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import {
  PaginatedResult,
  PaginationMeta,
} from '../../common/types/paginated.type';

@Injectable()
export class PaymentRepository extends BaseRepository<
  Payment,
  Prisma.PaymentCreateInput,
  Prisma.PaymentUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'payment');
  }

  override async findById(id: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
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
  ): Promise<Payment[]> {
    const { include, orderBy } = options;
    return this.prisma.payment.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override softDelete(): Promise<Payment> {
    return Promise.reject(
      new Error(
        'Soft delete not supported for Payment. Create a refund instead.',
      ),
    );
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
  ): Promise<PaginatedResult<Payment>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where: where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.PaymentOrderByWithRelationInput
          | Prisma.PaymentOrderByWithRelationInput[],
      }),
      this.prisma.payment.count({ where: where }),
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
    return this.prisma.payment.count({
      where: where,
    });
  }

  async sumPaymentsForDay(
    organizationId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: {
        organizationId,
        paymentDate: { gte: start, lte: end },
        isRefund: false,
      },
      _sum: { amount: true },
    });
    return result._sum.amount || 0;
  }
}
