import type { CaseFact, CaseTurn } from '@prisma/client';
import { factFromRow, rebuildState, rowDataFromFact } from './case-state';
import { isPending, readFactAt } from './engine/clinical-state';
import {
  isRecorded,
  recorded,
  assertedAbsent,
  NOT_ASSESSED,
} from './engine/tri-state';

/**
 * Rows in, state out — and every degradation pointing the same way.
 *
 * A row this build cannot read must come back as `not_assessed`, never as a
 * best guess at what a corrupted clinical assertion meant. That is the same
 * rule `parseFact` enforces one layer down, applied to the database instead of
 * to model output.
 */

let nextId = 0;

function factRow(overrides: Partial<CaseFact> = {}): CaseFact {
  return {
    id: `f${++nextId}`,
    sessionId: 's1',
    patientId: 'p1',
    section: 'hpi',
    fieldPath: 'hpi.duration',
    valueJson: 'three days',
    presence: 'recorded',
    sourceType: 'patient_text',
    sourceRef: 't1',
    confidence: null,
    verification: 'unverified',
    supersededById: null,
    supersededAt: null,
    createdAt: new Date('2026-09-14T10:00:00Z'),
    ...overrides,
  };
}

function turnRow(overrides: Partial<CaseTurn> = {}): CaseTurn {
  return {
    id: `t${++nextId}`,
    sessionId: 's1',
    sequence: 1,
    role: 'assistant',
    section: 'hpi',
    fieldKey: 'hpi.duration',
    questionText: 'How long?',
    answerRaw: null,
    answerModality: null,
    transcriptConfidence: null,
    audioKey: null,
    llmModel: null,
    latencyMs: null,
    createdAt: new Date('2026-09-14T10:00:00Z'),
    ...overrides,
  };
}

const base = { sessionId: 's1', facts: [], turns: [] };

describe('factFromRow', () => {
  it('reads a recorded value', () => {
    const fact = factFromRow(factRow());
    expect(fact && isRecorded(fact) && fact.value).toBe('three days');
  });

  it('reads an asserted absence with its provenance intact', () => {
    const fact = factFromRow(
      factRow({
        presence: 'unknown',
        valueJson: null,
        sourceType: 'patient_voice',
      }),
    );
    expect(fact?.presence).toBe('unknown');
    expect(fact?.presence !== 'not_assessed' && fact?.provenance.source).toBe(
      'patient_voice',
    );
  });

  /**
   * A presence this build does not recognise is not repaired into the nearest
   * one. The safe reading of a row we cannot understand is "nobody asked".
   */
  it('drops a row with an unrecognised presence', () => {
    expect(factFromRow(factRow({ presence: 'probably_not' }))).toBeNull();
  });

  it('drops a row whose field path is malformed', () => {
    expect(factFromRow(factRow({ fieldPath: '__proto__.x' }))).toBeNull();
  });

  it('drops a recorded row that lost its value', () => {
    // `parseFact` throws rather than defaulting, and a thrown row is dropped: a
    // "recorded" fact with no value is a fabrication wearing a different hat.
    expect(factFromRow(factRow({ valueJson: null }))).toBeNull();
  });

  describe('the two vocabularies', () => {
    /**
     * `schema.prisma` documents `document` and `patient_corrected`; the engine
     * says `uploaded_document` and has no `patient_corrected`. Both fit in an
     * unconstrained String column and only one can be right in the code — the
     * engine's, for the reason the `touch`/`choice` split was settled the same
     * way.
     */
    it('reads the schema comment\'s "document" as the engine\'s uploaded_document', () => {
      const fact = factFromRow(factRow({ sourceType: 'document' }));
      expect(fact?.presence !== 'not_assessed' && fact?.provenance.source).toBe(
        'uploaded_document',
      );
    });

    it('reads a source it cannot place as existing_record, never as patient speech', () => {
      const fact = factFromRow(factRow({ sourceType: 'telepathy' }));
      // Not `patient_voice`: a source we cannot read must not be upgraded into
      // a claim that the patient said it out loud.
      expect(fact?.presence !== 'not_assessed' && fact?.provenance.source).toBe(
        'existing_record',
      );
    });

    it('reads patient_corrected as patient_confirmed, never downwards', () => {
      const fact = factFromRow(factRow({ verification: 'patient_corrected' }));
      expect(
        fact?.presence !== 'not_assessed' && fact?.provenance.verification,
      ).toBe('patient_confirmed');
    });

    it('reads the column default "pending" as unverified', () => {
      const fact = factFromRow(factRow({ verification: 'pending' }));
      expect(
        fact?.presence !== 'not_assessed' && fact?.provenance.verification,
      ).toBe('unverified');
    });
  });

  /**
   * There is no `confidenceSource` column, and a confidence without one is the
   * exact comparison the engine forbids: OCR's character confidence is a
   * measurement, the model's self-report is a constant.
   */
  it('reads a stored confidence as derived, the only thing the column can mean', () => {
    const fact = factFromRow(factRow({ confidence: 0.82 }));
    expect(
      fact?.presence !== 'not_assessed' && fact?.provenance.confidenceSource,
    ).toBe('derived');
  });
});

