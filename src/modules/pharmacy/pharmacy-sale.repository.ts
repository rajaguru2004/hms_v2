import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma, PharmacySale } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@Injectable()
export class PharmacySaleRepository extends BaseRepository<
  PharmacySale,
  Prisma.PharmacySaleCreateInput,
  Prisma.PharmacySaleUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'pharmacySale');
  }

  override async findById(id: string): Promise<PharmacySale | null> {
    return this.prisma.pharmacySale.findFirst({
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
  ): Promise<PharmacySale[]> {
    const { include, orderBy } = options;
    return this.prisma.pharmacySale.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<PharmacySale | null> {
    return this.prisma.pharmacySale.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override softDelete(): Promise<PharmacySale> {
    return Promise.reject(
      new AppException(
        'Soft delete is not supported for pharmacy sales.',
        ErrorCodes.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
      ),
    );
  }

  override restore(): Promise<PharmacySale> {
    return Promise.reject(
      new AppException(
        'Restore is not supported for pharmacy sales.',
        ErrorCodes.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
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
    } = {},
  ): Promise<PaginatedResult<PharmacySale>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { saleDate: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.pharmacySale.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.PharmacySaleOrderByWithRelationInput
          | Prisma.PharmacySaleOrderByWithRelationInput[],
      }),
      this.prisma.pharmacySale.count({ where }),
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
    return this.prisma.pharmacySale.count({ where });
  }
}
