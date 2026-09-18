import {
  applyFact,
  clearPending,
  createClinicalState,
  isPending,
  markAsked,
  sectionRank,
  ClinicalState,
} from './clinical-state';
import { STATIC_FIELDS, applicableFields } from './field-registry';
import {
  NO_QUESTION_BUDGET,
  QUESTION_BUDGET,
  askableFields,
  budgetedFields,
  compareFields,
  fallbackPhrasing,
  interviewStatus,
  selectNextAndMarkAsked,
  interviewProgress,
  isComplete,
  outstandingFields,
  selectNext,
  selectNextBatch,
} from './question-selector';
import {
  assertedNone,
  declined,
  notApplicable,
  patientUnsure,
  recorded,
} from './tri-state';

const voice = { source: 'patient_voice', verification: 'unverified' } as const;

function withComplaint(text: string): ClinicalState {
  return applyFact(
    createClinicalState({ sessionId: 's' }),
    'chief_complaint.symptom',
    recorded(text, voice),
  );
}

/** Answer everything that currently applies, so the interview can run out. */
function answerEverything(start: ClinicalState): ClinicalState {
  let state = start;
  for (let pass = 0; pass < 50; pass += 1) {
    const next = selectNext(state);
    if (!next) return state;
    state = applyFact(state, next.field.key, assertedNone(voice));
    expect(isPending(state, next.field.key)).toBe(false);
  }
  throw new Error('interview did not terminate within 50 passes');
}

