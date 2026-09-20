// Asserting on a jest.Mocked collaborator reads its methods off the object,
// which is exactly what this rule warns about — and exactly what a mock is
// for. The same header auth.service.spec.ts carries, for the same reason.
/* eslint-disable @typescript-eslint/unbound-method */
import { DocumentLlm } from '../llm/document-llm.port';
import {
  OcrPage,
  OcrResult,
  SidecarOcrClient,
} from '../ocr/sidecar-ocr.client';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCodes } from '../../../common/exceptions/error-codes';
import { ConfigService } from '@nestjs/config';
import { DocumentPipelineService } from './document-pipeline.service';
import {
  AWAITING_REVIEW,
  EXTRACTION_NOT_SUPPORTED,
  EXTRACTION_UNAVAILABLE,
  IMAGE_TOO_SMALL,
  NO_TEXT_FOUND,
  NOTHING_EXTRACTED,
  PARTIALLY_EXTRACTED,
  UNREADABLE_DOCUMENT,
} from './messages';

/**
 * A config that answers only what it is given, defaulting to enabled.
 *
 * Same shape as `ollama.provider.spec.ts`'s, and for the same reason: the flags
 * are strings because environment variables are, and the production readers
 * compare against the literal `'false'`.
 */
function configWith(values: Record<string, string> = {}): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

/**
 * The pipeline with both models mocked.
 *
 * What is on trial here is the orchestration — which branch runs when, what
 * status comes out, and what sentence a patient is shown — so the OCR sidecar
 * and the language model are both stubs. The live behaviour of the real ones is
 * what `test/verify-patient-documents.ts` is for.
 */

