import {
  ClinicalState,
  applyFact,
  createClinicalState,
  markAsked,
} from './clinical-state';
import { evaluate, evaluateCondition, evaluateRule } from './safety-engine';
import { RULESET_VERSION, RedFlagRule } from './safety-rules';
import {
  Fact,
  FactPresence,
  FactValue,
  NOT_ASSESSED,
  assertedNone,
  declined,
  notApplicable,
  patientUnsure,
  recorded,
} from './tri-state';

const voice = { source: 'patient_voice', verification: 'unverified' } as const;
const record = {
  source: 'existing_record',
  verification: 'clinician_confirmed',
} as const;

function state(entries: Record<string, Fact<FactValue>> = {}): ClinicalState {
  let next = createClinicalState({ sessionId: 's' });
  for (const [path, fact] of Object.entries(entries)) {
    next = applyFact(next, path, fact);
  }
  return next;
}

const firedIds = (s: ClinicalState): string[] =>
  evaluate(s).triggered.map((rule) => rule.ruleId);

/** Every presence that is not an asserted yes, with a label for the test name. */
const NOT_A_YES: ReadonlyArray<readonly [FactPresence, Fact<FactValue>]> = [
  ['not_assessed', NOT_ASSESSED],
  ['none', assertedNone(voice)],
  ['unknown', patientUnsure(voice)],
  ['declined', declined(voice)],
  ['not_applicable', notApplicable(voice)],
];

describe('an empty interview fires nothing', () => {
  it('produces no alerts from a blank state', () => {
    // The single most important property of the whole engine. If absent data
    // could match, every patient would arrive pre-alerted, the triage desk
    // would learn within a week that the alerts mean nothing, and the one real
    // alert would be dismissed with the rest.
    const assessment = evaluate(createClinicalState());
    expect(assessment.triggered).toEqual([]);
    expect(assessment.highestSeverity).toBeNull();
    expect(assessment.patientMessage).toBeNull();
    expect(assessment.rulesetVersion).toBe(RULESET_VERSION);
  });

  it('produces no alerts from a complaint alone', () => {
    expect(
      firedIds(
        state({ 'chief_complaint.symptom': recorded('chest pain', voice) }),
      ),
    ).toEqual([]);
  });
});

describe('conditions match assertions and nothing else', () => {
  it.each(NOT_A_YES)(
    'a "yes" condition does not match a %s fact',
    (_presence, fact) => {
      const outcome = evaluateCondition(
        state({ 'ros.neurological.face_droop': fact }),
        { kind: 'yes', field: 'ros.neurological.face_droop' },
      );
      expect(outcome.matched).toBe(false);
      expect(outcome.facts).toEqual([]);
    },
  );

  it('a "yes" condition matches an asserted yes', () => {
    expect(
      evaluateCondition(
        state({ 'ros.neurological.face_droop': recorded(true, voice) }),
        { kind: 'yes', field: 'ros.neurological.face_droop' },
      ).matched,
    ).toBe(true);
  });

  it.each([
    ['not_assessed', NOT_ASSESSED],
    ['unknown', patientUnsure(voice)],
    ['declined', declined(voice)],
    ['not_applicable', notApplicable(voice)],
  ])('a "no" condition does not match a %s fact either', (_presence, fact) => {
    // The mirror image. "Nobody asked" is not a no any more than it is a yes.
    expect(
      evaluateCondition(state({ 'past_medical.diabetes': fact }), {
        kind: 'no',
        field: 'past_medical.diabetes',
      }).matched,
    ).toBe(false);
  });

  it('a "no" condition matches an asserted negative', () => {
    expect(
      evaluateCondition(
        state({ 'past_medical.diabetes': assertedNone(voice) }),
        { kind: 'no', field: 'past_medical.diabetes' },
      ).matched,
    ).toBe(true);
  });

  it('an "any_yes" condition needs at least one real yes', () => {
    const condition = {
      kind: 'any_yes' as const,
      fields: ['ros.constitutional.fever', 'hpi.associated.fever'],
    };
    expect(
      evaluateCondition(
        state({ 'ros.constitutional.fever': patientUnsure(voice) }),
        condition,
      ).matched,
    ).toBe(false);
    expect(
      evaluateCondition(
        state({ 'hpi.associated.fever': recorded(true, voice) }),
        condition,
      ).matched,
    ).toBe(true);
  });

  it('a "choice" condition does not match an unrecorded fact', () => {
    const condition = {
      kind: 'choice' as const,
      field: 'hpi.onset',
      oneOf: ['sudden'],
    };
    expect(evaluateCondition(state(), condition).matched).toBe(false);
    expect(
      evaluateCondition(state({ 'hpi.onset': patientUnsure(voice) }), condition)
        .matched,
    ).toBe(false);
    expect(
      evaluateCondition(
        state({ 'hpi.onset': recorded('sudden', voice) }),
        condition,
      ).matched,
    ).toBe(true);
  });

  it('a "number" condition refuses to compare against a non-number', () => {
    const condition = {
      kind: 'number' as const,
      field: 'hpi.severity',
      op: 'gte' as const,
      value: 8,
    };
    expect(
      evaluateCondition(
        state({ 'hpi.severity': recorded('quite bad', voice) }),
        condition,
      ).matched,
    ).toBe(false);
    expect(
      evaluateCondition(
        state({ 'hpi.severity': recorded(9, voice) }),
        condition,
      ).matched,
    ).toBe(true);
    // A numeric string is still a number the patient gave us.
    expect(
      evaluateCondition(
        state({ 'hpi.severity': recorded('9', voice) }),
        condition,
      ).matched,
    ).toBe(true);
  });

  it('a "presence" condition is the one that can match absence, on purpose', () => {
    const condition = {
      kind: 'presence' as const,
      field: 'ros.genitourinary.pregnancy_possible',
      presenceIn: ['unknown', 'not_assessed'] as FactPresence[],
    };
    expect(evaluateCondition(state(), condition).matched).toBe(true);
    expect(
      evaluateCondition(
        state({
          'ros.genitourinary.pregnancy_possible': recorded(true, voice),
        }),
        condition,
      ).matched,
    ).toBe(false);
  });
});

