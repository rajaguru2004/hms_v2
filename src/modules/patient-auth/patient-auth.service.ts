import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  PatientAuthRepository,
  PortalAccountRaceError,
} from './patient-auth.repository';
import { PatientRepository } from '../patients/patients.repository';
import { AuthService } from '../auth/auth.service';
import { hashRefreshToken } from '../auth/refresh-token.util';
import { AuditService } from '../../audit/audit.service';
import { hashPassword } from '../../common/utils/hash.util';
import { ClaimPatientRecordDto } from './dto/claim-patient-record.dto';
import { ActivatePatientAccountDto } from './dto/activate-patient-account.dto';
import {
  PatientClaimResponseDto,
  PatientPortalStateResponseDto,
} from './dto/patient-portal-response.dto';
import { TokenResponseDto } from '../auth/dto/auth.dto';
import { AuditAction } from '../../common/enums/action.enum';
import { Permission } from '../../common/enums/permission.enum';
import { SystemRole } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

/**
 * Long enough that the patient is still in the waiting room, short enough that
 * a token left in a browser history is worthless by the time anyone finds it.
 */
const CLAIM_TTL_MS = 10 * 60_000;

/** 256 bits. Guessing a claim token is not meant to be on anyone's list. */
const CLAIM_TOKEN_BYTES = 32;

/**
 * How many times one claim token may be presented and refused before it stops
 * working. Low, because there is nothing to get wrong: the client holds the
 * token, it does not retype it.
 */
const CLAIM_ATTEMPT_LIMIT = 5;

/**
 * Identity for the patient portal — proving a record is yours, and then signing
 * in as it.
 *
 * Two steps on purpose. `claim` proves possession of the card (MRN plus date of
 * birth) and hands back a short-lived token; `activate` spends that token to
 * create the account. Afterwards patients use `POST /auth/login` like everyone
 * else. There is deliberately no second login path: a parallel one is a second
 * place for lockout, rotation and revocation to be got wrong, and the first
 * time the two disagree is a patient who cannot sign in and a log that says the
 * password was correct.
 */
