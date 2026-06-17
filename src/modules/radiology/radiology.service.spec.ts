/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RadiologyService } from './radiology.service';
import { RadiologyExamRepository } from './radiology-exam.repository';
import { RadiologyOrderRepository } from './radiology-order.repository';
import { RadiologyReportRepository } from './radiology-report.repository';
import { AuditService } from '../../audit/audit.service';
import { RadiologyExam, RadiologyOrder, RadiologyReport } from '@prisma/client';
import {
  AppException,
  NotFoundException,
} from '../../common/exceptions/app.exception';

const ORG = 'org-demo';
const USER = 'user-1';

const mockExam: RadiologyExam = {
  id: 'exam-1',
  organizationId: ORG,
  examName: 'Chest X-ray',
  examCode: 'CXR',
  examCategory: 'X-ray',
  bodyPart: 'Chest',
  modality: null,
  price: 200,
  estimatedDuration: 15,
  preparationInstructions: null,
  contrastRequired: false,
  description: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdById: USER,
};

const mockOrder: RadiologyOrder = {
  id: 'ord-1',
  organizationId: ORG,
  patientId: 'pat-1',
  consultationId: null,
  examId: 'exam-1',
  requestedById: USER,
  orderNumber: `RAD${Date.now()}`,
  clinicalIndication: 'Shortness of breath',
  provisionalDiagnosis: null,
  relevantHistory: null,
  urgency: 'routine',
  status: 'pending',
  scheduledDate: null,
  examPerformedAt: null,
  performedById: null,
  notes: null,
  cancellationReason: null,
  orderDate: new Date(),
  reportCreatedAt: null,
  reportVerifiedAt: null,
  reportedById: null,
  verifiedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdById: USER,
};

