import { Readable } from 'stream';
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
import { rowDataFromFact } from '../case-taking/case-state';
import { CaseTakingRepository } from '../case-taking/case-taking.repository';
import { FactProvenance } from '../case-taking/engine/tri-state';
import { CorrectExtractionDto } from './dto/correct-extraction.dto';
import { PatientDocumentQueryDto } from './dto/patient-document-query.dto';
import { UploadPatientDocumentDto } from './dto/upload-patient-document.dto';
import {
  CorrectionTarget,
  DocumentOnlyReason,
  StoredCorrection,
  acknowledgeAll,
  caseFieldPathFor,
  deriveCorrection,
  documentFactFor,
  outstandingCorrections,
  readCorrections,
  readExtractionValue,
} from './document-corrections';
import {
  PatientDocumentsRepository,
  PatientDocumentWithOriginal,
} from './patient-documents.repository';
import { readExistingRecord } from './pipeline/contradictions';
import { DocumentPipelineService } from './pipeline/document-pipeline.service';
import { documentSha256, findTextDuplicate } from './pipeline/duplicates';
import {
  AWAITING_REVIEW,
  CORRECTION_RECORDED,
  DUPLICATE_DOCUMENT,
  DUPLICATE_OF_UNREADABLE,
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
    /**
     * The interview's fact store, borrowed rather than copied.
     *
     * `recordFact` writes a row and points the previous one at it inside one
     * transaction, and that supersession is the only thing in this codebase
     * allowed to replace a clinical assertion. A correction on a document
     * attached to a session is exactly such a replacement, so it goes through
     * that method. Re-implementing the transaction here would be a second
     * mechanism for one idea, and the second one is the one that forgets to set
     * `supersededAt`.
     */
    private readonly caseFacts: CaseTakingRepository,
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
   * The original itself, streamed through the API.
   *
   * `getOriginalUrl` signs a link straight to the object store, which is the
   * cheaper answer and the right one whenever the client shares a network with
   * it. A phone does not. Reached over a tunnel — or over mobile data, or from
   * any device that is not this host — `minio:9000` resolves to nothing, and
   * §22's preserved evidence becomes evidence nobody can open.
   *
   * So this route serves the bytes on the API's own origin. It costs a proxy
   * hop; what it buys is that "view the original" works from wherever the
   * patient actually is, which is the only place it matters.
   *
   * Ownership is settled before a byte is read: `requireOwned` loads the row
   * scoped to the organisation and the patient, and only the key on that row is
   * ever opened.
   */
  async streamOriginal(
    id: string,
    caller: DocumentCaller,
  ): Promise<{
    body: Readable;
    mimeType: string;
    contentLength?: number;
    filename: string;
  }> {
    const document = await this.requireOwned(id, caller);
    const object = await this.storage.readObject(document.fileKey);

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.CREATE,
      entityName: 'PatientDocumentAccess',
      entityId: document.id,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        via: 'stream',
      },
    });

    return {
      body: object.body,
      // The row's own type, not the store's. The row is what the pipeline
      // validated; a store answering `application/octet-stream` would make a
      // phone offer to download a prescription instead of showing it.
      mimeType:
        document.mimeType || object.contentType || 'application/octet-stream',
      contentLength: object.contentLength,
      filename: document.fileKey.split('/').pop() || 'document',
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
   *
   * Confirming is also what settles an outstanding correction. What the patient
   * is confirming is the document *as they have now corrected it*, so the
   * corrections are stamped rather than left open — but they are stamped, not
   * removed, because "disputed and then settled" is a different history from
   * "never disputed" and a clinician reading the row needs to be able to tell.
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

    const now = new Date();
    const corrections = readCorrections(document.corrections);
    const settled = acknowledgeAll(corrections, now);

    const updated = await this.repository.update(id, {
      status: 'verified',
      verifiedAt: now,
      // Written only when there is something to write, so a document nobody
      // corrected keeps `corrections` NULL. An empty array would claim somebody
      // reviewed it and found nothing to change, which is not what happened.
      ...(corrections.length > 0
        ? { corrections: settled as unknown as Prisma.InputJsonValue }
        : {}),
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
        correctionsAcknowledged: outstandingCorrections(corrections).length,
      },
    });

    return this.toResponse(updated);
  }

  /**
   * The patient fixing one value the model misread. §18, and Case Taking §35's
   * "every important section should allow correction".
   *
   * ── The shape of this method is decided by one rule
   *
   * `extraction` is not written. Not here, not anywhere after the pipeline sets
   * it. It is the record of what the model claimed about the page, and §22's
   * evidence chain — original → OCR → extracted data → patient verification →
   * clinical record — only survives while each link stays legible. A correction
   * is a later link. Fold it into `extraction` and the row can no longer say
   * "the model read 500 mg, the patient said 850", which is the one sentence
   * that makes the case auditable. So the correction is appended to a sibling
   * column and the original value it disputes is copied into it, because the
   * original is the point.
   *
   * ── Where the correction goes after that
   *
   * Two places, or one, and the answer is in the response because the client has
   * to be able to say which. A document attached to a `CaseSession` writes into
   * the interview's draft through the same append-only supersession the
   * interview itself uses: the document's reading is recorded as the fact it
   * always was, and the patient's statement supersedes it. A document attached
   * to no session has no draft to update, so the correction lives on the
   * document alone — which is still a complete record of the disagreement.
   *
   * ── What does not happen here
   *
   * The session's `clinicalState` projection is not rewritten and the safety
   * engine is not re-run. Neither is a gap: `case-state.ts` rebuilds the state
   * from the `CaseFact` rows on every read precisely so that two writers cannot
   * race over one JSON document, and `evaluate` runs off that rebuilt state. The
   * interview picks this correction up on its next turn or review, from the rows
   * this method wrote.
   */
  async correctExtraction(
    id: string,
    dto: CorrectExtractionDto,
    caller: DocumentCaller,
  ): Promise<DocumentCorrectionResponse> {
    const document = await this.requireOwned(id, caller);

    if (document.extraction === null || document.extraction === undefined) {
      throw new BadRequestException(
        'There is nothing to correct on this document yet.',
        ErrorCodes.PATIENT_DOCUMENT_NOT_READY,
      );
    }

    const reading = readExtractionValue(document.extraction, dto.path);
    if (!reading.ok) {
      // Refused rather than accepted as a new value. A path the extraction does
      // not hold is a client inventing a finding by way of a field name, and a
      // correction to a value nobody claimed is not a correction.
      throw new BadRequestException(
        `We could not find that on this document — ${reading.reason}.`,
        ErrorCodes.PATIENT_DOCUMENT_VALUE_NOT_FOUND,
      );
    }

    this.assertValueMatchesKind(dto);

    const now = new Date();
    const derivation = deriveCorrection({
      kind: dto.kind,
      originalValue: reading.value,
      patientValue: dto.value,
      provenance: this.correctionProvenance(document.id, dto.kind, now),
    });
    if (!derivation.ok) {
      throw new BadRequestException(
        derivation.reason,
        ErrorCodes.PATIENT_DOCUMENT_CORRECTION_INVALID,
      );
    }

    const propagation = await this.propagateCorrection({
      document,
      path: dto.path,
      kind: dto.kind,
      originalValue: reading.value,
      fact: derivation.outcome.fact,
    });

    const correction: StoredCorrection = {
      path: dto.path,
      kind: dto.kind,
      originalValue: reading.value,
      patientValue: derivation.outcome.patientValue,
      presence: derivation.outcome.presence,
      presenceReason: derivation.outcome.reason,
      note: dto.note ?? null,
      correctedByUserId: caller.userId,
      correctedAt: now.toISOString(),
      ...propagation,
      acknowledgedAt: null,
    };

    const corrections = [...readCorrections(document.corrections), correction];

    const updated = await this.repository.update(document.id, {
      corrections: corrections as unknown as Prisma.InputJsonValue,
      // A document with an outstanding correction is not confirmed, whatever it
      // was a moment ago. Saying otherwise would report the patient's own
      // dispute as settled clinical truth — §17 keeps verification separate from
      // everything else exactly so this stays answerable.
      ...(document.status === 'verified'
        ? { status: 'needs_review', verifiedAt: null }
        : {}),
    });

    void this.auditService.log({
      userId: caller.userId,
      action: AuditAction.UPDATE,
      entityName: 'PatientDocument',
      entityId: document.id,
      metadata: {
        organizationId: caller.organizationId,
        patientId: caller.patientId,
        path: dto.path,
        kind: dto.kind,
        target: correction.target,
        caseFactId: correction.caseFactId,
        supersededFactId: correction.supersededFactId,
      },
      // The disagreement itself, in the audit trail as well as on the row. Two
      // records of the same event, because the row can be corrected again and
      // the log cannot.
      oldValues: { path: dto.path, value: reading.value },
      newValues: {
        value: derivation.outcome.patientValue,
        presence: derivation.outcome.presence,
      },
    });

    return { correction, document: this.toResponse(updated) };
  }

  /**
   * `correct` needs a value; `confirm` and `unsure` must not carry one.
   *
   * Checked here rather than with a conditional validator because the message a
   * patient's client gets should say what to do, and because the rule is about
   * the relationship between two fields rather than the shape of either.
   */
  private assertValueMatchesKind(dto: CorrectExtractionDto): void {
    const supplied = (dto.value ?? '').trim();

    if (dto.kind === 'correct' && supplied.length === 0) {
      throw new BadRequestException(
        'Tell us what this should say. To say the document is wrong and there ' +
          'is nothing here, send "none".',
        ErrorCodes.PATIENT_DOCUMENT_CORRECTION_INVALID,
      );
    }
    if (dto.kind !== 'correct' && supplied.length > 0) {
      throw new BadRequestException(
        dto.kind === 'confirm'
          ? 'Confirming means agreeing with what is already there. To change ' +
              'it, send a correction instead.'
          : '"Not sure" is not a value. Send it on its own.',
        ErrorCodes.PATIENT_DOCUMENT_CORRECTION_INVALID,
      );
    }
  }

  /**
   * Provenance for the patient's own statement. §16.
   *
   * `confirm` keeps the source as `uploaded_document`, and that is not a slip.
   * §16 lists "uploaded document" and "patient correction" as different sources
   * because they are different claims, and a patient agreeing with a document
   * has not become the author of what it says. What changed is the verification
   * status — §17 tracks that separately for precisely this case. A correction
   * and an "I don't know" are the patient speaking, so those are
   * `patient_correction`.
   *
   * No confidence on any of them. There is no measurement of how sure a patient
   * is, and a number invented here would sit in the same column as an OCR
   * engine's character confidence.
   */
  private correctionProvenance(
    documentId: string,
    kind: CorrectExtractionDto['kind'],
    now: Date,
  ): FactProvenance {
    return {
      source: kind === 'confirm' ? 'uploaded_document' : 'patient_correction',
      // "Not sure" confirms nothing. The other two are the patient settling the
      // value themselves, which is confirmation by definition.
      verification: kind === 'unsure' ? 'unverified' : 'patient_confirmed',
      recordedAt: now.toISOString(),
      documentId,
    };
  }

  /**
   * Put the correction into the interview's draft, if there is one to put it in.
   *
   * The document's own reading is written first and superseded in the same
   * breath, so that the chain reads "the document said X → the patient said Y"
   * rather than starting at Y. It is written here rather than at upload because
   * §2 forbids extracted information being treated as verified clinical truth:
   * an upload must not quietly populate a chart with everything a model thought
   * it saw. One value the patient has actually looked at and disputed is a
   * different matter — and the row it creates is never live as an unchallenged
   * assertion, because the patient's supersedes it immediately.
   *
   * `confirm` skips that step. There is nothing to supersede: the patient agreed
   * with the document, so one row carrying the document's value and the
   * patient's confirmation is the whole of what happened.
   */
  private async propagateCorrection(input: {
    document: PatientDocument;
    path: string;
    kind: CorrectExtractionDto['kind'];
    originalValue: string | null;
    fact: Parameters<typeof rowDataFromFact>[1];
  }): Promise<{
    target: CorrectionTarget;
    documentOnlyReason: DocumentOnlyReason | null;
    caseFieldPath: string | null;
    caseFactId: string | null;
    supersededFactId: string | null;
  }> {
    const documentOnly = (
      reason: DocumentOnlyReason,
    ): {
      target: CorrectionTarget;
      documentOnlyReason: DocumentOnlyReason;
      caseFieldPath: null;
      caseFactId: null;
      supersededFactId: null;
    } => ({
      target: 'document_only',
      documentOnlyReason: reason,
      caseFieldPath: null,
      caseFactId: null,
      supersededFactId: null,
    });

    const sessionId = input.document.sessionId;
    if (!sessionId) return documentOnly('no_session');

    const caseFieldPath = caseFieldPathFor(input.path);
    if (!caseFieldPath) return documentOnly('no_case_field');

    const live = (await this.caseFacts.listCurrentFacts(sessionId)).find(
      (row) => row.fieldPath === caseFieldPath,
    );

    let superseded = live ?? null;
    if (!live && input.kind !== 'confirm' && input.originalValue !== null) {
      superseded = await this.caseFacts.recordFact({
        sessionId,
        patientId: input.document.patientId,
        row: rowDataFromFact(
          caseFieldPath,
          documentFactFor(
            input.originalValue,
            this.documentFactProvenance(input.document),
          ),
          input.document.id,
        ),
      });
    }

    const created = await this.caseFacts.recordFact({
      sessionId,
      patientId: input.document.patientId,
      row: rowDataFromFact(caseFieldPath, input.fact, input.document.id),
    });

    return {
      target: 'case_fact',
      documentOnlyReason: null,
      caseFieldPath,
      caseFactId: created.id,
      supersededFactId: superseded?.id ?? null,
    };
  }

  /** What the document claims, attributed to the document. §16. */
  private documentFactProvenance(document: PatientDocument): FactProvenance {
    return {
      source: 'uploaded_document',
      verification: 'unverified',
      // The recogniser's measurement, tagged as one, so nothing downstream can
      // compare it against a model's self-report. `document-facts.ts` makes the
      // same distinction for the same reason.
      ...(document.ocrConfidence !== null
        ? {
            confidence: document.ocrConfidence,
            confidenceSource: 'ocr' as const,
          }
        : {}),
      recordedAt: (document.processedAt ?? document.uploadedAt).toISOString(),
      documentId: document.id,
    };
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
  private toResponse(
    document: PatientDocumentWithOriginal,
  ): PatientDocumentResponse {
    const corrections = readCorrections(document.corrections);

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
      // Beside the extraction, never merged into it. A client renders the
      // corrected value and can still show what the page said, which is what
      // §18's "the original document must remain available as evidence" means
      // once the evidence is a value rather than a photograph.
      corrections,
      hasOutstandingCorrections: outstandingCorrections(corrections).length > 0,
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
  /** §18's corrections, as a sibling of the extraction they dispute. */
  corrections: StoredCorrection[];
  /** True while the patient has corrected something and not re-confirmed. */
  hasOutstandingCorrections: boolean;
  visionFallbackUsed: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  message: string;
  uploadedAt: Date;
  processedAt: Date | null;
  verifiedAt: Date | null;
}

/** What `PATCH /:documentId/extraction` answers with. */
export interface DocumentCorrectionResponse {
  /** The correction as stored, including where it went. */
  correction: StoredCorrection;
  /** The document afterwards, so the client re-renders from one payload. */
  document: PatientDocumentResponse;
}

/** The one sentence this row says to the patient looking at it. */
export function messageFor(document: {
  status: string;
  duplicateOfId: string | null;
  failureReason: string | null;
  extraction: unknown;
  corrections: unknown;
  duplicateOf?: { status: string; failureReason: string | null } | null;
}): string {
  if (document.duplicateOfId) {
    // A duplicate has no outcome of its own — the pipeline never ran for it —
    // so its sentence comes from the copy it points at. When that copy was
    // rejected, the reason is the only thing on the screen the patient can act
    // on, and saying "we have kept it with the first copy" instead tells them
    // a rejected photograph is safely filed. They then send the identical
    // photograph again, dedupe catches it again, and nothing ever says the
    // picture was too small.
    const original = document.duplicateOf;
    if (
      original &&
      (original.status === 'rejected_quality' || original.status === 'failed')
    ) {
      return original.failureReason
        ? `${DUPLICATE_OF_UNREADABLE} ${original.failureReason}`
        : `${DUPLICATE_OF_UNREADABLE} ${UNREADABLE_DOCUMENT}`;
    }
    return DUPLICATE_DOCUMENT;
  }

  switch (document.status) {
    case 'uploaded':
    case 'processing':
      return PROCESSING;
    case 'verified':
      return VERIFIED;
    case 'needs_review':
    case 'extracted':
      // An outstanding correction outranks the generic prompt: the patient has
      // already looked, and telling somebody who has just fixed a dose that "we
      // found some information, please check it" reads as though nothing they
      // did registered.
      if (
        outstandingCorrections(readCorrections(document.corrections)).length
      ) {
        return CORRECTION_RECORDED;
      }
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