describe('ACS triad', () => {
  const chestPain = {
    'chief_complaint.symptom': recorded('chest pain', voice),
  };

  it('fires on §29s combination', () => {
    const assessment = evaluate(
      state({
        ...chestPain,
        'hpi.associated.breathlessness': recorded(true, voice),
        'hpi.associated.sweating': recorded(true, voice),
      }),
    );
    expect(assessment.triggered.map((r) => r.ruleId)).toContain('ACS_TRIAD');
    expect(assessment.highestSeverity).toBe('critical');
  });

  it('fires on sudden onset instead of sweating', () => {
    expect(
      firedIds(
        state({
          ...chestPain,
          'hpi.associated.breathlessness': recorded(true, voice),
          'hpi.onset': recorded('sudden', voice),
        }),
      ),
    ).toContain('ACS_TRIAD');
  });

  it.each(NOT_A_YES)(
    'does not fire when breathlessness is %s',
    (_presence, fact) => {
      // The subtle bug this engine is built around: the rest of the triad is
      // present, and an engine that treats absence as a match would fire.
      expect(
        firedIds(
          state({
            ...chestPain,
            'hpi.associated.breathlessness': fact,
            'hpi.associated.sweating': recorded(true, voice),
            'hpi.onset': recorded('sudden', voice),
          }),
        ),
      ).not.toContain('ACS_TRIAD');
    },
  );

  it('does not fire when nobody has asked about sweating or onset', () => {
    expect(
      firedIds(
        state({
          ...chestPain,
          'hpi.associated.breathlessness': recorded(true, voice),
        }),
      ),
    ).not.toContain('ACS_TRIAD');
  });

  it('does not fire for a complaint that is not cardiac', () => {
    expect(
      firedIds(
        state({
          'chief_complaint.symptom': recorded('itchy rash on my arms', voice),
          'hpi.associated.breathlessness': recorded(true, voice),
          'hpi.associated.sweating': recorded(true, voice),
        }),
      ),
    ).not.toContain('ACS_TRIAD');
  });

  it('records the facts that matched, so the alert can be explained', () => {
    const triggered = evaluate(
      state({
        ...chestPain,
        'hpi.associated.breathlessness': recorded(true, voice),
        'hpi.associated.sweating': recorded(true, voice),
      }),
    ).triggered.find((rule) => rule.ruleId === 'ACS_TRIAD')!;

    const paths = triggered.matched.map((fact) => fact.fieldPath);
    expect(paths).toContain('chief_complaint.symptom');
    expect(paths).toContain('hpi.associated.breathlessness');
    expect(paths).toContain('hpi.associated.sweating');
    for (const fact of triggered.matched) {
      expect(fact.presence).toBe('recorded');
      expect(fact.condition.length).toBeGreaterThan(0);
    }
  });
});

