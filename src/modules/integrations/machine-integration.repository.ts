import { Injectable } from '@nestjs/common';
import { Prisma, MachineIntegration } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class MachineIntegrationRepository extends BaseRepository<
  MachineIntegration,
  Prisma.MachineIntegrationCreateInput,
  Prisma.MachineIntegrationUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'machineIntegration');
  }

  override async findById(id: string): Promise<MachineIntegration | null> {
    return this.prisma.machineIntegration.findUnique({
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
  ): Promise<MachineIntegration[]> {
    const { include, orderBy } = options;
    return this.prisma.machineIntegration.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<MachineIntegration | null> {
    return this.prisma.machineIntegration.findFirst({
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
  ): Promise<PaginatedResult<MachineIntegration>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.machineIntegration.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.MachineIntegrationOrderByWithRelationInput
          | Prisma.MachineIntegrationOrderByWithRelationInput[],
      }),
      this.prisma.machineIntegration.count({ where }),
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
    return this.prisma.machineIntegration.count({ where });
  }

  override async softDelete(id: string): Promise<MachineIntegration> {
    return this.prisma.machineIntegration.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async upsert(
    id: string,
    createData: Prisma.MachineIntegrationCreateInput,
    updateData: Prisma.MachineIntegrationUpdateInput,
  ): Promise<MachineIntegration> {
    return this.prisma.machineIntegration.upsert({
      where: { id },
      create: createData,
      update: updateData,
    });
  }
}
