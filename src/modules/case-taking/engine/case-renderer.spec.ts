import {
  renderCase,
  renderCaseText,
  renderItem,
  renderValue,
} from './case-renderer';
import {
  ClinicalState,
  applyFact,
  createClinicalState,
  markAsked,
} from './clinical-state';
import { STATIC_FIELDS, findField } from './field-registry';
import { evaluate } from './safety-engine';
import {
  Fact,
  FactValue,
  factFromAnswer,
  NonRecordedValueError,
  NOT_ASSESSED,
  assertedNone,
  declined,
  notApplicable,
  patientUnsure,
  recorded,
} from './tri-state';

const voice = { source: 'patient_voice', verification: 'unverified' } as const;
const fromReport = {
  source: 'uploaded_document',
  verification: 'unverified',
  confidence: 0.61,
  documentId: 'DOC-001',
} as const;

const allergyField = STATIC_FIELDS.find((f) => f.key === 'allergies.reported')!;

function state(entries: Record<string, Fact<FactValue>> = {}): ClinicalState {
  let next = createClinicalState({ sessionId: 'case-1' });
  for (const [path, fact] of Object.entries(entries)) {
    next = applyFact(next, path, fact);
  }
  return next;
}

describe('renderValue refuses to invent a value', () => {
  it.each([
    ['not_assessed', NOT_ASSESSED],
    ['none', assertedNone(voice)],
    ['unknown', patientUnsure(voice)],
    ['declined', declined(voice)],
    ['not_applicable', notApplicable(voice)],
  ])('throws for a %s fact', (_presence, fact) => {
    // A template reaching for a value it does not have gets a test failure,
    // not a blank, and certainly not a "No".
    expect(() => renderValue(fact, 'allergies.reported')).toThrow(
      NonRecordedValueError,
    );
  });

  it('throws for a fact that is not there at all', () => {
    expect(() => renderValue(undefined, 'allergies.reported')).toThrow(
      NonRecordedValueError,
    );
  });

  it('names the field and the presence in the failure', () => {
    expect(() => renderValue(patientUnsure(voice), 'hpi.onset')).toThrow(
      /hpi\.onset.*"unknown"/,
    );
  });

  it('formats a recorded value for a human', () => {
    expect(renderValue(recorded(true, voice))).toBe('Yes');
    expect(renderValue(recorded(false, voice))).toBe('No');
    expect(renderValue(recorded(8, voice))).toBe('8');
    expect(renderValue(recorded('woke_up_with_it', voice))).toBe(
      'Woke up with it',
    );
  });
});

describe('a not_assessed allergy never renders as "no known allergies"', () => {
  it('renders the unasked question as Not assessed', () => {
    const item = renderItem(allergyField, NOT_ASSESSED);
    expect(item.display).toBe('Not assessed');
    expect(item.presence).toBe('not_assessed');
    expect(item.outstanding).toBe(true);
  });

  it('gives the reassuring wording only to an asserted negative', () => {
    expect(renderItem(allergyField, assertedNone(voice)).display).toBe(
      'No known allergies',
    );
  });

  it('keeps the four §19 states apart', () => {
    const displays = [
      renderItem(allergyField, recorded(true, voice)).display,
      renderItem(allergyField, assertedNone(voice)).display,
      renderItem(allergyField, patientUnsure(voice)).display,
      renderItem(allergyField, NOT_ASSESSED).display,
    ];
    expect(new Set(displays).size).toBe(4);
    expect(displays[2]).toBe('Patient unsure');
    expect(displays[3]).toBe('Not assessed');
  });

  it('never prints the phrase anywhere in a case where nobody asked', () => {
    // The end-to-end version of the same guarantee, through the full render.
    const text = renderCaseText(
      renderCase(
        state({ 'chief_complaint.symptom': recorded('cough', voice) }),
      ),
    );
    expect(text).not.toContain('No known allergies');
    expect(text).toMatch(/Allergies: Not assessed/);
  });

  it('prints it once the patient has actually said no', () => {
    const text = renderCaseText(
      renderCase(
        state({
          'chief_complaint.symptom': recorded('cough', voice),
          'allergies.reported': assertedNone(voice),
        }),
      ),
    );
    expect(text).toContain('Allergies: No known allergies');
  });
});

