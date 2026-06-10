import { Injectable } from '@nestjs/common';
import { Prisma, PreTriage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class PreTriageRepository extends BaseRepository<
  PreTriage,
  Prisma.PreTriageCreateInput,
  Prisma.PreTriageUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'preTriage');
  }

  /**
   * Find pre-triage screening by screening number.
   */
  async findByScreeningNumber(
    screeningNumber: string,
    organizationId: string,
  ): Promise<PreTriage | null> {
    return this.prisma.preTriage.findFirst({
      where: { screeningNumber, organizationId, isDeleted: false },
    });
  }
}
