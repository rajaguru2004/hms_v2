import { applyFact, createClinicalState } from './clinical-state';
import {
  COMPLAINT_CATEGORIES,
  STATIC_FIELDS,
  applicableFields,
  classifyComplaint,
  complaintCategories,
  fieldsFor,
  findField,
  validateAnswerFor,
  valueSpecFor,
} from './field-registry';
import { assertedNone, derivePresence, recorded } from './tri-state';

const voice = { source: 'patient_voice', verification: 'unverified' } as const;

function withComplaint(text: string) {
  return applyFact(
    createClinicalState({ sessionId: 's' }),
    'chief_complaint.symptom',
    recorded(text, voice),
  );
}

function applicableKeys(state: ReturnType<typeof withComplaint>): string[] {
  return applicableFields(state).map((field) => field.key);
}

describe('there is no diagnosis slot, anywhere', () => {
  // The registry validates itself at import; these assertions restate the
  // guarantee so that a reader of the spec sees it, and so that the check
  // cannot be quietly deleted from the module without a test going red.
  const forbidden =
    /diagnos|impression|assessment|icd|differential|provisional/i;

  it('has no field key that could hold a diagnosis', () => {
    const offenders = STATIC_FIELDS.filter((field) =>
      forbidden.test(field.key),
    );
    expect(offenders.map((f) => f.key)).toEqual([]);
  });

  it('has no section that could hold one either', () => {
    const sections = new Set(STATIC_FIELDS.map((field) => field.section));
    for (const section of sections) {
      expect(forbidden.test(section)).toBe(false);
    }
  });

  it('keeps the model from asking for one by never offering the slot', () => {
    // Extraction writes by field path. A model that concludes "acute coronary
    // syndrome" can emit the string, but `findField` returns nothing for every
    // name it could plausibly choose, so the caller has nowhere to put it.
    const state = withComplaint('chest pain');
    for (const attempt of [
      'hpi.diagnosis',
      'chief_complaint.diagnosis',
      'past_medical.provisional_diagnosis',
      'investigations.icd_code',
    ]) {
      expect(findField(state, attempt)).toBeUndefined();
    }
  });
});

describe('complaint classification is deterministic', () => {
  it('pulls chest pain into both the cardiac and respiratory reviews', () => {
    // Narrowing to one category here would be this engine quietly deciding the
    // answer. "Chest pain" is cardiac and respiratory until somebody asks.
    expect(classifyComplaint('I have chest pain')).toEqual([
      'cardiac',
      'respiratory',
    ]);
  });

  it('routes abdominal pain to the GI review', () => {
    expect(classifyComplaint('stomach pain for three days')).toContain(
      'gastrointestinal',
    );
    expect(classifyComplaint('stomach pain for three days')).not.toContain(
      'cardiac',
    );
  });

  it('handles the transliterated Tamil in the spec §6 example', () => {
    // A safety net for an un-translated transcript, not a substitute for the
    // translation layer. It fails safe: an extra category asks extra questions.
    expect(classifyComplaint('enakku moonu naala nenju vali irukku')).toContain(
      'cardiac',
    );
    expect(classifyComplaint('vayiru vali')).toContain('gastrointestinal');
  });

  it('says unclassified rather than guessing', () => {
    expect(classifyComplaint('I just feel a bit off')).toEqual([
      'unclassified',
    ]);
  });

  it('returns nothing at all for nothing at all', () => {
    expect(classifyComplaint('')).toEqual([]);
    expect(classifyComplaint(undefined)).toEqual([]);
    expect(classifyComplaint(null)).toEqual([]);
  });

  it('gives the same answer every time, in the same order', () => {
    const once = classifyComplaint('chest pain and breathlessness');
    for (let i = 0; i < 25; i += 1) {
      expect(classifyComplaint('chest pain and breathlessness')).toEqual(once);
    }
  });

  it('lets the touch interface override the pattern match', () => {
    // §10: when the patient picks a complaint from a list, that choice is
    // better evidence than pattern-matching their prose.
    const state = applyFact(
      withComplaint('something in my tummy'),
      'chief_complaint.category',
      recorded('cardiac', {
        source: 'patient_choice',
        verification: 'patient_confirmed',
      }),
    );
    expect(complaintCategories(state)).toEqual(['cardiac']);
  });

  it('ignores an override that names a category it does not have', () => {
    const state = applyFact(
      withComplaint('chest pain'),
      'chief_complaint.category',
      recorded('oncology', voice),
    );
    expect(complaintCategories(state)).toEqual(['cardiac', 'respiratory']);
  });

  it('exposes every category it can return', () => {
    for (const category of COMPLAINT_CATEGORIES) {
      expect(typeof category).toBe('string');
    }
    expect(new Set(COMPLAINT_CATEGORIES).size).toBe(
      COMPLAINT_CATEGORIES.length,
    );
  });
});

