import { Injectable } from '@nestjs/common';
import { PatientDocument, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';
import {
  DuplicateCandidate,
  DUPLICATE_SCAN_LIMIT,
} from './pipeline/duplicates';

/**
 * A document, plus the outcome of the copy it duplicates.
 *
 * Only the two columns the message needs. Pulling the whole original would put
 * a second patient-identifiable row on every detail response to answer a
 * question about one sentence.
 */
export type PatientDocumentWithOriginal = PatientDocument & {
  duplicateOf?: { status: string; failureReason: string | null } | null;
};

/**
 * Every query this module makes, and the only file that talks to Prisma.
 *
 * `BaseRepository` supplies the CRUD and injects `isDeleted: false` on
 * everything, which `PatientDocument` has a column for. The methods below are
 * the ones that need more than that: each takes both the organisation and the
 * patient, because a document is scoped twice and a query that forgets the
 * second one reads somebody else's prescription.
 */
@Injectable()
export class PatientDocumentsRepository extends BaseRepository<
  PatientDocument,
  Prisma.PatientDocumentCreateInput,
  Prisma.PatientDocumentUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'patientDocument');
  }

  /**
   * One document, scoped to its owner.
   *
   * There is no "find by id" for this model on purpose. The id is a cuid a
   * caller supplies, and the difference between this signature and a bare
   * `findById` is the difference between a patient reading their own documents
   * and a patient reading anyone's.
   */
  async findOwned(
    id: string,
    organizationId: string,
    patientId: string,
  ): Promise<PatientDocumentWithOriginal | null> {
    return this.prisma.patientDocument.findFirst({
      where: { id, organizationId, patientId, isDeleted: false },
      // The first copy's outcome, for the one case where this row has none of
      // its own: a duplicate never runs the pipeline, so if the original was
      // rejected there is no other way for the reason to reach the patient.
      // Two columns, one hop — `duplicateOf` is never a chain.
      include: {
        duplicateOf: { select: { status: true, failureReason: true } },
      },
    });
  }

  /**
   * The document with these exact bytes, if this patient already sent it.
   *
   * §21's first signal. Scoped to the patient rather than the organisation: two
   * patients holding an identical lab-report PDF is possible and is not one
   * clinical event, and pointing one patient's row at another patient's
   * document would put a foreign key across a privacy boundary.
   */
  async findBySha256(
    sha256: string,
    organizationId: string,
    patientId: string,
  ): Promise<PatientDocument | null> {
    return this.prisma.patientDocument.findFirst({
      where: { sha256, organizationId, patientId, isDeleted: false },
      // The earliest, so a third copy points at the original rather than at
      // the second copy. `duplicateOf` should be one hop, never a chain.
      orderBy: { uploadedAt: 'asc' },
    });
  }

  /** The recent documents a new upload is compared against. §21's second signal. */
  async findDuplicateCandidates(
    organizationId: string,
    patientId: string,
    excludeId: string,
  ): Promise<DuplicateCandidate[]> {
    const rows = await this.prisma.patientDocument.findMany({
      where: {
        organizationId,
        patientId,
        isDeleted: false,
        id: { not: excludeId },
        // A row that is itself a duplicate is not a candidate: matching it
        // would produce the chain `findBySha256` already avoids.
        duplicateOfId: null,
        ocrText: { not: null },
      },
      select: { id: true, ocrText: true },
      orderBy: { uploadedAt: 'desc' },
      take: DUPLICATE_SCAN_LIMIT,
    });

    return rows;
  }

  /** Whether a case-taking session exists and belongs to this patient. */
  async sessionBelongsToPatient(
    sessionId: string,
    organizationId: string,
    patientId: string,
  ): Promise<boolean> {
    const session = await this.prisma.caseSession.findFirst({
      where: { id: sessionId, organizationId, patientId, isDeleted: false },
      select: { id: true },
    });
    return session !== null;
  }

  /** The patient's own record, for the §20 comparison. Read only. */
  async findPatientRecord(
    organizationId: string,
    patientId: string,
  ): Promise<{
    allergies: string | null;
    chronicConditions: string | null;
    currentMedications: string | null;
  } | null> {
    return this.prisma.patient.findFirst({
      where: { id: patientId, organizationId, isDeleted: false },
      select: {
        allergies: true,
        chronicConditions: true,
        currentMedications: true,
      },
    });
  }
}
