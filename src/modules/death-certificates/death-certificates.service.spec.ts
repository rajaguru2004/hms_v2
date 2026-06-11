/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DeathCertificatesService } from './death-certificates.service';
import { DeathCertificateRepository } from './repositories/death-certificate.repository';
import { AuditService } from '../../audit/audit.service';
import { DeathCertificate, Prisma } from '@prisma/client';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { PlaceOfDeath, MannerOfDeath } from './dto/death-certificate.dto';

const ORG = 'org-demo';
const USER = 'user-1';

const mockCertificate = {
  id: 'cert-1',
  organizationId: ORG,
  patientId: 'pat-1',
  certifiedById: USER,
  issuedById: null,
  certificateNumber: 'DC202606110001',
  dateOfDeath: new Date('2026-06-01'),
  timeOfDeath: '14:30',
  placeOfDeath: PlaceOfDeath.INPATIENT,
  locationDetails: null,
  ageAtDeathYears: 65,
  ageAtDeathMonths: null,
  ageAtDeathDays: null,
  sex: 'male',
  maritalStatus: 'married',
  occupation: null,
  address: null,
  immediateCause: 'Cardiac arrest',
  antecedentCauseB: null,
  antecedentCauseC: null,
  antecedentCauseD: null,
  otherConditions: null,
  mannerOfDeath: MannerOfDeath.NATURAL,
  autopsyPerformed: false,
  autopsyFindings: null,
  isMaternalDeath: false,
  pregnancyRelated: null,
  certificationDate: new Date(),
  certifierQualification: null,
  licenseNumber: null,
  signatureUrl: null,
  issuedTo: null,
  issuedToRelationship: null,
  issuedToNationalId: null,
  issuedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isDeleted: false,
  deletedAt: null,
} as unknown as DeathCertificate;

describe('DeathCertificatesService', () => {
  let service: DeathCertificatesService;
  let repository: jest.Mocked<DeathCertificateRepository>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
    };
    const mockAudit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeathCertificatesService,
        { provide: DeathCertificateRepository, useValue: mockRepo },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<DeathCertificatesService>(DeathCertificatesService);
    repository = module.get(DeathCertificateRepository);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create death certificate and log audit', async () => {
      repository.create.mockResolvedValue(mockCertificate);

      const result = await service.create(
        {
          patientId: 'pat-1',
          certifiedById: USER,
          dateOfDeath: '2026-06-01',
          placeOfDeath: PlaceOfDeath.INPATIENT,
          immediateCause: 'Cardiac arrest',
          mannerOfDeath: MannerOfDeath.NATURAL,
          sex: 'male',
        },
        ORG,
        USER,
      );

      expect(repository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.certificateNumber).toMatch(/^DC\d{12}$/);
    });

    it('should retry on P2002 (unique constraint) error', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['certificateNumber'] },
        },
      );
      // fail first 2 times, succeed on 3rd
      repository.create
        .mockRejectedValueOnce(p2002Error)
        .mockRejectedValueOnce(p2002Error)
        .mockResolvedValueOnce(mockCertificate);

      const result = await service.create(
        {
          patientId: 'pat-1',
          certifiedById: USER,
          dateOfDeath: '2026-06-01',
          placeOfDeath: PlaceOfDeath.INPATIENT,
          immediateCause: 'Cardiac arrest',
          mannerOfDeath: MannerOfDeath.NATURAL,
          sex: 'male',
        },
        ORG,
        USER,
      );

      expect(repository.create).toHaveBeenCalledTimes(3);
      expect(result.id).toBe('cert-1');
    });

    it('should throw ConflictException after all retries exhausted', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['certificateNumber'] },
        },
      );
      repository.create.mockRejectedValue(p2002Error);

      await expect(
        service.create(
          {
            patientId: 'pat-1',
            certifiedById: USER,
            dateOfDeath: '2026-06-01',
            placeOfDeath: PlaceOfDeath.INPATIENT,
            immediateCause: 'Cardiac arrest',
            mannerOfDeath: MannerOfDeath.NATURAL,
            sex: 'male',
          },
          ORG,
          USER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated death certificates', async () => {
      repository.paginate.mockResolvedValue({
        data: [mockCertificate],
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.findAll({ limit: 50 }, ORG);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return certificate when found', async () => {
      repository.findOne.mockResolvedValue(mockCertificate);

      const result = await service.findById('cert-1', ORG);
      expect(result.certificateNumber).toBe('DC202606110001');
    });

    it('should throw NotFoundException when certificate not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('cert-99', ORG)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update certificate and log audit', async () => {
      repository.findOne.mockResolvedValue(mockCertificate);
      repository.update.mockResolvedValue({
        ...mockCertificate,
        immediateCause: 'Heart failure',
      });

      await service.update(
        'cert-1',
        { immediateCause: 'Heart failure' },
        ORG,
        USER,
      );

      expect(repository.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('issue', () => {
    it('should record certificate issuance and log audit', async () => {
      repository.findOne.mockResolvedValue(mockCertificate);
      repository.update.mockResolvedValue({
        ...mockCertificate,
        issuedTo: 'Jane Doe',
        issuedAt: new Date(),
      });

      await service.issue(
        'cert-1',
        {
          issuedTo: 'Jane Doe',
          issuedToRelationship: 'spouse',
          issuedById: USER,
        },
        ORG,
        USER,
      );

      expect(repository.update).toHaveBeenCalledWith(
        'cert-1',
        expect.objectContaining({ issuedTo: 'Jane Doe' }),
      );
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft-delete certificate and log audit', async () => {
      repository.findOne.mockResolvedValue(mockCertificate);

      await service.remove('cert-1', ORG, USER);

      expect(repository.softDelete).toHaveBeenCalledWith('cert-1');
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('getPrintView', () => {
    it('should return an HTML string with certificate details', async () => {
      repository.findOne.mockResolvedValue({
        ...mockCertificate,
        patient: {
          firstName: 'John',
          middleName: null,
          lastName: 'Doe',
          mrn: 'MRN001',
        },
        certifiedBy: {
          fullName: 'Dr. A',
          licenseNumber: 'LIC-123',
          specialization: 'Cardiology',
        },
        issuedBy: null,
      } as unknown as Awaited<
        ReturnType<DeathCertificateRepository['findOne']>
      >);

      const html = await service.getPrintView('cert-1', ORG);

      expect(html).toContain('Death Certificate');
      expect(html).toContain('DC202606110001');
      expect(html).toContain('John');
    });
  });
});
