import { Injectable } from '@nestjs/common';
import { Prisma, LabTest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class LabTestRepository extends BaseRepository<
  LabTest,
  Prisma.LabTestCreateInput,
  Prisma.LabTestUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'labTest');
  }

  override async findById(id: string): Promise<LabTest | null> {
    return this.prisma.labTest.findFirst({
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
  ): Promise<LabTest[]> {
    const { include, orderBy } = options;
    return this.prisma.labTest.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<LabTest | null> {
    return this.prisma.labTest.findFirst({
      where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<LabTest> {
    return this.prisma.labTest.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
  }

  override async restore(id: string): Promise<LabTest> {
    return this.prisma.labTest.update({
      where: { id },
      data: {
        isActive: true,
        updatedAt: new Date(),
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
    } = {},
  ): Promise<PaginatedResult<LabTest>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.LabTestOrderByWithRelationInput
          | Prisma.LabTestOrderByWithRelationInput[],
      }),
      this.prisma.labTest.count({ where }),
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
    return this.prisma.labTest.count({ where });
  }
}
