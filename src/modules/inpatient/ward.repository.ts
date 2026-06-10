import { Injectable } from '@nestjs/common';
import { Prisma, Ward } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class WardRepository extends BaseRepository<
  Ward,
  Prisma.WardCreateInput,
  Prisma.WardUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'ward');
  }

  override async findById(id: string): Promise<Ward | null> {
    return this.prisma.ward.findFirst({
      where: { id },
    });
  }

  override async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
    } = {},
  ): Promise<Ward[]> {
    const { include, orderBy } = options;
    return this.prisma.ward.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Ward | null> {
    return this.prisma.ward.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<Ward> {
    // Ward doesn't have soft delete field, we toggle isActive to false instead
    return this.prisma.ward.update({
      where: { id },
      data: { isActive: false },
    });
  }

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.ward.count({
      where: where,
    });
  }
}
