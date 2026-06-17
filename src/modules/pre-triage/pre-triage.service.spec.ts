/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { PreTriageService } from './pre-triage.service';
import { PreTriageRepository } from './pre-triage.repository';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { Prisma, PreTriage } from '@prisma/client';
import { CreatePreTriageDto } from './dto/create-pre-triage.dto';
import { UpdatePreTriageDto } from './dto/update-pre-triage.dto';
import { PreTriageQueryDto } from './dto/pre-triage-query.dto';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';

describe('PreTriageService', () => {
  let service: PreTriageService;
  let repository: jest.Mocked<PreTriageRepository>;
  let patientsService: jest.Mocked<PatientsService>;
  let auditService: jest.Mocked<AuditService>;
  let queueService: jest.Mocked<QueueService>;

  const mockPreTriage: PreTriage = {
    id: 'scr-1',
    organizationId: 'org-1',
    screeningNumber: 'SCR20260610001',
    firstName: 'John',
    lastName: 'Doe',
    age: 30,
    gender: 'male',
    phone: '+251911123456',
    chiefComplaint: 'Fever',
    briefHistory: 'Started 2 days ago',
    temperature: 38.5,
    bloodPressureSystolic: 120,
    bloodPressureDiastolic: 80,
    pulseRate: 72,
    routedTo: null,
    status: 'screening',
    patientId: null,
    screenedAt: new Date(),
    screenedById: 'user-1',
    routedAt: null,
    routedById: null,
    updatedAt: new Date(),
    updatedBy: null,
    isDeleted: false,
    deletedAt: null,
  };

  const mockPatient = {
    id: 'pat-1',
    mrn: 'MRN202606100001',
    firstName: 'John',
    lastName: 'Doe',
  };

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
    };

    const mockPatientsService = {
      create: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const mockQueueService = {
      create: jest.fn(),
      update: jest.fn(),
      findActiveQueueEntry: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreTriageService,
        { provide: PreTriageRepository, useValue: mockRepo },
        { provide: PatientsService, useValue: mockPatientsService },
        { provide: AuditService, useValue: mockAudit },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<PreTriageService>(PreTriageService);
    repository = module.get(PreTriageRepository);
    patientsService = module.get(PatientsService);
    auditService = module.get(AuditService);
    queueService = module.get(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto: CreatePreTriageDto = {
      firstName: 'John',
      lastName: 'Doe',
      age: 30,
      gender: 'male',
      phone: '+251911123456',
      chiefComplaint: 'Fever',
    };

    it('should create a pre-triage record successfully', async () => {
      repository.create.mockResolvedValue(mockPreTriage);

      const result = await service.create(createDto, 'org-1', 'user-1');

      expect(repository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockPreTriage.id);
    });

    it('should retry creation on screening number collision', async () => {
      const dbError = new Prisma.PrismaClientKnownRequestError('Collision', {
        code: 'P2002',
        clientVersion: '7.8.0',
        meta: { target: ['screeningNumber'] },
      });

      repository.create
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce(mockPreTriage);

      const result = await service.create(createDto, 'org-1', 'user-1');

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(result.id).toBe(mockPreTriage.id);
    });

    it('should auto-register patient and add to queue when routedTo is provided', async () => {
      const routedMockPreTriage = {
        ...mockPreTriage,
        routedTo: 'opd',
        status: 'routed',
      };
      repository.create.mockResolvedValue(routedMockPreTriage);
      patientsService.create.mockResolvedValue(mockPatient as any);
      repository.update.mockResolvedValue({
        ...routedMockPreTriage,
        patientId: 'pat-1',
      });
      queueService.findActiveQueueEntry.mockResolvedValue(null);
      queueService.create.mockResolvedValue({ id: 'q-1' } as any);

      const result = await service.create(
        { ...createDto, routedTo: 'opd' },
        'org-1',
        'user-1',
      );

      expect(repository.create).toHaveBeenCalled();
      expect(patientsService.create).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(routedMockPreTriage.id, {
        patient: { connect: { id: 'pat-1' } },
      });
      expect(queueService.create).toHaveBeenCalledWith(
        { patientId: 'pat-1', serviceArea: 'opd', priority: 'normal' },
        'org-1',
        'user-1',
      );
      expect(result.patientId).toBe('pat-1');
    });
  });

  describe('findAll', () => {
    it('should return paginated pre-triage screenings', async () => {
      repository.paginate.mockResolvedValue({
        data: [mockPreTriage],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const query = new PreTriageQueryDto();
      const result = await service.findAll(query, 'org-1');

      expect(repository.paginate).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockPreTriage.id);
    });
  });

  describe('findById', () => {
    it('should return pre-triage screening details', async () => {
      repository.findOne.mockResolvedValue(mockPreTriage);

      const result = await service.findById('scr-1', 'org-1');

      expect(repository.findOne).toHaveBeenCalled();
      expect(result.id).toBe(mockPreTriage.id);
    });

    it('should throw NotFoundException if screening not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('scr-99', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const updateDto: UpdatePreTriageDto = {
      chiefComplaint: 'Severe Fever',
    };

    it('should update a pre-triage record', async () => {
      repository.findOne.mockResolvedValue(mockPreTriage);
      repository.update.mockResolvedValue({
        ...mockPreTriage,
        chiefComplaint: 'Severe Fever',
      });

      const result = await service.update(
        'scr-1',
        updateDto,
        'org-1',
        'user-1',
      );

      expect(repository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.chiefComplaint).toBe('Severe Fever');
    });

    it('should auto-register patient and add to queue when routedTo is updated', async () => {
      repository.findOne.mockResolvedValue(mockPreTriage);
      const routedMockPreTriage = {
        ...mockPreTriage,
        routedTo: 'mch',
        status: 'routed',
      };
      repository.update.mockResolvedValue(routedMockPreTriage);
      patientsService.create.mockResolvedValue(mockPatient as any);

      // Secondary update mock inside autoRegisterPatient helper
      repository.update
        .mockResolvedValueOnce(routedMockPreTriage) // first update in the method
        .mockResolvedValueOnce({ ...routedMockPreTriage, patientId: 'pat-1' }); // update inside helper

      queueService.findActiveQueueEntry.mockResolvedValue(null);
      queueService.create.mockResolvedValue({ id: 'q-1' } as any);

      const result = await service.update(
        'scr-1',
        { routedTo: 'mch' },
        'org-1',
        'user-1',
      );

      expect(patientsService.create).toHaveBeenCalled();
      expect(queueService.create).toHaveBeenCalledWith(
        { patientId: 'pat-1', serviceArea: 'mch', priority: 'normal' },
        'org-1',
        'user-1',
      );
    });
  });

  describe('remove', () => {
    it('should soft delete the pre-triage record', async () => {
      repository.findOne.mockResolvedValue(mockPreTriage);

      await service.remove('scr-1', 'org-1', 'user-1');

      expect(repository.softDelete).toHaveBeenCalledWith('scr-1', 'user-1');
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('convertToPatient', () => {
    it('should convert screening to patient successfully', async () => {
      repository.findOne.mockResolvedValue(mockPreTriage);
      patientsService.create.mockResolvedValue(mockPatient as any);
      repository.update.mockResolvedValue({
        ...mockPreTriage,
        status: 'registered_as_patient',
        patientId: 'pat-1',
      });

      const result = await service.convertToPatient('scr-1', 'org-1', 'user-1');

      expect(patientsService.create).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(result.patientId).toBe('pat-1');
    });

    it('should throw ConflictException if already converted', async () => {
      repository.findOne.mockResolvedValue({
        ...mockPreTriage,
        patientId: 'pat-already-exists',
      });

      await expect(
        service.convertToPatient('scr-1', 'org-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
