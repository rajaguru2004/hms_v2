import { Injectable } from '@nestjs/common';
import { Patient, PatientPortalClaim, Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

/** A claim with the record it points at, or null for a claim that matched none. */
export type ClaimWithPatient = PatientPortalClaim & { patient: Patient | null };

/** A patient row plus the account it signs in as, if it has been claimed. */
export type PatientWithPortalUser = Patient & {
  portalUser: Pick<User, 'id' | 'email'> | null;
  portalClaims: { consumedAt: Date | null }[];
};

/** Everything the transaction needs to turn a spent claim into an account. */
export interface LinkPortalAccountInput {
  claimId: string;
  patientId: string;
  organizationId: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  roleId: string;
}

/**
 * Data access for the patient portal's identity flow.
 *
 * Note which of `BaseRepository`'s methods are usable here: `create` and
 * `update` only. `findOne`, `findMany`, `paginate` and `count` all add
 * `isDeleted: false` to the where clause, and `PatientPortalClaim` has no such
 * column — a claim is a record of an attempt, which is never retracted, so
 * calling any of them is a Prisma validation error rather than an empty result.
 * Every read below is therefore spelled out.
 */
@Injectable()
export class PatientAuthRepository extends BaseRepository<
  PatientPortalClaim,
  Prisma.PatientPortalClaimCreateInput,
  Prisma.PatientPortalClaimUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'patientPortalClaim');
  }

  async findClaimByTokenHash(
    tokenHash: string,
  ): Promise<ClaimWithPatient | null> {
    return this.prisma.patientPortalClaim.findUnique({
      where: { tokenHash },
      include: { patient: true },
    });
  }

  /**
   * Counts a failed presentation of a claim and locks it once it has been
   * guessed at too often.
   *
   * Written even when the claim matched no patient. A claim token is only
   * useful to whoever was handed it, so repeated failures against one are
   * somebody working on a token they hold — which is exactly the shape worth
   * seeing next to the MRN it was issued for.
   */
  async recordFailedAttempt(
    claimId: string,
    attemptLimit: number,
  ): Promise<PatientPortalClaim> {
    const claim = await this.prisma.patientPortalClaim.update({
      where: { id: claimId },
      data: { attempts: { increment: 1 } },
    });

    if (claim.attempts >= attemptLimit && claim.status === 'issued') {
      return this.prisma.patientPortalClaim.update({
        where: { id: claimId },
        data: { status: 'locked' },
      });
    }

    return claim;
  }

  /**
   * The patient record as the portal reads it, with its account if it has one.
   *
   * The spent claim comes along for the ride so "when did this record get an
   * account" is answerable without a second round trip — it is the first thing
   * the front desk asks when a patient says the portal is not letting them in.
   */
  async findPatientWithPortalUser(
    patientId: string,
    organizationId: string,
  ): Promise<PatientWithPortalUser | null> {
    return this.prisma.patient.findFirst({
      where: { id: patientId, organizationId, isDeleted: false },
      include: {
        portalUser: { select: { id: true, email: true } },
        portalClaims: {
          where: { status: 'consumed' },
          orderBy: { consumedAt: 'desc' },
          take: 1,
          select: { consumedAt: true },
        },
      },
    });
  }

  /**
   * The organisation an unauthenticated claim belongs to.
   *
   * `POST /patient-auth/claim` has no token, so there is no authenticated
   * organisation to take — and taking one from the request body would let a
   * caller aim a claim at a hospital they have nothing to do with. This
   * deployment model is one organisation per hospital, so the oldest row is
   * *the* organisation; `orderBy` is there so a database that somehow holds two
   * answers the same way every time rather than whichever Postgres returns
   * first.
   *
   * If a single API ever fronts several hospitals, the tenant has to arrive out
   * of band — a subdomain or a host header — not in the body.
   */
  async findDefaultOrganizationId(): Promise<string | null> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return organization?.id ?? null;
  }

  /** The role every portal account is created with. */
  async findRoleIdByName(name: string): Promise<string | null> {
    const role = await this.prisma.role.findUnique({
      where: { name },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Creates the account, links the record to it and spends the claim — or does
   * none of those things.
   *
   * All three in one transaction because the intermediate states are not
   * recoverable by the patient: a User with no `Patient.userId` is an account
   * that logs in and can see nothing, and a linked record whose claim is still
   * `issued` hands a second person the same token and the same record. Neither
   * has a self-service repair, and both leave a patient locked out of their own
   * chart until somebody edits the database.
   *
   * The two writes are conditional (`status: 'issued'`, `userId: null`) rather
   * than blind, so two activations racing on the same claim cannot both commit.
   * The loser matches nothing, the count comes back zero, and the whole
   * transaction rolls back.
   */
  async linkPortalAccount(input: LinkPortalAccountInput): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          password: input.passwordHash,
          fullName: input.fullName,
          firstName: input.firstName,
          lastName: input.lastName,
          organizationId: input.organizationId,
          isActive: true,
          role: 'PATIENT',
          userRoles: { create: { roleId: input.roleId } },
        },
      });

      const linked = await tx.patient.updateMany({
        where: { id: input.patientId, userId: null },
        data: { userId: user.id },
      });

      if (linked.count !== 1) {
        throw new PortalAccountRaceError('patient already linked');
      }

      const consumed = await tx.patientPortalClaim.updateMany({
        where: { id: input.claimId, status: 'issued' },
        data: {
          status: 'consumed',
          consumedAt: new Date(),
          userId: user.id,
        },
      });

      if (consumed.count !== 1) {
        throw new PortalAccountRaceError('claim already consumed');
      }

      return user;
    });
  }
}

/**
 * Raised inside the activation transaction to roll it back when another
 * activation got there first. Never surfaces to a client — the service turns it
 * into the same answer a stale claim gets.
 */
export class PortalAccountRaceError extends Error {}