describe('the other screens', () => {
  it('fires the stroke screen on any single FAST sign', () => {
    for (const field of [
      'ros.neurological.face_droop',
      'ros.neurological.arm_weakness',
      'ros.neurological.speech_difficulty',
      'ros.neurological.sudden_vision_loss',
    ]) {
      expect(firedIds(state({ [field]: recorded(true, voice) }))).toContain(
        'STROKE_SIGNS',
      );
    }
  });

  it('does not fire the stroke screen when the signs are merely unasked', () => {
    expect(
      firedIds(
        state({
          'ros.neurological.face_droop': patientUnsure(voice),
          'ros.neurological.arm_weakness': assertedNone(voice),
        }),
      ),
    ).not.toContain('STROKE_SIGNS');
  });

  it('needs the fever before it will call anything a sepsis screen', () => {
    expect(
      firedIds(state({ 'ros.neurological.confusion': recorded(true, voice) })),
    ).not.toContain('SEPSIS_SIGNS');
    expect(
      firedIds(
        state({
          'ros.constitutional.fever': recorded(true, voice),
          'ros.neurological.confusion': recorded(true, voice),
        }),
      ),
    ).toContain('SEPSIS_SIGNS');
  });

  it('fires the anaphylaxis screen on airway involvement during a reaction', () => {
    expect(
      firedIds(
        state({
          'ros.allergic.reaction_happening_now': recorded(true, voice),
          'ros.allergic.throat_or_lip_swelling': recorded(true, voice),
        }),
      ),
    ).toContain('ANAPHYLAXIS');
  });

  it('does not fire the anaphylaxis screen on a rash alone', () => {
    expect(
      firedIds(
        state({
          'ros.dermatological.sudden_widespread_rash': recorded(true, voice),
        }),
      ),
    ).not.toContain('ANAPHYLAXIS');
  });

  it('fires on a self-harm disclosure and on nothing less', () => {
    expect(
      firedIds(
        state({ 'ros.psychiatric.self_harm_thoughts': recorded(true, voice) }),
      ),
    ).toContain('SUICIDAL_IDEATION');
    expect(
      firedIds(state({ 'ros.psychiatric.low_mood': recorded(true, voice) })),
    ).not.toContain('SUICIDAL_IDEATION');
  });

  it('fires the paediatric screen only for a child', () => {
    const signs = { 'ros.paediatric.unrousable': recorded(true, voice) };
    expect(firedIds(state(signs))).not.toContain('PAEDIATRIC_DANGER_SIGNS');
    expect(
      firedIds(
        state({ ...signs, 'social.age_band': recorded('adult', record) }),
      ),
    ).not.toContain('PAEDIATRIC_DANGER_SIGNS');
    expect(
      firedIds(
        state({ ...signs, 'social.age_band': recorded('child', record) }),
      ),
    ).toContain('PAEDIATRIC_DANGER_SIGNS');
  });
});

describe('bleeding in a possible pregnancy — the uncertainty case', () => {
  const bleeding = {
    'ros.genitourinary.vaginal_bleeding': recorded(true, voice),
  };

  it('escalates to critical when pregnancy is confirmed possible', () => {
    const fired = firedIds(
      state({
        ...bleeding,
        'ros.genitourinary.pregnancy_possible': recorded(true, voice),
      }),
    );
    expect(fired).toContain('PREGNANCY_BLEEDING');
    expect(fired).not.toContain('BLEEDING_PREGNANCY_STATUS_UNKNOWN');
  });

  it.each(['not_assessed', 'unknown', 'declined'] as const)(
    'raises the lower-severity "find out" rule when pregnancy is %s',
    (presence) => {
      // Neither "pregnant" (over-triggering on no evidence) nor "not pregnant"
      // (the fabricated negative). The honest answer is a rule of its own.
      const fact: Fact<FactValue> =
        presence === 'not_assessed'
          ? NOT_ASSESSED
          : presence === 'unknown'
            ? patientUnsure(voice)
            : declined(voice);
      const fired = firedIds(
        state({
          ...bleeding,
          ...(presence === 'not_assessed'
            ? {}
            : { 'ros.genitourinary.pregnancy_possible': fact }),
        }),
      );
      expect(fired).toContain('BLEEDING_PREGNANCY_STATUS_UNKNOWN');
      expect(fired).not.toContain('PREGNANCY_BLEEDING');
    },
  );

  it('raises neither when the patient says pregnancy is not possible', () => {
    const fired = firedIds(
      state({
        ...bleeding,
        'ros.genitourinary.pregnancy_possible': assertedNone(voice),
      }),
    );
    expect(fired).not.toContain('PREGNANCY_BLEEDING');
    expect(fired).not.toContain('BLEEDING_PREGNANCY_STATUS_UNKNOWN');
  });
});

