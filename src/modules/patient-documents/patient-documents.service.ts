import { Injectable, Logger } from '@nestjs/common';
import { PatientDocument, Prisma } from '@prisma/client';

import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  BadRequestException,
  NotFoundException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { PaginatedResult } from '../../common/types/paginated.type';
import { ObjectStorageService } from '../../storage/object-storage.service';
import { PatientDocumentQueryDto } from './dto/patient-document-query.dto';
import { UploadPatientDocumentDto } from './dto/upload-patient-document.dto';
import { PatientDocumentsRepository } from './patient-documents.repository';
import { readExistingRecord } from './pipeline/contradictions';
import { DocumentPipelineService } from './pipeline/document-pipeline.service';
import { documentSha256, findTextDuplicate } from './pipeline/duplicates';
import {
  AWAITING_REVIEW,
  DUPLICATE_DOCUMENT,
  NOTHING_EXTRACTED,
  PROCESSING,
  UNREADABLE_DOCUMENT,
  UNSUPPORTED_FILE,
  VERIFIED,
} from './pipeline/messages';

/** What a patient can photograph, and what the OCR sidecar will accept. */
export const PATIENT_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * The same 10 MB the mobile client refuses before it sends and the sidecar
 * refuses before it reads. Three places agreeing is not duplication: each one
 * is the last line for a caller that did not come through the previous one.
 */
export const PATIENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const STORAGE_FOLDER = 'patient-documents';

/** How long a link to an original stays good. Long enough to open, no longer. */
const ORIGINAL_URL_TTL_SECONDS = 300;

/** Who is asking, resolved by the guard rather than read from the request. */
export interface DocumentCaller {
  organizationId: string;
  patientId: string;
  userId: string;
}

@Injectable()
export class PatientDocumentsService {
  private readonly logger = new Logger(PatientDocumentsService.name);

