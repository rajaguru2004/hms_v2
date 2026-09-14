import { Injectable } from '@nestjs/common';
import {
  CaseFact,
  CaseRedFlag,
  CaseSession,
  CaseSubmission,
  CaseTurn,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import { FactRowData } from './case-state';

/**
 * Data access for the interview.
 *
 * Note which of `BaseRepository`'s methods are usable here, because it is not
 * the obvious answer. Its reads — `findById`, `findOne`, `findMany`,
 * `paginate`, `count` — all inject `isDeleted: false`. `CaseSession` has that
 * column. **`CaseTurn`, `CaseFact`, `CaseRedFlag` and `CaseSubmission` do
 * not**: a turn is evidence of what was said, a fact is superseded rather than
 * removed, a red flag that fired stays fired, and a submission is what the
 * doctor opened. Calling an inherited read against any of those is a Prisma
 * validation error, not an empty result, so every one of them is spelled out
 * below.
 *
 * (This is the second time this codebase has met that trap; `PatientPortalClaim`
 * was the first.)
 */
@Injectable()
export class CaseTakingRepository extends BaseRepository<
  CaseSession,
  Prisma.CaseSessionCreateInput,
  Prisma.CaseSessionUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'caseSession');
  }

  /* ───────────────────────────── sessions ───────────────────────────── */

  /**
   * The patient's open interview, if they have one.
   *
   * Scoped by patient and organisation together even though `patientId` alone
   * would be unique enough: a caller that somehow arrives with the wrong
   * organisation gets nothing rather than somebody else's session.
   */
  async findInProgressForPatient(
    patientId: string,
    organizationId: string,
  ): Promise<CaseSession | null> {
    return this.prisma.caseSession.findFirst({
      where: {
        patientId,
        organizationId,
        status: { in: ['in_progress', 'review'] },
        isDeleted: false,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async findSessionForPatient(
    sessionId: string,
    patientId: string,
    organizationId: string,
  ): Promise<CaseSession | null> {
    return this.prisma.caseSession.findFirst({
      where: { id: sessionId, patientId, organizationId, isDeleted: false },
    });
  }

  async touchSession(
    sessionId: string,
    data: Prisma.CaseSessionUpdateInput,
  ): Promise<CaseSession> {
    return this.prisma.caseSession.update({
      where: { id: sessionId },
      data: { ...data, lastActiveAt: new Date() },
    });
  }

  /* ─────────────────────────────── turns ─────────────────────────────── */

  async listTurns(sessionId: string): Promise<CaseTurn[]> {
    return this.prisma.caseTurn.findMany({
      where: { sessionId },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * Append a turn, allocating its sequence inside a transaction.
   *
   * `@@unique([sessionId, sequence])` is real, and two requests for one session
   * are not hypothetical: the patient's answer and a background extraction's
   * follow-up question can land together. Reading the maximum and inserting in
   * one transaction turns that from a duplicate-key 500 into a serialised pair
   * of turns.
   */
  async appendTurn(
    sessionId: string,
    data: Omit<Prisma.CaseTurnUncheckedCreateInput, 'sessionId' | 'sequence'>,
  ): Promise<CaseTurn> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.caseTurn.findFirst({
        where: { sessionId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      return tx.caseTurn.create({
        data: { ...data, sessionId, sequence: (last?.sequence ?? 0) + 1 },
      });
    });
  }

  /* ─────────────────────────────── facts ─────────────────────────────── */

  /** The current picture: the newest unsuperseded row for every path. */
  async listCurrentFacts(sessionId: string): Promise<CaseFact[]> {
    return this.prisma.caseFact.findMany({
      where: { sessionId, supersededById: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Everything ever asserted, superseded rows included. The history §32 wants. */
  async listAllFacts(sessionId: string): Promise<CaseFact[]> {
    return this.prisma.caseFact.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findFact(sessionId: string, factId: string): Promise<CaseFact | null> {
    return this.prisma.caseFact.findFirst({ where: { id: factId, sessionId } });
  }

  /**
   * Write a fact, superseding whatever currently holds the path.
   *
   * The supersession is the point, and it runs in one transaction with the
   * insert so a reader can never see two live rows for a path or none. Note
   * that the *old* row is the one that gets `supersededById` — it points
   * forwards at its replacement — which is what lets a reader walk a path's
   * history in the order it happened.
   *
   * `supersededById` is `@unique`, so a path cannot fork: two corrections
   * racing to replace the same row means one of them fails loudly rather than
   * both succeeding and one disappearing.
   */
  async recordFact(input: {
    sessionId: string;
    patientId: string;
    row: FactRowData;
  }): Promise<CaseFact> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.caseFact.findFirst({
        where: {
          sessionId: input.sessionId,
          fieldPath: input.row.fieldPath,
          supersededById: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      const created = await tx.caseFact.create({
        data: {
          sessionId: input.sessionId,
          patientId: input.patientId,
          ...input.row,
          valueJson:
            input.row.valueJson === null
              ? Prisma.DbNull
              : (input.row.valueJson as Prisma.InputJsonValue),
        },
      });

      if (current) {
        await tx.caseFact.update({
          where: { id: current.id },
          data: { supersededById: created.id, supersededAt: new Date() },
        });
      }

      return created;
    });
  }

  /* ───────────────────────────── red flags ───────────────────────────── */

  async listRedFlags(sessionId: string): Promise<CaseRedFlag[]> {
    return this.prisma.caseRedFlag.findMany({
      where: { sessionId },
      orderBy: { triggeredAt: 'asc' },
    });
  }

  async recordRedFlag(
    data: Prisma.CaseRedFlagUncheckedCreateInput,
  ): Promise<CaseRedFlag> {
    return this.prisma.caseRedFlag.create({ data });
  }

  /* ──────────────────────────── submission ───────────────────────────── */

  async findSubmission(sessionId: string): Promise<CaseSubmission | null> {
    return this.prisma.caseSubmission.findFirst({ where: { sessionId } });
  }

  async createSubmission(
    data: Prisma.CaseSubmissionUncheckedCreateInput,
  ): Promise<CaseSubmission> {
    return this.prisma.caseSubmission.create({ data });
  }

  /**
   * The patient's date of birth, for the age band the interview never asks.
   *
   * `social.age_band` is declared `NEVER_ASKED` in the registry precisely so it
   * can be read off the record instead — and the paediatric danger-sign rules
   * in §29 are gated on it, so a session that does not set it has those rules
   * silently switched off.
   */
  async findPatientForSession(
    patientId: string,
    organizationId: string,
  ): Promise<{
    id: string;
    dateOfBirth: Date | null;
    gender: string | null;
  } | null> {
    return this.prisma.patient.findFirst({
      where: { id: patientId, organizationId, isDeleted: false },
      select: { id: true, dateOfBirth: true, gender: true },
    });
  }
}
