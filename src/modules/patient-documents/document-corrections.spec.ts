import { FactProvenance } from '../case-taking/engine/tri-state';
import {
  StoredCorrection,
  acknowledgeAll,
  caseFieldPathFor,
  deriveCorrection,
  outstandingCorrections,
  readCorrections,
  readExtractionValue,
} from './document-corrections';

/**
 * What a correction is allowed to be, and what it must never quietly become.
 *
 * Two families of assertion here. The path tests are about reach: a correction
 * addresses a value the document actually holds, and nothing else — not a
 * fabricated field, not a whole medication object, not the prototype chain. The
 * derivation tests are about §19, and the one that matters most is the pair at
 * the bottom: "none" and "not sure" must land on different presences, and
 * neither of them may land on `not_assessed`.
 */

const PROVENANCE: FactProvenance = {
  source: 'patient_correction',
  verification: 'patient_confirmed',
  recordedAt: '2026-09-15T10:00:00.000Z',
  documentId: 'doc-1',
};

const EXTRACTION = {
  document: { type: 'prescription', date: '2026-09-01', facility: null },
  patient: { name: 'A Patient', identifier: null },
  medications: [
    { name: 'Metformin', strength: '500 mg', dose: '1 tablet', route: null },
    { name: 'Amlodipine', strength: '5 mg', dose: null, route: null },
  ],
  investigations: [{ test: 'HbA1c', result: '7.2', referenceRange: '4-6' }],
  diagnosesRecorded: ['Type 2 diabetes mellitus'],
  procedures: [],
  allergies: [],
  admission: null,
};

describe('reading the value a correction names', () => {
  it('finds a value through an object, an index and a field', () => {
    expect(readExtractionValue(EXTRACTION, 'medications[0].strength')).toEqual({
      ok: true,
      value: '500 mg',
    });
    expect(readExtractionValue(EXTRACTION, 'document.date')).toEqual({
      ok: true,
      value: '2026-09-01',
    });
    expect(readExtractionValue(EXTRACTION, 'diagnosesRecorded[0]')).toEqual({
      ok: true,
      value: 'Type 2 diabetes mellitus',
    });
  });

  it('distinguishes "the model read nothing here" from "there is no here"', () => {
    // The slot exists and the model declined to fill it — §11 asks it to return
    // null rather than guess, so this is a real position in the document and a
    // patient may say what belongs in it.
    expect(readExtractionValue(EXTRACTION, 'medications[1].dose')).toEqual({
      ok: true,
      value: null,
    });

    // No such slot. A correction here would be a client inventing a finding by
    // way of a field name.
    expect(readExtractionValue(EXTRACTION, 'medications[9].dose').ok).toBe(
      false,
    );
    expect(readExtractionValue(EXTRACTION, 'medications[0].colour').ok).toBe(
      false,
    );
    expect(readExtractionValue(EXTRACTION, 'allergies[0]').ok).toBe(false);
  });

  it('refuses a whole object or array, because the unit is one value', () => {
    expect(readExtractionValue(EXTRACTION, 'medications[0]').ok).toBe(false);
    expect(readExtractionValue(EXTRACTION, 'medications').ok).toBe(false);
  });

  it('refuses a path that addresses the prototype chain rather than the data', () => {
    for (const path of [
      '__proto__.polluted',
      'medications.constructor',
      'medications[0].__proto__',
      'constructor.prototype',
    ]) {
      expect(readExtractionValue(EXTRACTION, path).ok).toBe(false);
    }
  });

  it('refuses a path that is not a path', () => {
    for (const path of ['', ' ', 'a..b', 'a[', 'a[-1]', '1abc', 'a.b;drop']) {
      expect(readExtractionValue(EXTRACTION, path).ok).toBe(false);
    }
  });

  it('answers safely when the extraction is absent or not an object', () => {
    expect(readExtractionValue(null, 'medications[0].name').ok).toBe(false);
    expect(readExtractionValue('a string', 'medications[0].name').ok).toBe(
      false,
    );
  });
});

describe('which corrections reach the interview', () => {
  it('passes through paths the case engine can address', () => {
    expect(caseFieldPathFor('medications[0].name')).toBe('medications[0].name');
    expect(caseFieldPathFor('allergies[0]')).toBe('allergies[0]');
    expect(caseFieldPathFor('investigations[0].result')).toBe(
      'investigations[0].result',
    );
  });

  it('keeps a recorded diagnosis on the document, because there is no slot for one', () => {
    // `field-registry.ts` has no diagnosis field anywhere, deliberately and
    // with a module-load assertion behind it. Inventing a path here so that a
    // correction had somewhere to land would defeat that.
    expect(caseFieldPathFor('diagnosesRecorded[0]')).toBeNull();
    expect(caseFieldPathFor('procedures[0]')).toBeNull();
  });

  it('keeps facts about the paper on the paper', () => {
    expect(caseFieldPathFor('document.date')).toBeNull();
    expect(caseFieldPathFor('patient.name')).toBeNull();
    expect(caseFieldPathFor('investigations[0].referenceRange')).toBeNull();
  });
});

