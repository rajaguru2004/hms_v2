import {
  applyFact,
  applyFacts,
  computeCompletion,
  computeSectionCompletion,
  createClinicalState,
  factsInSection,
  groupIndices,
  nextGroupIndex,
  parseFieldPath,
  presenceAt,
  readFactAt,
  clearPending,
  expirePending,
  isPending,
  markAsked,
  pendingFieldPaths,
  sectionOf,
  sectionRank,
  SECTION_KEYS,
  SECTION_ORDER,
} from './clinical-state';
import {
  NOT_ASSESSED,
  assertedNone,
  declined,
  patientUnsure,
  recorded,
} from './tri-state';

const voice = { source: 'patient_voice', verification: 'unverified' } as const;

describe('field paths', () => {
  it('accepts the three shapes the interview actually produces', () => {
    expect(parseFieldPath('hpi.onset').section).toBe('hpi');
    expect(parseFieldPath('ros.cardiovascular.chest_pain').section).toBe('ros');
    expect(parseFieldPath('medications[0].name')).toEqual({
      section: 'medications',
      remainder: '[0].name',
      groupIndex: 0,
    });
  });

  it('rejects a bare section with no field', () => {
    expect(() => parseFieldPath('hpi')).toThrow(/malformed/);
  });

  it('rejects a path whose head is not a known section', () => {
    expect(() => parseFieldPath('vitals.pulse')).toThrow(/known section/);
  });

  it('rejects prototype keys outright', () => {
    // `__proto__` is not a section, so it cannot be used as a path at all.
    expect(() => parseFieldPath('__proto__.polluted')).toThrow();
    expect(() => parseFieldPath('constructor.prototype')).toThrow();
  });

  it('orders sections the way a clinician reads a case', () => {
    expect(SECTION_ORDER[0]).toBe('chief_complaint');
    expect([...SECTION_ORDER].sort()).toEqual([...SECTION_KEYS].sort());
    expect(sectionRank('chief_complaint')).toBeLessThan(sectionRank('hpi'));
    expect(sectionRank('hpi')).toBeLessThan(sectionRank('ros'));
  });
});

describe('reading facts', () => {
  it('reads a path nobody wrote as not_assessed', () => {
    const state = createClinicalState({ sessionId: 's' });
    expect(readFactAt(state, 'allergies.reported')).toBe(NOT_ASSESSED);
    expect(presenceAt(state, 'allergies.reported')).toBe('not_assessed');
  });

  it('does not hand back an inherited property as if it were a fact', () => {
    // `facts['toString']` on an ordinary object literal is a Function, and a
    // Function is truthy. Without an own-property check that reaches a caller
    // as a "fact" with no presence at all.
    const state = createClinicalState({ sessionId: 's' });
    expect(readFactAt(state, 'social.toString')).toBe(NOT_ASSESSED);
    expect(presenceAt(state, 'past_medical.constructor')).toBe('not_assessed');
  });

  it('round-trips a fact it was given', () => {
    const state = applyFact(
      createClinicalState(),
      'hpi.onset',
      recorded('sudden', voice),
    );
    expect(readFactAt(state, 'hpi.onset').presence).toBe('recorded');
  });
});

