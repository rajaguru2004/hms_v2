import { Injectable } from '@nestjs/common';
import { Prisma, Consultation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class ConsultationRepository extends BaseRepository<
  Consultation,
  Prisma.ConsultationCreateInput,
  Prisma.ConsultationUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'consultation');
  }

  override async softDelete(
    id: string,
    _deletedBy?: string,
  ): Promise<Consultation> {
    return this.prisma.consultation.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }
}
