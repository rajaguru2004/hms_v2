import { Injectable } from '@nestjs/common';
import { Prisma, DeathCertificate } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../../common/types/paginated.type';

@Injectable()
export class DeathCertificateRepository extends BaseRepository<
  DeathCertificate,
  Prisma.DeathCertificateCreateInput,
  Prisma.DeathCertificateUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'deathCertificate');
  }

  override async findById(id: string): Promise<DeathCertificate | null> {
    return this.prisma.deathCertificate.findUnique({
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
  ): Promise<DeathCertificate[]> {
    const { include, orderBy } = options;
    return this.prisma.deathCertificate.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<DeathCertificate | null> {
    return this.prisma.deathCertificate.findFirst({
      where: where,
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
  ): Promise<PaginatedResult<DeathCertificate>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.deathCertificate.findMany({
        where: where,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.DeathCertificateOrderByWithRelationInput
          | Prisma.DeathCertificateOrderByWithRelationInput[],
      }),
      this.prisma.deathCertificate.count({
        where: where,
      }),
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
    return this.prisma.deathCertificate.count({
      where: where,
    });
  }

  override async softDelete(id: string): Promise<DeathCertificate> {
    // Schema lacks isDeleted column. Perform hard delete instead.
    return this.prisma.deathCertificate.delete({
      where: { id },
    });
  }
}
