import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MachineIntegrationRepository } from './machine-integration.repository';
import { MachineResultsQueueRepository } from './machine-results-queue.repository';
import { IntegrationLogRepository } from './integration-log.repository';
import { PatientMatcher } from './patient-matcher';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  AppException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine.dto';
import { ResultsQueueQueryDto, MachineQueryDto } from './dto/results-queue.dto';
import { parseResultsFile } from './file-import';

export interface MachineIntegrationResponse {
  id: string;
  organizationId: string;
  machineName: string;
  machineType: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  department: string | null;
  connectionType: string;
  connectionDetails: Record<string, unknown>;
  testMapping: Record<string, unknown>;
  isActive: boolean;
  connectionStatus: string;
  lastConnectedAt: Date | null;
  lastResultReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  integrationLogs?: Array<{
    id: string;
    logDate: Date;
    logType: string | null;
    message: string;
    details: Record<string, unknown> | null;
  }>;
  _count?: {
    resultsQueue: number;
    integrationLogs?: number;
  };
}

export interface ResultsQueueResponse {
  id: string;
  organizationId: string;
  machineIntegrationId: string;
  rawData: string;
  parsedData: Record<string, unknown> | null;
  patientIdentifier: string | null;
  matchedPatientId: string | null;
  testResults: Array<Record<string, unknown>>;
  status: string;
  errorMessage: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  machineIntegration?: {
    id: string;
    machineName: string;
    machineType: string;
  };
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
  } | null;
}

export interface UploadResultsResponse {
  success: boolean;
  fileName: string;
  totalRows: number;
  parsedRows: number;
  parseErrors: string[];
  matchedCount: {
    success: number;
    failed: number;
    pending: number;
  };
  queuedResults: number;
}

interface MachineWithLogs {
  id: string;
  organizationId: string;
  machineName: string;
  machineType: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  department: string | null;
  connectionType: string;
  connectionDetails: string;
  testMapping: string;
  isActive: boolean;
  connectionStatus: string;
  lastConnectedAt: Date | null;
  lastResultReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  integrationLogs: Array<{
    id: string;
    logDate: Date;
    logType: string | null;
    message: string;
    details: string | null;
  }>;
  _count: {
    resultsQueue: number;
    integrationLogs: number;
  };
}

interface MachineWithCount {
  id: string;
  organizationId: string;
  machineName: string;
  machineType: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  department: string | null;
  connectionType: string;
  connectionDetails: string;
  testMapping: string;
  isActive: boolean;
  connectionStatus: string;
  lastConnectedAt: Date | null;
  lastResultReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  _count?: {
    resultsQueue: number;
  };
}

