/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { LaboratoryService } from './laboratory.service';
import { LabTestRepository } from './lab-test.repository';
import { LabOrderRepository } from './lab-order.repository';
import { LabResultRepository } from './lab-result.repository';
import { AuditService } from '../../audit/audit.service';
import { LabTest, LabOrder, LabResult } from '@prisma/client';
import { NotFoundException } from '../../common/exceptions/app.exception';

describe('LaboratoryService', () => {
  let service: LaboratoryService;
  let labTestRepository: jest.Mocked<LabTestRepository>;
  let labOrderRepository: jest.Mocked<LabOrderRepository>;
  let labResultRepository: jest.Mocked<LabResultRepository>;
  let auditService: jest.Mocked<AuditService>;

  const mockTestRecord: LabTest = {
    id: 'test-1',
    organizationId: 'org-demo',
    testName: 'Complete Blood Count',
    testCode: 'CBC',
    testCategory: 'hematology',
    testType: 'quantitative',
    specimenType: 'blood',
    specimenVolume: '2ml',
    specimenContainer: 'EDTA Tube',
    resultType: 'numeric',
    unit: 'g/dL',
    referenceRanges: '{"male": {"min": 13.5, "max": 17.5}}',
    price: 150.0,
    turnaroundTime: 24,
    department: 'Hematology Lab',
    preparationInstructions: 'Fasting',
    clinicalSignificance: 'Anemia screen',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockOrderRecord: LabOrder = {
    id: 'order-1',
    organizationId: 'org-demo',
    patientId: 'pat-1',
    consultationId: 'cons-1',
    requestedById: 'user-1',
    orderDate: new Date(),
    orderNumber: 'LAB123456789',
    tests: JSON.stringify([
      {
        testId: 'test-1',
        testName: 'Complete Blood Count',
        urgency: 'routine',
      },
    ]),
    clinicalIndication: 'Anemia screen',
    provisionalDiagnosis: 'Anemia',
    priority: 'routine',
    status: 'pending',
    sampleCollectedAt: null,
    sampleCollectedById: null,
    accessionNumber: null,
    resultsEnteredAt: null,
    resultsEnteredById: null,
    resultsVerifiedAt: null,
    resultsVerifiedById: null,
    resultsReportedAt: null,
    notes: 'Urgent check',
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
  };

  const mockResultRecord: LabResult = {
    id: 'res-1',
    organizationId: 'org-demo',
    orderId: 'order-1',
    testId: 'test-1',
    resultValue: '13.5',
    resultUnit: 'g/dL',
    isAbnormal: false,
    isCritical: false,
    flag: 'N',
    referenceRangeMin: 12.0,
    referenceRangeMax: 16.0,
    referenceRangeText: '12.0 - 16.0',
    qcLevel: 'level-1',
    qcPassed: true,
    methodUsed: 'auto',
    instrumentUsed: ' Beckman Coulter',
    enteredById: 'user-1',
    enteredAt: new Date(),
    verifiedById: null,
    verifiedAt: null,
    comment: 'Normal range',
    technicianNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockTestRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockOrderRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockResultRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LaboratoryService,
        { provide: LabTestRepository, useValue: mockTestRepo },
        { provide: LabOrderRepository, useValue: mockOrderRepo },
        { provide: LabResultRepository, useValue: mockResultRepo },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<LaboratoryService>(LaboratoryService);
    labTestRepository = module.get(LabTestRepository);
    labOrderRepository = module.get(LabOrderRepository);
    labResultRepository = module.get(LabResultRepository);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTests', () => {
    it('should query and return active tests', async () => {
      labTestRepository.findMany.mockResolvedValue([mockTestRecord]);
      const result = await service.getTests('org-demo', 'hematology');
      expect(labTestRepository.findMany).toHaveBeenCalledWith(
        {
          organizationId: 'org-demo',
          isActive: true,
          testCategory: 'hematology',
        },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockTestRecord.id);
    });
  });

  describe('getOrders', () => {
    it('should query and return orders', async () => {
      labOrderRepository.findMany.mockResolvedValue([mockOrderRecord]);
      const result = await service.getOrders('org-demo', 'pending', 'routine');
      expect(labOrderRepository.findMany).toHaveBeenCalledWith(
        { organizationId: 'org-demo', status: 'pending', priority: 'routine' },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockOrderRecord.id);
    });
  });

  describe('getResults', () => {
    it('should query and return results', async () => {
      labResultRepository.findMany.mockResolvedValue([mockResultRecord]);
      const result = await service.getResults('order-1');
      expect(labResultRepository.findMany).toHaveBeenCalledWith(
        { orderId: 'order-1' },
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockResultRecord.id);
    });
  });

  describe('createTest', () => {
    it('should create lab test and log audit', async () => {
      labTestRepository.create.mockResolvedValue(mockTestRecord);
      const result = await service.createTest(
        {
          testName: 'Complete Blood Count',
          testCode: 'CBC',
        },
        'org-demo',
        'user-1',
      );
      expect(labTestRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockTestRecord.id);
    });
  });

  describe('createOrder', () => {
    it('should create lab order and log audit', async () => {
      labOrderRepository.create.mockResolvedValue(mockOrderRecord);
      labOrderRepository.findOne.mockResolvedValue(mockOrderRecord);
      const result = await service.createOrder(
        {
          patientId: 'pat-1',
          tests: [
            {
              testId: 'test-1',
              testName: 'Complete Blood Count',
              urgency: 'routine',
            },
          ],
        },
        'org-demo',
        'user-1',
      );
      expect(labOrderRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockOrderRecord.id);
    });
  });

  describe('createResult', () => {
    it('should create result, update order to in_progress, and log audit', async () => {
      labResultRepository.create.mockResolvedValue(mockResultRecord);
      labResultRepository.findOne.mockResolvedValue(mockResultRecord);
      labOrderRepository.update.mockResolvedValue(mockOrderRecord);

      const result = await service.createResult(
        {
          orderId: 'order-1',
          testId: 'test-1',
          resultValue: '13.5',
        },
        'org-demo',
        'user-1',
      );

      expect(labResultRepository.create).toHaveBeenCalled();
      expect(labOrderRepository.update).toHaveBeenCalledWith('order-1', {
        status: 'in_progress',
        resultsEnteredAt: expect.any(Date),
        resultsEnteredById: 'user-1',
      });
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockResultRecord.id);
    });
  });

  describe('updateTest', () => {
    it('should update test and log audit', async () => {
      labTestRepository.findById.mockResolvedValue(mockTestRecord);
      labTestRepository.update.mockResolvedValue({
        ...mockTestRecord,
        price: 200.0,
      });

      const result = await service.updateTest(
        'test-1',
        { price: 200.0 },
        'org-demo',
        'user-1',
      );
      expect(labTestRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.price).toBe(200.0);
    });

    it('should throw NotFoundException if test does not exist', async () => {
      labTestRepository.findById.mockResolvedValue(null);
      await expect(
        service.updateTest('test-diff', { price: 200.0 }, 'org-demo', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateResult', () => {
    it('should update result and log audit', async () => {
      labResultRepository.findById.mockResolvedValue(mockResultRecord);
      labResultRepository.update.mockResolvedValue({
        ...mockResultRecord,
        resultValue: '14.0',
      });

      const result = await service.updateResult(
        'res-1',
        { resultValue: '14.0' },
        'org-demo',
        'user-1',
      );
      expect(labResultRepository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.resultValue).toBe('14.0');
    });

    it('should verify result and trigger order completion check', async () => {
      labResultRepository.findById.mockResolvedValue(mockResultRecord);
      const verifiedResult = {
        ...mockResultRecord,
        verifiedAt: new Date(),
        verifiedById: 'user-1',
      };
      labResultRepository.update.mockResolvedValue(verifiedResult);
      labResultRepository.findMany.mockResolvedValue([verifiedResult]);
      labOrderRepository.update.mockResolvedValue(mockOrderRecord);

      await service.updateResult(
        'res-1',
        { verifiedAt: new Date() },
        'org-demo',
        'user-1',
      );
      expect(labResultRepository.update).toHaveBeenCalled();
      expect(labOrderRepository.update).toHaveBeenCalledWith('order-1', {
        status: 'completed',
        resultsVerifiedAt: expect.any(Date),
        resultsVerifiedById: 'user-1',
        resultsReportedAt: expect.any(Date),
      });
    });
  });

  describe('updateOrder', () => {
    it('should generate a unique accession number when status becomes sample_collected', async () => {
      labOrderRepository.findById.mockResolvedValue(mockOrderRecord);
      labOrderRepository.findOne.mockResolvedValueOnce(null); // No existing order with generated accession
      labOrderRepository.update.mockImplementation((id, data) =>
        Promise.resolve({ ...mockOrderRecord, ...data } as LabOrder),
      );

      const result = await service.updateOrder(
        'order-1',
        { status: 'sample_collected', sampleCollectedAt: new Date() },
        'org-demo',
        'user-1',
      );

      expect(labOrderRepository.update).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          status: 'sample_collected',
          accessionNumber: expect.stringMatching(/^ACC-[0-9A-Z]{8}$/),
        }),
      );
      expect(result.accessionNumber).toMatch(/^ACC-[0-9A-Z]{8}$/);
    });

    it('should ignore and delete custom accession number from client to prevent duplication', async () => {
      labOrderRepository.findById.mockResolvedValue(mockOrderRecord);
      labOrderRepository.findOne.mockResolvedValueOnce(null);
      labOrderRepository.update.mockImplementation((id, data) =>
        Promise.resolve({ ...mockOrderRecord, ...data } as LabOrder),
      );

      const result = await service.updateOrder(
        'order-1',
        { status: 'sample_collected', accessionNumber: 'CUSTOM-ACC-123' },
        'org-demo',
        'user-1',
      );

      // Should be overwritten with a generated unique one
      expect(result.accessionNumber).not.toBe('CUSTOM-ACC-123');
      expect(result.accessionNumber).toMatch(/^ACC-[0-9A-Z]{8}$/);
    });
  });

  describe('getStats', () => {
    it('should calculate laboratory statistics', async () => {
      labOrderRepository.count.mockResolvedValueOnce(5); // pending
      labOrderRepository.count.mockResolvedValueOnce(3); // sampleCollected
      labOrderRepository.count.mockResolvedValueOnce(2); // inProgress
      labOrderRepository.count.mockResolvedValueOnce(4); // completedToday
      labResultRepository.count.mockResolvedValue(1); // criticalResults
      labTestRepository.count.mockResolvedValue(20); // totalTests

      const stats = await service.getStats('org-demo');
      expect(stats.pending).toBe(5);
      expect(stats.sampleCollected).toBe(3);
      expect(stats.inProgress).toBe(2);
      expect(stats.completedToday).toBe(4);
      expect(stats.criticalResults).toBe(1);
      expect(stats.totalTests).toBe(20);
    });
  });
});