describe('provenance travels with the value', () => {
  it('carries source, confidence, verification and document id', () => {
    const field = findField(createClinicalState(), 'chief_complaint.symptom')!;
    const item = renderItem(field, recorded('chest pain', fromReport));
    expect(item.source).toBe('uploaded_document');
    expect(item.confidence).toBeCloseTo(0.61);
    expect(item.verification).toBe('unverified');
    expect(item.documentId).toBe('DOC-001');
  });

  it('carries the provenance of an asserted negative too', () => {
    // §32: who said "no allergies" is exactly as important as the "no".
    const item = renderItem(allergyField, assertedNone(voice));
    expect(item.source).toBe('patient_voice');
    expect(item.presence).toBe('none');
    expect(item.value).toBeUndefined();
  });

  it('carries no provenance for a question nobody asked', () => {
    const item = renderItem(allergyField, NOT_ASSESSED);
    expect(item.source).toBeUndefined();
    expect(item.verification).toBeUndefined();
  });

  /**
   * A review without fact ids is a page of statements with no handle on any of
   * them: the client can read "Amlodipine 5 mg" and has no way to name the row
   * when the patient says it is 10. The mobile client had to route a first
   * correction through a turn to discover an id, which is a hop that exists
   * only because this field was missing.
   */
  it('carries the id of the fact it rendered, so a correction can name it', () => {
    const field = findField(createClinicalState(), 'chief_complaint.symptom')!;
    const item = renderItem(
      field,
      recorded('chest pain', { ...fromReport, factId: 'fact-123' }),
    );
    expect(item.factId).toBe('fact-123');
  });

  it('carries no fact id for an outstanding question', () => {
    // There is no row to supersede. Correcting something nobody has said is
    // answering it, which is a turn, not a correction.
    expect(renderItem(allergyField, NOT_ASSESSED).factId).toBeUndefined();
  });

  it('shows low confidence in the text output for §31 verification', () => {
    const text = renderCaseText(
      renderCase(
        state({
          'chief_complaint.symptom': recorded('chest pain', fromReport),
        }),
      ),
    );
    expect(text).toContain('confidence 61%');
    expect(text).toContain('unverified');
  });
});

describe('the rendered case', () => {
  const interviewed = state({
    'chief_complaint.symptom': recorded('chest pain', voice),
    'hpi.duration': recorded('3 days', voice),
    'hpi.associated.breathlessness': recorded(true, voice),
    'hpi.onset': recorded('sudden', voice),
    'allergies.reported': assertedNone(voice),
    'medications.any_current': recorded(true, voice),
    'medications[0].name': recorded('amlodipine', voice),
    'medications[0].strength': patientUnsure(voice),
  });

  it('follows §38s section order', () => {
    const sections = renderCase(interviewed).sections.map((s) => s.section);
    expect(sections[0]).toBe('chief_complaint');
    expect(sections.indexOf('hpi')).toBeLessThan(sections.indexOf('ros'));
    expect(sections.indexOf('medications')).toBeLessThan(
      sections.indexOf('allergies'),
    );
  });

  it('shows unanswered questions rather than omitting them', () => {
    // An omitted line reads as "nothing to report"; a printed one reads as "we
    // did not get to this". Those are different facts about the case.
    const hpi = renderCase(interviewed).sections.find(
      (s) => s.section === 'hpi',
    )!;
    const unanswered = hpi.items.filter((item) => item.outstanding);
    expect(unanswered.length).toBeGreaterThan(0);
    for (const item of unanswered) {
      expect(item.display).toBe('Not assessed');
    }
  });

  it('lists what is still missing, per §36', () => {
    const rendered = renderCase(interviewed);
    expect(rendered.missingInformation).toContain('hpi.severity');
    expect(rendered.missingInformation).not.toContain('hpi.onset');
    expect(rendered.missingInformation).not.toContain('allergies.reported');
    expect(rendered.percentComplete).toBeLessThan(100);
  });

  it('keeps a list summary above its items and the items in order', () => {
    const meds = renderCase(interviewed).sections.find(
      (s) => s.section === 'medications',
    )!;
    const keys = meds.items.map((item) => item.fieldPath);
    expect(keys[0]).toBe('medications.any_current');
    expect(keys.indexOf('medications[0].name')).toBeLessThan(
      keys.indexOf('medications[0].strength'),
    );
  });

  it('does not invent a strength the patient could not remember', () => {
    // §18: the system must not invent the medication name or its details.
    const meds = renderCase(interviewed).sections.find(
      (s) => s.section === 'medications',
    )!;
    const strength = meds.items.find(
      (item) => item.fieldPath === 'medications[0].strength',
    )!;
    expect(strength.display).toBe('Patient unsure');
    expect(strength.value).toBeUndefined();
  });

  it('renders a field the interview never asks but the record supplied', () => {
    const rendered = renderCase(
      state({
        'chief_complaint.symptom': recorded('fever', voice),
        'social.age_band': recorded('child', {
          source: 'existing_record',
          verification: 'clinician_confirmed',
        }),
      }),
    );
    const social = rendered.sections.find((s) => s.section === 'social')!;
    expect(
      social.items.find((item) => item.fieldPath === 'social.age_band')
        ?.display,
    ).toBe('Child');
    // …but it is not counted against progress, because it was never a question.
    expect(rendered.missingInformation).not.toContain('social.age_band');
  });

  it('carries the session and revision so the case can be traced', () => {
    const rendered = renderCase(interviewed);
    expect(rendered.sessionId).toBe('case-1');
    expect(rendered.revision).toBe(interviewed.revision);
  });
});