describe('appliesWhen is what makes the interview adaptive', () => {
  it('asks nothing but the complaint before the complaint is known', () => {
    expect(applicableKeys(createClinicalState())).toContain(
      'chief_complaint.symptom',
    );
    expect(applicableKeys(createClinicalState())).not.toContain('hpi.onset');
  });

  it('switches on the cardiac and respiratory review for chest pain', () => {
    const keys = applicableKeys(withComplaint('chest pain'));
    expect(keys).toContain('hpi.radiation');
    expect(keys).toContain('hpi.associated.breathlessness');
    expect(keys).toContain('hpi.associated.sweating');
    expect(keys).toContain('ros.cardiovascular.chest_pain');
    expect(keys).toContain('ros.respiratory.breathless_at_rest');
  });

  it('does not ask the GI review about chest pain', () => {
    const keys = applicableKeys(withComplaint('chest pain'));
    expect(
      keys.filter((key) => key.startsWith('ros.gastrointestinal.')),
    ).toEqual([]);
  });

  it('switches on the GI review for abdominal pain, and leaves the heart alone', () => {
    const keys = applicableKeys(withComplaint('stomach pain since yesterday'));
    expect(keys).toContain('ros.gastrointestinal.vomiting_blood');
    expect(keys).toContain('ros.gastrointestinal.black_stools');
    expect(keys).not.toContain('hpi.associated.sweating');
    expect(keys.filter((key) => key.startsWith('ros.cardiovascular.'))).toEqual(
      [],
    );
  });

  it('asks about allergies no matter what the complaint is', () => {
    // There is no presenting complaint for which "we did not get round to
    // allergies" is an acceptable outcome.
    for (const complaint of [
      'chest pain',
      'itchy rash',
      'sore throat',
      'blah',
    ]) {
      expect(applicableKeys(withComplaint(complaint))).toContain(
        'allergies.reported',
      );
    }
  });

  it('unlocks the vaginal bleeding question only on an asserted yes', () => {
    const base = withComplaint('lower stomach pain');
    expect(applicableKeys(base)).toContain(
      'ros.genitourinary.pregnancy_possible',
    );
    expect(applicableKeys(base)).not.toContain(
      'ros.genitourinary.vaginal_bleeding',
    );

    const unsure = applyFact(
      base,
      'ros.genitourinary.pregnancy_possible',
      assertedNone(voice),
    );
    expect(applicableKeys(unsure)).not.toContain(
      'ros.genitourinary.vaginal_bleeding',
    );

    const yes = applyFact(
      base,
      'ros.genitourinary.pregnancy_possible',
      recorded(true, voice),
    );
    expect(applicableKeys(yes)).toContain('ros.genitourinary.vaginal_bleeding');
  });

  it('asks paediatric danger signs only for a child', () => {
    const adult = applyFact(
      withComplaint('fever'),
      'social.age_band',
      recorded('adult', {
        source: 'existing_record',
        verification: 'clinician_confirmed',
      }),
    );
    expect(
      applicableKeys(adult).filter((k) => k.startsWith('ros.paediatric.')),
    ).toEqual([]);

    const child = applyFact(
      withComplaint('fever'),
      'social.age_band',
      recorded('child', {
        source: 'existing_record',
        verification: 'clinician_confirmed',
      }),
    );
    expect(applicableKeys(child)).toContain('ros.paediatric.unrousable');
  });

  it('never asks for the age band, because the record already knows it', () => {
    expect(applicableKeys(withComplaint('fever'))).not.toContain(
      'social.age_band',
    );
    expect(STATIC_FIELDS.some((f) => f.key === 'social.age_band')).toBe(true);
  });
});

