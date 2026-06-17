import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  ConflictException,
  NotFoundException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { CreateQueueDto } from './dto/create-queue.dto';
import { QueueQueryDto } from './dto/queue-query.dto';
import {
  PaginatedQueueResponseDto,
  QueueResponseDto,
} from './dto/queue-response.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import {
  QueueRepository,
  QueueWithPatient,
  QUEUE_PATIENT_INCLUDE,
} from './queue.repository';

@Injectable()
export class QueueService {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly auditService: AuditService,
  ) {}

  private generateQueueNumber(serviceArea: string): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    const prefix = serviceArea.substring(0, 3).toUpperCase();
    return `${prefix}${date}${random}`;
  }

  private mapToResponse(item: QueueWithPatient): QueueResponseDto {
    const now = new Date();
    const waitTime = item.joinedQueueAt
      ? Math.floor((now.getTime() - item.joinedQueueAt.getTime()) / 60000)
      : 0;

    return {
      id: item.id,
      organizationId: item.organizationId,
      patientId: item.patientId,
      serviceArea: item.serviceArea,
      serviceType: item.serviceType,
      queueNumber: item.queueNumber,
      priority: item.priority,
      assignedToId: item.assignedToId,
      assignedRoom: item.assignedRoom,
      status: item.status,
      joinedQueueAt: item.joinedQueueAt,
      calledAt: item.calledAt,
      serviceStartedAt: item.serviceStartedAt,
      serviceCompletedAt: item.serviceCompletedAt,
      estimatedWaitMinutes: item.estimatedWaitMinutes,
      displayMessage: item.displayMessage,
      waitTime,
      patient: item.patient
        ? {
            id: item.patient.id,
            mrn: item.patient.mrn,
            firstName: item.patient.firstName,
            lastName: item.patient.lastName,
            phonePrimary: item.patient.phonePrimary,
            gender: item.patient.gender,
            preTriage: item.patient.preTriages?.[0] ?? null,
          }
        : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async findAll(
    query: QueueQueryDto,
    organizationId: string,
  ): Promise<PaginatedQueueResponseDto> {
    const where: Prisma.QueueManagementWhereInput = { organizationId };

    if (query.serviceArea) {
      where.serviceArea = query.serviceArea;
    }

    if (query.status) {
      if (Array.isArray(query.status)) {
        where.status = { in: query.status };
      } else {
        where.status = query.status;
      }
    }

    const result = await this.queueRepository.findQueue(where, {
      page: query.page,
      limit: query.limit,
      orderBy: query.orderBy,
      orderDir: query.orderDir,
    });

    return {
      data: result.data.map((item) => this.mapToResponse(item)),
      meta: result.meta,
    };
  }

  async findOne(id: string, organizationId: string): Promise<QueueResponseDto> {
    const item = await this.findExisting(id, organizationId);
    return this.mapToResponse(item);
  }

  async create(
    dto: CreateQueueDto,
    organizationId: string,
    userId?: string,
  ): Promise<QueueResponseDto> {
    let retries = 3;
    let queueItem: QueueWithPatient | null = null;

    while (retries > 0) {
      try {
        queueItem = await this.queueRepository.createQueue({
          organization: { connect: { id: organizationId } },
          patient: { connect: { id: dto.patientId } },
          serviceArea: dto.serviceArea,
          serviceType: dto.serviceType,
          priority: dto.priority ?? 'normal',
          assignedTo: dto.assignedToId
            ? { connect: { id: dto.assignedToId } }
            : undefined,
          assignedRoom: dto.assignedRoom,
          queueNumber: this.generateQueueNumber(dto.serviceArea),
          status: 'waiting',
          createdBy: userId,
          updatedBy: userId,
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          retries--;
          continue;
        }
        throw error;
      }
    }

    if (!queueItem) {
      throw new ConflictException(
        'Failed to generate unique queue number after retries.',
        ErrorCodes.QUEUE_NUMBER_CONFLICT,
      );
    }

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'QueueManagement',
      entityId: queueItem.id,
      newValues: {
        queueNumber: queueItem.queueNumber,
        patientId: queueItem.patientId,
        serviceArea: queueItem.serviceArea,
        status: queueItem.status,
        priority: queueItem.priority,
      },
      metadata: { organizationId },
    });

    return this.mapToResponse(queueItem);
  }

  async update(
    id: string,
    dto: UpdateQueueDto,
    organizationId: string,
    userId?: string,
  ): Promise<QueueResponseDto> {
    const existing = await this.findExisting(id, organizationId);
    const updateData: Prisma.QueueManagementUpdateInput = {
      status: dto.status,
      priority: dto.priority,
      serviceArea: dto.serviceArea,
      serviceType: dto.serviceType,
      assignedTo: dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : undefined,
      assignedRoom: dto.assignedRoom,
      estimatedWaitMinutes: dto.estimatedWaitMinutes,
      displayMessage: dto.displayMessage,
      updatedBy: userId,
    };

    if (dto.status === 'called') {
      updateData.calledAt = new Date();
    } else if (dto.status === 'in_service') {
      updateData.serviceStartedAt = new Date();
    } else if (dto.status === 'completed' || dto.status === 'no_show') {
      updateData.serviceCompletedAt = new Date();
    }

    const updated = await this.queueRepository.updateQueue(id, updateData);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'QueueManagement',
      entityId: id,
      oldValues: {
        status: existing.status,
        priority: existing.priority,
        assignedToId: existing.assignedToId,
        assignedRoom: existing.assignedRoom,
      },
      newValues: {
        status: updated.status,
        priority: updated.priority,
        assignedToId: updated.assignedToId,
        assignedRoom: updated.assignedRoom,
      },
      metadata: { organizationId },
    });

    return this.mapToResponse(updated);
  }

  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    await this.findExisting(id, organizationId);
    await this.queueRepository.softDelete(id, userId);

    void this.auditService.log({
      userId,
      action: AuditAction.SOFT_DELETE,
      entityName: 'QueueManagement',
      entityId: id,
      metadata: { organizationId },
    });
  }

  async findActiveQueueEntry(
    patientId: string,
    organizationId: string,
  ): Promise<QueueResponseDto | null> {
    const item = (await this.queueRepository.findOne(
      {
        patientId,
        organizationId,
        status: { in: ['waiting', 'called', 'in_service'] },
      },
      QUEUE_PATIENT_INCLUDE,
    )) as QueueWithPatient | null;
    return item ? this.mapToResponse(item) : null;
  }

  private async findExisting(
    id: string,
    organizationId: string,
  ): Promise<QueueWithPatient> {
    const item = await this.queueRepository.findQueueById(id, organizationId);

    if (!item) {
      throw new NotFoundException(
        'Queue item not found or belongs to another organization',
        ErrorCodes.QUEUE_ITEM_NOT_FOUND,
      );
    }

    return item;
  }
}
