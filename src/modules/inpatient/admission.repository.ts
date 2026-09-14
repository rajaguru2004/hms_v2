import { Injectable } from '@nestjs/common';
import { Prisma, Admission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { PaginatedResult } from '../../common/types/paginated.type';
import { buildPaginationMeta } from '../../common/utils/pagination.util';

@Injectable()
export class AdmissionRepository extends BaseRepository<
  Admission,
  Prisma.AdmissionCreateInput,
  Prisma.AdmissionUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'admission');
  }

  override async findById(id: string): Promise<Admission | null> {
    return this.prisma.admission.findFirst({
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
  ): Promise<Admission[]> {
    const { include, orderBy } = options;
    return this.prisma.admission.findMany({
      where: where,
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    });
  }

  override async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Admission | null> {
    return this.prisma.admission.findFirst({
      where: where,
      ...(include && { include }),
    });
  }

  override async softDelete(id: string): Promise<Admission> {
    // Admission doesn't have soft delete, mark status as discharged
    return this.prisma.admission.update({
      where: { id },
      data: {
        status: 'discharged',
        dischargeDate: new Date(),
      },
    });
  }

  /**
   * Admission has no `isDeleted` column — the base implementation injects one
   * and Prisma rejects the whole query with an unknown-argument error. Every
   * other override in this file exists for the same reason.
   */
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
  ): Promise<PaginatedResult<Admission>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { admissionDate: 'desc' },
    } = options;

    const safeLimit = Math.min(limit, 100);

    const [data, total] = await Promise.all([
      this.prisma.admission.findMany({
        where: where,
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        ...(include && { include }),
        orderBy: orderBy as
          | Prisma.AdmissionOrderByWithRelationInput
          | Prisma.AdmissionOrderByWithRelationInput[],
      }),
      this.prisma.admission.count({ where: where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, safeLimit) };
  }

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.admission.count({
      where: where,
    });
  }
}