describe('AYUSH section', () => {
  const ayush = applyFact(
    withComplaint('joint pain'),
    'ayush.enabled',
    recorded(true, {
      source: 'existing_record',
      verification: 'clinician_confirmed',
    }),
  );

  it('stays switched off for an ordinary consultation', () => {
    expect(
      applicableKeys(withComplaint('joint pain')).filter((k) =>
        k.startsWith('ayush.'),
      ),
    ).toEqual([]);
  });

  it('covers prakriti, agni, koshtha and nidana when enabled', () => {
    const keys = applicableKeys(ayush);
    expect(keys).toContain('ayush.prakriti_build');
    expect(keys).toContain('ayush.agni_appetite');
    expect(keys).toContain('ayush.koshtha_bowel');
    expect(keys).toContain('ayush.nidana_triggers');
  });

  it('asks in plain language and keeps the Sanskrit in the clinician label', () => {
    // §22: the patient-facing experience translates the terminology. A patient
    // asked "what is your prakriti?" cannot answer.
    const sanskrit = /prakriti|agni|koshtha|nidana|vikriti|ahara|vihara|dosha/i;
    for (const field of STATIC_FIELDS.filter((f) => f.section === 'ayush')) {
      expect(sanskrit.test(field.prompt)).toBe(false);
      expect(sanskrit.test(field.label)).toBe(true);
    }
  });
});

describe('repeated groups', () => {
  const base = withComplaint('chest pain');

  it('does not ask about a medicine until the patient says there is one', () => {
    expect(applicableKeys(base)).not.toContain('medications[0].name');
  });

  it('opens the first item as soon as the summary answer is yes', () => {
    const state = applyFact(
      base,
      'medications.any_current',
      recorded(true, voice),
    );
    expect(applicableKeys(state)).toContain('medications[0].name');
    expect(applicableKeys(state)).toContain('medications[0].frequency');
  });

  it('closes the items again if the patient corrects the summary to no', () => {
    // The gate is re-checked against the current state rather than captured at
    // expansion time.
    let state = applyFact(
      base,
      'medications.any_current',
      recorded(true, voice),
    );
    state = applyFact(state, 'medications.any_current', assertedNone(voice));
    expect(applicableKeys(state)).not.toContain('medications[0].name');
  });

  it('grows a second item when the state already mentions one', () => {
    let state = applyFact(
      base,
      'medications.any_current',
      recorded(true, voice),
    );
    state = applyFact(
      state,
      'medications[1].name',
      recorded('metformin', voice),
    );
    const keys = fieldsFor(state).map((f) => f.key);
    expect(keys).toContain('medications[1].strength');
    expect(keys).toContain('medications[0].strength');
  });

  it('numbers later items in the label so the patient knows which one we mean', () => {
    let state = applyFact(
      base,
      'medications.any_current',
      recorded(true, voice),
    );
    state = applyFact(
      state,
      'medications[1].name',
      recorded('metformin', voice),
    );
    expect(findField(state, 'medications[1].name')?.label).toBe('Medicine (2)');
    expect(findField(state, 'medications[0].name')?.label).toBe('Medicine');
  });

  it('opens allergy detail questions only after allergies are reported', () => {
    expect(applicableKeys(base)).not.toContain('allergies[0].substance');
    const state = applyFact(base, 'allergies.reported', recorded(true, voice));
    expect(applicableKeys(state)).toContain('allergies[0].substance');
    expect(applicableKeys(state)).toContain('allergies[0].severity');
  });
});

