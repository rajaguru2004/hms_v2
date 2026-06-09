import { Injectable } from '@nestjs/common';
import { Prisma, Patient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class PatientRepository extends BaseRepository<
  Patient,
  Prisma.PatientCreateInput,
  Prisma.PatientUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'patient');
  }

  /**
   * Find patient by MRN.
   */
  async findByMrn(
    mrn: string,
    organizationId: string,
  ): Promise<Patient | null> {
    return this.prisma.patient.findFirst({
      where: { mrn, organizationId, isDeleted: false },
    });
  }
}
