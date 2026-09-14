/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Patient, PatientPortalClaim, User } from '@prisma/client';
import { PatientAuthService } from './patient-auth.service';
import {
  PatientAuthRepository,
  PortalAccountRaceError,
} from './patient-auth.repository';
import { PatientRepository } from '../patients/patients.repository';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../../audit/audit.service';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const ORG_ID = 'org-1';
const PATIENT_ID = 'pat-1';

const mockPatient = {
  id: PATIENT_ID,
  organizationId: ORG_ID,
  mrn: 'MRN202606100001',
  userId: null,
  firstName: 'Abebe',
  middleName: null,
  lastName: 'Assefa',
  dateOfBirth: new Date('1990-05-15'),
  gender: 'male',
  bloodGroup: 'A+',
  phonePrimary: '+251911123456',
  email: 'abebe@example.com',
  isDeleted: false,
} as unknown as Patient;

const mockClaim = {
  id: 'claim-1',
  organizationId: ORG_ID,
  patientId: PATIENT_ID,
  tokenHash: 'hash',
  mrnAttempted: mockPatient.mrn,
  attempts: 0,
  status: 'issued',
  expiresAt: new Date(Date.now() + 600_000),
  consumedAt: null,
  userId: null,
} as unknown as PatientPortalClaim;

const mockUser = { id: 'user-1', email: 'abebe@example.com' } as User;

const mockTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 900,
  tokenType: 'Bearer',
};

/** The error code an AppException came back with, whatever kind it was. */
function errorCodeOf(fn: () => Promise<unknown>): Promise<string> {
  return fn().then(
    () => 'no error thrown',
    (error: unknown) =>
      error instanceof AppException ? error.errorCode : String(error),
  );
}

