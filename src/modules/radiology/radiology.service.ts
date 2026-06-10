import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  RadiologyExam,
  RadiologyOrder,
  RadiologyReport,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  AppException,
  NotFoundException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  CreateRadiologyExamDto,
  UpdateRadiologyExamDto,
} from './dto/radiology-exam.dto';
import {
  CreateRadiologyOrderDto,
  UpdateRadiologyOrderDto,
} from './dto/radiology-order.dto';
import {
  CreateRadiologyReportDto,
  UpdateRadiologyReportDto,
} from './dto/radiology-report.dto';
import {
  RadiologyPatchCompatDto,
  RadiologyPostCompatDto,
  RadiologyQueryDto,
} from './dto/radiology-compat.dto';
import { RadiologyExamRepository } from './radiology-exam.repository';
import { RadiologyOrderRepository } from './radiology-order.repository';
import { RadiologyReportRepository } from './radiology-report.repository';

interface CompatibilityResult {
  data: unknown;
  message?: string;
}

interface RadiologyStats {
  pending: number;
  inProgress: number;
  completedToday: number;
  criticalFindings: number;
  totalExams: number;
}

@Injectable()
export class RadiologyService {
  private readonly logger = new Logger(RadiologyService.name);

  constructor(
    private readonly examRepository: RadiologyExamRepository,
    private readonly orderRepository: RadiologyOrderRepository,
    private readonly reportRepository: RadiologyReportRepository,
    private readonly auditService: AuditService,
  ) {}

  async compatibilityGet(
    query: RadiologyQueryDto,
    organizationId: string,
  ): Promise<CompatibilityResult> {
    const resource = query.resource || 'exams';

    if (resource === 'exams') {
      return { data: await this.getExams(organizationId, query.category) };
    }
    if (resource === 'orders') {
      return {
        data: await this.getOrders(organizationId, query.status, query.urgency),
      };
    }
    if (resource === 'reports') {
      return { data: await this.getReports(query.orderId) };
    }
    if (resource === 'stats') {
      return { data: await this.getStats(organizationId) };
    }

    throw new AppException(
      'Invalid resource specified',
      ErrorCodes.INVALID_RADIOLOGY_RESOURCE,
    );
  }

  async compatibilityPost(
    dto: RadiologyPostCompatDto,
    organizationId: string,
    userId: string,
  ): Promise<CompatibilityResult> {
    const resource = dto.resource || 'exam';

    if (resource === 'exam') {
      if (!dto.examName) {
        throw new AppException('examName is required', ErrorCodes.BAD_REQUEST);
      }
      const exam = await this.createExam(
        {
          examName: dto.examName,
          examCode: dto.examCode,
          examCategory: dto.examCategory,
          bodyPart: dto.bodyPart,
          modality: dto.modality,
          price: dto.price,
          estimatedDuration: dto.estimatedDuration,
          preparationInstructions: dto.preparationInstructions,
          contrastRequired: dto.contrastRequired,
          description: dto.description,
        },
        organizationId,
        userId,
      );
      return { data: exam, message: 'Exam added successfully' };
    }

    if (resource === 'order') {
      if (!dto.patientId || !dto.examId) {
        throw new AppException(
          'patientId and examId are required for order creation',
          ErrorCodes.BAD_REQUEST,
        );
      }
      const order = await this.createOrder(
        {
          patientId: dto.patientId,
          consultationId: dto.consultationId,
          examId: dto.examId,
          clinicalIndication: dto.clinicalIndication,
          provisionalDiagnosis: dto.provisionalDiagnosis,
          relevantHistory: dto.relevantHistory,
          urgency: dto.urgency,
          notes: dto.notes,
        },
        organizationId,
        userId,
      );
      return { data: order, message: 'Radiology order created' };
    }

    if (resource === 'report') {
      if (!dto.orderId) {
        throw new AppException(
          'orderId is required for report creation',
          ErrorCodes.BAD_REQUEST,
        );
      }
      const report = await this.createReport(
        {
          orderId: dto.orderId,
          technique: dto.technique,
          findings: dto.findings,
          impression: dto.impression,
          recommendations: dto.recommendations,
          hasCriticalFindings: dto.hasCriticalFindings,
          criticalFindings: dto.criticalFindings,
          comparedWithPrevious: dto.comparedWithPrevious,
          comparisonNotes: dto.comparisonNotes,
        },
        organizationId,
        userId,
      );
      return { data: report, message: 'Report created' };
    }

    throw new AppException(
      'Invalid resource specified',
      ErrorCodes.INVALID_RADIOLOGY_RESOURCE,
    );
  }

