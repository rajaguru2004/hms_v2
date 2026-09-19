import { harvest, harvestableFields, spanForAsked } from './harvest';
import { createClinicalState, applyFact } from './clinical-state';
import { recorded } from './tri-state';
import { STATIC_FIELDS } from './field-registry';

const provenance = {
  source: 'patient_voice' as const,
  verification: 'unverified' as const,
  recordedAt: '2026-09-19T00:00:00.000Z',
};

/** A state with a known complaint, which is what unlocks the HPI fields. */
function withComplaint(complaint = 'chest pain', language = 'en') {
  const state = createClinicalState({
    sessionId: 's1',
    language,
    inputLanguage: language,
  });
  return applyFact(
    state,
    'chief_complaint.symptom',
    recorded(complaint, provenance),
  );
}

const byPath = (found: readonly { fieldPath: string; span: string }[]) =>
  Object.fromEntries(found.map((f) => [f.fieldPath, f.span]));

const field = (key: string) => {
  const found = STATIC_FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(`${key} left the registry`);
  return found;
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sentence this file was written for
 *
 * "I've had chest pain for three days, it comes and goes, no fever" answers
 * four fields and only one of them was asked. That used to cost a background
 * call to gemma3:4b — eight to twenty seconds, landing two questions late, and
 * only when Ollama happened to be up. It is a vocabulary lookup.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('reading a narrative for the fields it answers', () => {
  it('finds the duration, the timing and the denial', () => {
    const found = byPath(
      harvest({
        state: withComplaint(),
        utterance: 'chest pain for three days, it comes and goes, no fever',
        language: 'en',
        askedFieldPath: 'chief_complaint.symptom',
      }),
    );

    expect(found['hpi.duration']).toBe('chest pain for three days');
    expect(found['hpi.timing']).toBe('it comes and goes');
    expect(found['hpi.associated.fever']).toBe('no fever');
  });

  it('gives each field its own clause, never the whole turn', () => {
    // The entire reason a span exists. Handed the whole turn, `derivePresence`
    // finds the "no" that was meant for the fever and reads the duration as an
    // absence.
    const found = harvest({
      state: withComplaint(),
      utterance: 'three days, no fever',
      language: 'en',
      askedFieldPath: 'chief_complaint.symptom',
    });
    for (const entry of found) {
      expect(entry.span.length).toBeLessThan('three days, no fever'.length);
    }
  });

  it('does not split an idiom that happens to contain "and"', () => {
    // "it comes and goes" split into "it comes" and "goes" lost `hpi.timing`
    // entirely — in the one sentence this file was written for.
    const found = byPath(
      harvest({
        state: withComplaint(),
        utterance: 'it comes and goes',
        language: 'en',
      }),
    );
    expect(found['hpi.timing']).toBe('it comes and goes');
  });

  it('does split two real statements joined by "and"', () => {
    const found = byPath(
      harvest({
        state: withComplaint(),
        utterance: 'it started three days ago and I have no fever',
        language: 'en',
      }),
    );
    expect(found['hpi.duration']).not.toContain('fever');
  });

  it('reads a Tamil narrative the same way', () => {
    const found = byPath(
      harvest({
        state: withComplaint('நெஞ்சு வலி', 'ta'),
        utterance: 'மூணு நாளா இருக்கு, வந்து போகுது',
        language: 'ta',
      }),
    );
    expect(found['hpi.duration']).toBeDefined();
    expect(found['hpi.timing']).toBeDefined();
  });

  it('reads a Hindi narrative the same way', () => {
    const found = byPath(
      harvest({
        state: withComplaint('सीने में दर्द', 'hi'),
        utterance: 'तीन दिन से है, कभी कभी होता है',
        language: 'hi',
      }),
    );
    expect(found['hpi.duration']).toBeDefined();
    expect(found['hpi.timing']).toBeDefined();
  });

  /**
   * The measured failure of the model, which a vocabulary lookup cannot
   * reproduce: `hpi.radiation: "when I walk"` — an aggravating factor filed as
   * a radiation, on a chart, because the model slot-filled eagerly.
   */
  it('never fills a free-text field from a narrative', () => {
    const found = byPath(
      harvest({
        state: withComplaint(),
        utterance: 'chest pain, worse when I walk up the stairs',
        language: 'en',
      }),
    );
    expect(found['hpi.radiation']).toBeUndefined();
    expect(found['hpi.location']).toBeUndefined();
    expect(found['hpi.aggravating_factors']).toBeUndefined();
  });

  it('never harvests the question that was just asked', () => {
    const found = harvest({
      state: withComplaint(),
      utterance: 'three days',
      language: 'en',
      askedFieldPath: 'hpi.duration',
    });
    expect(found.map((f) => f.fieldPath)).not.toContain('hpi.duration');
  });

  it('never harvests a field that already has an answer', () => {
    let state = withComplaint();
    state = applyFact(state, 'hpi.duration', recorded('two weeks', provenance));

    const found = harvest({
      state,
      utterance: 'three days',
      language: 'en',
    });
    expect(found.map((f) => f.fieldPath)).not.toContain('hpi.duration');
  });

  it('never harvests a repeated-group member', () => {
    // `medications[0].name` is addressed by index and a narrative carries none.
    const found = harvest({
      state: withComplaint(),
      utterance: 'I take metformin twice a day for three years',
      language: 'en',
    });
    for (const entry of found) {
      expect(entry.fieldPath).not.toContain('[');
    }
  });

  it('reads nothing out of silence', () => {
    expect(
      harvest({ state: withComplaint(), utterance: '   ', language: 'en' }),
    ).toEqual([]);
  });

  it('caps what one sentence may fill', () => {
    const found = harvest({
      state: withComplaint(),
      utterance:
        'three days, comes and goes, no fever, no sweating, no nausea, ' +
        'no palpitations, no fainting, no breathlessness',
      language: 'en',
    });
    expect(found.length).toBeLessThanOrEqual(6);
  });

  it('lists what a harvest could ever write to', () => {
    const harvestable = harvestableFields(withComplaint()).map((f) => f.key);
    expect(harvestable).toContain('hpi.duration');
    expect(harvestable).toContain('hpi.severity');
    expect(harvestable).toContain('hpi.associated.fever');
    // Free text is asked, never harvested.
    expect(harvestable).not.toContain('hpi.location');
  });
});

describe('the span that answers the question that was asked', () => {
  /**
   * "chest pain for three days, it comes and goes, no fever" was filed against
   * `chief_complaint.symptom` as `none` — an asserted absence of a complaint —
   * because the whole turn was judged, and "no fever" was in it.
   */
  it('gives a free-text field the first clause, not the denial', () => {
    expect(
      spanForAsked(
        'chest pain for three days, it comes and goes, no fever',
        field('chief_complaint.symptom'),
        'en',
      ),
    ).toBe('chest pain for three days');
  });

  it('gives a typed field the clause it can actually read', () => {
    expect(
      spanForAsked(
        'I think on the Tuesday, it started about three days ago',
        field('hpi.duration'),
        'en',
      ),
    ).toBe('it started about three days ago');
  });

  it('leaves a single-clause answer alone', () => {
    // Nothing to choose between, and `applyAnswer`'s own short-answer rule is
    // already right.
    expect(spanForAsked('three days', field('hpi.duration'), 'en')).toBeNull();
  });
});
