// Asserting on a jest.Mocked collaborator reads its methods off the object,
// which is exactly what this rule warns about — and exactly what a mock is
// for. The same header auth.service.spec.ts carries, for the same reason.
/* eslint-disable @typescript-eslint/unbound-method */
import { PatientDocument, Prisma } from '@prisma/client';

import { AuditService } from '../../audit/audit.service';
import { ObjectStorageService } from '../../storage/object-storage.service';
import { CaseTakingRepository } from '../case-taking/case-taking.repository';
import { StoredCorrection } from './document-corrections';
import { PatientDocumentsRepository } from './patient-documents.repository';
import {
  messageFor,
  PatientDocumentsService,
} from './patient-documents.service';
import { DocumentPipelineService } from './pipeline/document-pipeline.service';
import { documentSha256 } from './pipeline/duplicates';
import {
  AWAITING_REVIEW,
  CORRECTION_RECORDED,
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
    corrections: null,
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

/**
 * A small but real extraction envelope. Real enough that a path into it means
 * something: `medications[0].strength` is what the patient taps, and
 * `medications[1].dose` is the slot the model read and found nothing in.
 */
const EXTRACTION = {
  document: { type: 'prescription', date: '2026-09-01' },
  medications: [
    { name: 'Metformin', strength: '500 mg', dose: '1 tablet' },
    { name: 'Amlodipine', strength: '5 mg', dose: null },
  ],
  investigations: [],
  diagnosesRecorded: ['Type 2 diabetes mellitus'],
  allergies: [],
};

function storedCorrection(
  overrides: Partial<StoredCorrection> = {},
): StoredCorrection {
  return {
    path: 'medications[0].strength',
    kind: 'correct',
    originalValue: '500 mg',
    patientValue: '850 mg',
    presence: 'recorded',
    presenceReason: 'extracted_value',
    note: null,
    correctedByUserId: 'user-1',
    correctedAt: '2026-09-15T10:00:00.000Z',
    target: 'document_only',
    documentOnlyReason: 'no_session',
    caseFieldPath: null,
    caseFactId: null,
    supersededFactId: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

/** The corrections array as it was handed to the repository. */
function correctionsWritten(
  repository: jest.Mocked<PatientDocumentsRepository>,
): StoredCorrection[] {
  const update = repository.update.mock.calls[0][1] as {
    corrections?: StoredCorrection[];
  };
  return update.corrections ?? [];
}

interface Harness {
  service: PatientDocumentsService;
  repository: jest.Mocked<PatientDocumentsRepository>;
  storage: jest.Mocked<ObjectStorageService>;
  pipeline: jest.Mocked<DocumentPipelineService>;
  audit: jest.Mocked<AuditService>;
  caseFacts: jest.Mocked<CaseTakingRepository>;
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

  // The real one writes a row and supersedes the previous one in a transaction.
  // Here it only has to hand back a row with an id, because what these tests
  // assert is *which* rows the service asked for and in what order — the
  // supersession itself is `case-taking.repository`'s to prove.
  let nextFactId = 0;
  const caseFacts = {
    listCurrentFacts: jest.fn().mockResolvedValue([]),
    recordFact: jest.fn().mockImplementation(() => {
      nextFactId += 1;
      return Promise.resolve({ id: `fact-${nextFactId}` });
    }),
  } as unknown as jest.Mocked<CaseTakingRepository>;

  return {
    service: new PatientDocumentsService(
      repository,
      storage,
      pipeline,
      audit,
      caseFacts,
    ),
    repository,
    storage,
    pipeline,
    audit,
    caseFacts,
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

  it('settles the outstanding corrections, without discarding them', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({
        status: 'needs_review',
        corrections: [storedCorrection()] as unknown as Prisma.JsonValue,
      }),
    );
    repository.update.mockResolvedValue(documentRow({ status: 'verified' }));

    await service.verify('doc-1', CALLER);

    const written = correctionsWritten(repository);
    expect(written).toHaveLength(1);
    expect(written[0].acknowledgedAt).not.toBeNull();
    // What the patient disputed, and what the page said, both survive being
    // settled. Confirming is a stamp, not an erasure.
    expect(written[0].originalValue).toBe('500 mg');
    expect(written[0].patientValue).toBe('850 mg');
  });

  it('leaves the column alone on a document nobody corrected', async () => {
    // NULL means "nobody has ever corrected this", and `[]` would mean
    // "somebody reviewed it and found nothing to change". Those are different
    // claims and verifying must not silently make the second one.
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({ status: 'needs_review' }),
    );
    repository.update.mockResolvedValue(documentRow({ status: 'verified' }));

    await service.verify('doc-1', CALLER);

    expect(repository.update.mock.calls[0][1]).not.toHaveProperty(
      'corrections',
    );
  });
});