function pngOfSize(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const A_PAGE = pngOfSize(1240, 1754);

function line(text: string, top: number, left = 90): OcrPage['blocks'][number] {
  return {
    text,
    box: [
      [left, top],
      [left + 400, top],
      [left + 400, top + 30],
      [left, top + 30],
    ],
    confidence: 0.98,
  };
}

const PRESCRIPTION_BLOCKS = [
  line('PRESCRIPTION', 100),
  line('Patient: Ramesh Kumar', 150),
  line('Diagnosis: Type 2 Diabetes Mellitus', 200),
  line('Rx', 250),
  line('1. Tab. METFORMIN 500 mg', 300),
  line('1 tablet - twice daily - oral', 350),
];

function ocrReturning(
  blocks: OcrPage['blocks'],
  meanConfidence: number,
): SidecarOcrClient {
  const page: OcrPage = {
    blocks,
    text: blocks.map((b) => b.text).join('\n'),
    meanConfidence,
  };
  const result: OcrResult = {
    pageCount: 1,
    pages: [page],
    engine: 'pp-ocrv5-mobile',
  };
  return {
    read: jest.fn().mockResolvedValue(result),
  } as unknown as SidecarOcrClient;
}

function llmReturning(extraction: Record<string, unknown>): DocumentLlm {
  return {
    extractJson: jest.fn().mockResolvedValue(extraction),
    transcribeImage: jest.fn().mockResolvedValue(''),
  };
}

const METFORMIN = {
  medications: [
    {
      name: 'METFORMIN',
      strength: '500 mg',
      dose: '1 tablet',
      frequency: 'twice daily',
      route: 'oral',
      uncertain: false,
    },
  ],
  diagnosesRecorded: ['Type 2 Diabetes Mellitus'],
  patientName: 'Ramesh Kumar',
};

const INPUT = {
  documentId: 'doc-1',
  bytes: A_PAGE,
  mimeType: 'image/png',
  filename: 'prescription.png',
  record: { allergies: [], chronicConditions: [], currentMedications: [] },
  now: new Date('2026-09-14T09:00:00.000Z'),
};

describe('pipeline — the prescription path', () => {
  it('stops at needs_review and never further', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
    );

    const outcome = await pipeline.run(INPUT);

    // §2: never silently treated as verified clinical truth. There is no input
    // to this method that produces any other successful status.
    expect(outcome.status).toBe('needs_review');
    expect(outcome.docType).toBe('prescription');
    expect(outcome.extraction?.verificationStatus).toBe('unverified');
  });

  it('produces structured medication with provenance', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
    );

    const outcome = await pipeline.run(INPUT);
    const medication = outcome.extraction?.medications[0];

    expect(medication?.name).toBe('METFORMIN');
    expect(medication?.strength).toBe('500 mg');
    expect(medication?.frequency).toBe('twice daily');

    const cited = outcome.extraction?.sources.find(
      (s) => s.field === 'medications[0].name',
    );
    expect(cited?.page).toBe(1);
    expect(cited?.source).toBe('uploaded_document');
    expect(cited?.grounded).toBe(true);
  });

  it('keeps the two confidences as two numbers', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.ocrConfidence).toBe(0.9859);
    expect(outcome.extraction?.confidence.ocr).toBe(0.9859);
    expect(outcome.extraction?.confidence.ocrSource).toBe('measured');
    // Separate fields, and the extraction number is not the OCR one.
    expect(outcome.extraction?.confidence.extraction).not.toBe(0.9859);

    // Two scales now live in `confidence.extraction`, and the discriminator is
    // the only thing that says which. `derived` is never written again — it is
    // kept in the union for rows stored before the deterministic reader.
    expect(['grounding', 'rule_coverage']).toContain(
      outcome.extraction?.confidence.extractionSource,
    );
    expect(outcome.extraction?.confidence.ruleCoverage).not.toBeNull();
  });

  it('labels a rules-only reading as coverage, not as grounding', async () => {
    // The trap this discriminator exists for. Rules values are slices of the
    // OCR text, so the grounding check finds every one of them and reports
    // ~1.0 — a number that measures arithmetic, not evidence. Publishing it
    // unlabelled would silently redefine the column to "1.0 for most rows".
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
      configWith({ MEDIHIVE_DOCUMENT_LLM_ENABLED: 'false' }),
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.extraction?.confidence.extractionSource).toBe(
      'rule_coverage',
    );
    expect(outcome.extraction?.confidence.extraction).toBe(
      outcome.extraction?.confidence.ruleCoverage,
    );
    expect(outcome.extraction?.confidence.grounding).toBe(1);
  });

  it('keeps what the rules read when the model it asked for never answered', async () => {
    // The outage this test exists for: the local model server was up enough to
    // list its models and could not run one, so every extraction threw. The
    // pipeline caught it, substituted an empty extraction, and described that
    // emptiness — a prescription listing three drugs came back to the patient
    // as "This document does not mention medications".
    //
    // The deterministic reader changes what is true here, not what matters.
    // It read the drug off the page, so this is no longer "nobody looked"; the
    // second opinion simply did not arrive. Discarding a real reading because
    // of that would throw away the only reading anybody has.
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      {
        extractJson: jest
          .fn()
          .mockRejectedValue(new Error('model unreachable')),
        transcribeImage: jest.fn().mockResolvedValue(''),
      },
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.status).toBe('needs_review');
    expect(outcome.ocrText).toMatch(/METFORMIN/i);
    expect(outcome.extraction?.medications[0]?.name).toBe('METFORMIN');

    // Partial, not failed — and the row says which, and why.
    expect(outcome.extraction?.extractionFailed).toBeUndefined();
    expect(outcome.extraction?.extractionPartial).toBe(true);
    expect(outcome.extraction?.escalation.modelFailed).toBe(true);
    expect(outcome.extraction?.escalation.modelEnabled).toBe(true);

    // The invariant that survives all of it: never the sentence that claims we
    // read the whole document and found nothing medical in it.
    expect(outcome.message).toBe(PARTIALLY_EXTRACTED);
    expect(outcome.message).not.toBe(NOTHING_EXTRACTED);
  });

  it('still says nobody looked when nobody did', async () => {
    // The original invariant, on the document that can still reach it: a page
    // no rule set applies to, and no model to ask.
    const pipeline = new DocumentPipelineService(
      ocrReturning(
        [
          line('Sri Ganesh Provision Stores', 100),
          line('Sugar 2 kg, Rice 5 kg, Oil 1 L', 150),
          line('Total 840', 200),
        ],
        0.98,
      ),
      {
        extractJson: jest
          .fn()
          .mockRejectedValue(new Error('model unreachable')),
        transcribeImage: jest.fn().mockResolvedValue(''),
      },
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.extraction?.extractionMethod).toBe('none');
    expect(outcome.extraction?.extractionFailed).toBe(true);
    expect(outcome.extraction?.facts).toBeUndefined();
    expect(outcome.message).toBe(EXTRACTION_UNAVAILABLE);
    expect(outcome.message).not.toBe(NOTHING_EXTRACTED);
  });

  it('leaves allergies not_assessed for a prescription that never mentions them', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.extraction?.facts?.allergies.presence).toBe('not_assessed');
    expect(outcome.extraction?.facts?.allergies.label).not.toMatch(/no known/i);
  });

  it('flags a diagnosis the record does not hold', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llmReturning(METFORMIN),
    );

    const outcome = await pipeline.run({
      ...INPUT,
      record: {
        allergies: [],
        chronicConditions: ['Hypertension'],
        currentMedications: ['Amlodipine 5mg'],
      },
    });

    expect(
      outcome.extraction?.contradictions.some(
        (c) => c.topic === 'diagnoses' && c.kind === 'absent_from_record',
      ),
    ).toBe(true);
  });
});

