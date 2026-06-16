import { Injectable, Logger } from '@nestjs/common';
import { LabTest, LabOrder, LabResult } from '@prisma/client';
import { LabTestRepository } from './lab-test.repository';
import { LabOrderRepository } from './lab-order.repository';
import { LabResultRepository } from './lab-result.repository';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import { CreateLabTestDto, UpdateLabTestDto } from './dto/lab-test.dto';
import { CreateLabOrderDto, UpdateLabOrderDto } from './dto/lab-order.dto';
import { CreateLabResultDto, UpdateLabResultDto } from './dto/lab-result.dto';
import { NotFoundException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

@Injectable()
export class LaboratoryService {
  private readonly logger = new Logger(LaboratoryService.name);

  constructor(
    private readonly labTestRepository: LabTestRepository,
    private readonly labOrderRepository: LabOrderRepository,
    private readonly labResultRepository: LabResultRepository,
    private readonly auditService: AuditService,
  ) {}

  // ── Tests ────────────────────────────────────────────────────────────────
  async getTests(
    organizationId: string,
    category?: string,
  ): Promise<LabTest[]> {
    const where: Record<string, unknown> = {
      organizationId,
      isActive: true,
    };
    if (category) {
      where.testCategory = category;
    }

    return this.labTestRepository.findMany(where, {
      orderBy: [{ testCategory: 'asc' }, { testName: 'asc' }],
    });
  }

  async getTestById(id: string): Promise<LabTest> {
    const test = await this.labTestRepository.findById(id);
    if (!test) {
      throw new NotFoundException(
        `Lab test with ID ${id} not found`,
        ErrorCodes.LAB_TEST_NOT_FOUND,
      );
    }
    return test;
  }

  async createTest(
    dto: CreateLabTestDto,
    organizationId: string,
    userId: string,
  ): Promise<LabTest> {
    const test = await this.labTestRepository.create({
      organization: { connect: { id: organizationId } },
      ...dto,
      isActive: true,
      createdById: userId,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'LabTest',
      entityId: test.id,
      newValues: test,
      metadata: { organizationId },
    });

    return test;
  }

  async updateTest(
    id: string,
    dto: UpdateLabTestDto,
    organizationId: string,
    userId: string,
  ): Promise<LabTest> {
    const oldTest = await this.getTestById(id);

    const test = await this.labTestRepository.update(id, {
      ...dto,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'LabTest',
      entityId: test.id,
      oldValues: oldTest,
      newValues: test,
      metadata: { organizationId },
    });

    return test;
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async getOrders(
    organizationId: string,
    status?: string,
    priority?: string,
  ): Promise<LabOrder[]> {
    const where: Record<string, unknown> = { organizationId };
    if (status) {
      where.status = status;
    }
    if (priority) {
      where.priority = priority;
    }

    return this.labOrderRepository.findMany(where, {
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
        results: {
          include: {
            test: true,
          },
        },
      },
    });
  }

  async getOrderById(id: string): Promise<LabOrder> {
    const order = await this.labOrderRepository.findById(id);
    if (!order) {
      throw new NotFoundException(
        `Lab order with ID ${id} not found`,
        ErrorCodes.LAB_ORDER_NOT_FOUND,
      );
    }
    return order;
  }

  async createOrder(
    dto: CreateLabOrderDto,
    organizationId: string,
    userId: string,
  ): Promise<LabOrder> {
    const orderNumber = `LAB${Date.now()}`;

    // Compatibility note: tests array is stored as a JSON string in DB
    const order = await this.labOrderRepository.create({
      organization: { connect: { id: organizationId } },
      patient: { connect: { id: dto.patientId } },
      ...(dto.consultationId && {
        consultation: { connect: { id: dto.consultationId } },
      }),
      requestedBy: { connect: { id: userId } },
      orderNumber,
      tests: JSON.stringify(dto.tests),
      clinicalIndication: dto.clinicalIndication,
      provisionalDiagnosis: dto.provisionalDiagnosis,
      priority: dto.priority || 'routine',
      notes: dto.notes,
      status: 'pending',
      createdById: userId,
    });

    // Fetch full object with patient details to match return structure
    const fullOrder = await this.labOrderRepository.findOne(
      { id: order.id },
      {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true },
        },
      },
    );

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'LabOrder',
      entityId: order.id,
      newValues: order,
      metadata: { organizationId },
    });

    return fullOrder || order;
  }

  async updateOrder(
    id: string,
    dto: UpdateLabOrderDto,
    organizationId: string,
    userId: string,
  ): Promise<LabOrder> {
    const oldOrder = await this.getOrderById(id);

    const updates: Record<string, unknown> = { ...dto };

    // Auto-update times if status is updated to completed
    if (dto.status === 'completed' && oldOrder.status !== 'completed') {
      updates.resultsReportedAt = new Date();
    }

    // Auto-generate unique accession number on sample collection, ignore client value to prevent duplication
    if (dto.status === 'sample_collected') {
      if (!oldOrder.accessionNumber) {
        let uniqueAccession = '';
        let isUnique = false;
        while (!isUnique) {
          const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          let randomStr = '';
          for (let i = 0; i < 8; i++) {
            randomStr += chars[Math.floor(Math.random() * chars.length)];
          }
          uniqueAccession = `ACC-${randomStr}`;
          const existing = await this.labOrderRepository.findOne({
            accessionNumber: uniqueAccession,
          });
          if (!existing) {
            isUnique = true;
          }
        }
        updates.accessionNumber = uniqueAccession;
      } else {
        // Prevent changing existing accession number
        delete updates.accessionNumber;
      }
    } else {
      // Prevent setting accession number if status is not sample_collected
      delete updates.accessionNumber;
    }

    const order = await this.labOrderRepository.update(id, updates);

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'LabOrder',
      entityId: order.id,
      oldValues: oldOrder,
      newValues: order,
      metadata: { organizationId },
    });

    return order;
  }

  // ── Results ──────────────────────────────────────────────────────────────
  async getResults(orderId?: string): Promise<LabResult[]> {
    const where: Record<string, unknown> = {};
    if (orderId) {
      where.orderId = orderId;
    }

    return this.labResultRepository.findMany(where, {
      include: {
        test: true,
        order: {
          include: {
            patient: true,
          },
        },
      },
    });
  }

  async getResultById(id: string): Promise<LabResult> {
    const result = await this.labResultRepository.findById(id);
    if (!result) {
      throw new NotFoundException(
        `Lab result with ID ${id} not found`,
        ErrorCodes.LAB_RESULT_NOT_FOUND,
      );
    }
    return result;
  }

  async createResult(
    dto: CreateLabResultDto,
    organizationId: string,
    userId: string,
  ): Promise<LabResult> {
    const result = await this.labResultRepository.create({
      organizationId,
      order: { connect: { id: dto.orderId } },
      test: { connect: { id: dto.testId } },
      resultValue: dto.resultValue,
      resultUnit: dto.resultUnit,
      isAbnormal: dto.isAbnormal ?? false,
      isCritical: dto.isCritical ?? false,
      flag: dto.flag,
      comment: dto.comment,
      enteredBy: { connect: { id: userId } },
      enteredAt: new Date(),
    });

    // Auto-update order status when result is added
    try {
      await this.labOrderRepository.update(dto.orderId, {
        status: 'in_progress',
        resultsEnteredAt: new Date(),
        resultsEnteredById: userId,
      });
    } catch (err) {
      this.logger.error(
        `Failed to update order status for order ${dto.orderId}`,
        err,
      );
    }

    const fullResult = await this.labResultRepository.findOne(
      { id: result.id },
      { test: true },
    );

    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'LabResult',
      entityId: result.id,
      newValues: result,
      metadata: { organizationId },
    });

    return fullResult || result;
  }

  async updateResult(
    id: string,
    dto: UpdateLabResultDto,
    organizationId: string,
    userId: string,
  ): Promise<LabResult> {
    const oldResult = await this.getResultById(id);

    const updates: Record<string, unknown> = { ...dto };

    // Auto-fill verifier details if verifications updates are received
    if (dto.verifiedAt && !oldResult.verifiedAt) {
      updates.verifiedById = userId;
    }

    const result = await this.labResultRepository.update(id, updates);

    // If result verification triggers, check if all results for the order are verified to mark order complete
    if (dto.verifiedAt) {
      try {
        const orderResults = await this.labResultRepository.findMany({
          orderId: result.orderId,
        });
        const allVerified = orderResults.every((r) => r.verifiedAt !== null);
        if (allVerified) {
          await this.labOrderRepository.update(result.orderId, {
            status: 'completed',
            resultsVerifiedAt: new Date(),
            resultsVerifiedById: userId,
            resultsReportedAt: new Date(),
          });
        }
      } catch (err) {
        this.logger.error(
          `Failed to complete order status check for order ${result.orderId}`,
          err,
        );
      }
    }

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'LabResult',
      entityId: result.id,
      oldValues: oldResult,
      newValues: result,
      metadata: { organizationId },
    });

    return result;
  }

  // ── Statistics ───────────────────────────────────────────────────────────
  async getStats(organizationId: string) {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todayEnd = new Date(today.setHours(23, 59, 59, 999));

    const [
      pending,
      sampleCollected,
      inProgress,
      completedToday,
      criticalResults,
      totalTests,
    ] = await Promise.all([
      this.labOrderRepository.count({ organizationId, status: 'pending' }),
      this.labOrderRepository.count({
        organizationId,
        status: 'sample_collected',
      }),
      this.labOrderRepository.count({ organizationId, status: 'in_progress' }),
      this.labOrderRepository.count({
        organizationId,
        status: 'completed',
        resultsReportedAt: { gte: todayStart, lte: todayEnd },
      }),
      this.labResultRepository.count({ isCritical: true, verifiedAt: null }),
      this.labTestRepository.count({ organizationId, isActive: true }),
    ]);

    return {
      pending,
      sampleCollected,
      inProgress,
      completedToday,
      criticalResults,
      totalTests,
    };
  }
}
