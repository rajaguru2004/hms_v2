import { Injectable } from '@nestjs/common';
import { Prisma, QueueManagement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

export const QUEUE_PATIENT_INCLUDE = {
  patient: {
    select: {
      id: true,
      mrn: true,
      firstName: true,
      lastName: true,
      phonePrimary: true,
      gender: true,
    },
  },
} as const;

export type QueueWithPatient = Prisma.QueueManagementGetPayload<{
  include: typeof QUEUE_PATIENT_INCLUDE;
}>;

@Injectable()
export class QueueRepository extends BaseRepository<
  QueueManagement,
  Prisma.QueueManagementCreateInput,
  Prisma.QueueManagementUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'queueManagement');
  }

  async findQueue(
    where: Prisma.QueueManagementWhereInput,
  ): Promise<QueueWithPatient[]> {
    return this.prisma.queueManagement.findMany({
      where: { ...where, isDeleted: false },
      orderBy: [{ priority: 'desc' }, { joinedQueueAt: 'asc' }],
      include: QUEUE_PATIENT_INCLUDE,
    });
  }

  async findQueueById(
    id: string,
    organizationId: string,
  ): Promise<QueueWithPatient | null> {
    return this.prisma.queueManagement.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: QUEUE_PATIENT_INCLUDE,
    });
  }

  async createQueue(
    data: Prisma.QueueManagementCreateInput,
  ): Promise<QueueWithPatient> {
    return this.prisma.queueManagement.create({
      data,
      include: QUEUE_PATIENT_INCLUDE,
    });
  }

  async updateQueue(
    id: string,
    data: Prisma.QueueManagementUpdateInput,
  ): Promise<QueueWithPatient> {
    return this.prisma.queueManagement.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: QUEUE_PATIENT_INCLUDE,
    });
  }

  override async softDelete(
    id: string,
    deletedBy?: string,
  ): Promise<QueueManagement> {
    return this.prisma.queueManagement.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        updatedBy: deletedBy,
      },
    });
  }
}
