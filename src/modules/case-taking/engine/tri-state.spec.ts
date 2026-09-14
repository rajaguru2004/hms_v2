import {
  FACT_PRESENCES,
  FactPresence,
  NonRecordedValueError,
  NOT_ASSESSED,
  assertedNone,
  booleanAnswer,
  declined,
  isRecorded,
  notApplicable,
  parseFact,
  presenceLabel,
  presenceOf,
  readFact,
  recorded,
  requireValue,
  patientUnsure,
  AnswerInput,
  FieldValueSpec,
  derivePresence,
  factFromAnswer,
  validateFieldValue,
} from './tri-state';

// A provenance is deliberately tedious to conjure. Every helper below spells one
// out rather than importing a shared fixture, because the cost of writing it is
// the point: you cannot assert a negative in this system without saying who
// asserted it.
const patientSaidSo = {
  source: 'patient_voice',
  verification: 'unverified',
} as const;

/** Runs `run`, returning whatever it threw. Fails the test if it returned. */
function captureThrow(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

describe('presence taxonomy', () => {
  it('carries all six presences from spec §36 and keeps them distinct', () => {
    expect([...FACT_PRESENCES].sort()).toEqual([
      'declined',
      'none',
      'not_applicable',
      'not_assessed',
      'recorded',
      'unknown',
    ]);
    expect(new Set(FACT_PRESENCES).size).toBe(FACT_PRESENCES.length);
  });
});

describe('absence means not_assessed, by construction', () => {
  it('reads a missing fact as not_assessed rather than none', () => {
    expect(presenceOf(undefined)).toBe('not_assessed');
    expect(presenceOf(null)).toBe('not_assessed');
    expect(readFact(undefined).presence).toBe('not_assessed');
  });

  it('exposes a frozen not_assessed singleton that cannot be mutated into none', () => {
    const sneaky = NOT_ASSESSED as unknown as { presence: string };
    expect(() => {
      sneaky.presence = 'none';
    }).toThrow();
    expect(NOT_ASSESSED.presence).toBe('not_assessed');
  });

  it('refuses to build an asserted negative without a source', () => {
    // This is the structural guard. `none` is a clinical claim, so the only way
    // to produce one is to hand over the provenance that backs the claim.
    expect(() =>
      assertedNone(undefined as unknown as typeof patientSaidSo),
    ).toThrow(/provenance/i);
    expect(() =>
      assertedNone({ source: '', verification: 'unverified' } as never),
    ).toThrow(/source/i);
  });
});

describe('readFact is the only door to a value', () => {
  it('yields the value only through the recorded branch', () => {
    const reading = readFact(recorded('3 days', patientSaidSo));
    expect(reading.kind).toBe('value');
    if (reading.kind === 'value') {
      expect(reading.value).toBe('3 days');
    }
  });

  it('gives absent readings no value field at all', () => {
    for (const fact of [
      assertedNone(patientSaidSo),
      patientUnsure(patientSaidSo),
      notApplicable(patientSaidSo),
      declined(patientSaidSo),
      NOT_ASSESSED,
    ]) {
      const reading = readFact(fact);
      expect(reading.kind).toBe('absent');
      expect('value' in reading).toBe(false);
    }
  });

  it('throws rather than inventing a value for a non-recorded fact', () => {
    expect(() => requireValue(NOT_ASSESSED, 'allergies.reported')).toThrow(
      NonRecordedValueError,
    );
    const thrown = captureThrow(() =>
      requireValue(assertedNone(patientSaidSo), 'allergies.reported'),
    );
    expect(thrown).toBeInstanceOf(NonRecordedValueError);
    expect((thrown as NonRecordedValueError).presence).toBe('none');
    expect((thrown as NonRecordedValueError).fieldPath).toBe(
      'allergies.reported',
    );
  });

  it('narrows with isRecorded so callers cannot skip the check', () => {
    const fact = recorded(7, patientSaidSo);
    expect(isRecorded(fact)).toBe(true);
    expect(isRecorded(NOT_ASSESSED)).toBe(false);
    expect(isRecorded(patientUnsure(patientSaidSo))).toBe(false);
  });
});

describe('a not_assessed allergy can never render as "no known allergies"', () => {
  // The single most dangerous bug in the feature. A fabricated "no known
  // allergies" reads to a prescriber as a cleared safety check.
  const ALLERGY_LABELS = { none: 'No known allergies' } as const;

  it('labels an unasked allergy question as Not assessed', () => {
    expect(presenceLabel('not_assessed', ALLERGY_LABELS)).toBe('Not assessed');
  });

  it('gives the "no known allergies" wording to none and to nothing else', () => {
    const claimants = FACT_PRESENCES.filter(
      (presence) =>
        presenceLabel(presence, ALLERGY_LABELS) === 'No known allergies',
    );
    expect(claimants).toEqual(['none']);
  });

  it('keeps every presence label distinguishable from every other', () => {
    const labels = FACT_PRESENCES.map((presence) =>
      presenceLabel(presence, ALLERGY_LABELS),
    );
    expect(new Set(labels).size).toBe(FACT_PRESENCES.length);
  });

  it('never lets an unread allergy fact reach a negative label', () => {
    // The realistic failure: nobody asked, so there is no entry in the state
    // map at all, and a lookup returns undefined.
    const lookup: Record<string, never> = {};
    const label = presenceLabel(
      presenceOf(lookup['allergies.reported']),
      ALLERGY_LABELS,
    );
    expect(label).toBe('Not assessed');
    expect(label).not.toBe('No known allergies');
  });
});

describe('booleanAnswer', () => {
  it('reads an asserted negative as no and an asserted positive as yes', () => {
    expect(booleanAnswer(recorded(true, patientSaidSo))).toBe('yes');
    expect(booleanAnswer(assertedNone(patientSaidSo))).toBe('no');
    expect(booleanAnswer(recorded(false, patientSaidSo))).toBe('no');
  });

  it('reads everything nobody asserted as not_answered', () => {
    expect(booleanAnswer(NOT_ASSESSED)).toBe('not_answered');
    expect(booleanAnswer(undefined)).toBe('not_answered');
    expect(booleanAnswer(patientUnsure(patientSaidSo))).toBe('not_answered');
    expect(booleanAnswer(declined(patientSaidSo))).toBe('not_answered');
    expect(booleanAnswer(notApplicable(patientSaidSo))).toBe('not_answered');
  });

  it('does not read a non-boolean recorded value as yes', () => {
    // An extractor that writes the string "maybe" into a boolean field must not
    // silently become an affirmative answer to a red-flag question.
    expect(booleanAnswer(recorded('maybe', patientSaidSo))).toBe(
      'not_answered',
    );
    expect(booleanAnswer(recorded(0, patientSaidSo))).toBe('not_answered');
  });
});

describe('parseFact — the boundary where model output becomes a fact', () => {
  it('turns anything unrecognisable into not_assessed', () => {
    expect(parseFact(undefined).presence).toBe('not_assessed');
    expect(parseFact(null).presence).toBe('not_assessed');
    expect(parseFact('no').presence).toBe('not_assessed');
    expect(parseFact({}).presence).toBe('not_assessed');
    expect(parseFact({ presence: 'nope' }).presence).toBe('not_assessed');
  });

  it('rejects an asserted negative that arrives with no provenance', () => {
    // A model emitting `{"presence":"none"}` is exactly how a fabricated
    // negative gets into the chart. It must fail loudly at the boundary.
    expect(() => parseFact({ presence: 'none' })).toThrow(/provenance/i);
  });

  it('rejects a recorded fact with no value instead of defaulting it', () => {
    expect(() =>
      parseFact({ presence: 'recorded', provenance: patientSaidSo }),
    ).toThrow(/value/i);
  });

  it('accepts a well formed fact unchanged', () => {
    const fact = parseFact({
      presence: 'recorded',
      value: 'burning',
      provenance: { source: 'patient_text', verification: 'unverified' },
    });
    expect(fact.presence).toBe('recorded');
    expect(requireValue(fact)).toBe('burning');
  });

  it('never upgrades a not_assessed input into an assertion', () => {
    const roundTripped: FactPresence = parseFact(NOT_ASSESSED).presence;
    expect(roundTripped).toBe('not_assessed');
  });
});

/* ───────────────── presence derivation: the model does not get a vote ───────────────── */

const BOOLEAN_FIELD: FieldValueSpec = { kind: 'boolean' };
const DURATION_FIELD: FieldValueSpec = { kind: 'duration' };
const TEXT_FIELD: FieldValueSpec = { kind: 'text' };

function answer(overrides: Partial<AnswerInput>): AnswerInput {
  return {
    modality: 'voice',
    field: BOOLEAN_FIELD,
    ...overrides,
  };
}

describe('derivePresence reproduces the gemma3:4b failure and refuses it', () => {
  it('does not record "I don\'t know" as a stated fact, whatever value came with it', () => {
    // The probe returned, for allergies:
    //   { presence: "recorded", value: "unknown", confidence: 0.95 }
    // `presence` is not in the schema any more, so all we get is the value —
    // and the value alone must not become a recorded finding.
    const derived = derivePresence(
      answer({
        utterance:
          "I've had chest pain for three days, and I don't know if I'm allergic to anything",
        evidenceSpan: "I don't know if I'm allergic to anything",
        extractedValue: 'unknown',
      }),
    );
    expect(derived.presence).toBe('unknown');
    expect(derived.value).toBeUndefined();
    expect(derived.reason).toBe('uncertainty_phrase');
  });

  it('refuses the bare value "unknown" even with no utterance to check against', () => {
    // Second line of defence, and language-independent: a value that is itself
    // a statement about not knowing is never an answer.
    const derived = derivePresence(
      answer({ utterance: '', extractedValue: 'unknown' }),
    );
    expect(derived.presence).toBe('unknown');
    expect(derived.reason).toBe('uncertainty_value_token');
  });

  it.each(['Unknown', 'not sure', 'N/A', 'not known', 'undetermined'])(
    'refuses "%s" as a recorded value',
    (token) => {
      expect(
        derivePresence(answer({ field: TEXT_FIELD, extractedValue: token }))
          .presence,
      ).not.toBe('recorded');
    },
  );

  it('still gets the duration out of the same multi-field utterance', () => {
    // The other half of the probe. Given its own evidence span, the duration
    // survives the uncertainty sitting next to it in the turn.
    const derived = derivePresence(
      answer({
        field: DURATION_FIELD,
        utterance:
          "I've had chest pain for three days, and I don't know if I'm allergic to anything",
        evidenceSpan: 'chest pain for three days',
        extractedValue: 'three days',
      }),
    );
    expect(derived.presence).toBe('recorded');
    expect(derived.value).toBe('three days');
  });

  it('errs toward unknown when the extractor gave no evidence span', () => {
    // Without a span we cannot tell which half of the turn the uncertainty
    // belongs to. Re-asking a duration is cheap; fabricating one is not.
    const derived = derivePresence(
      answer({
        field: DURATION_FIELD,
        utterance:
          "chest pain for three days, and I don't know about allergies",
        extractedValue: 'three days',
      }),
    );
    expect(derived.presence).toBe('unknown');
    expect(derived.reason).toBe('uncertainty_phrase_without_span');
    expect(derived.needsPatientConfirmation).toBe(true);
  });
});

describe('derivePresence rule order', () => {
  it('reads a refusal as declined, not as an uncertainty', () => {
    for (const utterance of [
      "I'd rather not say",
      'I prefer not to answer that',
      'Skip this one',
      "I don't want to talk about that",
    ]) {
      expect(derivePresence(answer({ evidenceSpan: utterance })).presence).toBe(
        'declined',
      );
    }
  });

  it('reads an uncertainty as unknown even though it contains a negation', () => {
    // "I don't know" contains "don't". A negation-first order would turn every
    // uncertainty into an asserted no — the collapse, one layer up.
    for (const utterance of [
      "I don't know",
      "I can't remember",
      'Not sure really',
      'No idea',
    ]) {
      const derived = derivePresence(answer({ evidenceSpan: utterance }));
      expect(derived.presence).toBe('unknown');
      expect(derived.presence).not.toBe('none');
    }
  });

  it('reads a real negation as an asserted no', () => {
    for (const utterance of [
      'No',
      'No, never',
      "I don't have any",
      'Nothing like that',
    ]) {
      expect(derivePresence(answer({ evidenceSpan: utterance })).presence).toBe(
        'none',
      );
    }
  });

  it('reads a plain yes as a recorded true', () => {
    const derived = derivePresence(
      answer({ evidenceSpan: 'Yes, quite badly' }),
    );
    expect(derived.presence).toBe('recorded');
    expect(derived.value).toBe(true);
    expect(derived.reason).toBe('affirmation_phrase');
  });

  it('records nothing when nobody asked', () => {
    expect(derivePresence(answer({ modality: 'no_answer' })).presence).toBe(
      'not_assessed',
    );
  });

  it('treats an explicit skip as a refusal, not as silence', () => {
    // §36 keeps "prefer not to answer" and "not assessed" apart, and so must
    // the interview: one has been asked, the other has not.
    expect(derivePresence(answer({ modality: 'skip' })).presence).toBe(
      'declined',
    );
  });

  it('is deterministic', () => {
    const input = answer({ evidenceSpan: "I'm not sure, maybe" });
    const first = derivePresence(input);
    for (let i = 0; i < 25; i += 1) {
      expect(derivePresence(input)).toEqual(first);
    }
  });
});

describe('derivePresence for tapped answers', () => {
  const choiceField: FieldValueSpec = {
    kind: 'choice',
    choices: ['sudden', 'gradual'],
  };

  it('maps the reserved tokens to presences, not to values', () => {
    expect(
      derivePresence({
        modality: 'choice',
        field: choiceField,
        extractedValue: 'not_sure',
      }).presence,
    ).toBe('unknown');
    expect(
      derivePresence({
        modality: 'choice',
        field: choiceField,
        extractedValue: 'prefer_not_to_say',
      }).presence,
    ).toBe('declined');
    expect(
      derivePresence({
        modality: 'choice',
        field: choiceField,
        extractedValue: 'not_applicable',
      }).presence,
    ).toBe('not_applicable');
  });

  it('records a real choice', () => {
    const derived = derivePresence({
      modality: 'choice',
      field: choiceField,
      extractedValue: 'sudden',
    });
    expect(derived.presence).toBe('recorded');
    expect(derived.value).toBe('sudden');
  });

  it('rejects a choice that is not on the list', () => {
    expect(
      derivePresence({
        modality: 'choice',
        field: choiceField,
        extractedValue: 'sort of both',
      }).presence,
    ).toBe('not_assessed');
  });

  it('works without any phrase list, so touch is the reliable path in any language', () => {
    const derived = derivePresence({
      modality: 'choice',
      field: choiceField,
      extractedValue: 'not_sure',
      language: 'ta',
    });
    expect(derived.presence).toBe('unknown');
    expect(derived.needsPatientConfirmation).toBe(false);
  });
});

describe('derivePresence language coverage', () => {
  it('does not pretend to understand Tamil yet', () => {
    // The phrase lists are English only. "theriyala" is "I don't know", and we
    // cannot currently tell it from an answer.
    const derived = derivePresence(
      answer({
        field: TEXT_FIELD,
        language: 'ta',
        evidenceSpan: 'theriyala',
        extractedValue: 'theriyala',
      }),
    );
    expect(derived.languageCovered).toBe(false);
    expect(derived.needsPatientConfirmation).toBe(true);
  });

  it('marks English as covered and settles without a confirmation', () => {
    const derived = derivePresence(
      answer({
        field: TEXT_FIELD,
        language: 'en-IN',
        extractedValue: 'burning',
      }),
    );
    expect(derived.languageCovered).toBe(true);
    expect(derived.needsPatientConfirmation).toBe(false);
  });
});

describe('validateFieldValue rejects eagerly slot-filled values', () => {
  it('refuses a severity that is not a rating', () => {
    // "A severity that is not a 0-10 scale or a named band is not a severity."
    expect(validateFieldValue({ kind: 'scale' }, 'quite bad').ok).toBe(false);
    expect(validateFieldValue({ kind: 'scale' }, 42).ok).toBe(false);
    expect(validateFieldValue({ kind: 'scale' }, 7)).toEqual({
      ok: true,
      value: 7,
    });
    expect(validateFieldValue({ kind: 'scale' }, 'moderate')).toEqual({
      ok: true,
      value: 'moderate',
    });
  });

  it('refuses a duration that is not a length of time', () => {
    expect(validateFieldValue(DURATION_FIELD, 'when I walk').ok).toBe(false);
    expect(validateFieldValue(DURATION_FIELD, 'three days').ok).toBe(true);
    expect(validateFieldValue(DURATION_FIELD, '2 weeks').ok).toBe(true);
    expect(validateFieldValue(DURATION_FIELD, 'since yesterday').ok).toBe(true);
  });

  it('enforces a field-declared shape for free text', () => {
    const spec: FieldValueSpec = {
      kind: 'text',
      accepts: {
        pattern: /\b(arm|chest|back)\b/i,
        rejectReason: 'not a body site',
      },
    };
    expect(validateFieldValue(spec, 'when I walk')).toEqual({
      ok: false,
      reason: 'not a body site',
    });
    expect(validateFieldValue(spec, 'down my left arm').ok).toBe(true);
  });

  it('leaves the field not_assessed when the value fails its shape', () => {
    const derived = derivePresence(
      answer({
        field: { kind: 'scale' },
        evidenceSpan: 'it is pretty bad',
        extractedValue: 'pretty bad',
      }),
    );
    expect(derived.presence).toBe('not_assessed');
    expect(derived.reason).toBe('value_failed_field_shape');
    expect(derived.value).toBeUndefined();
  });
});

describe('factFromAnswer', () => {
  const provenance = {
    source: 'patient_voice',
    verification: 'patient_confirmed',
  } as const;

  it('builds a fact whose presence the caller could not have chosen', () => {
    const { fact } = factFromAnswer(
      answer({ evidenceSpan: "I don't know", extractedValue: 'unknown' }),
      provenance,
    );
    expect(fact.presence).toBe('unknown');
    expect(() => requireValue(fact)).toThrow(NonRecordedValueError);
  });

  it('returns the shared not_assessed singleton when nothing usable arrived', () => {
    const { fact } = factFromAnswer(
      answer({ modality: 'no_answer' }),
      provenance,
    );
    expect(fact).toBe(NOT_ASSESSED);
  });

  it('downgrades verification when the derivation is not certain', () => {
    // An unmatched language cannot yield a patient-confirmed fact just because
    // the caller said so.
    const { fact } = factFromAnswer(
      answer({ field: TEXT_FIELD, language: 'hi', extractedValue: 'jalan' }),
      provenance,
    );
    expect(fact.presence).toBe('recorded');
    if (fact.presence === 'recorded') {
      expect(fact.provenance.verification).toBe('unverified');
    }
  });

  it('keeps the caller-supplied verification when the derivation is certain', () => {
    const { fact } = factFromAnswer(
      answer({ field: TEXT_FIELD, language: 'en', extractedValue: 'burning' }),
      provenance,
    );
    if (fact.presence === 'recorded') {
      expect(fact.provenance.verification).toBe('patient_confirmed');
    }
  });
});

describe('model confidence is not evidence', () => {
  it('is ignored by presence derivation entirely', () => {
    // The probe self-reported 0.95 on every fact, including the wrong ones. A
    // constant carries no information, so there is no parameter for it here.
    const input = answer({
      evidenceSpan: "I don't know",
      extractedValue: 'unknown',
    });
    expect(Object.keys(input)).not.toContain('confidence');
    expect(derivePresence(input).presence).toBe('unknown');
  });

  it('is carried for display but labelled with where it came from', () => {
    const fact = recorded('amlodipine', {
      source: 'uploaded_document',
      verification: 'unverified',
      confidence: 0.95,
      confidenceSource: 'model_self_report',
    });
    expect(fact.provenance.confidenceSource).toBe('model_self_report');
    // …and it changes nothing about the fact's standing.
    expect(fact.provenance.verification).toBe('unverified');
  });
});