describe('correcting one extracted value', () => {
  const PATH = 'medications[0].strength';

  function reviewed(overrides: Partial<PatientDocument> = {}): PatientDocument {
    return documentRow({
      status: 'needs_review',
      extraction: EXTRACTION as unknown as Prisma.JsonValue,
      ocrConfidence: 0.91,
      processedAt: new Date('2026-09-14T09:05:00.000Z'),
      ...overrides,
    });
  }

  it('records the correction beside the extraction and never inside it', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(reviewed());
    repository.update.mockImplementation((_id, data) =>
      Promise.resolve(reviewed(data as Partial<PatientDocument>)),
    );

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'correct', value: '850 mg' },
      CALLER,
    );

    // The rule the whole feature is shaped by: `extraction` is the record of
    // what the model claimed, and §22's chain needs it to survive the patient
    // disagreeing with it.
    const update = repository.update.mock.calls[0][1];
    expect(update).not.toHaveProperty('extraction');
    expect(update).not.toHaveProperty('ocrText');

    expect(result.correction).toMatchObject({
      path: PATH,
      kind: 'correct',
      originalValue: '500 mg',
      patientValue: '850 mg',
      presence: 'recorded',
      correctedByUserId: 'user-1',
      acknowledgedAt: null,
    });
    expect(result.document.extraction).toEqual(EXTRACTION);
    expect(result.document.hasOutstandingCorrections).toBe(true);
  });

  it('appends rather than replacing, so a second correction keeps the first', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      reviewed({
        corrections: [storedCorrection()] as unknown as Prisma.JsonValue,
      }),
    );
    repository.update.mockResolvedValue(reviewed());

    await service.correctExtraction(
      'doc-1',
      { path: 'medications[0].name', kind: 'correct', value: 'Metformin SR' },
      CALLER,
    );

    const written = correctionsWritten(repository);
    expect(written).toHaveLength(2);
    expect(written[0].path).toBe('medications[0].strength');
    expect(written[1].path).toBe('medications[0].name');
  });

  it('takes a corrected document back out of verified', async () => {
    // §17 keeps verification separate from everything else precisely so this
    // stays answerable: a document the patient has just disputed is not one
    // they have confirmed.
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      reviewed({ status: 'verified', verifiedAt: new Date() }),
    );
    repository.update.mockImplementation((_id, data) =>
      Promise.resolve(reviewed(data as Partial<PatientDocument>)),
    );

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'correct', value: '850 mg' },
      CALLER,
    );

    expect(repository.update.mock.calls[0][1]).toMatchObject({
      status: 'needs_review',
      verifiedAt: null,
    });
    expect(result.document.status).toBe('needs_review');
    expect(result.document.message).toBe(CORRECTION_RECORDED);
  });

  it('refuses a value the document does not hold', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(reviewed());

    await expect(
      service.correctExtraction(
        'doc-1',
        { path: 'medications[7].name', kind: 'correct', value: 'Aspirin' },
        CALLER,
      ),
    ).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_VALUE_NOT_FOUND',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('refuses a correction with nothing in it, and a confirmation with something in it', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(reviewed());

    await expect(
      service.correctExtraction(
        'doc-1',
        { path: PATH, kind: 'correct' },
        CALLER,
      ),
    ).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_CORRECTION_INVALID',
    });

    await expect(
      service.correctExtraction(
        'doc-1',
        { path: PATH, kind: 'confirm', value: '850 mg' },
        CALLER,
      ),
    ).rejects.toMatchObject({
      errorCode: 'PATIENT_DOCUMENT_CORRECTION_INVALID',
    });
  });

  it('refuses a correction to a document that has not been read', async () => {
    const { service, repository } = build();
    repository.findOwned.mockResolvedValue(
      documentRow({ status: 'processing' }),
    );

    await expect(
      service.correctExtraction(
        'doc-1',
        { path: PATH, kind: 'correct', value: '850 mg' },
        CALLER,
      ),
    ).rejects.toMatchObject({ errorCode: 'PATIENT_DOCUMENT_NOT_READY' });
  });

  it('will not correct a document that is not the caller’s', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(null);

    await expect(
      service.correctExtraction(
        'doc-1',
        { path: PATH, kind: 'correct', value: '850 mg' },
        CALLER,
      ),
    ).rejects.toMatchObject({ errorCode: 'PATIENT_DOCUMENT_NOT_FOUND' });
    expect(repository.update).not.toHaveBeenCalled();
    expect(caseFacts.recordFact).not.toHaveBeenCalled();
  });
});

