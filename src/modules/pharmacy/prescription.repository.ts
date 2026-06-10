import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma, Prescription } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@Injectable()
export class PrescriptionRepository extends BaseRepository<
  Prescription,
  Prisma.PrescriptionCreateInput,
  Prisma.PrescriptionUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'prescription');
  }

  override async findById(id: string): Promise<Prescription | null> {
    return this.prisma.prescription.findFirst({
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
  ): Promise<Prescription[]> {
    const { include, orderBy } = options;
    return this.prisma.prescription.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Prescription | null> {
    return this.prisma.prescription.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override softDelete(): Promise<Prescription> {
    return Promise.reject(
      new AppException(
        'Soft delete is not supported for prescriptions.',
        ErrorCodes.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
      ),
    );
  }

  override restore(): Promise<Prescription> {
    return Promise.reject(
      new AppException(
        'Restore is not supported for prescriptions.',
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
  ): Promise<PaginatedResult<Prescription>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { prescriptionDate: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.PrescriptionOrderByWithRelationInput
          | Prisma.PrescriptionOrderByWithRelationInput[],
      }),
      this.prisma.prescription.count({ where }),
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
    return this.prisma.prescription.count({ where });
  }
}
