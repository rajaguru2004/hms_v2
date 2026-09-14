import { Injectable } from '@nestjs/common';
import { Prisma, QueueManagement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import {
  buildCompatPaginationMeta,
  type CompatPaginationMeta,
} from '../../common/utils/pagination.util';

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
  /**
   * The standard meta plus the queue's legacy keys.
   *
   * The console reads `currentPage`/`perPage`/`lastPage`; every other endpoint
   * answers `page`/`limit`/`totalPages`. Both ship until the console is
   * switched over, then the legacy half goes.
   */
  meta: CompatPaginationMeta;
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

  get prismaClient() {
    return this.prisma;
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
    // Acuity, then arrival. Ordering used to be on the priority *string*,
    // which is alphabetical: "routine" sorted above "normal", and the p1–p5
    // codes scrambled it completely. `priorityRank` is the ladder both
    // vocabularies map onto, and it is indexed alongside joinedQueueAt.
    const orderBy =
      options?.orderBy === 'priority'
        ? [{ priorityRank: orderDir }, { joinedQueueAt: 'asc' as const }]
        : [{ priorityRank: 'asc' as const }, { joinedQueueAt: 'asc' as const }];

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

    return { data, meta: buildCompatPaginationMeta(total, page, limit) };
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