describe('rowDataFromFact', () => {
  it("writes a recorded value with the engine's vocabulary", () => {
    const row = rowDataFromFact(
      'hpi.duration',
      recorded('three days', {
        source: 'patient_text',
        verification: 'unverified',
      }),
      'turn-1',
    );

    expect(row).toMatchObject({
      section: 'hpi',
      fieldPath: 'hpi.duration',
      valueJson: 'three days',
      presence: 'recorded',
      sourceType: 'patient_text',
      sourceRef: 'turn-1',
      verification: 'unverified',
    });
  });

  it('writes no value for an asserted absence', () => {
    const row = rowDataFromFact(
      'allergies.reported',
      assertedAbsent('unknown', {
        source: 'patient_voice',
        verification: 'unverified',
      }),
    );

    expect(row.presence).toBe('unknown');
    expect(row.valueJson).toBeNull();
  });

  /**
   * The rule that keeps the confidence column interpretable: only a measured
   * confidence is ever written. A model's self-report is dropped on the floor
   * rather than stored as a bare float a later reader could mistake for OCR.
   */
  it("drops a model's self-reported confidence and keeps a measured one", () => {
    const selfReported = rowDataFromFact(
      'hpi.duration',
      recorded('three days', {
        source: 'patient_text',
        verification: 'unverified',
        confidence: 0.95,
        confidenceSource: 'model_self_report',
      }),
    );
    expect(selfReported.confidence).toBeNull();

    const measured = rowDataFromFact(
      'hpi.duration',
      recorded('three days', {
        source: 'patient_voice',
        verification: 'unverified',
        confidence: 0.82,
        confidenceSource: 'derived',
      }),
    );
    expect(measured.confidence).toBe(0.82);
  });

  it('refuses a path outside a known section', () => {
    expect(() =>
      rowDataFromFact(
        'nonsense.thing',
        recorded(1, {
          source: 'patient_text',
          verification: 'unverified',
        }),
      ),
    ).toThrow();
  });
});

describe('rebuildState', () => {
  it('applies facts by path', () => {
    const state = rebuildState({ ...base, facts: [factRow()] });
    const fact = readFactAt(state, 'hpi.duration');
    expect(isRecorded(fact) && fact.value).toBe('three days');
  });

  it('reads an unreadable row back as not assessed rather than dropping the session', () => {
    const state = rebuildState({
      ...base,
      facts: [
        factRow({ presence: 'nonsense' }),
        factRow({ fieldPath: 'hpi.onset', valueJson: 'sudden' }),
      ],
    });

    expect(readFactAt(state, 'hpi.duration')).toEqual(NOT_ASSESSED);
    expect(isRecorded(readFactAt(state, 'hpi.onset'))).toBe(true);
  });

  describe('pending, derived from the turn log', () => {
    /**
     * `pending` is not stored, because both the request handler and a
     * background extraction would have to write it and a lost update there
     * means a question asked twice or never. Derived from append-only rows, it
     * cannot be lost.
     */
    it('marks a question that was asked and not yet answered', () => {
      const state = rebuildState({
        ...base,
        turns: [turnRow({ sequence: 1, fieldKey: 'hpi.duration' })],
      });
      expect(isPending(state, 'hpi.duration')).toBe(true);
    });

    it('releases a question as soon as a fact for it exists', () => {
      const state = rebuildState({
        ...base,
        facts: [factRow()],
        turns: [turnRow({ sequence: 1, fieldKey: 'hpi.duration' })],
      });
      expect(isPending(state, 'hpi.duration')).toBe(false);
    });

    it("ignores the patient's own turns", () => {
      const state = rebuildState({
        ...base,
        turns: [
          turnRow({ sequence: 1, role: 'patient', fieldKey: 'hpi.duration' }),
        ],
      });
      // Only a question puts a field in flight. An answer is what takes it out.
      expect(isPending(state, 'hpi.duration')).toBe(false);
    });

    it('ignores a turn that belongs to no field', () => {
      const state = rebuildState({
        ...base,
        turns: [turnRow({ sequence: 1, fieldKey: null })],
      });
      expect(Object.keys(state.pending)).toEqual([]);
    });

    it('survives a turn naming a field path that no longer parses', () => {
      const state = rebuildState({
        ...base,
        turns: [turnRow({ sequence: 1, fieldKey: 'not a path' })],
      });
      expect(Object.keys(state.pending)).toEqual([]);
    });
  });
});
