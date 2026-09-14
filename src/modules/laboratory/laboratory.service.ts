import { Injectable, Logger } from '@nestjs/common';
import { Prisma, LabTest, LabOrder, LabResult } from '@prisma/client';
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
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types/paginated.type';

@Injectable()
export class LaboratoryService {
  private readonly logger = new Logger(LaboratoryService.name);

  constructor(
    private readonly labTestRepository: LabTestRepository,
    private readonly labOrderRepository: LabOrderRepository,
    private readonly labResultRepository: LabResultRepository,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
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

  async getTestById(id: string, organizationId: string): Promise<LabTest> {
    // Scoped by organisation, not just id: these ids are opaque but guessable
    // enough that "GET /laboratory/tests/:id" was a cross-hospital read of
    // another site's catalogue, and for results below, of their patients.
    const test = await this.labTestRepository.findOne({ id, organizationId });
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
    const oldTest = await this.getTestById(id, organizationId);

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

  async deleteTest(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<LabTest> {
    const oldTest = await this.getTestById(id, organizationId);

    const test = await this.labTestRepository.update(id, {
      isActive: false,
    });

    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'LabTest',
      entityId: test.id,
      oldValues: oldTest,
      newValues: test,
      metadata: { organizationId, deleted: true },
    });

    return test;
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async getOrders(
    organizationId: string,
    status?: string,
    priority?: string,
    search?: string,
    page: number = 1,
    limit: number = 10,
    patientId?: string,
  ): Promise<PaginatedResult<LabOrder>> {
    const where: Prisma.LabOrderWhereInput = { organizationId };

    if (status) {
      where.status = status;
    }
    if (priority) {
      where.priority = priority;
    }
    if (patientId) {
      where.patientId = patientId;
    }
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { accessionNumber: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { mrn: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    return this.labOrderRepository.paginate(where, {
      page,
      limit,
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

  async getOrderById(id: string, organizationId: string): Promise<LabOrder> {
    const order = await this.labOrderRepository.findOne({ id, organizationId });
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
    const oldOrder = await this.getOrderById(id, organizationId);

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
  async getResults(
    organizationId: string,
    orderId?: string,
  ): Promise<LabResult[]> {
    // Scoped through the order, never through `LabResult.organizationId`: that
    // column is nullable, so rows written before it existed carry NULL and
    // filtering on it directly drops real results from their own hospital's
    // list while leaking nothing back. The order's column is NOT NULL.
    const where: Record<string, unknown> = { order: { organizationId } };
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

  async getResultById(id: string, organizationId: string): Promise<LabResult> {
    const result = await this.labResultRepository.findOne({
      id,
      order: { organizationId },
    });
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
    const oldResult = await this.getResultById(id, organizationId);

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

    // Single $queryRaw replaces 6 parallel COUNT queries (each was 1-2s).
    // Uses indexes: LabOrder_organizationId_status_idx,
    //               LabOrder_organizationId_status_resultsReportedAt_idx,
    //               LabResult_isCritical_verifiedAt_idx,
    //               LabTest_organizationId_isActive_idx
    type StatsRow = {
      pending: bigint;
      sample_collected: bigint;
      in_progress: bigint;
      completed_today: bigint;
      critical_results: bigint;
      total_tests: bigint;
    };

    const rows = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        (SELECT COUNT(*) FROM "LabOrder"
          WHERE "organizationId" = ${organizationId} AND "status" = 'pending'
        ) AS pending,
        (SELECT COUNT(*) FROM "LabOrder"
          WHERE "organizationId" = ${organizationId} AND "status" = 'sample_collected'
        ) AS sample_collected,
        (SELECT COUNT(*) FROM "LabOrder"
          WHERE "organizationId" = ${organizationId} AND "status" = 'in_progress'
        ) AS in_progress,
        (SELECT COUNT(*) FROM "LabOrder"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'completed'
            AND "resultsReportedAt" >= ${todayStart}
            AND "resultsReportedAt" <= ${todayEnd}
        ) AS completed_today,
        -- Joined through the order: LabResult.organizationId is nullable, so
        -- filtering on it directly would silently drop rows. Without the join
        -- this counted every hospital's unverified critical results, and a
        -- clinician saw a number that was not about their patients.
        (SELECT COUNT(*) FROM "LabResult" r
          JOIN "LabOrder" o ON o."id" = r."orderId"
          WHERE r."isCritical" = true
            AND r."verifiedAt" IS NULL
            AND o."organizationId" = ${organizationId}
        ) AS critical_results,
        (SELECT COUNT(*) FROM "LabTest"
          WHERE "organizationId" = ${organizationId} AND "isActive" = true
        ) AS total_tests
    `;

    const r = rows[0];
    return {
      pending: Number(r.pending),
      sampleCollected: Number(r.sample_collected),
      inProgress: Number(r.in_progress),
      completedToday: Number(r.completed_today),
      criticalResults: Number(r.critical_results),
      totalTests: Number(r.total_tests),
    };
  }
}
