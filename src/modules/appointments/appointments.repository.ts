import { Injectable } from '@nestjs/common';
import { Prisma, Appointment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class AppointmentRepository extends BaseRepository<
  Appointment,
  Prisma.AppointmentCreateInput,
  Prisma.AppointmentUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'appointment');
  }

  override async softDelete(
    id: string,
    deletedBy?: string,
  ): Promise<Appointment> {
    return this.prisma.appointment.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }
}