@Injectable()
export class PatientAuthService {
  constructor(
    private readonly patientAuthRepository: PatientAuthRepository,
    private readonly patientRepository: PatientRepository,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Issue a claim token for an MRN and date of birth.
   *
   * The answer is the same whether or not that MRN exists, and that is the
   * whole design of this method rather than a detail of it. MRNs are short and
   * sequential — the number on one card tells you roughly what the next card
   * says — so any difference between "matched" and "did not match" lets someone
   * with one card enumerate the hospital's patient list. A different status, a
   * different error code, a missing field, an absent token: each of those is
   * the same leak wearing different clothes.
   *
   * So a miss gets a real token too. It is stored, it is the same length, it
   * expires at the same time, and it is useless: the claim it belongs to points
   * at no patient, so `activate` refuses it with the same answer a made-up
   * token gets. The residual oracle is that second call, which costs a round
   * trip, is rate limited, and leaves a row behind naming the MRN that was
   * tried — which is the point of writing a row for every attempt rather than
   * only the ones that worked.
   *
   * Both paths do the same work for the same reason: the organisation lookup,
   * one indexed lookup on the MRN and one insert happen whatever the answer is,
   * so the reply takes as long when nothing matched. That is also why the
   * organisation is resolved unconditionally rather than read off a match —
   * deriving it from the patient would make a hit one query cheaper than a
   * miss, which is the same leak measured with a stopwatch.
   */
  async claim(dto: ClaimPatientRecordDto): Promise<PatientClaimResponseDto> {
    const organizationId =
      await this.patientAuthRepository.findDefaultOrganizationId();

    if (!organizationId) {
      throw new NotFoundException(
        'No organisation is configured on this system.',
        ErrorCodes.ORGANIZATION_NOT_FOUND,
      );
    }

    const mrn = dto.mrn.trim();
    const candidate = await this.patientRepository.findByMrn(
      mrn,
      organizationId,
    );

    const matched =
      candidate && sameCalendarDay(candidate.dateOfBirth, dto.dateOfBirth)
        ? candidate
        : null;

    const claimToken = randomBytes(CLAIM_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);

    // No AuditService call here, and no logging of the MRN anywhere in this
    // method. The row below *is* the audit record — it holds the attempt, what
    // was typed and whether it landed — and duplicating it into AuditLog would
    // put a patient identifier in a second place for no extra answer.
    await this.patientAuthRepository.create({
      organization: { connect: { id: organizationId } },
      ...(matched && { patient: { connect: { id: matched.id } } }),
      tokenHash: hashRefreshToken(claimToken),
      mrnAttempted: mrn,
      expiresAt,
    });

    return {
      claimToken,
      expiresAt,
      expiresInSeconds: CLAIM_TTL_MS / 1000,
    };
  }

  /**
   * Spend a claim token: create the portal account, link it to the record and
   * sign the patient in.
   *
   * The organisation is taken from the claim rather than from the request,
   * because this route is unauthenticated and there is no other authenticated
   * source for it. Hashing the presented token and looking the row up by that
   * hash is also what scopes it — a token minted for one hospital cannot select
   * a row belonging to another.
   */
  async activate(
    dto: ActivatePatientAccountDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    const claim = await this.patientAuthRepository.findClaimByTokenHash(
      hashRefreshToken(dto.claimToken),
    );

    if (!claim) {
      throw new UnauthorizedException(
        'That link is no longer valid. Please start again.',
        ErrorCodes.PATIENT_PORTAL_CLAIM_INVALID,
      );
    }

    if (claim.status === 'consumed' || claim.consumedAt) {
      throw new ConflictException(
        'This link has already been used to create an account. Sign in instead.',
        ErrorCodes.PATIENT_PORTAL_CLAIM_CONSUMED,
      );
    }

    if (claim.status === 'locked' || claim.attempts >= CLAIM_ATTEMPT_LIMIT) {
      throw new UnauthorizedException(
        'Too many attempts with this link. Please start again.',
        ErrorCodes.PATIENT_PORTAL_CLAIM_LOCKED,
      );
    }

    if (claim.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'That link has expired. Please start again.',
        ErrorCodes.PATIENT_PORTAL_CLAIM_EXPIRED,
      );
    }

    const patient = claim.patient;
    if (!patient) {
      // The claim matched no record, so the MRN or the date of birth was wrong.
      // Answered exactly as an unknown token is — saying "that MRN does not
      // exist" here would hand back the signal `claim` spent its whole design
      // withholding, one call later.
      await this.patientAuthRepository.recordFailedAttempt(
        claim.id,
        CLAIM_ATTEMPT_LIMIT,
      );
      throw new UnauthorizedException(
        'That link is no longer valid. Please start again.',
        ErrorCodes.PATIENT_PORTAL_CLAIM_INVALID,
      );
    }

    if (patient.userId) {
      // Only reachable by someone who already matched this record's MRN and
      // date of birth, so it tells them nothing they did not know — and it is
      // the one message that actually helps, because the next step is to sign
      // in rather than to try the card again.
      throw new ConflictException(
        'This record already has a portal account. Sign in instead.',
        ErrorCodes.PATIENT_PORTAL_ALREADY_CLAIMED,
      );
    }

    // Not lower-cased. `UserRepository.findByEmail` matches exactly, so an
    // address normalised on the way in is an address that cannot log in.
    const email = (dto.email ?? patient.email ?? '').trim();
    if (!email) {
      throw new BadRequestException(
        'An email address is needed to sign in. Please provide one.',
        ErrorCodes.PATIENT_PORTAL_EMAIL_REQUIRED,
      );
    }

    if (await this.patientAuthRepository.findUserIdByEmail(email)) {
      throw new ConflictException(
        'That email address is already in use.',
        ErrorCodes.USER_EMAIL_TAKEN,
      );
    }

    const roleId = await this.patientAuthRepository.findRoleIdByName(
      SystemRole.PATIENT,
    );
    if (!roleId) {
      // Seeded since the beginning. Missing means the database was not seeded,
      // and creating the account without the role would produce a login that
      // authenticates and then fails every guard — worse than refusing.
      throw new NotFoundException(
        'The patient role is not configured on this system.',
        ErrorCodes.ROLE_NOT_FOUND,
      );
    }

    let user;
    try {
      user = await this.patientAuthRepository.linkPortalAccount({
        claimId: claim.id,
        patientId: patient.id,
        organizationId: claim.organizationId,
        email,
        fullName: [patient.firstName, patient.lastName]
          .filter(Boolean)
          .join(' '),
        firstName: patient.firstName,
        lastName: patient.lastName,
        passwordHash: await hashPassword(dto.password),
        roleId,
      });
    } catch (error) {
      if (error instanceof PortalAccountRaceError) {
        // Another activation with this claim committed while we were hashing.
        // Same answer as arriving a second later would have given.
        throw new ConflictException(
          'This link has already been used to create an account. Sign in instead.',
          ErrorCodes.PATIENT_PORTAL_CLAIM_CONSUMED,
        );
      }
      throw error;
    }

    void this.auditService.log({
      userId: user.id,
      action: AuditAction.CREATE,
      entityName: 'User',
      entityId: user.id,
      newValues: { role: SystemRole.PATIENT, patientId: patient.id },
      ipAddress,
      userAgent,
      metadata: {
        organizationId: claim.organizationId,
        reason: 'Patient portal account activated',
        claimId: claim.id,
      },
    });

    return this.authService.issueTokensForUser(user.id, ipAddress, userAgent);
  }