describe('pipeline — the answers that are not a document', () => {
  it('refuses a thumbnail before it costs an OCR pass', async () => {
    const ocr = ocrReturning(PRESCRIPTION_BLOCKS, 0.98);
    const pipeline = new DocumentPipelineService(ocr, llmReturning(METFORMIN));

    const outcome = await pipeline.run({
      ...INPUT,
      bytes: pngOfSize(220, 311),
    });

    expect(outcome.status).toBe('rejected_quality');
    expect(outcome.message).toBe(IMAGE_TOO_SMALL);
    expect(ocr.read).not.toHaveBeenCalled();
  });

  it('answers an unreadable page with a sentence, not an engine message', async () => {
    const pipeline = new DocumentPipelineService(
      ocrReturning([], 0),
      llmReturning({}),
    );

    const outcome = await pipeline.run(INPUT);

    expect(outcome.status).toBe('rejected_quality');
    expect(outcome.message).toBe(NO_TEXT_FOUND);
    // §27, stated as an assertion rather than a convention.
    expect(outcome.message).not.toMatch(
      /PP-?OCR|inference|exception|undefined|null|stack|Error:/i,
    );
  });

  it('turns an OCR failure into a sentence too', async () => {
    const ocr = {
      read: jest
        .fn()
        .mockRejectedValue(
          new AppException(
            UNREADABLE_DOCUMENT,
            ErrorCodes.PATIENT_DOCUMENT_UNREADABLE,
          ),
        ),
    } as unknown as SidecarOcrClient;

    const outcome = await new DocumentPipelineService(
      ocr,
      llmReturning({}),
    ).run(INPUT);

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toBe(UNREADABLE_DOCUMENT);
  });

  it('keeps a readable document whose extraction failed', async () => {
    const llm = {
      extractJson: jest.fn().mockRejectedValue(new Error('model timed out')),
      transcribeImage: jest.fn(),
    } as unknown as DocumentLlm;

    const outcome = await new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.98),
      llm,
    ).run(INPUT);

    // The original is evidence and the OCR text is searchable. Throwing it
    // away because the second model was busy would be the wrong trade — and
    // now there is more to keep than the OCR text, because the deterministic
    // reader had already read the drug before the model was ever asked.
    expect(outcome.status).toBe('needs_review');
    expect(outcome.ocrText).toContain('METFORMIN');
    expect(outcome.extraction?.medications[0]?.strength).toBe('500 mg');

    // NOT `NOTHING_EXTRACTED`, which this asserted until the outage that
    // showed why: that sentence says we read the document and found nothing
    // medical in it, which is a finding. A partial reading has no such finding
    // to report.
    expect(outcome.message).toBe(PARTIALLY_EXTRACTED);
    expect(outcome.extraction?.extractionPartial).toBe(true);
  });
});