describe('a correction reaching the interview', () => {
  const PATH = 'medications[0].strength';

  function attached(overrides: Partial<PatientDocument> = {}): PatientDocument {
    return documentRow({
      status: 'needs_review',
      sessionId: 'session-1',
      extraction: EXTRACTION as unknown as Prisma.JsonValue,
      ocrConfidence: 0.91,
      processedAt: new Date('2026-09-14T09:05:00.000Z'),
      ...overrides,
    });
  }

  it('records what the document said, then supersedes it with what the patient said', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached());
    repository.update.mockResolvedValue(attached());

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'correct', value: '850 mg' },
      CALLER,
    );

    // Two rows, in this order. The first is the first link of §22's chain —
    // without it a `patient_correction` row says what the patient thinks and
    // loses what they were disagreeing with.
    expect(caseFacts.recordFact).toHaveBeenCalledTimes(2);

    const [documentWrite, patientWrite] = caseFacts.recordFact.mock.calls.map(
      (call) => call[0],
    );

    expect(documentWrite).toMatchObject({
      sessionId: 'session-1',
      row: {
        section: 'medications',
        fieldPath: PATH,
        valueJson: '500 mg',
        presence: 'recorded',
        sourceType: 'uploaded_document',
        sourceRef: 'doc-1',
        verification: 'unverified',
        // The recogniser's measurement, kept as one.
        confidence: 0.91,
      },
    });

    expect(patientWrite).toMatchObject({
      row: {
        fieldPath: PATH,
        valueJson: '850 mg',
        presence: 'recorded',
        sourceType: 'patient_correction',
        verification: 'patient_confirmed',
        // No number is invented for how sure a patient is.
        confidence: null,
      },
    });

    expect(result.correction).toMatchObject({
      target: 'case_fact',
      caseFieldPath: PATH,
      caseFactId: 'fact-2',
      supersededFactId: 'fact-1',
      documentOnlyReason: null,
    });
  });

  it('supersedes the row already holding the path rather than stacking a new one under it', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached());
    repository.update.mockResolvedValue(attached());
    caseFacts.listCurrentFacts.mockResolvedValue([
      { id: 'fact-existing', fieldPath: PATH },
    ] as never);

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'correct', value: '850 mg' },
      CALLER,
    );

    expect(caseFacts.recordFact).toHaveBeenCalledTimes(1);
    expect(result.correction.supersededFactId).toBe('fact-existing');
  });

  it('writes one row for a confirmation, because there is nothing to supersede', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached());
    repository.update.mockResolvedValue(attached());

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'confirm' },
      CALLER,
    );

    expect(caseFacts.recordFact).toHaveBeenCalledTimes(1);
    expect(caseFacts.recordFact.mock.calls[0][0]).toMatchObject({
      row: {
        valueJson: '500 mg',
        // Agreeing with a document does not make the patient its author. What
        // changed is the verification.
        sourceType: 'uploaded_document',
        verification: 'patient_confirmed',
      },
    });
    expect(result.correction.presence).toBe('recorded');
  });

  it('records "not sure" as unknown, attributed to the patient', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached());
    repository.update.mockResolvedValue(attached());

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'unsure' },
      CALLER,
    );

    expect(result.correction.presence).toBe('unknown');
    const calls = caseFacts.recordFact.mock.calls;
    const patientWrite = calls[calls.length - 1][0];
    expect(patientWrite).toMatchObject({
      row: {
        presence: 'unknown',
        valueJson: null,
        sourceType: 'patient_correction',
        // "Not sure" confirms nothing.
        verification: 'unverified',
      },
    });
  });

  it('keeps a correction on the document when there is no interview to update', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached({ sessionId: null }));
    repository.update.mockResolvedValue(attached({ sessionId: null }));

    const result = await service.correctExtraction(
      'doc-1',
      { path: PATH, kind: 'correct', value: '850 mg' },
      CALLER,
    );

    expect(caseFacts.recordFact).not.toHaveBeenCalled();
    expect(result.correction).toMatchObject({
      target: 'document_only',
      documentOnlyReason: 'no_session',
      caseFieldPath: null,
      caseFactId: null,
    });
    // Still a complete record of the disagreement, which is the point.
    expect(result.correction.originalValue).toBe('500 mg');
    expect(result.correction.patientValue).toBe('850 mg');
  });

  it('keeps a corrected diagnosis on the document, because the interview has no slot for one', async () => {
    const { service, repository, caseFacts } = build();
    repository.findOwned.mockResolvedValue(attached());
    repository.update.mockResolvedValue(attached());

    const result = await service.correctExtraction(
      'doc-1',
      {
        path: 'diagnosesRecorded[0]',
        kind: 'correct',
        value: 'Type 2 diabetes',
      },
      CALLER,
    );

    expect(caseFacts.recordFact).not.toHaveBeenCalled();
    expect(result.correction).toMatchObject({
      target: 'document_only',
      documentOnlyReason: 'no_case_field',
    });
  });
});

