/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { NotFoundException } from '../../common/exceptions/app.exception';
import { CreateQueueDto } from './dto/create-queue.dto';
import {
  QueueRepository,
  QueueWithPatient,
  QueuePaginatedResult,
} from './queue.repository';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;
  let repository: jest.Mocked<QueueRepository>;
  let auditService: jest.Mocked<AuditService>;

  const joinedQueueAt = new Date(Date.now() - 10 * 60000);

  const mockQueueItem = {
    id: 'queue-1',
    organizationId: 'org-1',
    patientId: 'patient-1',
    serviceArea: 'opd',
    serviceType: 'consultation',
    queueNumber: 'OPD202606100001',
    priority: 'normal',
    assignedToId: null,
    assignedRoom: null,
    status: 'waiting',
    joinedQueueAt,
    calledAt: null,
    serviceStartedAt: null,
    serviceCompletedAt: null,
    estimatedWaitMinutes: null,
    displayMessage: null,
    createdAt: joinedQueueAt,
    updatedAt: joinedQueueAt,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    isDeleted: false,
    deletedAt: null,
    patient: {
      id: 'patient-1',
      mrn: 'MRN202606100001',
      firstName: 'Abebe',
      lastName: 'Kebede',
      phonePrimary: '+251911123456',
      gender: 'male',
    },
  } as unknown as QueueWithPatient;

  beforeEach(async () => {
    const mockPrisma = {
      preTriage: { findFirst: jest.fn() },
      radiologyOrder: { findFirst: jest.fn(), create: jest.fn() },
      radiologyExam: { findFirst: jest.fn(), create: jest.fn() },
      user: { findFirst: jest.fn() },
    };

    const mockRepo = {
      findQueue: jest.fn(),
      findQueueById: jest.fn(),
      createQueue: jest.fn(),
      updateQueue: jest.fn(),
      softDelete: jest.fn(),
      prismaClient: mockPrisma,
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QueueRepository, useValue: mockRepo },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(QueueService);
    repository = module.get(QueueRepository);
    auditService = module.get(AuditService);
  });

  it('should create a queue item', async () => {
    const dto: CreateQueueDto = {
      patientId: 'patient-1',
      serviceArea: 'opd',
      priority: 'urgent',
    };
    repository.createQueue.mockResolvedValue(mockQueueItem);

    const result = await service.create(dto, 'org-1', 'user-1');

    expect(repository.createQueue).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalled();
    expect(result.queueNumber).toBe(mockQueueItem.queueNumber);
    expect(result.waitTime).toBeGreaterThanOrEqual(9);
  });

  it('should retry create on queue number collision', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError('Collision', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });
    repository.createQueue
      .mockRejectedValueOnce(dbError)
      .mockResolvedValueOnce(mockQueueItem);

    const result = await service.create(
      { patientId: 'patient-1', serviceArea: 'opd' },
      'org-1',
      'user-1',
    );

    expect(repository.createQueue).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(mockQueueItem.id);
  });

  it('should list queue entries with filters and wait time', async () => {
    const paginatedResult: QueuePaginatedResult = {
      data: [mockQueueItem],
      meta: {
        total: 1,
        lastPage: 1,
        currentPage: 1,
        perPage: 50,
        prev: null,
        next: null,
      },
    };
    repository.findQueue.mockResolvedValue(paginatedResult);

    const result = await service.findAll(
      { serviceArea: 'opd', status: 'waiting' },
      'org-1',
    );

    expect(repository.findQueue).toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.waitTime).toBeGreaterThanOrEqual(9);
  });

  it('should set calledAt when status becomes called', async () => {
    repository.findQueueById.mockResolvedValue(mockQueueItem);
    repository.updateQueue.mockImplementation(async (_id, data) => ({
      ...mockQueueItem,
      status: 'called',
      calledAt: data.calledAt as Date,
    }));

    const result = await service.update(
      'queue-1',
      { status: 'called' },
      'org-1',
      'user-1',
    );

    expect(repository.updateQueue).toHaveBeenCalled();
    expect(result.status).toBe('called');
    expect(result.calledAt).toBeInstanceOf(Date);
  });

  it('should set serviceStartedAt when status becomes in_service', async () => {
    repository.findQueueById.mockResolvedValue(mockQueueItem);
    repository.updateQueue.mockImplementation(async (_id, data) => ({
      ...mockQueueItem,
      status: 'in_service',
      serviceStartedAt: data.serviceStartedAt as Date,
    }));

    const result = await service.update(
      'queue-1',
      { status: 'in_service' },
      'org-1',
      'user-1',
    );

    expect(result.serviceStartedAt).toBeInstanceOf(Date);
  });

  it('should set serviceCompletedAt when status becomes completed', async () => {
    repository.findQueueById.mockResolvedValue(mockQueueItem);
    repository.updateQueue.mockImplementation(async (_id, data) => ({
      ...mockQueueItem,
      status: 'completed',
      serviceCompletedAt: data.serviceCompletedAt as Date,
    }));

    const result = await service.update(
      'queue-1',
      { status: 'completed' },
      'org-1',
      'user-1',
    );

    expect(result.serviceCompletedAt).toBeInstanceOf(Date);
  });

  it('should throw not found for missing or cross-org queue item', async () => {
    repository.findQueueById.mockResolvedValue(null);

    await expect(
      service.update('queue-404', { status: 'called' }, 'org-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should soft delete a queue item and audit it', async () => {
    repository.findQueueById.mockResolvedValue(mockQueueItem);
    repository.softDelete.mockResolvedValue(mockQueueItem);

    await service.remove('queue-1', 'org-1', 'user-1');

    expect(repository.softDelete).toHaveBeenCalledWith('queue-1', 'user-1');
    expect(auditService.log).toHaveBeenCalled();
  });

  it('should auto-create a pending radiology order if updated to called and patient routed from pre-triage', async () => {
    const mockRadQueueItem = {
      ...mockQueueItem,
      id: 'queue-rad',
      serviceArea: 'radiology',
      status: 'waiting',
    } as unknown as QueueWithPatient;

    repository.findQueueById.mockResolvedValue(mockRadQueueItem);
    repository.updateQueue.mockResolvedValue({
      ...mockRadQueueItem,
      status: 'called',
      calledAt: new Date(),
    });

    const mockPrisma = repository.prismaClient as any;
    mockPrisma.preTriage.findFirst.mockResolvedValue({
      id: 'pt-1',
      chiefComplaint: 'cough',
      briefHistory: 'fever',
      temperature: 38.5,
    });
    mockPrisma.radiologyOrder.findFirst.mockResolvedValue(null);
    mockPrisma.radiologyExam.findFirst.mockResolvedValue({
      id: 'exam-1',
      examName: 'Chest X-Ray',
    });

    const result = await service.update(
      'queue-rad',
      { status: 'called' },
      'org-1',
      'user-1',
    );

    expect(result.status).toBe('called');
    // Allow macro-task queue / promise ticks to complete for async call
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockPrisma.preTriage.findFirst).toHaveBeenCalledWith({
      where: {
        patientId: 'patient-1',
        routedTo: 'radiology',
        isDeleted: false,
      },
      orderBy: { screenedAt: 'desc' },
    });
    expect(mockPrisma.radiologyOrder.create).toHaveBeenCalled();
  });
});