describe('pipeline — a deployment with no model', () => {
  /** A complete printed prescription: everything the rules need, nothing more. */
  const COMPLETE_RX = [
    line('SUNRISE MULTISPECIALITY CLINIC', 60),
    line('PRESCRIPTION', 100),
    line('Patient: Ramesh Kumar', 150),
    line('Date: 12/09/2026', 150, 700),
    line('Diagnosis: Type 2 Diabetes Mellitus, Hypertension', 200),
    line('Rx', 250),
    line('1.', 300),
    line('Tab. METFORMIN 500 mg', 300, 140),
    line('1 tablet - twice daily - oral', 350, 140),
    line('After food, 30 days', 400, 140),
    line('Follow up: Review after 30 days.', 460),
    line('Dr. Anitha Raghavan, MD', 520, 760),
  ];

  it('does not ask a model about a document it has already read', async () => {
    // The point of the whole change, and nothing else catches a regression
    // into always-escalating: the model is there for the documents the rules
    // could not account for, and this is not one of them.
    const llm = llmReturning(METFORMIN);
    const outcome = await new DocumentPipelineService(
      ocrReturning(COMPLETE_RX, 0.9859),
      llm,
    ).run(INPUT);

    expect(llm.extractJson).not.toHaveBeenCalled();
    expect(outcome.extraction?.extractionMethod).toBe('rules');
    expect(outcome.extraction?.escalation.reasons).toEqual([]);
    expect(outcome.extraction?.medications[0]?.name).toBe('METFORMIN');
    expect(outcome.message).toBe(AWAITING_REVIEW);
  });

  it('reads a printed prescription with the model switched off', async () => {
    // A GPU-less box. Deterministic extraction alone, and the result is a
    // complete reading rather than a degraded one.
    const llm = llmReturning(METFORMIN);
    const outcome = await new DocumentPipelineService(
      ocrReturning(COMPLETE_RX, 0.9859),
      llm,
      configWith({ MEDIHIVE_DOCUMENT_LLM_ENABLED: 'false' }),
    ).run(INPUT);

    expect(llm.extractJson).not.toHaveBeenCalled();
    expect(outcome.extraction?.escalation.modelEnabled).toBe(false);
    expect(outcome.extraction?.medications[0]?.strength).toBe('500 mg');
    expect(outcome.extraction?.patient.name).toBe('Ramesh Kumar');
    expect(outcome.extraction?.extractionPartial).toBeUndefined();
    expect(outcome.message).toBe(AWAITING_REVIEW);
  });

  it('never calls the model, even on a document it could not finish', async () => {
    const llm = llmReturning(METFORMIN);
    const outcome = await new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llm,
      configWith({ MEDIHIVE_DOCUMENT_LLM_ENABLED: 'false' }),
    ).run(INPUT);

    expect(llm.extractJson).not.toHaveBeenCalled();
    expect(outcome.extraction?.extractionPartial).toBe(true);
    expect(outcome.message).toBe(PARTIALLY_EXTRACTED);

    // Why it is thin is on the row, so a reviewer a month later can tell a
    // hard document apart from a box with the model switched off.
    expect(outcome.extraction?.escalation.reasons).toContain(
      'missing_required',
    );
    expect(outcome.extraction?.escalation.modelEnabled).toBe(false);
    expect(outcome.extraction?.escalation.modelFailed).toBe(false);
    expect(outcome.extraction?.coverage.lineClaim).toBeGreaterThan(0);
  });

  it('does not claim a topic is absent when no rule looked for it', async () => {
    // §19 by a new door. The lab rule set has no allergy pattern, so an empty
    // `allergies` here establishes only that nobody looked — and "this
    // document does not mention allergies" would be manufactured out of a
    // blind spot rather than read off the page.
    const outcome = await new DocumentPipelineService(
      ocrReturning(
        [
          line('METROLAB DIAGNOSTICS', 60),
          line('COMPLETE BLOOD COUNT', 100),
          line('Haemoglobin', 200),
          line('11.2', 200, 600),
          line('g/dL', 200, 800),
          line('13.0 - 17.0', 200, 980),
        ],
        0.98,
      ),
      llmReturning({}),
      configWith({ MEDIHIVE_DOCUMENT_LLM_ENABLED: 'false' }),
    ).run(INPUT);

    const allergies = outcome.extraction?.facts?.allergies;
    expect(allergies?.read).toBe(false);
    expect(allergies?.label).not.toMatch(/does not mention/i);
    expect(allergies?.label).toMatch(/have not read/i);
  });

  it('does not reach for the vision model when vision is switched off', async () => {
    const llm = {
      extractJson: jest.fn().mockResolvedValue({}),
      transcribeImage: jest.fn().mockResolvedValue('Tab. METFORMIN 500 mg'),
    };

    await new DocumentPipelineService(
      ocrReturning([line('blurred', 100)], 0.3),
      llm,
      configWith({ MEDIHIVE_DOCUMENT_VISION_ENABLED: 'false' }),
    ).run(INPUT);

    expect(llm.transcribeImage).not.toHaveBeenCalled();
  });

  it('says so plainly when nothing here can read the document', async () => {
    // No rule set for an unidentified page, and no model to ask. Not
    // EXTRACTION_UNAVAILABLE, whose "just now" promises that trying again
    // will go differently — on this box it will not.
    const outcome = await new DocumentPipelineService(
      ocrReturning(
        [
          line('Sri Ganesh Provision Stores', 100),
          line('Sugar 2 kg, Rice 5 kg, Oil 1 L', 150),
          line('Total 840', 200),
        ],
        0.98,
      ),
      llmReturning({}),
      configWith({ MEDIHIVE_DOCUMENT_LLM_ENABLED: 'false' }),
    ).run(INPUT);

    expect(outcome.extraction?.extractionMethod).toBe('none');
    expect(outcome.message).toBe(EXTRACTION_NOT_SUPPORTED);
    expect(outcome.message).not.toBe(NOTHING_EXTRACTED);
  });
});

