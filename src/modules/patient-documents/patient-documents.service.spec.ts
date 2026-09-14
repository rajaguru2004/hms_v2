// Asserting on a jest.Mocked collaborator reads its methods off the object,
// which is exactly what this rule warns about — and exactly what a mock is
// for. The same header auth.service.spec.ts carries, for the same reason.
/* eslint-disable @typescript-eslint/unbound-method */
import { PatientDocument } from '@prisma/client';

import { AuditService } from '../../audit/audit.service';
import { ObjectStorageService } from '../../storage/object-storage.service';
import { PatientDocumentsRepository } from './patient-documents.repository';
import {
  messageFor,
  PatientDocumentsService,
} from './patient-documents.service';
import { DocumentPipelineService } from './pipeline/document-pipeline.service';
import { documentSha256 } from './pipeline/duplicates';
import {
  AWAITING_REVIEW,
  DUPLICATE_DOCUMENT,
  NOTHING_EXTRACTED,
  PROCESSING,
  UNREADABLE_DOCUMENT,
  VERIFIED,
} from './pipeline/messages';

/**
 * The service with the repository, storage and pipeline all mocked.
 *
 * Everything worth asserting here is a decision rather than a computation: what
 * gets stored, what does not get run twice, and which query the answer came
 * from. The scoping tests are the important ones — they are the difference
 * between a patient reading their own documents and a patient reading anyone's.
 */

const CALLER = {
  organizationId: 'org-1',
  patientId: 'patient-1',
  userId: 'user-1',
};

const FILE_BYTES = Buffer.from('a photograph of a prescription');

function uploadedFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'prescription.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: FILE_BYTES.length,
    buffer: FILE_BYTES,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

