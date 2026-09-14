import {
  buildDocumentFacts,
  describeFacts,
  statesAbsence,
} from './document-facts';
import { emptyExtraction, ExtractedDocument } from './extraction-schema';

/**
 * §19, which is the rule this feature is not allowed to get wrong.
 *
 * The OCR text below is the real output of PP-OCRv5 on
 * `test/fixtures/prescription.png`, block order and run-together words
 * included. It matters that it is the real thing: the point of the test is that
 * a document which never mentions allergies produces no claim about allergies,
 * and a tidied-up fixture is a document somebody has already thought about.
 */
const PRESCRIPTION_OCR = [
  'SUNRISEMULTISPECIALITYCLINIC',
  '14 Station Road, Coimbatore 641002·Ph 0422 244 1180',
  'PRESCRIPTION',
  'Patient: Ramesh Kumar',
  'Date: 12/09/2026',
  'Age / Sex: 54 / Male',
  'OP No: OP-2026-11847',
  'Diagnosis: Type 2 Diabetes Mellitus, Hypertension',
  'Rx',
  '1. Tab. METFORMIN 500 mg',
  '1 tablet - twice daily - oral',
  'After food, 30 days',
  '2.',
  'Tab.AMLODIPINE 5 mg',
  '1 tablet - once daily - oral',
  'Morning, 30 days',
  'Advice: Check fasting blood sugar after 2 weeks. Reduce salt intake.',
  'Follow up: Review after 30 days.',
  'Dr.Anitha Raghavan,MD',
].join('\n');

const PROVENANCE = {
  documentId: 'doc-1',
  ocrConfidence: 0.9859,
  recordedAt: '2026-09-14T09:00:00.000Z',
};

function prescriptionExtraction(): ExtractedDocument {
  const extraction = emptyExtraction('prescription');
  extraction.medications = [
    {
      name: 'METFORMIN',
      strength: '500 mg',
      dose: '1 tablet',
      frequency: 'twice daily',
      route: 'oral',
      duration: null,
      instructions: 'After food, 30 days',
      startDate: null,
      stopDate: null,
      uncertain: false,
    },
  ];
  extraction.diagnosesRecorded = ['Type 2 Diabetes Mellitus', 'Hypertension'];
  // The document has no allergy section at all, so the extractor has nothing
  // to put here. This empty array is the exact input §19 is about.
  extraction.allergies = [];
  return extraction;
}

describe('document facts — "not found" is never "no"', () => {
  it('leaves allergies not_assessed for a prescription with no allergy section', () => {
    const facts = buildDocumentFacts(
      prescriptionExtraction(),
      PRESCRIPTION_OCR,
      PROVENANCE,
    );

    expect(facts.allergies.presence).toBe('not_assessed');
    expect(facts.allergies.presence).not.toBe('none');
  });

  it('never labels an unmentioned allergy section "No known allergies"', () => {
    const described = describeFacts(
      buildDocumentFacts(
        prescriptionExtraction(),
        PRESCRIPTION_OCR,
        PROVENANCE,
      ),
    );

    expect(described.allergies.label).toBe(
      'This document does not mention allergies',
    );
    expect(described.allergies.label.toLowerCase()).not.toContain('no known');
    expect(described.allergies.values).toEqual([]);
  });

  it('gives a not_assessed fact no value to read and no provenance to cite', () => {
    const facts = buildDocumentFacts(
      prescriptionExtraction(),
      PRESCRIPTION_OCR,
      PROVENANCE,
    );

    // The engine's structural guarantee, restated from this side: there is no
    // field to accidentally read as a negative, because the shape has none.
    expect(facts.allergies).not.toHaveProperty('value');
    expect(facts.allergies).not.toHaveProperty('provenance');
  });

  it('records what the document did say', () => {
    const facts = buildDocumentFacts(
      prescriptionExtraction(),
      PRESCRIPTION_OCR,
      PROVENANCE,
    );

    expect(facts.medications.presence).toBe('recorded');
    expect(facts.diagnoses.presence).toBe('recorded');
    if (facts.medications.presence !== 'recorded')
      throw new Error('unreachable');
    expect(facts.medications.value).toEqual(['METFORMIN']);
    expect(facts.medications.provenance.source).toBe('uploaded_document');
    expect(facts.medications.provenance.verification).toBe('unverified');
  });

  it('tags the stored confidence as an OCR measurement, not a model opinion', () => {
    const facts = buildDocumentFacts(
      prescriptionExtraction(),
      PRESCRIPTION_OCR,
      PROVENANCE,
    );

    if (facts.medications.presence !== 'recorded')
      throw new Error('unreachable');
    expect(facts.medications.provenance.confidence).toBe(0.9859);
    expect(facts.medications.provenance.confidenceSource).toBe('ocr');
  });
});