  async compatibilityPatch(
    dto: RadiologyPatchCompatDto,
    organizationId: string,
    userId: string,
  ): Promise<CompatibilityResult> {
    if (dto.resource === 'exam') {
      return {
        data: await this.updateExam(
          dto.id,
          {
            examName: dto.examName,
            examCode: dto.examCode,
            examCategory: dto.examCategory,
            bodyPart: dto.bodyPart,
            modality: dto.modality,
            price: dto.price,
            estimatedDuration: dto.estimatedDuration,
            preparationInstructions: dto.preparationInstructions,
            contrastRequired: dto.contrastRequired,
            description: dto.description,
            isActive: dto.isActive,
          },
          organizationId,
          userId,
        ),
      };
    }

    if (dto.resource === 'order') {
      return {
        data: await this.updateOrder(
          dto.id,
          {
            status: dto.status,
            urgency: dto.urgency,
            notes: dto.notes,
            clinicalIndication: dto.clinicalIndication,
            provisionalDiagnosis: dto.provisionalDiagnosis,
            relevantHistory: dto.relevantHistory,
            scheduledDate: dto.scheduledDate,
            examPerformedAt: dto.examPerformedAt,
            performedById: dto.performedById,
            cancellationReason: dto.cancellationReason,
          },
          organizationId,
          userId,
        ),
      };
    }

    if (dto.resource === 'report') {
      return {
        data: await this.updateReport(
          dto.id,
          {
            technique: dto.technique,
            findings: dto.findings,
            impression: dto.impression,
            recommendations: dto.recommendations,
            hasCriticalFindings: dto.hasCriticalFindings,
            criticalFindings: dto.criticalFindings,
            criticalNotifiedTo: dto.criticalNotifiedTo,
            criticalNotifiedAt: dto.criticalNotifiedAt,
            comparedWithPrevious: dto.comparedWithPrevious,
            comparisonNotes: dto.comparisonNotes,
            verifiedAt: dto.verifiedAt,
            status: dto.reportStatus,
          },
          organizationId,
          userId,
        ),
      };
    }

    throw new AppException(
      'Invalid resource specified',
      ErrorCodes.INVALID_RADIOLOGY_RESOURCE,
    );
  }

  async getExams(
    organizationId: string,
    category?: string,
  ): Promise<RadiologyExam[]> {
    const where: Record<string, unknown> = { organizationId, isActive: true };
    if (category) {
      where.examCategory = category;
    }

    return this.examRepository.findMany(where, {
      orderBy: [{ examCategory: 'asc' }, { examName: 'asc' }],
    });
  }