describe('assessment shape', () => {
  const busy = state({
    'chief_complaint.symptom': recorded('chest pain', voice),
    'hpi.associated.breathlessness': recorded(true, voice),
    'hpi.onset': recorded('sudden', voice),
    'ros.gastrointestinal.blood_in_stool': recorded(true, voice),
  });

  it('shows the patient the most severe message, not all of them', () => {
    const assessment = evaluate(busy);
    expect(assessment.triggered.length).toBeGreaterThan(1);
    expect(assessment.highestSeverity).toBe('critical');
    expect(assessment.patientMessage).toBe(
      assessment.triggered[0].patientMessage,
    );
  });

  it('sorts critical before urgent, then by rule id', () => {
    const severities = evaluate(busy).triggered.map((rule) => rule.severity);
    expect(severities).toEqual(
      [...severities].sort((a, b) => (a === b ? 0 : a === 'critical' ? -1 : 1)),
    );
  });

  it('is pure — the same state gives a byte-identical assessment', () => {
    expect(JSON.stringify(evaluate(busy))).toBe(JSON.stringify(evaluate(busy)));
  });

  it('does not mutate the state it evaluates', () => {
    const before = JSON.stringify(busy);
    evaluate(busy);
    expect(JSON.stringify(busy)).toBe(before);
  });
});

describe('defensive handling of a rule set supplied at runtime', () => {
  it('never fires a rule that has no conditions', () => {
    // `safety-rules.ts` rejects these at load; a deployment override or a test
    // could still hand one in, and "matches everything" would be catastrophic.
    const empty: RedFlagRule = {
      id: 'EMPTY',
      version: 1,
      severity: 'critical',
      title: 'half-written',
      all: [],
      any: [],
      message: 'Please tell the front desk.',
      clinicianSummary: 'x',
      recommendedAction: 'x',
    };
    expect(evaluateRule(createClinicalState(), empty)).toBeNull();
    expect(evaluate(createClinicalState(), [empty]).triggered).toEqual([]);
  });

  it('fires a rule whose "all" is satisfied and whose "any" is empty', () => {
    const rule: RedFlagRule = {
      id: 'SIMPLE',
      version: 2,
      severity: 'urgent',
      title: 'simple',
      all: [{ kind: 'yes', field: 'ros.constitutional.fever' }],
      any: [],
      message: 'Please tell the front desk when you check in.',
      clinicianSummary: 'fever reported',
      recommendedAction: 'observe',
    };
    const fired = evaluate(
      state({ 'ros.constitutional.fever': recorded(true, voice) }),
      [rule],
    );
    expect(fired.triggered).toHaveLength(1);
    expect(fired.triggered[0].ruleVersion).toBe(2);
  });
});

describe('the engine reads facts, not metadata', () => {
  const triad = (confidence?: number) =>
    state({
      'chief_complaint.symptom': recorded('chest pain', {
        ...voice,
        confidence,
        confidenceSource: 'model_self_report',
      }),
      'hpi.associated.breathlessness': recorded(true, {
        ...voice,
        confidence,
        confidenceSource: 'model_self_report',
      }),
      'hpi.associated.sweating': recorded(true, {
        ...voice,
        confidence,
        confidenceSource: 'model_self_report',
      }),
    });

  it('fires identically whatever the model claimed its confidence was', () => {
    // The probe self-reported 0.95 on every fact, including the wrong ones. A
    // safety rule gated on that number is a coin toss in a lab coat, so no
    // condition kind can read it — and this proves the number changes nothing.
    const high = evaluate(triad(0.95));
    const low = evaluate(triad(0.05));
    const absent = evaluate(triad(undefined));
    expect(low.triggered.map((r) => r.ruleId)).toEqual(
      high.triggered.map((r) => r.ruleId),
    );
    expect(absent.triggered.map((r) => r.ruleId)).toEqual(
      high.triggered.map((r) => r.ruleId),
    );
  });

  it('fires identically whatever the verification status is', () => {
    const unverified = state({
      'ros.neurological.face_droop': recorded(true, {
        source: 'patient_voice',
        verification: 'unverified',
      }),
    });
    const disputed = state({
      'ros.neurological.face_droop': recorded(true, {
        source: 'patient_voice',
        verification: 'disputed',
      }),
    });
    // A red flag that waits for confirmation is a red flag that arrives late.
    expect(firedIds(disputed)).toEqual(firedIds(unverified));
  });

  it('cannot see a question that is merely in flight', () => {
    // "Asked, awaiting extraction" says nothing about the patient. Treating it
    // as anything but `not_assessed` here would fire rules on questions whose
    // answers have not come back.
    const asked = markAsked(
      state({ 'chief_complaint.symptom': recorded('chest pain', voice) }),
      'hpi.associated.breathlessness',
    );
    expect(firedIds(asked)).toEqual([]);
    expect(JSON.stringify(evaluate(asked))).toBe(
      JSON.stringify(
        evaluate(
          state({ 'chief_complaint.symptom': recorded('chest pain', voice) }),
        ),
      ),
    );
  });
});