  /**
   * The caller's own record and whether it has a portal account.
   *
   * `patientId` arrives from `PatientSelfGuard` via `@PatientScope()`, never
   * from the request — for a patient caller the guard has already replaced
   * whatever they asked for with their own id.
   */
  async getPortalState(
    currentUser: AuthenticatedUser,
    patientId: string | undefined,
  ): Promise<PatientPortalStateResponseDto> {
    if (!patientId) {
      // A staff caller who named nobody. Patients never land here: the guard
      // refuses a PATIENT token with no linked record before this runs.
      throw new BadRequestException(
        'Specify which patient to read.',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    const isPatient = currentUser.roles.includes(SystemRole.PATIENT);
    if (
      !isPatient &&
      !currentUser.permissions.includes(Permission.PATIENT_READ)
    ) {
      // Portal state carries the record's demographics, so staff read it on the
      // same permission that reads the record itself rather than on the fact
      // that this route happens to be mounted under /patient-auth.
      throw new ForbiddenException(
        'You cannot read another patient’s record.',
        ErrorCodes.FORBIDDEN,
      );
    }

    const patient = await this.patientAuthRepository.findPatientWithPortalUser(
      patientId,
      currentUser.organizationId,
    );

    if (!patient) {
      throw new NotFoundException(
        'Patient not found.',
        ErrorCodes.PATIENT_NOT_FOUND,
      );
    }

    return {
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        firstName: patient.firstName,
        middleName: patient.middleName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
        bloodGroup: patient.bloodGroup,
        phonePrimary: patient.phonePrimary,
        email: patient.email,
      },
      portal: {
        isLinked: Boolean(patient.userId),
        userId: patient.portalUser?.id ?? null,
        email: patient.portalUser?.email ?? null,
        activatedAt: patient.portalClaims[0]?.consumedAt ?? null,
      },
    };
  }
}

/**
 * Whether a stored date of birth and a submitted one are the same day.
 *
 * Compared as calendar dates rather than instants. Patients are stored at UTC
 * midnight by `PatientsService.create`, but a row that arrived from an import
 * or an older client can carry a time component, and an exact-equality check
 * would reject the right date of birth for those patients with no way for them
 * to tell why.
 */
function sameCalendarDay(stored: Date, submitted: string): boolean {
  return stored.toISOString().slice(0, 10) === submitted.slice(0, 10);
}
