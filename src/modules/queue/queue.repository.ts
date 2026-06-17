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
      preTriages: {
        where: { isDeleted: false },
        orderBy: { screenedAt: 'desc' as const },
        take: 1,
        select: {
          id: true,
          chiefComplaint: true,
          briefHistory: true,
          temperature: true,
          bloodPressureSystolic: true,
          bloodPressureDiastolic: true,
          pulseRate: true,
        },
      },
    },
  },
} as const;

export type QueueWithPatient = Prisma.QueueManagementGetPayload<{
  include: typeof QUEUE_PATIENT_INCLUDE;
}>;

export interface QueuePaginatedResult {
  data: QueueWithPatient[];
  meta: {
    total: number;
    lastPage: number;
    currentPage: number;
    perPage: number;
    prev: number | null;
    next: number | null;
  };
}

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
    options?: {
      page?: number;
      limit?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
    },
  ): Promise<QueuePaginatedResult> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const skip = (page - 1) * limit;
    const orderDir = options?.orderDir ?? 'asc';
    const orderBy =
      options?.orderBy === 'priority'
        ? [{ priority: orderDir }, { joinedQueueAt: 'asc' as const }]
        : [{ priority: 'desc' as const }, { joinedQueueAt: 'asc' as const }];

    const baseWhere: Prisma.QueueManagementWhereInput = {
      ...where,
      isDeleted: false,
    };

    const [total, data] = await Promise.all([
      this.prisma.queueManagement.count({ where: baseWhere }),
      this.prisma.queueManagement.findMany({
        where: baseWhere,
        orderBy,
        skip,
        take: limit,
        include: QUEUE_PATIENT_INCLUDE,
      }),
    ]);

    const lastPage = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        lastPage,
        currentPage: page,
        perPage: limit,
        prev: page > 1 ? page - 1 : null,
        next: page < lastPage ? page + 1 : null,
      },
    };
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
