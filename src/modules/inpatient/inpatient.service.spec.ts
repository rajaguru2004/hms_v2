/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InpatientService } from './inpatient.service';
import { WardRepository } from './ward.repository';
import { BedRepository } from './bed.repository';
import { AdmissionRepository } from './admission.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { Ward, Bed, Admission } from '@prisma/client';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';

const ORG = 'org-demo';
const USER = 'user-1';

const mockWard: Ward = {
  id: 'ward-1',
  organizationId: ORG,
  name: 'General Ward',
  code: 'GW',
  type: 'general',
  capacity: 20,
  departmentId: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockBed: Bed = {
  id: 'bed-1',
  organizationId: ORG,
  wardId: 'ward-1',
  bedNumber: 'GW-01',
  type: 'standard',
  status: 'available',
  currentPatientId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAdmission: Admission = {
  id: 'adm-1',
  organizationId: ORG,
  patientId: 'pat-1',
  bedId: 'bed-1',
  admissionType: 'regular',
  admissionReason: 'Fever',
  admittingDoctorId: 'doc-1',
  attendingDoctorId: null,
  status: 'admitted',
  dischargeReason: null,
  dischargeSummary: null,
  dischargeDoctorId: null,
  followUpNotes: null,
  admissionDate: new Date(),
  dischargeDate: null,
  followUpDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('InpatientService', () => {
  let service: InpatientService;
  let wardRepository: jest.Mocked<WardRepository>;
  let bedRepository: jest.Mocked<BedRepository>;
  let admissionRepository: jest.Mocked<AdmissionRepository>;
  let prismaService: {
    $transaction: jest.Mock;
    bed: { count: jest.Mock };
    patient: { findFirst: jest.Mock };
  };
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockWardRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockBedRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockAdmissionRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };

    const mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            admission: {
              create: jest.fn().mockResolvedValue(mockAdmission),
              update: jest.fn().mockResolvedValue(mockAdmission),
            },
            bed: { update: jest.fn(), findFirst: jest.fn() },
          }),
        ),
      bed: { count: jest.fn() },
      patient: { findFirst: jest.fn() },
    };

    const mockAudit = { log: jest.fn() };
    const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InpatientService,
        { provide: WardRepository, useValue: mockWardRepo },
        { provide: BedRepository, useValue: mockBedRepo },
        { provide: AdmissionRepository, useValue: mockAdmissionRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<InpatientService>(InpatientService);
    wardRepository = module.get(WardRepository);
    bedRepository = module.get(BedRepository);
    admissionRepository = module.get(AdmissionRepository);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getWards', () => {
    it('should return wards with occupancy data', async () => {
      wardRepository.findMany.mockResolvedValue([mockWard]);
      prismaService.bed.count.mockResolvedValue(5);

      const result = (await service.getWards(ORG)) as {
        occupiedBeds: number;
        availableBeds: number;
      }[];

      expect(wardRepository.findMany).toHaveBeenCalled();
      expect(result[0].occupiedBeds).toBe(5);
      expect(result[0].availableBeds).toBe(15); // 20 - 5
    });
  });

  describe('getWardById', () => {
    it('should return ward when found', async () => {
      wardRepository.findOne.mockResolvedValue(mockWard);

      const result = await service.getWardById('ward-1', ORG);
      expect(result.id).toBe('ward-1');
    });

    it('should throw NotFoundException when ward not found', async () => {
      wardRepository.findOne.mockResolvedValue(null);

      await expect(service.getWardById('ward-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createWard', () => {
    it('should create ward and log audit', async () => {
      wardRepository.create.mockResolvedValue(mockWard);

      const result = await service.createWard(
        { name: 'General Ward', code: 'GW', type: 'general', capacity: 20 },
        ORG,
        USER,
      );

      expect(wardRepository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe('ward-1');
    });
  });

  describe('getBeds', () => {
    it('should return beds for organization', async () => {
      bedRepository.findMany.mockResolvedValue([mockBed]);

      const result = await service.getBeds(ORG);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bed-1');
    });

    it('should filter beds by wardId when provided', async () => {
      bedRepository.findMany.mockResolvedValue([mockBed]);

      await service.getBeds(ORG, 'ward-1', 'available');

      expect(bedRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ wardId: 'ward-1', status: 'available' }),
        expect.anything(),
      );
    });
  });

  describe('getBedById', () => {
    it('should return bed when found', async () => {
      bedRepository.findOne.mockResolvedValue(mockBed);

      const result = await service.getBedById('bed-1', ORG);
      expect(result.id).toBe('bed-1');
    });

    it('should throw NotFoundException when bed not found', async () => {
      bedRepository.findOne.mockResolvedValue(null);

      await expect(service.getBedById('bed-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAdmission', () => {
    it('should create admission when patient and bed are valid', async () => {
      prismaService.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
      bedRepository.findOne.mockResolvedValue(mockBed);

      await service.createAdmission(
        {
          patientId: 'pat-1',
          bedId: 'bed-1',
          admissionType: 'regular',
          admissionReason: 'Fever',
        },
        ORG,
        USER,
      );

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException when patient not found', async () => {
      prismaService.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdmission(
          {
            patientId: 'pat-99',
            admissionType: 'regular',
            admissionReason: 'Fever',
          },
          ORG,
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when bed is not available', async () => {
      prismaService.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
      bedRepository.findOne.mockResolvedValue({
        ...mockBed,
        status: 'occupied',
      });

      await expect(
        service.createAdmission(
          {
            patientId: 'pat-1',
            bedId: 'bed-1',
            admissionType: 'regular',
            admissionReason: 'Fever',
          },
          ORG,
          USER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getStats', () => {
    it('should calculate inpatient occupancy stats', async () => {
      bedRepository.count
        .mockResolvedValueOnce(40) // totalBeds
        .mockResolvedValueOnce(20) // occupiedBeds
        .mockResolvedValueOnce(20); // availableBeds
      admissionRepository.count
        .mockResolvedValueOnce(3) // todayAdmissions
        .mockResolvedValueOnce(1); // todayDischarges

      const result = await service.getStats(ORG);

      expect(result.totalBeds).toBe(40);
      expect(result.occupiedBeds).toBe(20);
      expect(result.occupancyRate).toBe(50);
    });
  });
});
