/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConsultationsService } from './consultations.service';
import { ConsultationRepository } from './consultations.repository';
import { PatientsService } from '../patients/patients.service';
import { UserService } from '../users/user.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { Consultation, User } from '@prisma/client';
import { MappedPatient } from '../patients/patients.service';
import { ConsultationQueryDto } from './dto/consultation-query.dto';
import {
  NotFoundException,
  ForbiddenException,
} from '../../common/exceptions/app.exception';

const ORG = 'org-demo';
const USER = 'user-1';

const mockConsultation: Consultation = {
  id: 'cons-1',
  organizationId: ORG,
  patientId: 'pat-1',
  doctorId: 'doc-1',
  appointmentId: null,
  visitDate: new Date('2026-06-10'),
  visitType: 'outpatient',
  temperature: null,
  bloodPressureSystolic: null,
  bloodPressureDiastolic: null,
  pulseRate: null,
  respiratoryRate: null,
  weight: null,
  height: null,
  oxygenSaturation: null,
  chiefComplaint: 'Fever',
  historyOfPresentIllness: null,
  physicalExamination: null,
  diagnosis: 'Mild fever',
  icd10Codes: null,
  treatmentPlan: null,
  followUpInstructions: null,
  followUpDate: null,
  referredTo: null,
  referralReason: null,
  notes: null,
  createdById: USER,
  createdAt: new Date(),
  updatedAt: new Date(),
  isDeleted: false,
  deletedAt: null,
  attachments: null,
};

const mockPatient = { id: 'pat-1', organizationId: ORG, mrn: 'MRN001' };
const mockDoctor = { id: 'doc-1', organizationId: ORG, fullName: 'Dr. Jane' };

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let consultationRepository: jest.Mocked<ConsultationRepository>;
  let patientsService: jest.Mocked<PatientsService>;
  let userService: jest.Mocked<UserService>;
  let cacheService: jest.Mocked<AppCacheService>;
  let auditService: jest.Mocked<AuditService>;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
    };

    const mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            consultation: {
              create: jest.fn().mockResolvedValue(mockConsultation),
            },
            prescription: { create: jest.fn() },
            appointment: { update: jest.fn() },
          }),
        ),
    };

    const mockAudit = { log: jest.fn() };
    const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const mockPatientsSvc = { findById: jest.fn() };
    const mockUserSvc = { findById: jest.fn() };
    const mockApptSvc = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsultationsService,
        { provide: ConsultationRepository, useValue: mockRepo },
        { provide: PatientsService, useValue: mockPatientsSvc },
        { provide: UserService, useValue: mockUserSvc },
        { provide: AppointmentsService, useValue: mockApptSvc },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<ConsultationsService>(ConsultationsService);
    consultationRepository = module.get(ConsultationRepository);
    patientsService = module.get(PatientsService);
    userService = module.get(UserService);
    cacheService = module.get(AppCacheService);
    auditService = module.get(AuditService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create consultation successfully', async () => {
      patientsService.findById.mockResolvedValue(
        mockPatient as unknown as MappedPatient,
      );
      userService.findById.mockResolvedValue(
        mockDoctor as unknown as Omit<User, 'password'>,
      );
      // findById called after create to return populated record
      consultationRepository.findOne.mockResolvedValue(mockConsultation);

      const result = await service.create(
        {
          patientId: 'pat-1',
          doctorId: 'doc-1',
          visitType: 'outpatient',
          chiefComplaint: 'Fever',
        },
        ORG,
        USER,
      );

      expect(patientsService.findById).toHaveBeenCalledWith('pat-1', ORG);
      expect(userService.findById).toHaveBeenCalledWith('doc-1');
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockConsultation.id);
    });

    it('should throw ForbiddenException when doctor is in another org', async () => {
      patientsService.findById.mockResolvedValue(
        mockPatient as unknown as MappedPatient,
      );
      userService.findById.mockResolvedValue({
        ...mockDoctor,
        organizationId: 'org-other',
      } as unknown as Omit<User, 'password'>);

      await expect(
        service.create(
          {
            patientId: 'pat-1',
            doctorId: 'doc-1',
            visitType: 'outpatient',
            chiefComplaint: 'Fever',
          },
          ORG,
          USER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findById', () => {
    it('should return cached consultation when available', async () => {
      cacheService.get.mockResolvedValue(mockConsultation);

      const result = await service.findById('cons-1', ORG);

      expect(cacheService.get).toHaveBeenCalled();
      expect(consultationRepository.findOne).not.toHaveBeenCalled();
      expect(result.id).toBe('cons-1');
    });

    it('should fetch from DB and cache when not in cache', async () => {
      cacheService.get.mockResolvedValue(null);
      consultationRepository.findOne.mockResolvedValue(mockConsultation);

      const result = await service.findById('cons-1', ORG);

      expect(consultationRepository.findOne).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalled();
      expect(result.id).toBe('cons-1');
    });

    it('should throw NotFoundException when consultation not found', async () => {
      cacheService.get.mockResolvedValue(null);
      consultationRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('cons-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated consultations', async () => {
      consultationRepository.paginate.mockResolvedValue({
        data: [mockConsultation],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const query = Object.assign(new ConsultationQueryDto(), {
        page: 1,
        limit: 10,
      });
      const result = await service.findAll(query, ORG);

      expect(consultationRepository.paginate).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update consultation and invalidate cache', async () => {
      consultationRepository.findOne.mockResolvedValue(mockConsultation);
      consultationRepository.update.mockResolvedValue({
        ...mockConsultation,
        diagnosis: 'Updated',
      });
      // findById call after update
      cacheService.get.mockResolvedValue({
        ...mockConsultation,
        diagnosis: 'Updated',
      });

      await service.update('cons-1', { diagnosis: 'Updated' }, ORG, USER);

      expect(consultationRepository.update).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException when consultation not found for update', async () => {
      consultationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('cons-99', { diagnosis: 'X' }, ORG, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft-delete consultation and invalidate cache', async () => {
      consultationRepository.findOne.mockResolvedValue(mockConsultation);

      await service.remove('cons-1', ORG, USER);

      expect(consultationRepository.softDelete).toHaveBeenCalledWith(
        'cons-1',
        USER,
      );
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException when consultation not found for delete', async () => {
      consultationRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('cons-99', ORG, USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
