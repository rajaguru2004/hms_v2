import { Injectable } from '@nestjs/common';
import { Prisma, RadiologyExam } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class RadiologyExamRepository extends BaseRepository<
  RadiologyExam,
  Prisma.RadiologyExamCreateInput,
  Prisma.RadiologyExamUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'radiologyExam');
  }

  override async findById(id: string): Promise<RadiologyExam | null> {
    return this.prisma.radiologyExam.findFirst({ where: { id } });
  }

  override async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
    } = {},
  ): Promise<RadiologyExam[]> {
    const { include, orderBy } = options;
    return this.prisma.radiologyExam.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && {
        orderBy: orderBy as
          | Prisma.RadiologyExamOrderByWithRelationInput
          | Prisma.RadiologyExamOrderByWithRelationInput[],
      }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<RadiologyExam | null> {
    return this.prisma.radiologyExam.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<RadiologyExam> {
    return this.prisma.radiologyExam.update({
      where: { id },
      data: { isActive: false },
    });
  }

  override async restore(id: string): Promise<RadiologyExam> {
    return this.prisma.radiologyExam.update({
      where: { id },
      data: { isActive: true },
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
  ): Promise<PaginatedResult<RadiologyExam>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.radiologyExam.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.RadiologyExamOrderByWithRelationInput
          | Prisma.RadiologyExamOrderByWithRelationInput[],
      }),
      this.prisma.radiologyExam.count({ where }),
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
    return this.prisma.radiologyExam.count({ where });
  }
}