describe('what a correction asserts', () => {
  it('records the value the patient gave', () => {
    const result = deriveCorrection({
      kind: 'correct',
      originalValue: '500 mg',
      patientValue: '850 mg',
      provenance: PROVENANCE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.presence).toBe('recorded');
    expect(result.outcome.patientValue).toBe('850 mg');
    expect(result.outcome.fact).toMatchObject({
      presence: 'recorded',
      value: '850 mg',
      provenance: { source: 'patient_correction' },
    });
  });

  it('reads "the document is wrong and there is nothing here" as an asserted none', () => {
    // §19's hardest case, and the reason there is no seventh presence. The
    // patient is making a claim — there is nothing — and a claim with an author
    // is `none`. Silence is `not_assessed`, and the two must never meet.
    for (const said of ['none', 'nothing', 'no, nothing like that']) {
      const result = deriveCorrection({
        kind: 'correct',
        originalValue: 'Penicillin',
        patientValue: said,
        provenance: PROVENANCE,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outcome.presence).toBe('none');
      expect(result.outcome.presence).not.toBe('not_assessed');
      expect(result.outcome.patientValue).toBeNull();
    }
  });

  it('reads a patient who does not know as unknown, not as a negative', () => {
    const tapped = deriveCorrection({
      kind: 'unsure',
      originalValue: '500 mg',
      provenance: PROVENANCE,
    });
    expect(tapped.ok).toBe(true);
    if (!tapped.ok) return;
    expect(tapped.outcome.presence).toBe('unknown');
    expect(tapped.outcome.reason).toBe('uncertainty_choice');
    expect(tapped.outcome.patientValue).toBeNull();

    // And the same in words, through the free-text path, so a client that sends
    // the sentence rather than the button lands in the same state.
    const typed = deriveCorrection({
      kind: 'correct',
      originalValue: '500 mg',
      patientValue: "I don't know",
      provenance: PROVENANCE,
    });
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(typed.outcome.presence).toBe('unknown');
  });

  it('confirms with the document’s own value rather than a supplied one', () => {
    const result = deriveCorrection({
      kind: 'confirm',
      originalValue: 'Metformin',
      provenance: { ...PROVENANCE, source: 'uploaded_document' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.fact).toMatchObject({
      presence: 'recorded',
      value: 'Metformin',
      // The patient agreeing with a document does not make them its author —
      // what changed is the verification, which §17 tracks separately.
      provenance: { source: 'uploaded_document' },
    });
    expect(result.outcome.patientValue).toBeNull();
  });

  it('refuses to confirm a value the model never found', () => {
    // Agreeing with silence is exactly how "not found" becomes "no".
    const result = deriveCorrection({
      kind: 'confirm',
      originalValue: null,
      provenance: PROVENANCE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/nothing recorded here to confirm/i);
  });

  it('refuses a correction that reads as nothing at all', () => {
    // Storing it would turn a value the patient was looking at into a hole,
    // which is worse than the misreading they were trying to fix.
    const result = deriveCorrection({
      kind: 'correct',
      originalValue: '500 mg',
      patientValue: '   ',
      provenance: PROVENANCE,
    });

    expect(result.ok).toBe(false);
  });

  it('never produces a fact without a provenance behind it', () => {
    expect(() =>
      deriveCorrection({
        kind: 'correct',
        originalValue: '500 mg',
        patientValue: '850 mg',
        provenance: undefined as unknown as FactProvenance,
      }),
    ).toThrow(/provenance/i);
  });
});

describe('the stored array', () => {
  const correction = (
    overrides: Partial<StoredCorrection> = {},
  ): StoredCorrection => ({
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
  });

  it('reads nothing out of a column that holds nothing', () => {
    expect(readCorrections(null)).toEqual([]);
    expect(readCorrections(undefined)).toEqual([]);
    expect(readCorrections({ not: 'an array' })).toEqual([]);
  });

  it('drops entries it cannot recognise rather than refusing the whole row', () => {
    // A document whose corrections cannot be read must still be readable: the
    // extraction and the original are on the same row, and hiding those to
    // protest about a malformed entry helps nobody.
    expect(
      readCorrections([correction(), { junk: true }, null, 'x']),
    ).toHaveLength(1);
  });

  it('counts only the corrections nobody has confirmed over', () => {
    const rows = [
      correction(),
      correction({ acknowledgedAt: '2026-09-15T11:00:00.000Z' }),
    ];
    expect(outstandingCorrections(rows)).toHaveLength(1);
  });

  it('stamps outstanding corrections rather than removing them', () => {
    const already = '2026-09-15T11:00:00.000Z';
    const settled = acknowledgeAll(
      [correction(), correction({ acknowledgedAt: already })],
      new Date('2026-09-15T12:00:00.000Z'),
    );

    expect(settled).toHaveLength(2);
    expect(settled[0].acknowledgedAt).toBe('2026-09-15T12:00:00.000Z');
    // An earlier acknowledgement is not rewritten: when it was settled is part
    // of the history too.
    expect(settled[1].acknowledgedAt).toBe(already);
    // And the disputed value survives being settled.
    expect(settled[0].originalValue).toBe('500 mg');
  });
});