describe('document facts — an asserted absence needs the document to assert it', () => {
  it.each([
    'PAST HISTORY\nNo known drug allergies.\nDiabetes since 2019.',
    'Allergies: NKDA',
    'Allergy: Nil',
    'Patient denies any drug allergies.',
  ])('reads %p as the document saying "none"', (text) => {
    const facts = buildDocumentFacts(
      emptyExtraction('discharge_summary'),
      text,
      {
        ...PROVENANCE,
        ocrConfidence: 0.91,
      },
    );

    expect(facts.allergies.presence).toBe('none');
  });

  it('attributes an asserted absence, so it is never unowned', () => {
    const facts = buildDocumentFacts(
      emptyExtraction('discharge_summary'),
      'Allergies: NKDA',
      PROVENANCE,
    );

    if (facts.allergies.presence === 'recorded') throw new Error('unreachable');
    if (facts.allergies.presence === 'not_assessed')
      throw new Error('unreachable');
    expect(facts.allergies.provenance.source).toBe('uploaded_document');
    expect(facts.allergies.provenance.documentId).toBe('doc-1');
  });

  it('labels a stated absence differently from an unmentioned one', () => {
    const stated = describeFacts(
      buildDocumentFacts(
        emptyExtraction('discharge_summary'),
        'Allergies: NKDA',
        PROVENANCE,
      ),
    );
    const silent = describeFacts(
      buildDocumentFacts(
        prescriptionExtraction(),
        PRESCRIPTION_OCR,
        PROVENANCE,
      ),
    );

    expect(stated.allergies.label).toContain('No known allergies');
    expect(silent.allergies.label).not.toContain('No known allergies');
    expect(stated.allergies.label).not.toBe(silent.allergies.label);
  });

  it('does not read "no known allergies" out of an unrelated negative', () => {
    // "No known family history" is a different claim about a different thing,
    // and a looser pattern would harvest it.
    const facts = buildDocumentFacts(
      emptyExtraction('discharge_summary'),
      'No known family history of cardiac disease. Nil by mouth from midnight.',
      PROVENANCE,
    );

    expect(facts.allergies.presence).toBe('not_assessed');
  });

  it('has no explicit-absence vocabulary for diagnoses', () => {
    // A document that lists no diagnosis has not said the patient has none.
    expect(statesAbsence('diagnoses', 'Diagnosis: Nil')).toBe(false);
  });
});

describe('document facts — a model writing "None" is not the document saying so', () => {
  it('drops a denial the model put in the list, and does not promote it to "none"', () => {
    const extraction = emptyExtraction('prescription');
    // The failure mode this guards: asked for a list of allergies from a
    // document that has none, a small model answers with the sentence rather
    // than the empty array.
    extraction.allergies = ['No known allergies'];

    const facts = buildDocumentFacts(extraction, PRESCRIPTION_OCR, PROVENANCE);

    expect(facts.allergies.presence).toBe('not_assessed');
  });

  it('still reaches "none" when the page itself says so', () => {
    const extraction = emptyExtraction('discharge_summary');
    extraction.allergies = ['Nil'];

    const facts = buildDocumentFacts(
      extraction,
      'Drug allergies: Nil. Discharged on Metformin.',
      PROVENANCE,
    );

    expect(facts.allergies.presence).toBe('none');
  });

  it('keeps a real allergy that happens to sit beside a denial', () => {
    const extraction = emptyExtraction('discharge_summary');
    extraction.allergies = ['None', 'Penicillin'];

    const facts = buildDocumentFacts(
      extraction,
      'Allergies: Penicillin (rash).',
      PROVENANCE,
    );

    expect(facts.allergies.presence).toBe('recorded');
    if (facts.allergies.presence !== 'recorded') throw new Error('unreachable');
    expect(facts.allergies.value).toEqual(['Penicillin']);
  });
});