describe('applying facts', () => {
  it('never mutates the state it was given', () => {
    const before = createClinicalState({ sessionId: 's' });
    const after = applyFact(before, 'hpi.severity', recorded(8, voice));

    expect(before.revision).toBe(0);
    expect(after.revision).toBe(1);
    expect(presenceAt(before, 'hpi.severity')).toBe('not_assessed');
    expect(presenceAt(after, 'hpi.severity')).toBe('recorded');
    expect(after).not.toBe(before);
  });

  it('lets a correction replace an earlier answer', () => {
    // §35: the patient can correct anything. The replacement carries the
    // `patient_correction` source, which is what makes the change auditable.
    let state = applyFact(
      createClinicalState(),
      'hpi.severity',
      recorded(8, voice),
    );
    state = applyFact(
      state,
      'hpi.severity',
      recorded(4, {
        source: 'patient_correction',
        verification: 'patient_confirmed',
      }),
    );
    const fact = readFactAt(state, 'hpi.severity');
    expect(fact.presence).toBe('recorded');
    expect(state.revision).toBe(2);
  });

  it('refuses a malformed path rather than storing an unreachable fact', () => {
    expect(() =>
      applyFact(createClinicalState(), 'nonsense', recorded(1, voice)),
    ).toThrow(/malformed/);
  });

  it('refuses something that is not a fact', () => {
    expect(() =>
      applyFact(createClinicalState(), 'hpi.onset', null as never),
    ).toThrow(/requires a Fact/);
  });

  it('applies a batch in order', () => {
    const state = applyFacts(createClinicalState(), [
      { fieldPath: 'chief_complaint.symptom', fact: recorded('cough', voice) },
      { fieldPath: 'hpi.duration', fact: recorded('3 days', voice) },
    ]);
    expect(state.revision).toBe(2);
    expect(factsInSection(state, 'hpi')).toHaveLength(1);
  });
});

describe('repeated groups', () => {
  it('finds the indices in play and the next free one', () => {
    let state = createClinicalState();
    expect(groupIndices(state, 'medications')).toEqual([]);
    expect(nextGroupIndex(state, 'medications')).toBe(0);

    state = applyFact(
      state,
      'medications[0].name',
      recorded('amlodipine', voice),
    );
    state = applyFact(
      state,
      'medications[2].name',
      recorded('metformin', voice),
    );

    expect(groupIndices(state, 'medications')).toEqual([0, 2]);
    expect(nextGroupIndex(state, 'medications')).toBe(3);
  });

  it('does not confuse the summary field with a list item', () => {
    const state = applyFact(
      createClinicalState(),
      'allergies.reported',
      assertedNone(voice),
    );
    expect(groupIndices(state, 'allergies')).toEqual([]);
  });
});

describe('completion', () => {
  const expectations = [
    { key: 'hpi.onset', section: 'hpi' as const },
    { key: 'hpi.severity', section: 'hpi' as const },
    { key: 'allergies.reported', section: 'allergies' as const },
  ];

  it('counts only not_assessed as outstanding', () => {
    // "Unknown" and "prefer not to answer" are finished interview steps. Asking
    // again would turn the interview into an interrogation, and progress would
    // never reach 100%.
    let state = createClinicalState();
    state = applyFact(state, 'hpi.onset', patientUnsure(voice));
    state = applyFact(state, 'hpi.severity', declined(voice));
    state = applyFact(state, 'allergies.reported', assertedNone(voice));

    const report = computeCompletion(state, expectations);
    expect(report.addressed).toBe(3);
    expect(report.percent).toBe(100);
    expect(report.complete).toBe(true);
    expect(report.sections.flatMap((s) => s.outstanding)).toEqual([]);
  });

  it('names what is still outstanding', () => {
    const state = applyFact(
      createClinicalState(),
      'hpi.onset',
      recorded('sudden', voice),
    );
    const report = computeCompletion(state, expectations);
    expect(report.addressed).toBe(1);
    expect(report.percent).toBe(33);
    expect(report.sections.flatMap((s) => s.outstanding)).toEqual([
      'hpi.severity',
      'allergies.reported',
    ]);
  });

  it('reports sections in reading order, not in the order they were asked', () => {
    const report = computeCompletion(createClinicalState(), [
      { key: 'allergies.reported', section: 'allergies' },
      { key: 'hpi.onset', section: 'hpi' },
    ]);
    expect(report.sections.map((s) => s.section)).toEqual(['hpi', 'allergies']);
  });

  it('calls a section with nothing applicable complete, not empty', () => {
    // A chest-pain interview never asks the GI review. If an inapplicable
    // section scored 0%, no interview could ever finish.
    const section = computeSectionCompletion(
      createClinicalState(),
      'ayush',
      expectations,
    );
    expect(section.expected).toBe(0);
    expect(section.percent).toBe(100);
    expect(section.complete).toBe(true);
  });

  it('is 100% when there is nothing applicable at all', () => {
    expect(computeCompletion(createClinicalState(), []).percent).toBe(100);
  });
});

