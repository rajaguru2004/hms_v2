import { Injectable } from '@nestjs/common';
import { Prisma, Admission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

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

  override async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.prisma.admission.count({
      where: where,
    });
  }
}
