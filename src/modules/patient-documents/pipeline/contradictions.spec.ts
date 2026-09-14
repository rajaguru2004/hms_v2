import { findContradictions, readExistingRecord } from './contradictions';
import { emptyExtraction, ExtractedDocument } from './extraction-schema';

function prescriptionFor(
  name: string,
  strength: string | null,
  diagnoses: string[] = [],
): ExtractedDocument {
  const extraction = emptyExtraction('prescription');
  extraction.medications = [
    {
      name,
      strength,
      dose: null,
      frequency: null,
      route: null,
      duration: null,
      instructions: null,
      startDate: null,
      stopDate: null,
      uncertain: false,
    },
  ];
  extraction.diagnosesRecorded = diagnoses;
  return extraction;
}

const EMPTY_RECORD = {
  allergies: [],
  chronicConditions: [],
  currentMedications: [],
};

describe('contradiction detection — §20', () => {
  it("flags the specification's own example", () => {
    // Uploaded document: a diabetes medicine. Existing record: hypertension
    // only, no diabetes history.
    const findings = findContradictions(
      prescriptionFor('Metformin', '500 mg', ['Type 2 Diabetes Mellitus']),
      {
        ...EMPTY_RECORD,
        chronicConditions: ['Hypertension'],
        currentMedications: ['Amlodipine 5mg'],
      },
    );

    const diagnosis = findings.find((f) => f.topic === 'diagnoses');
    expect(diagnosis?.kind).toBe('absent_from_record');
    expect(diagnosis?.documentValue).toBe('Type 2 Diabetes Mellitus');
    expect(diagnosis?.recordValues).toEqual(['Hypertension']);
    expect(diagnosis?.recordHadEntries).toBe(true);
    expect(diagnosis?.message).toMatch(/differs from your current record/i);
  });

  it('says nothing when the record already agrees', () => {
    const findings = findContradictions(prescriptionFor('Metformin', null), {
      ...EMPTY_RECORD,
      currentMedications: ['Tab Metformin 500mg (1-0-1)'],
    });

    expect(findings).toEqual([]);
  });

  it('flags a strength that disagrees, when both sides state one', () => {
    const findings = findContradictions(
      prescriptionFor('Metformin', '850 mg'),
      {
        ...EMPTY_RECORD,
        currentMedications: ['Metformin 500 mg'],
      },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('differs_from_record');
  });

  it('does not treat a less specific record entry as a disagreement', () => {
    // "Metformin" is not a different drug from "Metformin 500 mg".
    expect(
      findContradictions(prescriptionFor('Metformin', '500 mg'), {
        ...EMPTY_RECORD,
        currentMedications: ['Metformin'],
      }),
    ).toEqual([]);
  });

  it('marks a first entry as new information rather than a conflict', () => {
    const findings = findContradictions(
      prescriptionFor('Metformin', '500 mg'),
      EMPTY_RECORD,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].recordHadEntries).toBe(false);
  });

  it('never reports the other direction', () => {
    // The record holds a penicillin allergy; this prescription does not mention
    // allergies. That is silence, not disagreement — §19.
    const findings = findContradictions(
      prescriptionFor('Metformin', '500 mg'),
      {
        allergies: ['Penicillin'],
        chronicConditions: ['Type 2 Diabetes Mellitus'],
        currentMedications: ['Metformin 500 mg'],
      },
    );

    expect(findings).toEqual([]);
  });

  it('writes nothing — it only reports', () => {
    const record = {
      ...EMPTY_RECORD,
      chronicConditions: ['Hypertension'],
    };
    const before = JSON.stringify(record);

    findContradictions(
      prescriptionFor('Metformin', '500 mg', ['Diabetes']),
      record,
    );

    expect(JSON.stringify(record)).toBe(before);
  });
});

describe('reading the record out of the columns that hold it', () => {
  it('parses the JSON array the schema documents', () => {
    expect(
      readExistingRecord({ allergies: '["Penicillin","Sulfa"]' }).allergies,
    ).toEqual(['Penicillin', 'Sulfa']);
  });

  it('parses a comma-separated line somebody typed', () => {
    // Dropping this would make every uploaded document disagree with an empty
    // list, which reads as "your record has nothing" to a patient who has two
    // allergies on file.
    expect(
      readExistingRecord({ allergies: 'penicillin, sulfa' }).allergies,
    ).toEqual(['penicillin', 'sulfa']);
  });

  it('flattens an array of objects to the text worth matching', () => {
    expect(
      readExistingRecord({
        currentMedications: '[{"name":"Metformin","dosage":"500 mg"}]',
      }).currentMedications,
    ).toEqual(['Metformin 500 mg']);
  });

  it('reads an absent column as an empty list', () => {
    expect(readExistingRecord({})).toEqual({
      allergies: [],
      chronicConditions: [],
      currentMedications: [],
    });
    expect(readExistingRecord({ allergies: null }).allergies).toEqual([]);
  });
});