describe('PatientAuthService', () => {
  let service: PatientAuthService;
  let repository: jest.Mocked<PatientAuthRepository>;
  let patientRepository: jest.Mocked<PatientRepository>;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      findDefaultOrganizationId: jest.fn().mockResolvedValue(ORG_ID),
      findClaimByTokenHash: jest.fn(),
      recordFailedAttempt: jest.fn(),
      findPatientWithPortalUser: jest.fn(),
      findRoleIdByName: jest.fn().mockResolvedValue('role-patient'),
      findUserIdByEmail: jest.fn().mockResolvedValue(null),
      linkPortalAccount: jest.fn().mockResolvedValue(mockUser),
    };

    const mockPatientRepo = { findByMrn: jest.fn() };
    const mockAuth = {
      issueTokensForUser: jest.fn().mockResolvedValue(mockTokens),
    };
    const mockAudit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientAuthService,
        { provide: PatientAuthRepository, useValue: mockRepo },
        { provide: PatientRepository, useValue: mockPatientRepo },
        { provide: AuthService, useValue: mockAuth },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(PatientAuthService);
    repository = module.get(PatientAuthRepository);
    patientRepository = module.get(PatientRepository);
    authService = module.get(AuthService);
  });

  describe('claim', () => {
    /**
     * The point of the endpoint. If these two responses can be told apart by
     * anything other than the random bytes in the token, the MRN space is
     * enumerable from the outside.
     */
    it('answers a matching and a non-matching MRN indistinguishably', async () => {
      patientRepository.findByMrn.mockResolvedValueOnce(mockPatient);
      const hit = await service.claim({
        mrn: mockPatient.mrn,
        dateOfBirth: '1990-05-15',
      });

      patientRepository.findByMrn.mockResolvedValueOnce(null);
      const miss = await service.claim({
        mrn: 'MRN000000000000',
        dateOfBirth: '1990-05-15',
      });

      expect(Object.keys(hit).sort()).toEqual(Object.keys(miss).sort());
      expect(hit.claimToken).toHaveLength(miss.claimToken.length);
      expect(hit.expiresInSeconds).toBe(miss.expiresInSeconds);
      expect(hit.claimToken).not.toBe(miss.claimToken);
    });

    it('records an attempt for an MRN that matched nothing', async () => {
      patientRepository.findByMrn.mockResolvedValue(null);

      await service.claim({
        mrn: 'MRN000000000000',
        dateOfBirth: '1990-05-15',
      });

      const written = repository.create.mock.calls[0][0];
      expect(written.mrnAttempted).toBe('MRN000000000000');
      expect(written.patient).toBeUndefined();
    });

    it('stores only the hash of the token it hands out', async () => {
      patientRepository.findByMrn.mockResolvedValue(mockPatient);

      const result = await service.claim({
        mrn: mockPatient.mrn,
        dateOfBirth: '1990-05-15',
      });

      const written = repository.create.mock.calls[0][0];
      expect(written.tokenHash).toBe(
        createHash('sha256').update(result.claimToken).digest('hex'),
      );
      expect(written.tokenHash).not.toBe(result.claimToken);
    });

    it('treats the right MRN with the wrong date of birth as no match', async () => {
      patientRepository.findByMrn.mockResolvedValue(mockPatient);

      await service.claim({ mrn: mockPatient.mrn, dateOfBirth: '1991-01-01' });

      const written = repository.create.mock.calls[0][0];
      expect(written.patient).toBeUndefined();
    });

    it('matches a date of birth stored with a time component', async () => {
      patientRepository.findByMrn.mockResolvedValue({
        ...mockPatient,
        dateOfBirth: new Date('1990-05-15T09:30:00.000Z'),
      });

      await service.claim({ mrn: mockPatient.mrn, dateOfBirth: '1990-05-15' });

      const written = repository.create.mock.calls[0][0];
      expect(written.patient).toEqual({ connect: { id: PATIENT_ID } });
    });
  });

  describe('activate', () => {
    const dto = { claimToken: 'a'.repeat(43), password: 'Portal@12345' };

    it('creates the account, links the record and signs the patient in', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: mockPatient,
      });

      const result = await service.activate(dto);

      expect(repository.linkPortalAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          claimId: mockClaim.id,
          patientId: PATIENT_ID,
          organizationId: ORG_ID,
          email: mockPatient.email,
          roleId: 'role-patient',
        }),
      );
      expect(authService.issueTokensForUser).toHaveBeenCalledWith(
        mockUser.id,
        undefined,
        undefined,
      );
      expect(result).toEqual(mockTokens);
    });

    it('never stores the password in the clear', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: mockPatient,
      });

      await service.activate(dto);

      const written = repository.linkPortalAccount.mock.calls[0][0];
      expect(written.passwordHash).not.toBe(dto.password);
      expect(written.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    /**
     * A claim that matched no MRN has to fail exactly as a made-up token does.
     * Any other answer moves the oracle `claim` closed to one call later.
     */
    it('refuses a claim that matched nothing exactly as it refuses an unknown token', async () => {
      repository.findClaimByTokenHash.mockResolvedValueOnce(null);
      const unknown = await errorCodeOf(() => service.activate(dto));

      repository.findClaimByTokenHash.mockResolvedValueOnce({
        ...mockClaim,
        patientId: null,
        patient: null,
      });
      const dud = await errorCodeOf(() => service.activate(dto));

      expect(dud).toBe(unknown);
      expect(dud).toBe(ErrorCodes.PATIENT_PORTAL_CLAIM_INVALID);
    });

    it('counts a failed attempt against a claim that matched nothing', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patientId: null,
        patient: null,
      });

      await errorCodeOf(() => service.activate(dto));

      expect(repository.recordFailedAttempt).toHaveBeenCalledWith(
        mockClaim.id,
        5,
      );
    });

    it('refuses a claim that has already been spent', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        status: 'consumed',
        consumedAt: new Date(),
        patient: mockPatient,
      });

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_CLAIM_CONSUMED,
      );
      expect(repository.linkPortalAccount).not.toHaveBeenCalled();
    });

    it('refuses an expired claim', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        expiresAt: new Date(Date.now() - 1),
        patient: mockPatient,
      });

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_CLAIM_EXPIRED,
      );
    });

    it('refuses a claim presented too many times', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        attempts: 5,
        patient: mockPatient,
      });

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_CLAIM_LOCKED,
      );
    });

    it('refuses a record that already has a portal account', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: { ...mockPatient, userId: 'user-existing' },
      });

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_ALREADY_CLAIMED,
      );
    });

    it('refuses when neither the request nor the record carries an email', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: { ...mockPatient, email: null },
      });

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_EMAIL_REQUIRED,
      );
    });

    it('prefers the email the patient supplied over the one on the record', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: mockPatient,
      });

      await service.activate({ ...dto, email: 'new@example.com' });

      expect(repository.linkPortalAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
    });

    it('refuses an email that already belongs to someone', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: mockPatient,
      });
      repository.findUserIdByEmail.mockResolvedValue('someone-else');

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.USER_EMAIL_TAKEN,
      );
    });

    /** Two activations racing on one claim: the loser is told it was spent. */
    it('turns a lost transaction race into the already-spent answer', async () => {
      repository.findClaimByTokenHash.mockResolvedValue({
        ...mockClaim,
        patient: mockPatient,
      });
      repository.linkPortalAccount.mockRejectedValue(
        new PortalAccountRaceError('claim already consumed'),
      );

      await expect(errorCodeOf(() => service.activate(dto))).resolves.toBe(
        ErrorCodes.PATIENT_PORTAL_CLAIM_CONSUMED,
      );
    });
  });

  describe('getPortalState', () => {
    const patientCaller: AuthenticatedUser = {
      id: 'user-1',
      email: 'abebe@example.com',
      roles: ['PATIENT'],
      permissions: [],
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
    };

    it('reports the record and its portal account', async () => {
      repository.findPatientWithPortalUser.mockResolvedValue({
        ...mockPatient,
        userId: 'user-1',
        portalUser: { id: 'user-1', email: 'abebe@example.com' },
        portalClaims: [{ consumedAt: new Date('2026-09-01') }],
      });

      const result = await service.getPortalState(patientCaller, PATIENT_ID);

      expect(result.patient.mrn).toBe(mockPatient.mrn);
      expect(result.portal).toEqual({
        isLinked: true,
        userId: 'user-1',
        email: 'abebe@example.com',
        activatedAt: new Date('2026-09-01'),
      });
    });

    it('reads the scoped id, not the organisation-wide record', async () => {
      repository.findPatientWithPortalUser.mockResolvedValue({
        ...mockPatient,
        portalUser: null,
        portalClaims: [],
      });

      await service.getPortalState(patientCaller, PATIENT_ID);

      expect(repository.findPatientWithPortalUser).toHaveBeenCalledWith(
        PATIENT_ID,
        ORG_ID,
      );
    });

    it('refuses a staff caller who cannot read patients', async () => {
      const receptionist: AuthenticatedUser = {
        ...patientCaller,
        roles: ['RECEPTIONIST'],
        permissions: ['QUEUE_READ'],
        patientId: undefined,
      };

      await expect(
        errorCodeOf(() => service.getPortalState(receptionist, PATIENT_ID)),
      ).resolves.toBe(ErrorCodes.FORBIDDEN);
      expect(repository.findPatientWithPortalUser).not.toHaveBeenCalled();
    });

    it('lets a staff caller with PATIENT_READ look a record up', async () => {
      repository.findPatientWithPortalUser.mockResolvedValue({
        ...mockPatient,
        portalUser: null,
        portalClaims: [],
      });

      const receptionist: AuthenticatedUser = {
        ...patientCaller,
        roles: ['RECEPTIONIST'],
        permissions: ['PATIENT_READ'],
        patientId: undefined,
      };

      const result = await service.getPortalState(receptionist, PATIENT_ID);

      expect(result.portal.isLinked).toBe(false);
    });

    it('refuses a staff caller who named nobody', async () => {
      const receptionist: AuthenticatedUser = {
        ...patientCaller,
        roles: ['RECEPTIONIST'],
        permissions: ['PATIENT_READ'],
        patientId: undefined,
      };

      await expect(
        errorCodeOf(() => service.getPortalState(receptionist, undefined)),
      ).resolves.toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });
});