  constructor(
    private readonly repository: PatientDocumentsRepository,
    private readonly storage: ObjectStorageService,
    private readonly pipeline: DocumentPipelineService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Take a document in, and start reading it.
   *
   * The response comes back before the reading is done, and that is the design
   * rather than a shortcut. A page costs about five seconds of OCR and fifteen
   * of the extraction model on this hardware; a mobile client holding a
   * multipart POST open for twenty seconds on a clinic's wifi is a request that
   * fails for reasons that have nothing to do with the document. So the row is
   * created, the bytes are safe, and the client polls `GET /:id` — which is
   * also what §28's "Processing..." screen wants to exist.
   *
   * Known limit, stated rather than hidden: the pipeline runs in this process.
   * A restart mid-read leaves a row at `processing` and nothing retries it. The
   * fix is a queue, and a queue is a larger decision than this module gets to
   * make on its own.
   */
  async upload(
    file: Express.Multer.File,
    dto: UploadPatientDocumentDto,
    caller: DocumentCaller,
  ): Promise<PatientDocumentResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        UNSUPPORTED_FILE,
        ErrorCodes.PATIENT_DOCUMENT_UNSUPPORTED_TYPE,
      );
    }

    if (dto.sessionId) {
      const belongs = await this.repository.sessionBelongsToPatient(
        dto.sessionId,
        caller.organizationId,
        caller.patientId,
      );
      if (!belongs) {
        // Deliberately the same answer for "no such session" and "somebody
        // else's session". Distinguishing them would let a caller walk session
        // ids to find out which exist.
        throw new NotFoundException(
          'That case-taking session could not be found.',
          ErrorCodes.PATIENT_DOCUMENT_SESSION_NOT_FOUND,
        );
      }
    }

    // §21's first signal, run before anything expensive. Cheap, exact, and it
    // catches the commonest duplicate there is: the upload that appeared to
    // time out, so the patient pressed the button again.
    const sha256 = documentSha256(file.buffer);
    const existing = await this.repository.findBySha256(
      sha256,
      caller.organizationId,
      caller.patientId,
    );

    // Re-checked inside the storage service too. This one exists so a rejected
    // file never reaches the network at all.
    const stored = existing
      ? // The bytes are identical, so the object already in the bucket is this
        // document. Pointing the new row at the same key stores the evidence
        // once and keeps §22 satisfied for both rows — the original is retained
        // and both rows resolve to it.
        { key: existing.fileKey }
      : await this.storage.uploadObject(file, {
          organizationId: caller.organizationId,
          folder: STORAGE_FOLDER,
          allowedMimeTypes: PATIENT_DOCUMENT_MIME_TYPES,
        });

    const created = await this.repository.create({
      organization: { connect: { id: caller.organizationId } },
      patient: { connect: { id: caller.patientId } },
      ...(dto.sessionId ? { session: { connect: { id: dto.sessionId } } } : {}),
      fileKey: stored.key,
      mimeType: file.mimetype,
      byteSize: file.size ?? file.buffer.length,
      sha256,
      // §21: recorded and told, never refused. The row exists, it says what it
      // is a copy of, and it is the last thing that happens to it — no second
      // extraction, so no second clinical event.
      ...(existing
        ? {
            status: 'uploaded',
            duplicateOf: { connect: { id: existing.id } },
            // Set so that a duplicate is distinguishable from a row whose
            // processing never started. `uploaded` with a processedAt is a
            // decision; `uploaded` without one is a queue.
            processedAt: new Date(),
          }
        : { status: 'uploaded' }),
    });

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.CREATE,
      entityName: 'PatientDocument',
      entityId: created.id,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        mimeType: file.mimetype,
        byteSize: created.byteSize,
        duplicateOfId: existing?.id,
      },
    });

    if (!existing) {
      // Fire and forget. `void` rather than an unawaited promise so that the
      // floating-promise rule reads as intent, and a `catch` so that a rejected
      // background task cannot take the process down with it.
      void this.processDocument(created.id, file.buffer, caller).catch(
        (error: unknown) => {
          this.logger.error(
            `Document ${created.id} failed outside the pipeline: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        },
      );
    }

    return this.toResponse(created);
  }

  /**
   * Read the document, structure it, and stop short of the record.
   *
   * Takes the bytes rather than re-fetching them: the upload already has them
   * in memory, and a GET back out of object storage to read a file we are
   * holding is a round trip bought with nothing.
   */
  async processDocument(
    documentId: string,
    bytes: Buffer,
    caller: DocumentCaller,
  ): Promise<void> {
    const document = await this.repository.findOwned(
      documentId,
      caller.organizationId,
      caller.patientId,
    );
    if (!document) return;

    await this.repository.update(documentId, { status: 'processing' });

    const patient = await this.repository.findPatientRecord(
      caller.organizationId,
      caller.patientId,
    );

    const outcome = await this.pipeline.run({
      documentId,
      bytes,
      mimeType: document.mimeType,
      filename: document.fileKey.split('/').pop() ?? 'document',
      record: readExistingRecord(patient ?? {}),
      now: new Date(),
    });

    // §21's second signal, and it has to run here rather than at upload: it
    // needs the text, and the text needs the OCR pass. A re-photographed page
    // is different bytes, so the hash said nothing about it.
    const textDuplicate = outcome.ocrText
      ? findTextDuplicate(
          outcome.ocrText,
          await this.repository.findDuplicateCandidates(
            caller.organizationId,
            caller.patientId,
            documentId,
          ),
        )
      : null;

    const update: Prisma.PatientDocumentUpdateInput = {
      status: textDuplicate?.duplicateOfId ? 'uploaded' : outcome.status,
      docType: outcome.docType,
      docTypeConfidence: outcome.docTypeConfidence,
      ocrEngine: outcome.ocrEngine,
      ocrConfidence: outcome.ocrConfidence,
      ocrText: outcome.ocrText,
      ocrBlocks: (outcome.ocrBlocks ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      pageCount: outcome.pageCount,
      visionFallbackUsed: outcome.visionFallbackUsed,
      processedAt: new Date(),
      // Only a real failure writes here — the column is shown to a patient and
      // is named for what it holds. A successful row's sentence is derived on
      // read, so it cannot drift out of step with the status beside it.
      failureReason: outcome.status === 'needs_review' ? null : outcome.message,
      ...(textDuplicate?.duplicateOfId
        ? {
            // The text matched something already held. The OCR is kept — it is
            // what proved the match — and the extraction is not run, so this
            // copy never becomes a second set of medications.
            duplicateOf: { connect: { id: textDuplicate.duplicateOfId } },
            extraction: Prisma.DbNull,
            extractionConfidence: null,
          }
        : {
            // Cast through `unknown` because the envelope is a typed interface
            // and `InputJsonValue` wants an index signature. It is JSON —
            // every field on it is a string, number, boolean, array or plain
            // object — so the widening is sound and stating it here is better
            // than loosening the interface into `Record<string, unknown>` and
            // losing the field names everywhere else.
            extraction: (outcome.extraction ??
              Prisma.DbNull) as unknown as Prisma.InputJsonValue,
            extractionConfidence: outcome.extractionConfidence,
          }),
    };

    await this.repository.update(documentId, update);

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.UPDATE,
      entityName: 'PatientDocument',
      entityId: documentId,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        status: update.status,
        docType: outcome.docType,
        ocrConfidence: outcome.ocrConfidence,
        extractionConfidence: outcome.extractionConfidence,
        visionFallbackUsed: outcome.visionFallbackUsed,
        duplicateOfId: textDuplicate?.duplicateOfId,
      },
    });
  }

  async findOne(
    id: string,
    caller: DocumentCaller,
  ): Promise<PatientDocumentResponse> {
    return this.toResponse(await this.requireOwned(id, caller));
  }

  async list(
    query: PatientDocumentQueryDto,
    caller: DocumentCaller,
  ): Promise<PaginatedResult<PatientDocumentResponse>> {
    const page = await this.repository.paginate(
      {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.docType ? { docType: query.docType } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      },
      {
        page: query.page,
        limit: query.limit,
        orderBy: { uploadedAt: query.orderDir ?? 'desc' },
      },
    );

    return {
      data: page.data.map((row) => this.toResponse(row)),
      meta: page.meta,
    };
  }

  /**
   * A short-lived link to the stored original. §22's evidence chain, made
   * reachable.
   *
   * The row is loaded scoped to the caller's organisation and patient first,
   * and only the key found there is signed. The storage service will sign any
   * key it is handed — it has no idea who is asking — so this method is where
   * "whose document is this" is decided, and it is decided by a query that
   * cannot return somebody else's row.
   */
  async getOriginalUrl(
    id: string,
    caller: DocumentCaller,
  ): Promise<{
    url: string;
    expiresInSeconds: number;
    expiresAt: Date;
    mimeType: string;
  }> {
    const document = await this.requireOwned(id, caller);

    const url = await this.storage.getReadUrl(
      document.fileKey,
      ORIGINAL_URL_TTL_SECONDS,
    );

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.CREATE,
      entityName: 'PatientDocumentAccess',
      entityId: document.id,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
      },
    });

    return {
      url,
      expiresInSeconds: ORIGINAL_URL_TTL_SECONDS,
      expiresAt: new Date(Date.now() + ORIGINAL_URL_TTL_SECONDS * 1000),
      mimeType: document.mimeType,
    };
  }

  /**
   * The patient confirming what was found. §18.
   *
   * This is the only transition out of `needs_review`, and it is the only
   * reason `needs_review` is where the pipeline stops: §2 forbids the system
   * treating extracted information as verified clinical truth, so somebody has
   * to say it is. Confirming marks the document; it does not itself write
   * medications or diagnoses onto the patient record. That import is a separate
   * decision with its own provenance rules (§30), and folding it in here would
   * mean a tap on a phone silently editing a chart.
   */
  async verify(
    id: string,
    caller: DocumentCaller,
  ): Promise<PatientDocumentResponse> {
    const document = await this.requireOwned(id, caller);

    if (document.status !== 'needs_review') {
      throw new BadRequestException(
        'There is nothing to confirm on this document yet.',
        ErrorCodes.PATIENT_DOCUMENT_NOT_READY,
      );
    }

    const updated = await this.repository.update(id, {
      status: 'verified',
      verifiedAt: new Date(),
    });

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.UPDATE,
      entityName: 'PatientDocument',
      entityId: id,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        status: 'verified',
      },
    });

    return this.toResponse(updated);
  }

  private async requireOwned(
    id: string,
    caller: DocumentCaller,
  ): Promise<PatientDocument> {
    const document = await this.repository.findOwned(
      id,
      caller.organizationId,
      caller.patientId,
    );

    if (!document) {
      // 404 and not 403, for a document that exists but belongs to someone
      // else. The distinction is the whole point: a 403 confirms the id is
      // real, and confirming which ids are real is how a list of patients gets
      // enumerated one document at a time. `PatientSelfGuard` makes the same
      // argument about substituting the caller's own id.
      throw new NotFoundException(
        'That document could not be found.',
        ErrorCodes.PATIENT_DOCUMENT_NOT_FOUND,
      );
    }

    return document;
  }

  /**
   * The row, as a client sees it.
   *
   * `message` is derived here rather than stored, so that the sentence a
   * patient reads is always the one that matches the status beside it. A stored
   * message goes stale the first time a status changes without it.
   */
  private toResponse(document: PatientDocument): PatientDocumentResponse {
    return {
      id: document.id,
      patientId: document.patientId,
      sessionId: document.sessionId,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      pageCount: document.pageCount,
      status: document.status,
      docType: document.docType,
      docTypeConfidence: document.docTypeConfidence,
      ocrEngine: document.ocrEngine,
      ocrConfidence: document.ocrConfidence,
      extractionConfidence: document.extractionConfidence,
      extraction: document.extraction ?? null,
      visionFallbackUsed: document.visionFallbackUsed,
      isDuplicate: document.duplicateOfId !== null,
      duplicateOfId: document.duplicateOfId,
      message: messageFor(document),
      uploadedAt: document.uploadedAt,
      processedAt: document.processedAt,
      verifiedAt: document.verifiedAt,
    };
  }
}

export interface PatientDocumentResponse {
  id: string;
  patientId: string;
  sessionId: string | null;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  status: string;
  docType: string | null;
  docTypeConfidence: number | null;
  ocrEngine: string | null;
  ocrConfidence: number | null;
  extractionConfidence: number | null;
  extraction: unknown;
  visionFallbackUsed: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  message: string;
  uploadedAt: Date;
  processedAt: Date | null;
  verifiedAt: Date | null;
}

/** The one sentence this row says to the patient looking at it. */
export function messageFor(document: {
  status: string;
  duplicateOfId: string | null;
  failureReason: string | null;
  extraction: unknown;
}): string {
  if (document.duplicateOfId) return DUPLICATE_DOCUMENT;

  switch (document.status) {
    case 'uploaded':
    case 'processing':
      return PROCESSING;
    case 'verified':
      return VERIFIED;
    case 'needs_review':
    case 'extracted':
      return hasFindings(document.extraction)
        ? AWAITING_REVIEW
        : NOTHING_EXTRACTED;
    default:
      // A stored `failureReason` is already a sentence — the column exists for
      // exactly this and nothing else writes to it. The fallback is for a row
      // that failed before the pipeline could write one.
      return document.failureReason ?? UNREADABLE_DOCUMENT;
  }
}

function hasFindings(extraction: unknown): boolean {
  if (typeof extraction !== 'object' || extraction === null) return false;
  const envelope = extraction as Record<string, unknown>;
  return [
    'medications',
    'investigations',
    'diagnosesRecorded',
    'procedures',
    'allergies',
    'followUp',
  ].some((key) => Array.isArray(envelope[key]) && envelope[key].length > 0);
}
