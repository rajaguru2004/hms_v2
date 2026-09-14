// Asserting on a jest.Mocked collaborator reads its methods off the object,
// which is exactly what this rule warns about — and exactly what a mock is
// for. The same header auth.service.spec.ts carries, for the same reason.
/* eslint-disable @typescript-eslint/unbound-method */
import { DocumentLlm } from '../llm/document-llm.port';
import {
  classifyByKeywords,
  classifyDocument,
  scoreDocumentTypes,
} from './classifier';

const PRESCRIPTION = [
  'SUNRISEMULTISPECIALITYCLINIC',
  'PRESCRIPTION',
  'Patient: Ramesh Kumar',
  'Diagnosis: Type 2 Diabetes Mellitus, Hypertension',
  'Rx',
  '1. Tab. METFORMIN 500 mg',
  '1 tablet - twice daily - oral',
  'Follow up: Review after 30 days.',
].join('\n');

const LAB_REPORT = [
  'METROLAB DIAGNOSTICS',
  'COMPLETE BLOOD COUNT',
  'TEST\tRESULT\tUNIT\tREFERENCE',
  'Haemoglobin\t11.2\tg/dL\t13.0 - 17.0',
  'Platelet Count\t250000\t/uL\t150000 - 410000',
  'Referred by: Dr. Anitha Raghavan',
].join('\n');

function llmAnswering(documentType: string): DocumentLlm {
  return {
    extractJson: jest.fn().mockResolvedValue({ documentType }),
    transcribeImage: jest.fn(),
  };
}

function llmThatFails(): DocumentLlm {
  return {
    extractJson: jest.fn().mockRejectedValue(new Error('model is down')),
    transcribeImage: jest.fn(),
  };
}

describe('classifier — the deterministic pass', () => {
  it('reads a prescription from its own vocabulary', () => {
    const result = classifyByKeywords(PRESCRIPTION);
    expect(result.type).toBe('prescription');
    expect(result.method).toBe('layout_keywords');
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it('reads a laboratory report from its table', () => {
    const result = classifyByKeywords(LAB_REPORT);
    expect(result.type).toBe('laboratory_report');
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it('is not fooled into "referral" by a "Referred by" line', () => {
    // A lab report names the doctor who ordered it. That is not a referral
    // letter, and a bare /refer/ pattern would say it was.
    const scores = scoreDocumentTypes(LAB_REPORT);
    expect(scores.laboratory_report).toBeGreaterThan(scores.referral_letter);
  });

  it('answers unknown, not a guess, when nothing matches', () => {
    const result = classifyByKeywords(
      'the quick brown fox jumps over the lazy dog',
    );
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('no_evidence');
  });
});

describe('classifier — when the keywords cannot decide', () => {
  it('does not call the model when they can', async () => {
    const llm = llmAnswering('imaging_report');
    const result = await classifyDocument(PRESCRIPTION, llm);

    expect(result.type).toBe('prescription');
    expect(llm.extractJson).not.toHaveBeenCalled();
  });

  it('asks the model for a document it has no vocabulary for', async () => {
    const llm = llmAnswering('imaging_report');
    const result = await classifyDocument(
      'CHEST PA VIEW\nCardiac silhouette within normal limits.',
      llm,
    );

    expect(llm.extractJson).toHaveBeenCalled();
    expect(result.type).toBe('imaging_report');
    expect(result.method).toBe('model');
  });

  it("keeps the model's answer below the level a keyword match earns", async () => {
    const byModel = await classifyDocument(
      'Something medical.',
      llmAnswering('other'),
    );
    expect(byModel.confidence).toBeLessThan(
      classifyByKeywords(PRESCRIPTION).confidence,
    );
  });

  it('takes unknown for an answer from the model', async () => {
    const result = await classifyDocument('...', llmAnswering('unknown'));
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('does not promote a weak keyword guess when the model is down', async () => {
    const weak = 'Dear Dr Menon';
    const result = await classifyDocument(weak, llmThatFails());

    // The model being unavailable is not evidence about the document.
    expect(result.confidence).toBe(classifyByKeywords(weak).confidence);
    expect(result.confidence).toBeLessThan(0.55);
  });

  it('falls all the way to unknown when there was no evidence either', async () => {
    const result = await classifyDocument('aaaa bbbb cccc', llmThatFails());
    expect(result.type).toBe('unknown');
    expect(result.method).toBe('no_evidence');
  });
});