interface QueueWithRelations {
  id: string;
  organizationId: string;
  machineIntegrationId: string;
  rawData: string;
  parsedData: string | null;
  patientIdentifier: string | null;
  matchedPatientId: string | null;
  testResults: string;
  status: string;
  errorMessage: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  machineIntegration?: {
    id: string;
    machineName: string;
    machineType: string;
  };
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
  } | null;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly machineIntegrationRepo: MachineIntegrationRepository,
    private readonly machineResultsQueueRepo: MachineResultsQueueRepository,
    private readonly integrationLogRepo: IntegrationLogRepository,
    private readonly patientMatcher: PatientMatcher,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get all machine integrations
   */
  async getMachines(
    organizationId: string,
    query: MachineQueryDto,
  ): Promise<MachineIntegrationResponse[]> {
    const where: Record<string, unknown> = { organizationId };

    if (query.machineType) {
      where.machineType = query.machineType;
    }
    if (query.department) {
      where.department = query.department;
    }
    if (query.status) {
      where.connectionStatus = query.status;
    }

    const machines = (await this.machineIntegrationRepo.findMany(where, {
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            resultsQueue: { where: { status: 'pending' } },
          },
        },
      },
    })) as unknown as MachineWithCount[];

    return machines.map((machine) => ({
      ...machine,
      connectionDetails: JSON.parse(
        machine.connectionDetails || '{}',
      ) as Record<string, unknown>,
      testMapping: JSON.parse(machine.testMapping || '{}') as Record<
        string,
        unknown
      >,
      _count: machine._count || { resultsQueue: 0 },
    }));
  }

  /**
   * Get machine integration details
   */
  async getMachineById(
    id: string,
    organizationId: string,
  ): Promise<MachineIntegrationResponse> {
    const machine = (await this.machineIntegrationRepo.findOne(
      { id, organizationId },
      {
        _count: {
          select: {
            resultsQueue: true,
            integrationLogs: true,
          },
        },
        integrationLogs: {
          orderBy: { logDate: 'desc' },
          take: 10,
        },
      },
    )) as MachineWithLogs | null;

    if (!machine) {
      throw new NotFoundException(
        'Machine not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }

    return {
      ...machine,
      connectionDetails: JSON.parse(
        machine.connectionDetails || '{}',
      ) as Record<string, unknown>,
      testMapping: JSON.parse(machine.testMapping || '{}') as Record<
        string,
        unknown
      >,
      integrationLogs: machine.integrationLogs.map((log) => ({
        ...log,
        details: log.details
          ? (JSON.parse(log.details) as Record<string, unknown>)
          : null,
      })),
      _count: machine._count,
    };
  }

  /**
   * Register a new machine integration
   */
  async createMachine(
    dto: CreateMachineDto,
    organizationId: string,
    userId?: string,
  ): Promise<MachineIntegrationResponse> {
    const resolvedOrgId = dto.organizationId || organizationId;

    const machine = await this.machineIntegrationRepo.create({
      organization: { connect: { id: resolvedOrgId } },
      machineName: dto.machineName,
      machineType: dto.machineType,
      manufacturer: dto.manufacturer,
      model: dto.model,
      serialNumber: dto.serialNumber,
      department: dto.department,
      connectionType: dto.connectionType,
      connectionDetails: JSON.stringify(dto.connectionDetails || {}),
      testMapping: JSON.stringify(dto.testMapping || {}),
      isActive: true,
      connectionStatus: 'disconnected',
      createdById: userId,
    });

    // Log configuration change in integration logs
    await this.integrationLogRepo.create({
      machineIntegration: { connect: { id: machine.id } },
      logType: 'config_change',
      message: `Machine integration created: ${dto.machineName}`,
      details: JSON.stringify({ action: 'create', machineId: machine.id }),
    });

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'MachineIntegration',
      entityId: machine.id,
      newValues: {
        machineName: machine.machineName,
        machineType: machine.machineType,
        connectionType: machine.connectionType,
      },
      metadata: { organizationId: resolvedOrgId },
    });

    return {
      ...machine,
      connectionDetails: JSON.parse(machine.connectionDetails) as Record<
        string,
        unknown
      >,
      testMapping: JSON.parse(machine.testMapping) as Record<string, unknown>,
    };
  }

  /**
   * Update machine integration
   */
  async updateMachine(
    id: string,
    dto: UpdateMachineDto,
    organizationId: string,
    userId?: string,
  ): Promise<MachineIntegrationResponse> {
    const existing = await this.machineIntegrationRepo.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Machine not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }

    const updateData: Prisma.MachineIntegrationUpdateInput = {};
    if (dto.machineName !== undefined) updateData.machineName = dto.machineName;
    if (dto.manufacturer !== undefined)
      updateData.manufacturer = dto.manufacturer;
    if (dto.model !== undefined) updateData.model = dto.model;
    if (dto.serialNumber !== undefined)
      updateData.serialNumber = dto.serialNumber;
    if (dto.department !== undefined) updateData.department = dto.department;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.connectionStatus !== undefined)
      updateData.connectionStatus = dto.connectionStatus;

    if (dto.connectionDetails !== undefined) {
      updateData.connectionDetails = JSON.stringify(dto.connectionDetails);
    }
    if (dto.testMapping !== undefined) {
      updateData.testMapping = JSON.stringify(dto.testMapping);
    }

    const machine = await this.machineIntegrationRepo.update(id, updateData);

    // Log config change
    await this.integrationLogRepo.create({
      machineIntegration: { connect: { id: machine.id } },
      logType: 'config_change',
      message: 'Machine configuration updated',
      details: JSON.stringify({ updatedFields: Object.keys(updateData) }),
    });

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'MachineIntegration',
      entityId: id,
      oldValues: {
        machineName: existing.machineName,
        isActive: existing.isActive,
        connectionStatus: existing.connectionStatus,
      },
      newValues: {
        machineName: machine.machineName,
        isActive: machine.isActive,
        connectionStatus: machine.connectionStatus,
      },
      metadata: { organizationId },
    });

    return {
      ...machine,
      connectionDetails: JSON.parse(machine.connectionDetails) as Record<
        string,
        unknown
      >,
      testMapping: JSON.parse(machine.testMapping) as Record<string, unknown>,
    };
  }

  /**
   * Delete machine integration
   */
  async deleteMachine(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<{ success: boolean }> {
    const existing = await this.machineIntegrationRepo.findOne({
      id,
      organizationId,
    });
    if (!existing) {
      throw new NotFoundException(
        'Machine not found',
        ErrorCodes.MACHINE_NOT_FOUND,
      );
    }

    await this.machineIntegrationRepo.hardDelete(id);

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      entityName: 'MachineIntegration',
      entityId: id,
      oldValues: {
        machineName: existing.machineName,
      },
      metadata: { organizationId },
    });

    return { success: true };
  }

  /**
   * Get results from the import queue
   */
  async getResultsQueue(
    organizationId: string,
    query: ResultsQueueQueryDto,
  ): Promise<ResultsQueueResponse[]> {
    const where: Record<string, unknown> = { organizationId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.machineId) {
      where.machineIntegrationId = query.machineId;
    }

    const results = (await this.machineResultsQueueRepo.findMany(where, {
      orderBy: { receivedAt: 'desc' },
      include: {
        machineIntegration: {
          select: {
            id: true,
            machineName: true,
            machineType: true,
          },
        },
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mrn: true,
          },
        },
      },
    })) as unknown as QueueWithRelations[];

    return results.map((result) => ({
      ...result,
      parsedData: result.parsedData
        ? (JSON.parse(result.parsedData) as Record<string, unknown>)
        : null,
      testResults: JSON.parse(result.testResults || '[]') as Array<
        Record<string, unknown>
      >,
      machineIntegration: result.machineIntegration || {
        id: '',
        machineName: '',
        machineType: 'lab_analyzer',
      },
      patient: result.patient || null,
    }));
  }

  /**
   * Upload CSV/Excel file with laboratory/radiology results
   */
  async uploadResultsFile(
    fileBuffer: Buffer,
    fileName: string,
    machineIntegrationId: string | undefined,
    organizationId: string,
    userId?: string,
  ): Promise<UploadResultsResponse> {
    const resolvedMachineIntegrationId =
      machineIntegrationId || `machine-manual-upload-${organizationId}`;

    // Ensure valid machine integration exists
    await this.machineIntegrationRepo.upsert(
      resolvedMachineIntegrationId,
      {
        id: resolvedMachineIntegrationId,
        organization: { connect: { id: organizationId } },
        machineName: 'Manual File Upload',
        machineType: 'lab_analyzer',
        connectionType: 'file_upload',
        connectionDetails: JSON.stringify({ source: 'manual-upload' }),
        testMapping: JSON.stringify({}),
        isActive: true,
        connectionStatus: 'connected',
      },
      {},
    );

    // Parse file
    const parseResult = parseResultsFile(fileBuffer, fileName);
    if (!parseResult.success) {
      throw new AppException(
        `File parsing failed: ${parseResult.errors.join(', ')}`,
        ErrorCodes.FILE_PARSING_FAILED,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Process matching
    const queueEntries: Prisma.MachineResultsQueueCreateManyInput[] = [];
    const matchedCount = { success: 0, failed: 0, pending: 0 };

    for (const result of parseResult.data) {
      const patientMatch = await this.patientMatcher.matchPatient(
        result.patientId,
        organizationId,
        {
          name: result.patientName,
        },
      );

      const status = patientMatch.matched
        ? 'matched'
        : patientMatch.suggestions
          ? 'manual_review'
          : 'failed';

      const errorMessage =
        !patientMatch.matched && !patientMatch.suggestions
          ? `Patient not found: ${result.patientId}`
          : patientMatch.suggestions
            ? `Multiple matches found, requires manual review`
            : null;

      const queueEntry: Prisma.MachineResultsQueueCreateManyInput = {
        organizationId,
        machineIntegrationId: resolvedMachineIntegrationId,
        rawData: JSON.stringify(result),
        parsedData: JSON.stringify(result),
        patientIdentifier: result.patientId,
        matchedPatientId:
          patientMatch.matched && patientMatch.patientId
            ? patientMatch.patientId
            : null,
        testResults: JSON.stringify([
          {
            testCode: result.testCode,
            testName: result.testName,
            value: result.result,
            unit: result.unit,
            referenceRange: result.referenceRange,
            timestamp: result.timestamp,
          },
        ]),
        status,
        errorMessage,
        receivedAt: new Date(),
      };

      queueEntries.push(queueEntry);

      if (patientMatch.matched) {
        matchedCount.success++;
      } else if (patientMatch.suggestions) {
        matchedCount.pending++;
      } else {
        matchedCount.failed++;
      }
    }

    // Bulk insert to queue
    if (queueEntries.length > 0) {
      await this.machineResultsQueueRepo.createMany(queueEntries);
    }

    // Log the import
    await this.integrationLogRepo.create({
      machineIntegration: { connect: { id: resolvedMachineIntegrationId } },
      logType: 'result_import',
      message: `File upload processed: ${fileName}`,
      details: JSON.stringify({
        fileName,
        totalRows: parseResult.totalRows,
        parsedRows: parseResult.parsedRows,
        matchedCount,
      }),
      resultsImported: matchedCount.success,
      resultsFailed: matchedCount.failed,
    });

    // Update machine last active status
    await this.machineIntegrationRepo.update(resolvedMachineIntegrationId, {
      lastResultReceivedAt: new Date(),
    });

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'MachineResultsQueue',
      entityId: resolvedMachineIntegrationId,
      newValues: {
        fileName,
        totalRows: parseResult.totalRows,
        matchedCount,
      },
      metadata: { organizationId },
    });

    return {
      success: true,
      fileName,
      totalRows: parseResult.totalRows,
      parsedRows: parseResult.parsedRows,
      parseErrors: parseResult.errors,
      matchedCount,
      queuedResults: queueEntries.length,
    };
  }
}