describe('the question budget', () => {
  /**
   * The reason the budget exists. A real chest-pain session put sixty-nine
   * questions to a patient on a phone; the interview must now stop at ten,
   * whatever the complaint opens up.
   */
  it('never asks more than the budget, whatever the complaint', () => {
    for (const complaint of [
      'chest pain',
      'stomach pain',
      'headache since morning',
      'burning when I pass urine',
      'sore throat',
    ]) {
      const state = withComplaint(complaint);
      expect(budgetedFields(state).length).toBeLessThanOrEqual(QUESTION_BUDGET);
      expect(interviewProgress(state).expected).toBeLessThanOrEqual(
        QUESTION_BUDGET,
      );
    }
  });

  it('runs a whole interview in at most ten questions', () => {
    // End to end through the real selector rather than by counting the set:
    // this is the number the patient actually experiences.
    let state = createClinicalState({ sessionId: 's' });
    const asked: string[] = [];
    for (let pass = 0; pass < 100; pass += 1) {
      const next = selectNext(state);
      if (!next) break;
      asked.push(next.field.key);
      state = applyFact(state, next.field.key, assertedNone(voice));
    }
    expect(asked.length).toBeLessThanOrEqual(QUESTION_BUDGET);
    expect(isComplete(state)).toBe(true);
    expect(interviewProgress(state).percent).toBe(100);
  });

  /**
   * The trap the two sort orders exist to avoid. Ten questions taken in asking
   * order would be the chief complaint and nine HPI slots, and `allergies.
   * reported` — the field this codebase singles out as a permanent hole in a
   * chart when it goes unasked — would never be reached.
   */
  it('spends the budget on the red flags, not on the first section', () => {
    const keys = budgetedFields(withComplaint('chest pain')).map((f) => f.key);
    expect(keys).toContain('allergies.reported');
    expect(keys).toContain('chief_complaint.symptom');
    expect(new Set(keys.map((k) => k.split('.')[0])).size).toBeGreaterThan(2);
  });

  it('still asks them in conversational order', () => {
    // Chosen by weight, asked by section: the budget must not reshuffle the
    // interview into a red-flag-first interrogation.
    const sections = budgetedFields(withComplaint('chest pain')).map(
      (f) => f.section,
    );
    const ranks = sections.map((section) => sectionRank(section));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  /**
   * The monotonicity the progress bar depends on. Answering the chief complaint
   * opens its category's branch, and those fields can outweigh ones already in
   * the budget — so a set recomputed purely by weight could drop a field the
   * patient had already answered, and `addressed` would exceed `expected`.
   */
  it('never drops a field the patient has already answered', () => {
    let state = createClinicalState({ sessionId: 's' });
    const answered: string[] = [];
    for (let pass = 0; pass < 100; pass += 1) {
      const next = selectNext(state);
      if (!next) break;
      state = applyFact(state, next.field.key, assertedNone(voice));
      answered.push(next.field.key);

      const keys = new Set(budgetedFields(state).map((f) => f.key));
      for (const key of answered) expect(keys.has(key)).toBe(true);

      const progress = interviewProgress(state);
      expect(progress.addressed).toBeLessThanOrEqual(progress.expected);
    }
  });

  it('keeps a field that is still in flight inside the budget', () => {
    // Otherwise a question could be asked, fall out of the budget while its
    // extraction was still running, and have its answer land against a field
    // the interview no longer counted.
    const state = markAsked(withComplaint('chest pain'), 'allergies.reported');
    expect(isPending(state, 'allergies.reported')).toBe(true);
    expect(budgetedFields(state).map((f) => f.key)).toContain(
      'allergies.reported',
    );
  });

  /**
   * The inversion this rule exists to prevent: a patient who brings their
   * paperwork getting *fewer* questions about everything the paperwork does not
   * cover. The demo patient with an uploaded prescription and a lab report
   * arrives with nine facts he was never asked for; counted flat, his budget was
   * full before the interview opened its mouth.
   */
  it('does not spend the budget on facts the interview never asked for', () => {
    const fromDocument = {
      source: 'uploaded_document',
      verification: 'unverified',
    } as const;
    const fromRecord = {
      source: 'existing_record',
      verification: 'unverified',
    } as const;

    let state = withComplaint('chest pain');
    const asked = budgetedFields(state).length;

    // Four facts nobody asked for. The budget must not move.
    state = applyFact(
      state,
      'medications.any_current',
      recorded(true, fromDocument),
    );
    state = applyFact(
      state,
      'past_medical.diabetes',
      recorded(true, fromDocument),
    );
    state = applyFact(
      state,
      'past_medical.hypertension',
      recorded(true, fromRecord),
    );
    state = applyFact(state, 'social.age_band', recorded('40_59', fromRecord));

    const after = budgetedFields(state);
    expect(after.length).toBe(asked);
    // And none of them is offered back as a question: they are already answered.
    expect(after.map((f) => f.key)).not.toContain('medications.any_current');
    expect(outstandingFields(state).map((f) => f.key)).not.toContain(
      'past_medical.diabetes',
    );
  });

  it('does spend the budget on an answer the patient actually gave', () => {
    // The other side of the same rule, so it cannot be satisfied by ignoring
    // provenance altogether.
    let state = withComplaint('chest pain');
    const before = outstandingFields(state).length;
    const next = selectNext(state)!;
    state = applyFact(state, next.field.key, assertedNone(voice));
    expect(outstandingFields(state).length).toBe(before - 1);
    expect(budgetedFields(state).map((f) => f.key)).toContain(next.field.key);
  });

  it('leaves the full applicable set reachable for callers that need it', () => {
    // The chart and the extraction menu still read everything: the budget caps
    // what is asked, not what may be recorded.
    const state = withComplaint('chest pain');
    expect(applicableFields(state).length).toBeGreaterThan(QUESTION_BUDGET);
    expect(outstandingFields(state, NO_QUESTION_BUDGET).length).toBeGreaterThan(
      QUESTION_BUDGET,
    );
  });
});

describe('selectNext', () => {
  it('asks what is wrong before it asks anything about it', () => {
    const first = selectNext(createClinicalState());
    expect(first?.field.key).toBe('chief_complaint.symptom');
  });

  it('is identical on every run for the same state', () => {
    const state = withComplaint('chest pain for three days');
    const first = selectNext(state);
    for (let i = 0; i < 50; i += 1) {
      expect(selectNext(state)?.field.key).toBe(first?.field.key);
    }
  });

  it('returns null once nothing applicable is outstanding', () => {
    const finished = answerEverything(withComplaint('sore throat'));
    expect(selectNext(finished)).toBeNull();
    expect(isComplete(finished)).toBe(true);
    expect(interviewProgress(finished).percent).toBe(100);
  });

  it('counts down as the interview proceeds', () => {
    const state = withComplaint('chest pain');
    const before = selectNext(state);
    const after = selectNext(
      applyFact(state, before!.field.key, recorded(true, voice)),
    );
    expect(after!.remaining).toBe(before!.remaining - 1);
  });
});

describe('the selector never asks an irrelevant question', () => {
  it('asks nothing from the GI review of a chest-pain patient', () => {
    const keys = outstandingFields(withComplaint('chest pain')).map(
      (f) => f.key,
    );
    expect(
      keys.filter((key) => key.startsWith('ros.gastrointestinal.')),
    ).toEqual([]);
    expect(keys.filter((key) => key.startsWith('ros.genitourinary.'))).toEqual(
      [],
    );
  });

  it('does ask about radiation, which a chest complaint makes relevant', () => {
    // The mirror of the test above: adaptive means narrowing *and* widening.
    //
    // Unbudgeted, because this is a statement about `appliesWhen` and not about
    // the ten questions the interview can afford. `hpi.radiation` is relevant to
    // a chest complaint and irrelevant to a sore throat whatever the budget is;
    // whether it makes the cut is `budgetedFields`' business, tested separately.
    const keys = outstandingFields(
      withComplaint('chest pain'),
      NO_QUESTION_BUDGET,
    ).map((f) => f.key);
    expect(keys).toContain('hpi.radiation');
    expect(
      outstandingFields(withComplaint('sore throat'), NO_QUESTION_BUDGET).map(
        (f) => f.key,
      ),
    ).not.toContain('hpi.radiation');
  });

  it('never surfaces a question whose appliesWhen is false', () => {
    // The invariant behind every example: the outstanding set is always a
    // subset of the applicable set.
    for (const complaint of [
      'chest pain',
      'stomach pain',
      'headache since morning',
      'itchy rash on my arms',
      'burning when I pass urine',
    ]) {
      const state = withComplaint(complaint);
      const applicable = new Set(applicableFields(state).map((f) => f.key));
      for (const field of outstandingFields(state)) {
        expect(applicable.has(field.key)).toBe(true);
      }
    }
  });

  it('never asks the age band, which is read off the patient record', () => {
    expect(
      outstandingFields(withComplaint('fever')).map((f) => f.key),
    ).not.toContain('social.age_band');
  });
});

describe('the selector never re-asks a question that was answered', () => {
  it.each([
    ['an asserted no', assertedNone(voice)],
    ['patient unsure', patientUnsure(voice)],
    ['prefer not to answer', declined(voice)],
    ['not applicable', notApplicable(voice)],
    ['a recorded yes', recorded(true, voice)],
  ])('treats %s as answered', (_label, fact) => {
    const state = applyFact(
      withComplaint('chest pain'),
      'hpi.associated.breathlessness',
      fact,
    );
    expect(outstandingFields(state).map((f) => f.key)).not.toContain(
      'hpi.associated.breathlessness',
    );
  });

  it('keeps asking a question nobody has reached', () => {
    expect(
      outstandingFields(withComplaint('chest pain')).map((f) => f.key),
    ).toContain('hpi.associated.breathlessness');
  });
});

describe('ordering', () => {
  it('walks the sections in reading order', () => {
    const sections: string[] = outstandingFields(
      withComplaint('chest pain'),
    ).map((f) => f.section);
    const firstIndexOf = (section: string) => sections.indexOf(section);
    expect(firstIndexOf('chief_complaint')).toBeLessThan(firstIndexOf('hpi'));
    expect(firstIndexOf('hpi')).toBeLessThan(firstIndexOf('ros'));
    expect(firstIndexOf('ros')).toBeLessThan(firstIndexOf('allergies'));
  });

  it('puts the red-flag questions first within a section', () => {
    // Breathlessness (weight 90) before duration (weight 40), even though
    // duration has the higher conversational priority.
    //
    // Unbudgeted for the same reason as the relevance test above: this pins the
    // sort key, and `hpi.duration` and `hpi.character` are exactly the kind of
    // narrative field a ten-question interview drops. Ordering has to hold over
    // the whole applicable set or it is not the sort key that is being tested.
    const hpi = outstandingFields(
      withComplaint('chest pain'),
      NO_QUESTION_BUDGET,
    )
      .filter((f) => f.section === 'hpi')
      .map((f) => f.key);
    expect(hpi.indexOf('hpi.associated.breathlessness')).toBeLessThan(
      hpi.indexOf('hpi.duration'),
    );
    expect(hpi.indexOf('hpi.associated.sweating')).toBeLessThan(
      hpi.indexOf('hpi.character'),
    );
  });

  it('breaks ties on the key, so registry order cannot change the interview', () => {
    const twins = STATIC_FIELDS.filter(
      (f) => f.section === 'past_medical' && f.kind === 'boolean',
    );
    const shuffled = [...twins].reverse().sort(compareFields);
    const straight = [...twins].sort(compareFields);
    expect(shuffled.map((f) => f.key)).toEqual(straight.map((f) => f.key));
  });

  it('is a total order — no two fields compare as equal', () => {
    const fields = applicableFields(withComplaint('chest pain'));
    for (let i = 0; i < fields.length; i += 1) {
      for (let j = i + 1; j < fields.length; j += 1) {
        expect(compareFields(fields[i], fields[j])).not.toBe(0);
      }
    }
  });
});

describe('fallback phrasing', () => {
  const byKey = (key: string) => STATIC_FIELDS.find((f) => f.key === key)!;

  it('tells the patient a yes/no question is a yes/no question', () => {
    expect(fallbackPhrasing(byKey('hpi.previous_episodes'))).toBe(
      'Have you had this same problem before? You can answer yes or no.',
    );
  });

  it('reads the choices out, in words rather than in snake_case', () => {
    const phrasing = fallbackPhrasing(byKey('hpi.onset'));
    expect(phrasing).toContain('sudden, gradual or woke up with it');
    expect(phrasing).not.toContain('_');
  });

  it('bounds a scale question', () => {
    expect(fallbackPhrasing(byKey('hpi.severity'))).toContain('0 to 10');
  });

  it('gives an example for a duration', () => {
    expect(fallbackPhrasing(byKey('hpi.duration'))).toContain('three days');
  });

  it('leaves a free-text question alone', () => {
    expect(fallbackPhrasing(byKey('hpi.location'))).toBe(
      byKey('hpi.location').prompt,
    );
  });

  it('is what selectNext hands back, so the offline path is the tested path', () => {
    const next = selectNext(withComplaint('chest pain'))!;
    expect(next.fallbackPrompt).toBe(fallbackPhrasing(next.field));
  });
});

describe('selectNextBatch', () => {
  it('returns the head of the same ordering the voice interview uses', () => {
    const state = withComplaint('chest pain');
    const batch = selectNextBatch(state, 3);
    expect(batch.map((q) => q.field.key)).toEqual(
      outstandingFields(state)
        .slice(0, 3)
        .map((f) => f.key),
    );
  });

  it('copes with a silly limit', () => {
    expect(selectNextBatch(withComplaint('chest pain'), 0)).toEqual([]);
    expect(selectNextBatch(withComplaint('chest pain'), -5)).toEqual([]);
  });
});

describe('the hot path — selecting while extraction is still running', () => {
  const chestPain = () =>
    applyFact(
      createClinicalState({ sessionId: 's' }),
      'chief_complaint.symptom',
      recorded('chest pain', voice),
    );

  it('does not ask the same question twice while its answer is being parsed', () => {
    // Extraction takes eight seconds for a short answer on this card, so the
    // next question is chosen against a state one turn behind. Without the
    // pending filter the patient hears the same question twice in a row, which
    // reads as the system not listening.
    const state = chestPain();
    const first = selectNext(state)!;
    const asked = markAsked(state, first.field.key);
    const second = selectNext(asked)!;
    expect(second.field.key).not.toBe(first.field.key);
  });

  it('still counts the in-flight question as outstanding', () => {
    // It is not answered, only asked. Progress must not jump.
    const state = markAsked(chestPain(), 'hpi.associated.breathlessness');
    expect(outstandingFields(state).map((f) => f.key)).toContain(
      'hpi.associated.breathlessness',
    );
    expect(askableFields(state).map((f) => f.key)).not.toContain(
      'hpi.associated.breathlessness',
    );
  });

  it('keeps the pending question invisible to everything but the selector', () => {
    const state = markAsked(chestPain(), 'allergies.reported');
    // The presence is unchanged, so the safety engine and the renderer see
    // exactly what they saw before the question was asked.
    expect(
      interviewProgress(state).sections.flatMap((s) => s.outstanding),
    ).toContain('allergies.reported');
  });

  it('marks and selects in one step, so the two cannot drift apart', () => {
    const state = chestPain();
    const step = selectNextAndMarkAsked(state)!;
    expect(isPending(step.state, step.question.field.key)).toBe(true);
    expect(selectNext(step.state)!.field.key).not.toBe(step.question.field.key);
  });

  it('puts the question back in the queue when extraction is abandoned', () => {
    const state = chestPain();
    const step = selectNextAndMarkAsked(state)!;
    const released = clearPending(step.state, step.question.field.key);
    expect(selectNext(released)!.field.key).toBe(step.question.field.key);
  });

  it('tells "waiting for extraction" apart from "finished"', () => {
    // Submitting a case as complete while answers are still in the queue loses
    // them silently, so `selectNext` returning null is not enough on its own.
    const finished = answerEverything(withComplaint('sore throat'));
    expect(interviewStatus(finished)).toBe('complete');
    expect(isComplete(finished)).toBe(true);

    const waiting = markAsked(finished, 'hpi.duration');
    expect(selectNext(waiting)).toBeNull();
    expect(interviewStatus(waiting)).toBe('awaiting_extraction');
    expect(isComplete(waiting)).toBe(false);
  });

  it('is ready while there is anything left to ask', () => {
    expect(interviewStatus(chestPain())).toBe('ready');
  });

  it('is fast enough to run in front of the model rather than behind it', () => {
    // The point of a synchronous selector is that the patient hears the next
    // question immediately instead of after the extraction round trip. A budget
    // this loose still catches an accidental O(n^2) or a lost memo.
    const state = chestPain();
    selectNext(state); // warm the per-state category memo
    const started = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) selectNext(state);
    const msPerCall = Number(process.hrtime.bigint() - started) / 1e6 / 200;
    expect(msPerCall).toBeLessThan(5);
  });
});
