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

    if (
      updated.serviceArea === 'radiology' &&
      (updated.status === 'called' || updated.status === 'in_service')
    ) {
      void this.createRadiologyOrderForQueueItem(
        updated,
        organizationId,
        userId,
      ).catch((err) => {
        console.error('Failed to auto create radiology order from queue:', err);
      });
    }

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

  private async createRadiologyOrderForQueueItem(
    queueItem: QueueWithPatient,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    if (!queueItem.patientId) return;

    const prisma = this.queueRepository.prismaClient;

    // 1. Verify if patient is from pre-triage and routed to radiology
    const preTriage = await prisma.preTriage.findFirst({
      where: {
        patientId: queueItem.patientId,
        routedTo: 'radiology',
        isDeleted: false,
      },
      orderBy: { screenedAt: 'desc' },
    });

    if (!preTriage) {
      return;
    }

    // 2. Check if a pending radiology order already exists for this patient
    const existingOrder = await prisma.radiologyOrder.findFirst({
      where: {
        patientId: queueItem.patientId,
        organizationId,
        status: 'pending',
      },
    });

    if (existingOrder) {
      return;
    }

    // 3. Determine requestedById (foreign key User)
    let requestedById = userId;
    if (!requestedById) {
      requestedById = queueItem.createdBy ?? undefined;
      if (!requestedById) {
        const fallbackUser = await prisma.user.findFirst({
          where: { organizationId, isActive: true },
        });
        requestedById = fallbackUser?.id;
      }
    }

    if (!requestedById) {
      return;
    }

    // 4. Find or create default RadiologyExam
    let exam = await prisma.radiologyExam.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!exam) {
      exam = await prisma.radiologyExam.create({
        data: {
          organizationId,
          examName: 'General/Unspecified Radiology Exam',
          examCode: 'GEN-RAD',
          examCategory: 'x-ray',
          modality: 'CR',
          price: 0,
          estimatedDuration: 15,
          isActive: true,
          createdById: requestedById,
        },
      });
    }

    // 5. Construct clinical details from pre-triage
    const clinicalIndication = preTriage.chiefComplaint || 'Pre-Triage Routing';

    const historyParts = [];
    if (preTriage.briefHistory) {
      historyParts.push(preTriage.briefHistory);
    }
    const vitals = [];
    if (preTriage.temperature) vitals.push(`Temp: ${preTriage.temperature}°C`);
    if (preTriage.pulseRate) vitals.push(`Pulse: ${preTriage.pulseRate} bpm`);
    if (preTriage.bloodPressureSystolic && preTriage.bloodPressureDiastolic) {
      vitals.push(
        `BP: ${preTriage.bloodPressureSystolic}/${preTriage.bloodPressureDiastolic} mmHg`,
      );
    }
    if (vitals.length > 0) {
      historyParts.push(`Vitals: ${vitals.join(', ')}`);
    }
    const relevantHistory =
      historyParts.join(' | ') || 'Pre-Triage Screening Details';

    // 6. Create the pending RadiologyOrder
    const orderNumber = `RAD${Date.now()}`;
    await prisma.radiologyOrder.create({
      data: {
        organization: { connect: { id: organizationId } },
        patient: { connect: { id: queueItem.patientId } },
        exam: { connect: { id: exam.id } },
        requestedBy: { connect: { id: requestedById } },
        orderNumber,
        clinicalIndication,
        relevantHistory,
        provisionalDiagnosis: preTriage.chiefComplaint || 'Pre-Triage Route',
        urgency: queueItem.priority === 'urgent' ? 'urgent' : 'routine',
        status: 'pending',
        createdById: requestedById,
      },
    });

    // 7. Audit log the order creation
    void this.auditService.log({
      userId: requestedById,
      action: AuditAction.CREATE,
      entityName: 'RadiologyOrder',
      entityId: orderNumber,
      newValues: {
        patientId: queueItem.patientId,
        examId: exam.id,
        orderNumber,
        source: 'Pre-Triage Queue Automation',
      },
      metadata: { organizationId },
    });
  }
}