describe('the safety block', () => {
  const alarming = state({
    'chief_complaint.symptom': recorded('chest pain', voice),
    'hpi.associated.breathlessness': recorded(true, voice),
    'hpi.associated.sweating': recorded(true, voice),
  });

  it('shows the triage desk the screen and the rule version', () => {
    const text = renderCaseText(
      renderCase(alarming, { safety: evaluate(alarming) }),
    );
    expect(text).toContain('[CRITICAL]');
    expect(text).toContain('ACS_TRIAD v1');
  });

  it('puts the clinician summary in the case, not the patient message', () => {
    const assessment = evaluate(alarming);
    const text = renderCaseText(renderCase(alarming, { safety: assessment }));
    expect(text).toContain(assessment.triggered[0].clinicianSummary);
    expect(text).not.toContain(assessment.triggered[0].patientMessage);
  });

  it('omits the block entirely when nothing fired', () => {
    const calm = state({
      'chief_complaint.symptom': recorded('sore throat', voice),
    });
    const text = renderCaseText(renderCase(calm, { safety: evaluate(calm) }));
    expect(text).not.toContain('Safety');
  });
});

describe('renderCaseText', () => {
  it('opens the way §38 opens', () => {
    const text = renderCaseText(renderCase(state()));
    expect(text.startsWith('PATIENT CASE')).toBe(true);
  });

  it('reports completion and names what is outstanding', () => {
    const text = renderCaseText(
      renderCase(
        state({ 'chief_complaint.symptom': recorded('cough', voice) }),
      ),
    );
    expect(text).toMatch(/\d+% of applicable questions answered/);
    expect(text).toMatch(/Not assessed: .*allergies\.reported/);
  });

  it('is stable — the same state renders the same text', () => {
    const s = state({ 'chief_complaint.symptom': recorded('cough', voice) });
    expect(renderCaseText(renderCase(s))).toBe(renderCaseText(renderCase(s)));
  });
});

describe('the renderer sees answers, never pipeline state or model confidence', () => {
  it('prints a question that is still being extracted as Not assessed', () => {
    // "Asked, awaiting extraction" is not an answer. Printing it as anything
    // else would put the pipeline's progress into the patient's chart.
    const asked = markAsked(
      state({ 'chief_complaint.symptom': recorded('cough', voice) }),
      'allergies.reported',
    );
    const text = renderCaseText(renderCase(asked));
    expect(text).toContain('Allergies: Not assessed');
    expect(text).not.toContain('No known allergies');
  });

  it('does not let a high model confidence stand in for verification', () => {
    // The probe reported 0.95 on every fact. A chart that reads 95% as
    // "confirmed" has confirmed nothing.
    const item = renderItem(
      allergyField,
      recorded(true, {
        source: 'patient_voice',
        verification: 'unverified',
        confidence: 0.95,
        confidenceSource: 'model_self_report',
      }),
    );
    expect(item.verification).toBe('unverified');
    expect(item.confidence).toBeCloseTo(0.95);
  });

  it('renders a fact derived from an "I don\'t know" as unsure, not as a value', () => {
    // End to end from the raw utterance: the same input that made gemma3:4b
    // emit `{presence:"recorded", value:"unknown"}` reaches the chart as
    // "Patient unsure".
    const { fact } = factFromAnswer(
      {
        modality: 'voice',
        field: { kind: 'boolean' },
        evidenceSpan: "I don't know if I'm allergic to anything",
        extractedValue: 'unknown',
      },
      { source: 'patient_voice', verification: 'unverified' },
    );
    const item = renderItem(allergyField, fact);
    expect(item.display).toBe('Patient unsure');
    expect(item.value).toBeUndefined();
    expect(() => renderValue(fact, 'allergies.reported')).toThrow(
      NonRecordedValueError,
    );
  });
});
