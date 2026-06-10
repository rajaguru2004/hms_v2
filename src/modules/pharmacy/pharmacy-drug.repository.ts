import { Injectable } from '@nestjs/common';
import { Prisma, PharmacyDrug } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class PharmacyDrugRepository extends BaseRepository<
  PharmacyDrug,
  Prisma.PharmacyDrugCreateInput,
  Prisma.PharmacyDrugUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'pharmacyDrug');
  }

  override async findById(
    id: string,
    includeDeleted = false,
  ): Promise<PharmacyDrug | null> {
    return this.prisma.pharmacyDrug.findFirst({
      where: {
        id,
        ...(!includeDeleted && { isActive: true }),
      },
    });
  }

  override async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
      includeDeleted?: boolean;
    } = {},
  ): Promise<PharmacyDrug[]> {
    const { include, orderBy, includeDeleted = false } = options;
    return this.prisma.pharmacyDrug.findMany({
      where: {
        ...where,
        ...(!includeDeleted && { isActive: true }),
      },
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<PharmacyDrug | null> {
    return this.prisma.pharmacyDrug.findFirst({
      where: {
        ...where,
        isActive: true,
      },
      ...(include && { include }),
    });
  }

  override async softDelete(
    id: string,
    deletedBy?: string,
  ): Promise<PharmacyDrug> {
    return this.prisma.pharmacyDrug.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
        ...(deletedBy && { updatedBy: deletedBy }),
      },
    });
  }

  override async restore(
    id: string,
    restoredBy?: string,
  ): Promise<PharmacyDrug> {
    return this.prisma.pharmacyDrug.update({
      where: { id },
      data: {
        isActive: true,
        updatedAt: new Date(),
        ...(restoredBy && { updatedBy: restoredBy }),
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
      includeDeleted?: boolean;
    } = {},
  ): Promise<PaginatedResult<PharmacyDrug>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { drugName: 'asc' },
      includeDeleted = false,
    } = options;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const whereClause = {
      ...where,
      ...(!includeDeleted && { isActive: true }),
    };

    const [data, total] = await Promise.all([
      this.prisma.pharmacyDrug.findMany({
        where: whereClause,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.PharmacyDrugOrderByWithRelationInput
          | Prisma.PharmacyDrugOrderByWithRelationInput[],
      }),
      this.prisma.pharmacyDrug.count({ where: whereClause }),
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

  override async count(
    where: Record<string, unknown> = {},
    includeDeleted = false,
  ): Promise<number> {
    return this.prisma.pharmacyDrug.count({
      where: {
        ...where,
        ...(!includeDeleted && { isActive: true }),
      },
    });
  }
}
