import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma, LabResult } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@Injectable()
export class LabResultRepository extends BaseRepository<
  LabResult,
  Prisma.LabResultCreateInput,
  Prisma.LabResultUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'labResult');
  }

  override async findById(id: string): Promise<LabResult | null> {
    return this.prisma.labResult.findFirst({
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
  ): Promise<LabResult[]> {
    const { include, orderBy } = options;
    return this.prisma.labResult.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<LabResult | null> {
    return this.prisma.labResult.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override softDelete(): Promise<LabResult> {
    return Promise.reject(
      new AppException(
        'Soft delete is not supported for lab results.',
        ErrorCodes.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
      ),
    );
  }

  override restore(): Promise<LabResult> {
    return Promise.reject(
      new AppException(
        'Restore is not supported for lab results.',
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
  ): Promise<PaginatedResult<LabResult>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.labResult.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.LabResultOrderByWithRelationInput
          | Prisma.LabResultOrderByWithRelationInput[],
      }),
      this.prisma.labResult.count({ where }),
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
    return this.prisma.labResult.count({ where });
  }
}