  async getExamById(
    id: string,
    organizationId?: string,
  ): Promise<RadiologyExam> {
    const where: Record<string, unknown> = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }
    const exam = await this.examRepository.findOne(where);
    if (!exam) {
      throw new NotFoundException(
        `Radiology exam with ID ${id} not found`,
        ErrorCodes.RADIOLOGY_EXAM_NOT_FOUND,
      );
    }
    return exam;
  }

  async createExam(
    dto: CreateRadiologyExamDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyExam> {
    const exam = await this.examRepository.create({
      organization: { connect: { id: organizationId } },
      examName: dto.examName,
      examCode: dto.examCode,
      examCategory: dto.examCategory,
      bodyPart: dto.bodyPart,
      modality: dto.modality,
      price: dto.price,
      estimatedDuration: dto.estimatedDuration,
      preparationInstructions: dto.preparationInstructions,
      contrastRequired: dto.contrastRequired ?? false,
      description: dto.description,
      isActive: true,
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'RadiologyExam',
      entityId: exam.id,
      newValues: exam,
      metadata: { organizationId },
    });

    return exam;
  }

  async updateExam(
    id: string,
    dto: UpdateRadiologyExamDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyExam> {
    const oldExam = await this.getExamById(id, organizationId);
    const exam = await this.examRepository.update(id, dto);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'RadiologyExam',
      entityId: exam.id,
      oldValues: oldExam,
      newValues: exam,
      metadata: { organizationId },
    });

    return exam;
  }

  async getOrders(
    organizationId: string,
    status?: string,
    urgency?: string,
  ): Promise<RadiologyOrder[]> {
    const where: Record<string, unknown> = { organizationId };
    if (status) {
      where.status = status;
    }
    if (urgency) {
      where.urgency = urgency;
    }

    return this.orderRepository.findMany(where, {
      orderBy: { orderDate: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            phonePrimary: true,
          },
        },
        exam: true,
        report: true,
      },
    });
  }

  async getOrderById(
    id: string,
    organizationId?: string,
  ): Promise<RadiologyOrder> {
    const where: Record<string, unknown> = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }
    const order = await this.orderRepository.findOne(where, {
      patient: true,
      exam: true,
      report: true,
    });
    if (!order) {
      throw new NotFoundException(
        `Radiology order with ID ${id} not found`,
        ErrorCodes.RADIOLOGY_ORDER_NOT_FOUND,
      );
    }
    return order;
  }

  async createOrder(
    dto: CreateRadiologyOrderDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyOrder> {
    const orderNumber = `RAD${Date.now()}`;
    const order = await this.orderRepository.create({
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      ...(dto.consultationId && {
        consultation: { connect: { id: dto.consultationId } },
      }),
      exam: { connect: { id: dto.examId } },
      requestedBy: { connect: { id: userId } },
      orderNumber,
      clinicalIndication: dto.clinicalIndication,
      provisionalDiagnosis: dto.provisionalDiagnosis,
      relevantHistory: dto.relevantHistory,
      urgency: dto.urgency || 'routine',
      notes: dto.notes,
      status: 'pending',
      createdById: userId,
    });

    const fullOrder = await this.orderRepository.findOne(
      { id: order.id },
      {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true },
        },
        exam: true,
      },
    );

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'RadiologyOrder',
      entityId: order.id,
      newValues: order,
      metadata: { organizationId },
    });

    return fullOrder || order;
  }

  async updateOrder(
    id: string,
    dto: UpdateRadiologyOrderDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyOrder> {
    const oldOrder = await this.getOrderById(id, organizationId);
    const updates: Prisma.RadiologyOrderUpdateInput = {
      patient: dto.patientId ? { connect: { id: dto.patientId } } : undefined,
      consultation: dto.consultationId
        ? { connect: { id: dto.consultationId } }
        : undefined,
      exam: dto.examId ? { connect: { id: dto.examId } } : undefined,
      clinicalIndication: dto.clinicalIndication,
      provisionalDiagnosis: dto.provisionalDiagnosis,
      relevantHistory: dto.relevantHistory,
      urgency: dto.urgency,
      status: dto.status,
      scheduledDate: dto.scheduledDate
        ? new Date(dto.scheduledDate)
        : undefined,
      examPerformedAt: dto.examPerformedAt
        ? new Date(dto.examPerformedAt)
        : undefined,
      performedBy: dto.performedById
        ? { connect: { id: dto.performedById } }
        : undefined,
      notes: dto.notes,
      cancellationReason: dto.cancellationReason,
    };

    if (dto.status === 'completed' && oldOrder.status !== 'completed') {
      updates.examPerformedAt = updates.examPerformedAt || new Date();
    }
    if (dto.status === 'reported' && oldOrder.status !== 'reported') {
      updates.reportCreatedAt = new Date();
      updates.reportedById = userId;
    }

    const order = await this.orderRepository.update(id, updates);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'RadiologyOrder',
      entityId: order.id,
      oldValues: oldOrder,
      newValues: order,
      metadata: { organizationId },
    });

    return order;
  }

  async getReports(orderId?: string): Promise<RadiologyReport[]> {
    const where: Record<string, unknown> = {};
    if (orderId) {
      where.orderId = orderId;
    }

    return this.reportRepository.findMany(where, {
      include: {
        order: {
          include: { patient: true, exam: true },
        },
      },
    });
  }

  async getReportById(id: string): Promise<RadiologyReport> {
    const report = await this.reportRepository.findOne(
      { id },
      { order: { include: { patient: true, exam: true } } },
    );
    if (!report) {
      throw new NotFoundException(
        `Radiology report with ID ${id} not found`,
        ErrorCodes.RADIOLOGY_REPORT_NOT_FOUND,
      );
    }
    return report;
  }

  async createReport(
    dto: CreateRadiologyReportDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyReport> {
    await this.getOrderById(dto.orderId, organizationId);

    const report = await this.reportRepository.create({
      organizationId,
      order: { connect: { id: dto.orderId } },
      technique: dto.technique,
      findings: dto.findings,
      impression: dto.impression,
      recommendations: dto.recommendations,
      hasCriticalFindings: dto.hasCriticalFindings ?? false,
      criticalFindings: dto.criticalFindings,
      comparedWithPrevious: dto.comparedWithPrevious ?? false,
      comparisonNotes: dto.comparisonNotes,
      status: 'draft',
      reportedBy: { connect: { id: userId } },
      reportedAt: new Date(),
    });

    try {
      await this.orderRepository.update(dto.orderId, {
        status: 'reported',
        reportCreatedAt: new Date(),
        reportedById: userId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update radiology order status for order ${dto.orderId}`,
        error,
      );
    }

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'RadiologyReport',
      entityId: report.id,
      newValues: report,
      metadata: { organizationId },
    });

    return report;
  }

  async updateReport(
    id: string,
    dto: UpdateRadiologyReportDto,
    organizationId: string,
    userId: string,
  ): Promise<RadiologyReport> {
    const oldReport = await this.getReportById(id);
    const updates: Prisma.RadiologyReportUpdateInput = {
      technique: dto.technique,
      findings: dto.findings,
      impression: dto.impression,
      recommendations: dto.recommendations,
      hasCriticalFindings: dto.hasCriticalFindings,
      criticalFindings: dto.criticalFindings,
      criticalNotifiedTo: dto.criticalNotifiedTo,
      criticalNotifiedAt: dto.criticalNotifiedAt
        ? new Date(dto.criticalNotifiedAt)
        : undefined,
      comparedWithPrevious: dto.comparedWithPrevious,
      comparisonNotes: dto.comparisonNotes,
      images: dto.images,
      dicomStudyUid: dto.dicomStudyUid,
      templateUsed: dto.templateUsed,
      reportedBy: dto.reportedById
        ? { connect: { id: dto.reportedById } }
        : undefined,
      reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : undefined,
      verifiedById: dto.verifiedById,
      verifiedAt: dto.verifiedAt ? new Date(dto.verifiedAt) : undefined,
      status: dto.status,
      amendmentReason: dto.amendmentReason,
      amendedAt: dto.amendedAt ? new Date(dto.amendedAt) : undefined,
      amendedById: dto.amendedById,
    };

    if (dto.verifiedAt && !oldReport.verifiedAt) {
      updates.verifiedById = userId;
    }
    if (dto.status === 'amended' && !oldReport.amendedAt) {
      updates.amendedAt = new Date();
      updates.amendedById = userId;
    }

    const report = await this.reportRepository.update(id, updates);

    if (report.verifiedAt && !oldReport.verifiedAt) {
      try {
        await this.orderRepository.update(report.orderId, {
          reportVerifiedAt: report.verifiedAt,
          verifiedById: userId,
        });
      } catch (error) {
        this.logger.error(
          `Failed to update radiology order verification for order ${report.orderId}`,
          error,
        );
      }
    }

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'RadiologyReport',
      entityId: report.id,
      oldValues: oldReport,
      newValues: report,
      metadata: { organizationId },
    });

    return report;
  }

  async getStats(organizationId: string): Promise<RadiologyStats> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const [pending, inProgress, completedToday, criticalFindings, totalExams] =
      await Promise.all([
        this.orderRepository.count({ organizationId, status: 'pending' }),
        this.orderRepository.count({ organizationId, status: 'in_progress' }),
        this.orderRepository.count({
          organizationId,
          status: 'completed',
          orderDate: { gte: todayStart, lte: todayEnd },
        }),
        this.reportRepository.count({
          hasCriticalFindings: true,
          verifiedAt: null,
        }),
        this.examRepository.count({ organizationId, isActive: true }),
      ]);

    return {
      pending,
      inProgress,
      completedToday,
      criticalFindings,
      totalExams,
    };
  }
}
