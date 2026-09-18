import type { CaseFact, CaseTurn } from '@prisma/client';
import { factFromRow, rebuildState, rowDataFromFact } from './case-state';
import {
  expirePending,
  isPending,
  pendingFieldPaths,
  readFactAt,
} from './engine/clinical-state';
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

/**
 * `now` is pinned half a minute after the fixture rows' own timestamps, so the
 * default rebuild sees a freshly asked question rather than a three-day-old one.
 * Without it every fixture would trip the lost-extraction clock, which is a real
 * behaviour and a terrible default for tests about something else — the tests
 * that do mean to exercise that clock set `now` themselves.
 */
const base = {
  sessionId: 's1',
  facts: [],
  turns: [],
  now: new Date('2026-09-14T10:00:30Z'),
};

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

    /**
     * The deadlock, reproduced from the session that produced it.
     *
     * Two questions were asked and their extractions never landed; twenty-nine
     * more were asked and answered after them. The revision counted only the
     * unanswered ones, so the two lost fields sat at ages 1 and 0 and
     * `expirePending` — which releases at an age above two — could never reach
     * them. With nothing askable and something pending forever, the interview
     * reported `awaiting_extraction` on every load and the patient was left on
     * a screen with no question and no way forward.
     *
     * The ages are what this pins. A staleness measured in questions asked has
     * to see twenty-nine of them.
     */
    it('ages a lost extraction by every question since, not just the unanswered ones', () => {
      const lost = ['past_medical.thyroid_disorder', 'past_medical.epilepsy'];

      // Two questions asked and never answered...
      const turns: CaseTurn[] = lost.map((fieldKey, index) =>
        turnRow({ sequence: index + 1, section: 'past_medical', fieldKey }),
      );
      // ...then twenty-nine that were, all on one field so the fixture stays
      // readable: what matters is the count of asked-and-answered turns after
      // the lost pair, not which fields they were.
      for (let i = 0; i < 29; i += 1) {
        turns.push(
          turnRow({
            sequence: lost.length + i + 1,
            section: 'hpi',
            fieldKey: 'hpi.duration',
          }),
        );
      }

      const state = rebuildState({
        ...base,
        facts: [factRow({ fieldPath: 'hpi.duration' })],
        turns,
      });

      // Still in flight on the raw rebuild — expiry is the loader's job.
      expect(isPending(state, 'past_medical.thyroid_disorder')).toBe(true);
      expect(isPending(state, 'past_medical.epilepsy')).toBe(true);

      // But old enough to be released, which is what was impossible before:
      // the revision counts all 31 questions, so the lost pair sit at ages 30
      // and 29 rather than 1 and 0.
      const released = expirePending(state);
      expect(isPending(released, 'past_medical.thyroid_disorder')).toBe(false);
      expect(isPending(released, 'past_medical.epilepsy')).toBe(false);
      expect(pendingFieldPaths(released)).toEqual([]);
    });

    /**
     * The blind spot at the end of an interview, and the clock that covers it.
     *
     * `expirePending` counts questions, and when everything left is in flight
     * there are no more questions to count — the age freezes and the interview
     * reports `awaiting_extraction` on every load for ever. A restart of the API
     * produces exactly this: the background job lived in the process, and the
     * process is gone.
     */
    it('presumes an extraction lost once it has been in flight too long', () => {
      const asked = new Date('2026-09-17T04:00:00Z');
      const turns = [
        turnRow({
          sequence: 1,
          section: 'hpi',
          fieldKey: 'hpi.onset',
          createdAt: asked,
        }),
      ];

      // Still inside the window the API's own extraction timeout allows.
      const running = rebuildState({
        ...base,
        turns,
        now: new Date(asked.getTime() + 30_000),
      });
      expect(isPending(running, 'hpi.onset')).toBe(true);

      // Well past it: nobody is coming back with this answer.
      const lost = rebuildState({
        ...base,
        turns,
        now: new Date(asked.getTime() + 300_000),
      });
      expect(isPending(lost, 'hpi.onset')).toBe(false);
    });

    it('does not release an answered field on the clock, having already cleared it', () => {
      // The two releases must not fight: an answered field leaves `pending` in
      // the loop, and the clock must find nothing left to do for it.
      const asked = new Date('2026-09-17T04:00:00Z');
      const state = rebuildState({
        ...base,
        facts: [factRow({ fieldPath: 'hpi.duration' })],
        turns: [
          turnRow({ sequence: 1, fieldKey: 'hpi.duration', createdAt: asked }),
        ],
        now: new Date(asked.getTime() + 300_000),
      });
      expect(isPending(state, 'hpi.duration')).toBe(false);
      expect(readFactAt(state, 'hpi.duration').presence).toBe('recorded');
    });

    it('keeps a question asked moments ago in flight', () => {
      // The other half of the same rule. Expiry must not race the extraction it
      // is there to backstop: a field asked on the most recent turn is age
      // zero, and two more questions have to go by before it is released.
      const state = rebuildState({
        ...base,
        turns: [
          turnRow({ sequence: 1, section: 'hpi', fieldKey: 'hpi.onset' }),
        ],
      });
      expect(isPending(expirePending(state), 'hpi.onset')).toBe(true);
    });
  });
});
