import { Injectable } from '@nestjs/common';
import { Prisma, MachineResultsQueue } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class MachineResultsQueueRepository extends BaseRepository<
  MachineResultsQueue,
  Prisma.MachineResultsQueueCreateInput,
  Prisma.MachineResultsQueueUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'machineResultsQueue');
  }

  override async findById(id: string): Promise<MachineResultsQueue | null> {
    return this.prisma.machineResultsQueue.findUnique({
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
  ): Promise<MachineResultsQueue[]> {
    const { include, orderBy } = options;
    return this.prisma.machineResultsQueue.findMany({
      where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<MachineResultsQueue | null> {
    return this.prisma.machineResultsQueue.findFirst({
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
  ): Promise<PaginatedResult<MachineResultsQueue>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { receivedAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.machineResultsQueue.findMany({
        where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.MachineResultsQueueOrderByWithRelationInput
          | Prisma.MachineResultsQueueOrderByWithRelationInput[],
      }),
      this.prisma.machineResultsQueue.count({ where }),
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
    return this.prisma.machineResultsQueue.count({ where });
  }

  override async softDelete(id: string): Promise<MachineResultsQueue> {
    return this.prisma.machineResultsQueue.delete({
      where: { id },
    });
  }

  async createMany(
    data: Prisma.MachineResultsQueueCreateManyInput[],
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.machineResultsQueue.createMany({
      data,
    });
  }
}