describe('registry invariants', () => {
  it('gives every askable field a plain-English fallback prompt', () => {
    const askable = STATIC_FIELDS.filter((f) => f.key !== 'social.age_band');
    for (const field of askable) {
      expect(field.prompt.trim().length).toBeGreaterThan(0);
      expect(field.prompt).toMatch(/[?.]$/);
    }
  });

  it('gives every choice field its choices', () => {
    for (const field of STATIC_FIELDS.filter((f) => f.kind === 'choice')) {
      expect(field.choices?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('files every field under the section its path names', () => {
    for (const field of STATIC_FIELDS) {
      expect(field.key.startsWith(field.section)).toBe(true);
    }
  });

  it('has unique keys', () => {
    const keys = STATIC_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every HPI field §14 lists', () => {
    const keys = new Set(STATIC_FIELDS.map((f) => f.key));
    for (const suffix of [
      'onset',
      'duration',
      'location',
      'character',
      'severity',
      'timing',
      'frequency',
      'progression',
      'radiation',
      'aggravating_factors',
      'relieving_factors',
      'previous_episodes',
    ]) {
      expect(keys.has(`hpi.${suffix}`)).toBe(true);
    }
    expect(STATIC_FIELDS.some((f) => f.key.startsWith('hpi.associated.'))).toBe(
      true,
    );
  });

  it('covers every review-of-systems area §15 lists', () => {
    const systems = new Set(
      STATIC_FIELDS.filter((f) => f.section === 'ros').map(
        (f) => f.key.split('.')[1],
      ),
    );
    for (const system of [
      'constitutional',
      'cardiovascular',
      'respiratory',
      'gastrointestinal',
      'neurological',
      'genitourinary',
      'musculoskeletal',
      'dermatological',
    ]) {
      expect(systems.has(system)).toBe(true);
    }
  });
});

describe('fields refuse values that do not fit their shape', () => {
  const chestPain = withComplaint('chest pain, worse when I walk');
  const field = (key: string) => findField(chestPain, key)!;

  it('refuses the aggravating factor the model filed as radiation', () => {
    // The observed failure: gemma3:4b put `hpi.radiation: "when I walk"`.
    // Radiation is about where the pain spreads, not about when it happens.
    const rejected = validateAnswerFor(field('hpi.radiation'), 'when I walk');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toMatch(/aggravating/);
    }
  });

  it('accepts a radiation answer that names a body site, qualifier and all', () => {
    // Rejecting "it goes down my left arm when I walk" would lose real data, so
    // the constraint demands a body site rather than banning temporal words.
    expect(
      validateAnswerFor(
        field('hpi.radiation'),
        'it goes down my left arm when I walk',
      ).ok,
    ).toBe(true);
    expect(
      validateAnswerFor(field('hpi.radiation'), 'no, it stays in one place').ok,
    ).toBe(true);
  });

  it('refuses a location that is not a place', () => {
    expect(validateAnswerFor(field('hpi.location'), 'after meals').ok).toBe(
      false,
    );
    expect(
      validateAnswerFor(field('hpi.location'), 'middle of my chest').ok,
    ).toBe(true);
  });

  it('refuses a severity that is not a rating', () => {
    expect(validateAnswerFor(field('hpi.severity'), 'quite bad').ok).toBe(
      false,
    );
    expect(validateAnswerFor(field('hpi.severity'), 11).ok).toBe(false);
    expect(validateAnswerFor(field('hpi.severity'), 8)).toEqual({
      ok: true,
      value: 8,
    });
  });

  it('refuses a duration that is not a length of time', () => {
    expect(validateAnswerFor(field('hpi.duration'), 'when I walk').ok).toBe(
      false,
    );
    expect(validateAnswerFor(field('hpi.duration'), 'three days').ok).toBe(
      true,
    );
  });

  it('refuses a choice that is not on the list', () => {
    expect(validateAnswerFor(field('hpi.onset'), 'sort of both').ok).toBe(
      false,
    );
    expect(validateAnswerFor(field('hpi.onset'), 'sudden')).toEqual({
      ok: true,
      value: 'sudden',
    });
  });

  it('leaves the field not_assessed when a value is rejected, rather than storing it', () => {
    const derived = derivePresence({
      modality: 'voice',
      field: valueSpecFor(field('hpi.radiation')),
      evidenceSpan: 'when I walk',
      extractedValue: 'when I walk',
    });
    expect(derived.presence).toBe('not_assessed');
    expect(derived.reason).toBe('value_failed_field_shape');
  });

  it('hands derivePresence the same spec the registry declares', () => {
    expect(valueSpecFor(field('hpi.onset'))).toEqual({
      kind: 'choice',
      choices: ['sudden', 'gradual', 'woke_up_with_it'],
      accepts: undefined,
    });
  });
});

describe('complaint classification is memoised without changing its answer', () => {
  it('gives the cached answer and the fresh answer alike', () => {
    const state = withComplaint('chest pain');
    const first = complaintCategories(state);
    expect(complaintCategories(state)).toBe(first); // same array, from the memo
    expect([...complaintCategories(state)]).toEqual(['cardiac', 'respiratory']);
  });

  it("does not leak one state's categories into another", () => {
    const cardiac = withComplaint('chest pain');
    const gastro = withComplaint('stomach pain');
    expect(complaintCategories(cardiac)).not.toEqual(
      complaintCategories(gastro),
    );
  });
});