describe('pipeline — the vision fallback is a fallback', () => {
  it('is not used when OCR read the page well', async () => {
    const llm = llmReturning(METFORMIN);
    const outcome = await new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.9859),
      llm,
    ).run(INPUT);

    expect(outcome.visionFallbackUsed).toBe(false);
    expect(llm.transcribeImage).not.toHaveBeenCalled();
  });

  it('is used when the recogniser found text and could not read it', async () => {
    const llm = {
      extractJson: jest.fn().mockResolvedValue(METFORMIN),
      transcribeImage: jest
        .fn()
        .mockResolvedValue(
          'PRESCRIPTION\nTab. METFORMIN 500 mg\n1 tablet - twice daily - oral',
        ),
    } as unknown as DocumentLlm;

    const outcome = await new DocumentPipelineService(
      ocrReturning(PRESCRIPTION_BLOCKS, 0.31),
      llm,
    ).run(INPUT);

    expect(llm.transcribeImage).toHaveBeenCalled();
    expect(outcome.visionFallbackUsed).toBe(true);
    expect(outcome.status).toBe('needs_review');
    // The measured number is still the measured number. Using vision does not
    // retroactively improve how well the recogniser read the page.
    expect(outcome.ocrConfidence).toBe(0.31);
  });

  it('is not used on a page where the detector found nothing at all', async () => {
    // Zero regions is a measurement, not a failure to read. Asking a
    // generative model to read a page with nothing on it produces text that no
    // provenance can be attached to.
    const llm = llmReturning({});
    await new DocumentPipelineService(ocrReturning([], 0), llm).run(INPUT);

    expect(llm.transcribeImage).not.toHaveBeenCalled();
  });

  it('is not used on a PDF, which has no pixels to send', async () => {
    const llm = llmReturning({});
    await new DocumentPipelineService(ocrReturning([], 0), llm).run({
      ...INPUT,
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7'),
    });

    expect(llm.transcribeImage).not.toHaveBeenCalled();
  });

  it('discards a vision answer that is a refusal rather than a reading', async () => {
    const llm = {
      extractJson: jest.fn().mockResolvedValue({}),
      transcribeImage: jest
        .fn()
        .mockResolvedValue(
          'Please provide the text from the image. I need the actual text to transcribe it for you.',
        ),
    } as unknown as DocumentLlm;

    const outcome = await new DocumentPipelineService(
      ocrReturning([line('...', 100)], 0.12),
      llm,
    ).run(INPUT);

    expect(outcome.visionFallbackUsed).toBe(false);
    expect(outcome.status).toBe('rejected_quality');
  });
});
