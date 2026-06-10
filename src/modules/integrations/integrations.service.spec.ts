/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { MachineIntegrationRepository } from './machine-integration.repository';
import { MachineResultsQueueRepository } from './machine-results-queue.repository';
import { IntegrationLogRepository } from './integration-log.repository';
import { PatientMatcher } from './patient-matcher';
import { AuditService } from '../../audit/audit.service';
import { MachineIntegration, MachineResultsQueue } from '@prisma/client';
import {
  NotFoundException,
  AppException,
} from '../../common/exceptions/app.exception';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let machineIntegrationRepo: jest.Mocked<MachineIntegrationRepository>;
  let machineResultsQueueRepo: jest.Mocked<MachineResultsQueueRepository>;
  let integrationLogRepo: jest.Mocked<IntegrationLogRepository>;
  let patientMatcher: jest.Mocked<PatientMatcher>;
  let auditService: jest.Mocked<AuditService>;

  const mockMachineRecord: MachineIntegration = {
    id: 'mac-1',
    organizationId: 'org-demo',
    machineName: 'Sysmex X1',
    machineType: 'lab_analyzer',
    manufacturer: 'Sysmex',
    model: 'X1',
    serialNumber: 'SN-123',
    department: 'laboratory',
    connectionType: 'file_upload',
    connectionDetails: JSON.stringify({ source: 'test' }),
    testMapping: JSON.stringify({ WBC: 'wbc-id' }),
    isActive: true,
    connectionStatus: 'connected',
    lastConnectedAt: null,
    lastResultReceivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockQueueRecord: MachineResultsQueue = {
    id: 'q-1',
    organizationId: 'org-demo',
    machineIntegrationId: 'mac-1',
    rawData: '{}',
    parsedData: JSON.stringify({
      patientId: 'PT-1',
      testCode: 'WBC',
      result: '7.5',
    }),
    patientIdentifier: 'PT-1',
    matchedPatientId: 'pat-123',
    testResults: JSON.stringify([{ testCode: 'WBC', value: '7.5' }]),
    status: 'matched',
    errorMessage: null,
    receivedAt: new Date(),
    processedAt: null,
  };

  beforeEach(async () => {
    const mockMachineRepository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      hardDelete: jest.fn(),
      upsert: jest.fn(),
    };

    const mockQueueRepository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    };

    const mockLogRepository = {
      create: jest.fn(),
    };

    const mockMatcher = {
      matchPatient: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        {
          provide: MachineIntegrationRepository,
          useValue: mockMachineRepository,
        },
        {
          provide: MachineResultsQueueRepository,
          useValue: mockQueueRepository,
        },
        { provide: IntegrationLogRepository, useValue: mockLogRepository },
        { provide: PatientMatcher, useValue: mockMatcher },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    machineIntegrationRepo = module.get(MachineIntegrationRepository);
    machineResultsQueueRepo = module.get(MachineResultsQueueRepository);
    integrationLogRepo = module.get(IntegrationLogRepository);
    patientMatcher = module.get(PatientMatcher);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMachines', () => {
    it('should return machine integrations with parsed fields', async () => {
      machineIntegrationRepo.findMany.mockResolvedValue([mockMachineRecord]);
      const result = await service.getMachines('org-demo', {});
      expect(machineIntegrationRepo.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].connectionDetails).toEqual({ source: 'test' });
      expect(result[0].testMapping).toEqual({ WBC: 'wbc-id' });
    });
  });

  describe('getMachineById', () => {
    it('should return parsed machine details', async () => {
      const details = {
        ...mockMachineRecord,
        integrationLogs: [
          {
            id: 'l-1',
            message: 'Connected',
            details: JSON.stringify({ ip: '127.0.0.1' }),
            logDate: new Date(),
          },
        ],
      };
      machineIntegrationRepo.findOne.mockResolvedValue(details);
      const result = await service.getMachineById('mac-1', 'org-demo');
      expect(machineIntegrationRepo.findOne).toHaveBeenCalled();
      expect(result.id).toBe('mac-1');
      expect(result.connectionDetails).toEqual({ source: 'test' });
      expect(result.integrationLogs?.[0].details).toEqual({ ip: '127.0.0.1' });
    });

    it('should throw NotFoundException if machine not found', async () => {
      machineIntegrationRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getMachineById('mac-different', 'org-demo'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createMachine', () => {
    it('should register a machine, create log, and audit log', async () => {
      machineIntegrationRepo.create.mockResolvedValue(mockMachineRecord);
      const result = await service.createMachine(
        {
          machineName: 'Sysmex X1',
          machineType: 'lab_analyzer',
          connectionType: 'file_upload',
          connectionDetails: { source: 'test' },
          testMapping: { WBC: 'wbc-id' },
        },
        'org-demo',
        'user-1',
      );
      expect(machineIntegrationRepo.create).toHaveBeenCalled();
      expect(integrationLogRepo.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockMachineRecord.id);
    });
  });

  describe('updateMachine', () => {
    it('should update machine config, create log, and audit log', async () => {
      machineIntegrationRepo.findOne.mockResolvedValue(mockMachineRecord);
      machineIntegrationRepo.update.mockResolvedValue({
        ...mockMachineRecord,
        connectionStatus: 'error',
      });
      const result = await service.updateMachine(
        'mac-1',
        { connectionStatus: 'error' },
        'org-demo',
        'user-1',
      );
      expect(machineIntegrationRepo.findOne).toHaveBeenCalled();
      expect(machineIntegrationRepo.update).toHaveBeenCalled();
      expect(integrationLogRepo.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.connectionStatus).toBe('error');
    });

    it('should throw NotFoundException if machine does not exist', async () => {
      machineIntegrationRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateMachine(
          'mac-different',
          { connectionStatus: 'error' },
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMachine', () => {
    it('should hard delete machine and audit log', async () => {
      machineIntegrationRepo.findOne.mockResolvedValue(mockMachineRecord);
      machineIntegrationRepo.hardDelete.mockResolvedValue(mockMachineRecord);
      const result = await service.deleteMachine('mac-1', 'org-demo', 'user-1');
      expect(machineIntegrationRepo.findOne).toHaveBeenCalled();
      expect(machineIntegrationRepo.hardDelete).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should throw NotFoundException if machine does not exist', async () => {
      machineIntegrationRepo.findOne.mockResolvedValue(null);
      await expect(
        service.deleteMachine('mac-different', 'org-demo', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResultsQueue', () => {
    it('should return results with parsed fields', async () => {
      machineResultsQueueRepo.findMany.mockResolvedValue([mockQueueRecord]);
      const result = await service.getResultsQueue('org-demo', {});
      expect(machineResultsQueueRepo.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].patientIdentifier).toBe('PT-1');
      expect(result[0].parsedData?.result).toBe('7.5');
    });
  });

  describe('uploadResultsFile', () => {
    const csvContent = Buffer.from(
      'Patient ID,Patient Name,Test Code,Test Name,Result,Unit,Reference Range,Date\nPT-1,Alice,WBC,White Blood Cell,7.5,10^9/L,4.0-11.0,2026-06-10T12:00:00Z',
    );

    it('should parse csv, match patient, create queue record and logs', async () => {
      machineIntegrationRepo.upsert.mockResolvedValue(mockMachineRecord);
      patientMatcher.matchPatient.mockResolvedValue({
        matched: true,
        patientId: 'pat-123',
        confidence: 1.0,
      });
      machineResultsQueueRepo.createMany.mockResolvedValue({ count: 1 });
      machineIntegrationRepo.update.mockResolvedValue(mockMachineRecord);

      const result = await service.uploadResultsFile(
        csvContent,
        'results.csv',
        'mac-1',
        'org-demo',
        'user-1',
      );

      expect(machineIntegrationRepo.upsert).toHaveBeenCalled();
      expect(patientMatcher.matchPatient).toHaveBeenCalled();
      expect(machineResultsQueueRepo.createMany).toHaveBeenCalled();
      expect(integrationLogRepo.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.matchedCount.success).toBe(1);
    });

    it('should throw AppException if parsing fails', async () => {
      const invalidContent = Buffer.from('Invalid,CSV,Headers\n');
      machineIntegrationRepo.upsert.mockResolvedValue(mockMachineRecord);

      await expect(
        service.uploadResultsFile(
          invalidContent,
          'results.csv',
          'mac-1',
          'org-demo',
          'user-1',
        ),
      ).rejects.toThrow(AppException);
    });
  });
});
