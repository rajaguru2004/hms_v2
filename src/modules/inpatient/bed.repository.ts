import { Injectable } from '@nestjs/common';
import { Prisma, Bed } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class BedRepository extends BaseRepository<
  Bed,
  Prisma.BedCreateInput,
  Prisma.BedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'bed');
  }

  override async findById(id: string): Promise<Bed | null> {
    return this.prisma.bed.findFirst({
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
  ): Promise<Bed[]> {
    const { include, orderBy } = options;
    return this.prisma.bed.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Bed | null> {
    return this.prisma.bed.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<Bed> {
    // Bed doesn't have soft delete, update status to maintenance/inactive
    return this.prisma.bed.update({
      where: { id },
      data: { status: 'maintenance' },
    });
  }

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.bed.count({
      where: where,
    });
  }
}