describe('the sentence a row says', () => {
  const base = {
    status: 'needs_review',
    duplicateOfId: null,
    failureReason: null,
    extraction: null as unknown,
    corrections: null as unknown,
  };

  it('says a duplicate is a duplicate whatever its status', () => {
    expect(
      messageFor({ ...base, status: 'uploaded', duplicateOfId: 'doc-1' }),
    ).toBe(DUPLICATE_DOCUMENT);
  });

  it('gives a duplicate of a rejected copy the reason it was rejected', () => {
    // The loop this closes: a photo is rejected as too small, the patient
    // sends the same file again, dedupe catches it, and the screen says only
    // "we have kept it with the first copy" — which sounds like success. They
    // send it again. Nothing ever tells them to move the camera closer.
    const tooSmall =
      'This image is too small to read. Please take the photo again, ' +
      'holding the camera closer so the page fills the frame.';

    const message = messageFor({
      ...base,
      status: 'uploaded',
      duplicateOfId: 'doc-1',
      duplicateOf: { status: 'rejected_quality', failureReason: tooSmall },
    });

    expect(message).toContain(tooSmall);
    expect(message).not.toBe(DUPLICATE_DOCUMENT);
    // Still told it was a duplicate — §21 is "recorded and told", and the
    // patient should not think this is a different document.
    expect(message).toContain('already sent this document');
  });

  it('never claims a failed copy is safely filed, even with no reason stored', () => {
    const message = messageFor({
      ...base,
      status: 'uploaded',
      duplicateOfId: 'doc-1',
      duplicateOf: { status: 'failed', failureReason: null },
    });

    expect(message).toContain(UNREADABLE_DOCUMENT);
    expect(message).not.toMatch(/undefined|null/);
  });

  it('leaves an ordinary duplicate alone', () => {
    // The original succeeded, so there is nothing to warn about and the plain
    // sentence is the right one.
    expect(
      messageFor({
        ...base,
        status: 'uploaded',
        duplicateOfId: 'doc-1',
        duplicateOf: { status: 'verified', failureReason: null },
      }),
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

  it('answers a patient who has just corrected something, rather than asking again', () => {
    const outstanding = messageFor({
      ...base,
      extraction: { medications: ['x'] },
      corrections: [storedCorrection()],
    });
    expect(outstanding).toBe(CORRECTION_RECORDED);

    // Once it is settled the ordinary prompt comes back.
    expect(
      messageFor({
        ...base,
        extraction: { medications: ['x'] },
        corrections: [
          storedCorrection({ acknowledgedAt: '2026-09-15T11:00:00.000Z' }),
        ],
      }),
    ).toBe(AWAITING_REVIEW);
  });

  it('falls back to a sentence when a row failed before one was written', () => {
    const message = messageFor({ ...base, status: 'failed' });

    expect(message).toBe(UNREADABLE_DOCUMENT);
    expect(message).not.toMatch(/undefined|null|Error/);
  });
});