const mockReport: RadiologyReport = {
  id: 'rpt-1',
  organizationId: ORG,
  orderId: 'ord-1',
  reportedById: USER,
  technique: 'PA view',
  findings: 'Normal',
  impression: 'No abnormality',
  recommendations: null,
  hasCriticalFindings: false,
  criticalFindings: null,
  criticalNotifiedTo: null,
  criticalNotifiedAt: null,
  comparedWithPrevious: false,
  comparisonNotes: null,
  images: null,
  dicomStudyUid: null,
  templateUsed: null,
  reportedAt: new Date(),
  verifiedById: null,
  verifiedAt: null,
  status: 'draft',
  amendmentReason: null,
  amendedAt: null,
  amendedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('RadiologyService', () => {
  let service: RadiologyService;
  let examRepository: jest.Mocked<RadiologyExamRepository>;
  let orderRepository: jest.Mocked<RadiologyOrderRepository>;
  let reportRepository: jest.Mocked<RadiologyReportRepository>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockExamRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };
    const mockOrderRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };
    const mockReportRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };
    const mockAudit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadiologyService,
        { provide: RadiologyExamRepository, useValue: mockExamRepo },
        { provide: RadiologyOrderRepository, useValue: mockOrderRepo },
        { provide: RadiologyReportRepository, useValue: mockReportRepo },
        { provide: AuditService, useValue: mockAudit },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'S3_ENDPOINT')
                return 'https://hms.s3.skillhiveinnovations.com';
              if (key === 'S3_BUCKET') return 'hmsbucket';
              if (key === 'S3_ACCESS_KEY') return 'minio_admin';
              if (key === 'S3_SECRET_KEY') return 'minio_password';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RadiologyService>(RadiologyService);
    examRepository = module.get(RadiologyExamRepository);
    orderRepository = module.get(RadiologyOrderRepository);
    reportRepository = module.get(RadiologyReportRepository);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getExams', () => {
    it('should return exams for org', async () => {
      examRepository.findMany.mockResolvedValue([mockExam]);

      const result = await service.getExams(ORG);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('exam-1');
    });
  });

  describe('getExamById', () => {
    it('should return exam when found', async () => {
      examRepository.findOne.mockResolvedValue(mockExam);

      const result = await service.getExamById('exam-1', ORG);
      expect(result.id).toBe('exam-1');
    });

    it('should throw NotFoundException when exam not found', async () => {
      examRepository.findOne.mockResolvedValue(null);

      await expect(service.getExamById('exam-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createExam', () => {
    it('should create exam and log audit', async () => {
      examRepository.create.mockResolvedValue(mockExam);

      const result = await service.createExam(
        {
          examName: 'Chest X-ray',
          examCode: 'CXR',
          examCategory: 'X-ray',
          price: 200,
        },
        ORG,
        USER,
      );

      expect(examRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe('exam-1');
    });
  });

  describe('createOrder', () => {
    it('should create radiology order and log audit', async () => {
      orderRepository.create.mockResolvedValue(mockOrder);
      orderRepository.findOne.mockResolvedValue(mockOrder);

      await service.createOrder(
        { patientId: 'pat-1', examId: 'exam-1', urgency: 'routine' },
        ORG,
        USER,
      );

      expect(orderRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('getOrderById', () => {
    it('should return order when found', async () => {
      orderRepository.findOne.mockResolvedValue(mockOrder);

      const result = await service.getOrderById('ord-1', ORG);
      expect(result.id).toBe('ord-1');
    });

    it('should throw NotFoundException when order not found', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.getOrderById('ord-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createReport', () => {
    it('should create report, update order status, and log audit', async () => {
      orderRepository.findOne.mockResolvedValue(mockOrder);
      reportRepository.create.mockResolvedValue(mockReport);
      orderRepository.update.mockResolvedValue(mockOrder);

      const result = await service.createReport(
        { orderId: 'ord-1', findings: 'Normal', impression: 'No abnormality' },
        ORG,
        USER,
      );

      expect(reportRepository.create).toHaveBeenCalled();
      expect(orderRepository.update).toHaveBeenCalledWith(
        'ord-1',
        expect.objectContaining({ status: 'reported' }),
      );
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe('rpt-1');
    });
  });

  describe('getStats', () => {
    it('should return radiology stats', async () => {
      orderRepository.count
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(2) // inProgress
        .mockResolvedValueOnce(8); // completedToday
      reportRepository.count.mockResolvedValue(1); // criticalFindings
      examRepository.count.mockResolvedValue(10); // totalExams

      const result = await service.getStats(ORG);

      expect(result.pending).toBe(5);
      expect(result.inProgress).toBe(2);
      expect(result.completedToday).toBe(8);
      expect(result.criticalFindings).toBe(1);
      expect(result.totalExams).toBe(10);
    });
  });

  describe('compatibilityGet', () => {
    it('should route to exams when resource=exams', async () => {
      examRepository.findMany.mockResolvedValue([mockExam]);

      const result = await service.compatibilityGet({ resource: 'exams' }, ORG);
      expect(result.data).toEqual([mockExam]);
    });

    it('should throw AppException for invalid resource', async () => {
      await expect(
        service.compatibilityGet({ resource: 'invalid' }, ORG),
      ).rejects.toThrow(AppException);
    });
  });

  describe('uploadToS3', () => {
    it('should throw error if no file provided', async () => {
      await expect(
        service.uploadToS3(null as unknown as Express.Multer.File, ORG),
      ).rejects.toThrow(AppException);
    });

    it('should throw error if file is not an image', async () => {
      const mockFile = {
        fieldname: 'file',
        originalname: 'test.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 4,
      } as Express.Multer.File;

      await expect(service.uploadToS3(mockFile, ORG)).rejects.toThrow(
        AppException,
      );
    });

    it('should upload successfully and return URL', async () => {
      const mockFile = {
        fieldname: 'file',
        originalname: 'test.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('test-image'),
        size: 10,
      } as Express.Multer.File;

      const mockSend = jest.fn().mockResolvedValue({});
      const serviceBypass = service as unknown as {
        s3Client: {
          send: (command: unknown) => Promise<unknown>;
        };
      };
      jest.spyOn(serviceBypass.s3Client, 'send').mockImplementation(mockSend);

      const result = await service.uploadToS3(mockFile, ORG);
      expect(result).toContain(
        'https://hms.s3.skillhiveinnovations.com/hmsbucket/org-demo/radiology/',
      );
      expect(result).toContain('.png');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw error if S3 send fails', async () => {
      const mockFile = {
        fieldname: 'file',
        originalname: 'test.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('test-image'),
        size: 10,
      } as Express.Multer.File;

      const mockSend = jest.fn().mockRejectedValue(new Error('S3 error'));
      const serviceBypass = service as unknown as {
        s3Client: {
          send: (command: unknown) => Promise<unknown>;
        };
      };
      jest.spyOn(serviceBypass.s3Client, 'send').mockImplementation(mockSend);

      await expect(service.uploadToS3(mockFile, ORG)).rejects.toThrow(
        AppException,
      );
    });
  });
});
