/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { PatientsService } from './patients.service';
import { PatientRepository } from './patients.repository';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { Prisma, Patient } from '@prisma/client';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';

describe('PatientsService', () => {
  let service: PatientsService;
  let repository: jest.Mocked<PatientRepository>;
  let cacheService: jest.Mocked<AppCacheService>;
  let auditService: jest.Mocked<AuditService>;

  const mockPatient: Patient = {
    id: 'pat-1',
    organizationId: 'org-1',
    mrn: 'MRN202606090001',
    externalId: null,
    // Unclaimed: the portal account column added with the patient portal, null
    // for every record nobody has signed in as.
    userId: null,
    firstName: 'Abebe',
    middleName: 'Kebede',
    lastName: 'Assefa',
    dateOfBirth: new Date('1990-05-15'),
    gender: 'male',
    bloodGroup: 'A+',
    phonePrimary: '+251911123456',
    phoneSecondary: null,
    email: 'abebe@example.com',
    region: 'Addis Ababa',
    zone: null,
    woreda: null,
    kebele: null,
    houseNumber: null,
    addressDescription: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    allergies: JSON.stringify(['Penicillin']),
    chronicConditions: null,
    currentMedications: null,
    hasInsurance: false,
    insuranceProvider: null,
    insuranceId: null,
    insuranceExpiryDate: null,
    insuranceCoverageDetails: null,
    photoUrl: null,
    maritalStatus: null,
    occupation: null,
    educationLevel: null,
    isActive: true,
    isVip: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
    updatedById: null,
    isDeleted: false,
    deletedAt: null,
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

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PatientRepository, useValue: mockRepo },
        { provide: AppCacheService, useValue: mockCache },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<PatientsService>(PatientsService);
    repository = module.get(PatientRepository);
    cacheService = module.get(AppCacheService);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto: CreatePatientDto = {
      firstName: 'Abebe',
      middleName: 'Kebede',
      lastName: 'Assefa',
      dateOfBirth: '1990-05-15',
      gender: 'male',
      bloodGroup: 'A+',
      phonePrimary: '+251911123456',
      email: 'abebe@example.com',
      region: 'Addis Ababa',
      allergies: ['Penicillin'],
    };

    it('should register a patient successfully', async () => {
      repository.create.mockResolvedValue(mockPatient);

      const result = await service.create(createDto, 'org-1', 'user-1');

      expect(repository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockPatient.id);
      expect(result.allergies).toEqual(['Penicillin']);
    });

    it('should retry creation if MRN collision occurs', async () => {
      const dbError = new Prisma.PrismaClientKnownRequestError('Collision', {
        code: 'P2002',
        clientVersion: '7.8.0',
        meta: { target: ['mrn'] },
      });

      repository.create
        .mockRejectedValueOnce(dbError) // collision 1
        .mockResolvedValueOnce(mockPatient); // success 2

      const result = await service.create(createDto, 'org-1', 'user-1');

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(result.id).toBe(mockPatient.id);
    });

    it('should throw ConflictException if MRN collision persists 3 times', async () => {
      const dbError = new Prisma.PrismaClientKnownRequestError('Collision', {
        code: 'P2002',
        clientVersion: '7.8.0',
        meta: { target: ['mrn'] },
      });

      repository.create.mockRejectedValue(dbError);

      await expect(
        service.create(createDto, 'org-1', 'user-1'),
      ).rejects.toThrow(ConflictException);

      expect(repository.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('findById', () => {
    it('should return cached patient if present', async () => {
      cacheService.get.mockResolvedValue(mockPatient);

      const result = await service.findById('pat-1', 'org-1');

      expect(cacheService.get).toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(result.id).toBe(mockPatient.id);
    });

    it('should fetch from DB and cache if not cached', async () => {
      cacheService.get.mockResolvedValue(null);
      repository.findOne.mockResolvedValue(mockPatient);

      const result = await service.findById('pat-1', 'org-1');

      expect(cacheService.get).toHaveBeenCalled();
      expect(repository.findOne).toHaveBeenCalledWith({
        id: 'pat-1',
        organizationId: 'org-1',
      });
      expect(cacheService.set).toHaveBeenCalled();
      expect(result.id).toBe(mockPatient.id);
    });

    it('should throw NotFoundException if patient does not exist', async () => {
      cacheService.get.mockResolvedValue(null);
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('pat-99', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated patients', async () => {
      repository.paginate.mockResolvedValue({
        data: [mockPatient],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const query = Object.assign(new PatientQueryDto(), {
        page: 1,
        limit: 10,
      });
      const result = await service.findAll(query, 'org-1');

      expect(repository.paginate).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockPatient.id);
    });
  });

  describe('update', () => {
    const updateDto: UpdatePatientDto = {
      firstName: 'Abebe New',
    };

    it('should update patient and invalidate cache', async () => {
      repository.findOne.mockResolvedValue(mockPatient);
      repository.update.mockResolvedValue({
        ...mockPatient,
        firstName: 'Abebe New',
      });

      const result = await service.update(
        'pat-1',
        updateDto,
        'org-1',
        'user-1',
      );

      expect(repository.findOne).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.firstName).toBe('Abebe New');
    });

    it('should throw NotFoundException if patient to update is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('pat-99', updateDto, 'org-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete patient and invalidate cache', async () => {
      repository.findOne.mockResolvedValue(mockPatient);

      await service.remove('pat-1', 'org-1', 'user-1');

      expect(repository.findOne).toHaveBeenCalled();
      expect(repository.softDelete).toHaveBeenCalledWith('pat-1', 'user-1');
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException if patient to remove is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('pat-99', 'org-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