function documentRow(
  overrides: Partial<PatientDocument> = {},
): PatientDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    patientId: 'patient-1',
    sessionId: null,
    fileKey: 'org-1/patient-documents/1-abc.png',
    mimeType: 'image/png',
    byteSize: FILE_BYTES.length,
    pageCount: 1,
    sha256: documentSha256(FILE_BYTES),
    status: 'uploaded',
    docType: null,
    docTypeConfidence: null,
    ocrEngine: null,
    ocrConfidence: null,
    ocrText: null,
    ocrBlocks: null,
    extraction: null,
    extractionConfidence: null,
    visionFallbackUsed: false,
    duplicateOfId: null,
    failureReason: null,
    uploadedAt: new Date('2026-09-14T09:00:00.000Z'),
    processedAt: null,
    verifiedAt: null,
    updatedAt: new Date('2026-09-14T09:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

interface Harness {
  service: PatientDocumentsService;
  repository: jest.Mocked<PatientDocumentsRepository>;
  storage: jest.Mocked<ObjectStorageService>;
  pipeline: jest.Mocked<DocumentPipelineService>;
  audit: jest.Mocked<AuditService>;
}

function build(): Harness {
  const repository = {
    create: jest.fn().mockResolvedValue(documentRow()),
    update: jest.fn().mockResolvedValue(documentRow()),
    findOwned: jest.fn().mockResolvedValue(null),
    findBySha256: jest.fn().mockResolvedValue(null),
    findDuplicateCandidates: jest.fn().mockResolvedValue([]),
    sessionBelongsToPatient: jest.fn().mockResolvedValue(true),
    findPatientRecord: jest.fn().mockResolvedValue(null),
    paginate: jest.fn(),
  } as unknown as jest.Mocked<PatientDocumentsRepository>;

  const storage = {
    uploadObject: jest.fn().mockResolvedValue({
      key: 'org-1/patient-documents/1-abc.png',
      url: 'u',
    }),
    getReadUrl: jest
      .fn()
      .mockResolvedValue('https://signed.example/doc?X-Amz=1'),
  } as unknown as jest.Mocked<ObjectStorageService>;

  const pipeline = {
    run: jest.fn(),
  } as unknown as jest.Mocked<DocumentPipelineService>;

  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  return {
    service: new PatientDocumentsService(repository, storage, pipeline, audit),
    repository,
    storage,
    pipeline,
    audit,
  };
}

/** The background read is fire-and-forget; let its microtasks settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('upload', () => {
  it('stores the file and records the row', async () => {
    const { service, storage, repository } = build();

    const response = await service.upload(uploadedFile(), {}, CALLER);
    await settle();

    expect(storage.uploadObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        folder: 'patient-documents',
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sha256: documentSha256(FILE_BYTES),
        mimeType: 'image/png',
      }),
    );
    expect(response.status).toBe('uploaded');
    expect(response.message).toBe(PROCESSING);
  });

  it('refuses a session that is not this patient’s, without saying which', async () => {
    const { service, repository, storage } = build();
    repository.sessionBelongsToPatient.mockResolvedValue(false);

    await expect(
      service.upload(uploadedFile(), { sessionId: 'someone-elses' }, CALLER),
    ).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_SESSION_NOT_FOUND',
    });

    expect(storage.uploadObject).not.toHaveBeenCalled();
  });

  it('refuses an empty upload in words', async () => {
    const { service } = build();

    await expect(
      service.upload(uploadedFile({ buffer: Buffer.alloc(0) }), {}, CALLER),
    ).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_UNSUPPORTED_TYPE',
    });
  });
});

describe('upload — the same file twice', () => {
  it('records the duplicate and tells the patient, rather than refusing', async () => {
    const { service, repository } = build();
    repository.findBySha256.mockResolvedValue(
      documentRow({ id: 'doc-original' }),
    );
    repository.create.mockResolvedValue(
      documentRow({ id: 'doc-2', duplicateOfId: 'doc-original' }),
    );

    const response = await service.upload(uploadedFile(), {}, CALLER);

    // §21: recorded and told. A 409 would be the system deciding on the
    // patient's behalf that the second upload never happened.
    expect(response.isDuplicate).toBe(true);
    expect(response.duplicateOfId).toBe('doc-original');
    expect(response.message).toBe(DUPLICATE_DOCUMENT);
  });

  it('does not run the pipeline again, so there is no second clinical event', async () => {
    const { service, repository, pipeline } = build();
    repository.findBySha256.mockResolvedValue(
      documentRow({ id: 'doc-original' }),
    );
    repository.create.mockResolvedValue(
      documentRow({ id: 'doc-2', duplicateOfId: 'doc-original' }),
    );

    await service.upload(uploadedFile(), {}, CALLER);
    await settle();

    expect(pipeline.run).not.toHaveBeenCalled();
  });

  it('points the copy at the object already in the bucket', async () => {
    const { service, repository, storage } = build();
    repository.findBySha256.mockResolvedValue(
      documentRow({
        id: 'doc-original',
        fileKey: 'org-1/patient-documents/first.png',
      }),
    );

    await service.upload(uploadedFile(), {}, CALLER);

    // Identical bytes are the same object. §22 wants the original retained,
    // not retained twice.
    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ fileKey: 'org-1/patient-documents/first.png' }),
    );
  });

  it('marks the copy as decided rather than queued', async () => {
    const { service, repository } = build();
    repository.findBySha256.mockResolvedValue(
      documentRow({ id: 'doc-original' }),
    );

    await service.upload(uploadedFile(), {}, CALLER);

    const created = repository.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // `uploaded` with a processedAt is a decision; without one it is a queue.
    expect(created.processedAt).toBeInstanceOf(Date);
    expect(created.duplicateOf).toEqual({ connect: { id: 'doc-original' } });
  });
});

describe('processing', () => {
  const OUTCOME = {
    status: 'needs_review' as const,
    docType: 'prescription' as const,
    docTypeConfidence: 0.83,
    ocrEngine: 'pp-ocrv5-mobile',
    ocrConfidence: 0.9859,
    ocrText: 'PRESCRIPTION\nTab. METFORMIN 500 mg',
    ocrBlocks: null,
    pageCount: 1,
    extraction: null,
    extractionConfidence: 0.91,
    visionFallbackUsed: false,
    message: AWAITING_REVIEW,
  };

  it('writes both confidences and leaves failureReason empty on success', async () => {
    const { service, repository, pipeline } = build();
    repository.findOwned.mockResolvedValue(documentRow());
    pipeline.run.mockResolvedValue(OUTCOME);

    await service.processDocument('doc-1', FILE_BYTES, CALLER);

    // Indexed rather than `.at(-1)`: this project targets ES2021 and
    // `Array.prototype.at` arrived in ES2022, so the spec would not compile.
    const updates = repository.update.mock.calls;
    const update = updates[updates.length - 1]?.[1] as Record<string, unknown>;
    expect(update.status).toBe('needs_review');
    expect(update.ocrConfidence).toBe(0.9859);
    expect(update.extractionConfidence).toBe(0.91);
    // The column is named for what it holds and is shown to a patient.
    expect(update.failureReason).toBeNull();
  });

  it('stores the written sentence when the document was refused', async () => {
    const { service, repository, pipeline } = build();
    repository.findOwned.mockResolvedValue(documentRow());
    pipeline.run.mockResolvedValue({
      ...OUTCOME,
      status: 'rejected_quality',
      message: UNREADABLE_DOCUMENT,
      extractionConfidence: null,
    });

    await service.processDocument('doc-1', FILE_BYTES, CALLER);

    // Indexed rather than `.at(-1)`: this project targets ES2021 and
    // `Array.prototype.at` arrived in ES2022, so the spec would not compile.
    const updates = repository.update.mock.calls;
    const update = updates[updates.length - 1]?.[1] as Record<string, unknown>;
    expect(update.failureReason).toBe(UNREADABLE_DOCUMENT);
    expect(update.failureReason).not.toMatch(/PP-?OCR|exception|undefined/i);
  });

  it('stops at the duplicate it found in the text, keeping the OCR that proved it', async () => {
    const { service, repository, pipeline } = build();
    repository.findOwned.mockResolvedValue(documentRow());
    repository.findDuplicateCandidates.mockResolvedValue([
      { id: 'doc-original', ocrText: OUTCOME.ocrText },
    ]);
    pipeline.run.mockResolvedValue(OUTCOME);

    await service.processDocument('doc-1', FILE_BYTES, CALLER);

    // Indexed rather than `.at(-1)`: this project targets ES2021 and
    // `Array.prototype.at` arrived in ES2022, so the spec would not compile.
    const updates = repository.update.mock.calls;
    const update = updates[updates.length - 1]?.[1] as Record<string, unknown>;
    expect(update.duplicateOf).toEqual({ connect: { id: 'doc-original' } });
    expect(update.ocrText).toBe(OUTCOME.ocrText);
    expect(update.extractionConfidence).toBeNull();
  });

  it('does nothing for a document that is not this caller’s', async () => {
    const { service, repository, pipeline } = build();
    repository.findOwned.mockResolvedValue(null);

    await service.processDocument('doc-1', FILE_BYTES, CALLER);

    expect(pipeline.run).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('reading a document', () => {
  it('answers 404 for a document that belongs to somebody else', async () => {
    const { service, repository } = build();
    // The scoped query is what refuses: the row is not returned, so there is
    // nothing to leak. A 403 would confirm the id is real.
    repository.findOwned.mockResolvedValue(null);

    await expect(
      service.findOne('someone-elses-doc', CALLER),
    ).rejects.toMatchObject({ errorCode: 'PATIENT_DOCUMENT_NOT_FOUND' });
    expect(repository.findOwned).toHaveBeenCalledWith(
      'someone-elses-doc',
      'org-1',
      'patient-1',
    );
  });

  it('signs only the key it found on the caller’s own row', async () => {
    const { service, repository, storage } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({ fileKey: 'org-1/patient-documents/mine.png' }),
    );

    const original = await service.getOriginalUrl('doc-1', CALLER);

    expect(storage.getReadUrl).toHaveBeenCalledWith(
      'org-1/patient-documents/mine.png',
      300,
    );
    expect(original.url).toContain('X-Amz');
    expect(original.expiresInSeconds).toBe(300);
  });

  it('will not sign anything for a document that is not the caller’s', async () => {
    const { service, repository, storage } = build();
    repository.findOwned.mockResolvedValue(null);

    await expect(service.getOriginalUrl('doc-1', CALLER)).rejects.toMatchObject(
      {
        errorCode: 'PATIENT_DOCUMENT_NOT_FOUND',
      },
    );
    expect(storage.getReadUrl).not.toHaveBeenCalled();
  });
});

describe('verification', () => {
  it('moves a reviewed document to verified', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({ status: 'needs_review' }),
    );
    repository.update.mockResolvedValue(
      documentRow({ status: 'verified', verifiedAt: new Date() }),
    );

    const response = await service.verify('doc-1', CALLER);

    expect(response.status).toBe('verified');
    expect(response.message).toBe(VERIFIED);
  });

  it('refuses to confirm a document that has not been read yet', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({ status: 'processing' }),
    );

    await expect(service.verify('doc-1', CALLER)).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_NOT_READY',
    });
  });
});

describe('the sentence a row says', () => {
  const base = {
    status: 'needs_review',
    duplicateOfId: null,
    failureReason: null,
    extraction: null as unknown,
  };

  it('says a duplicate is a duplicate whatever its status', () => {
    expect(
      messageFor({ ...base, status: 'uploaded', duplicateOfId: 'doc-1' }),
    ).toBe(DUPLICATE_DOCUMENT);
  });

  it('distinguishes "we found something" from "we found nothing"', () => {
    expect(messageFor({ ...base, extraction: { medications: ['x'] } })).toBe(
      AWAITING_REVIEW,
    );
    expect(messageFor({ ...base, extraction: { medications: [] } })).toBe(
      NOTHING_EXTRACTED,
    );
  });

  it('falls back to a sentence when a row failed before one was written', () => {
    const message = messageFor({ ...base, status: 'failed' });

    expect(message).toBe(UNREADABLE_DOCUMENT);
    expect(message).not.toMatch(/undefined|null|Error/);
  });
});