describe('createClinicalState', () => {
  it('validates the paths it is seeded with', () => {
    expect(() =>
      createClinicalState({ facts: { garbage: recorded(1, voice) } }),
    ).toThrow(/malformed/);
  });

  it('starts at revision zero with no facts', () => {
    const state = createClinicalState({ sessionId: 'abc', language: 'ta' });
    expect(state.revision).toBe(0);
    expect(state.language).toBe('ta');
    expect(Object.keys(state.facts)).toEqual([]);
  });

  it('keeps every section key addressable', () => {
    for (const section of SECTION_KEYS) {
      expect(sectionOf(`${section}.probe`)).toBe(section);
    }
  });
});

describe('questions in flight — asked, awaiting extraction', () => {
  it('is not a presence', () => {
    // The crux. "Asked but not yet parsed" is a fact about the pipeline, not
    // about the patient. If it were a seventh presence it would appear in front
    // of every switch in the engine and one of them would eventually read it as
    // an answer.
    const state = markAsked(createClinicalState(), 'allergies.reported');
    expect(readFactAt(state, 'allergies.reported')).toBe(NOT_ASSESSED);
    expect(presenceAt(state, 'allergies.reported')).toBe('not_assessed');
    expect(isPending(state, 'allergies.reported')).toBe(true);
  });

  it('records which questions are in flight, in a stable order', () => {
    let state = markAsked(createClinicalState(), 'hpi.onset');
    state = markAsked(state, 'allergies.reported');
    expect(pendingFieldPaths(state)).toEqual([
      'allergies.reported',
      'hpi.onset',
    ]);
  });

  it('clears the flag when the answer lands', () => {
    let state = markAsked(createClinicalState(), 'hpi.onset');
    state = applyFact(state, 'hpi.onset', recorded('sudden', voice));
    expect(isPending(state, 'hpi.onset')).toBe(false);
  });

  it('clears the flag even when extraction produced nothing usable', () => {
    // The answer came back as `not_assessed` — a slot-filled value that failed
    // its field's shape. The question must become askable again rather than
    // wait forever for a result that has already arrived empty.
    let state = markAsked(createClinicalState(), 'hpi.severity');
    state = applyFact(state, 'hpi.severity', NOT_ASSESSED);
    expect(isPending(state, 'hpi.severity')).toBe(false);
    expect(presenceAt(state, 'hpi.severity')).toBe('not_assessed');
  });

  it('can be released by hand when extraction crashes', () => {
    const state = clearPending(
      markAsked(createClinicalState(), 'hpi.onset'),
      'hpi.onset',
    );
    expect(isPending(state, 'hpi.onset')).toBe(false);
  });

  it('expires anything stuck in flight for too many turns', () => {
    // Without this a lost extraction retires a question forever, and for
    // `allergies.reported` that is a permanent hole nobody is told about.
    let state = markAsked(createClinicalState(), 'allergies.reported');
    state = applyFact(state, 'hpi.onset', recorded('sudden', voice));
    state = applyFact(
      state,
      'hpi.location',
      recorded('centre of chest', voice),
    );
    state = applyFact(state, 'hpi.character', recorded('pressing', voice));

    expect(isPending(state, 'allergies.reported')).toBe(true);
    expect(isPending(expirePending(state, 2), 'allergies.reported')).toBe(
      false,
    );
  });

  it('keeps a recently asked question in flight', () => {
    const state = markAsked(createClinicalState(), 'allergies.reported');
    expect(isPending(expirePending(state, 2), 'allergies.reported')).toBe(true);
  });

  it('does not mutate the state it marks', () => {
    const before = createClinicalState();
    const after = markAsked(before, 'hpi.onset');
    expect(isPending(before, 'hpi.onset')).toBe(false);
    expect(after.revision).toBe(before.revision + 1);
  });

  it('refuses to mark a path that is not a real field path', () => {
    expect(() => markAsked(createClinicalState(), 'nonsense')).toThrow(
      /malformed/,
    );
  });
});
