import { STATIC_FIELDS } from './field-registry';
import {
  RED_FLAG_RULES,
  RED_FLAG_SEVERITIES,
  RULESET_VERSION,
  RedFlagRule,
  findDiagnosticLanguage,
  referencedFieldPaths,
  severityRank,
} from './safety-rules';

const byId = (id: string): RedFlagRule => {
  const rule = RED_FLAG_RULES.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule;
};

describe('the patient never gets a diagnosis', () => {
  it.each(RED_FLAG_RULES.map((rule) => [rule.id, rule] as const))(
    '%s says what to do, not what is wrong',
    (_id, rule) => {
      expect(findDiagnosticLanguage(rule.message)).toBeNull();
    },
  );

  it('would catch the sentence §29 forbids', () => {
    // Proof that the check has teeth rather than passing vacuously.
    expect(findDiagnosticLanguage('You are having a heart attack.')).toBe(
      'heart attack',
    );
    // Diagnostic *framing* is caught even when no condition is named.
    expect(findDiagnosticLanguage('This looks like something serious.')).toBe(
      'This looks like',
    );
    expect(findDiagnosticLanguage('We think you need to hurry.')).toBe(
      'We think you',
    );
    expect(
      findDiagnosticLanguage('Our diagnosis is that you should wait.'),
    ).toBe('diagnos');
  });

  it('tells every patient where to go', () => {
    for (const rule of RED_FLAG_RULES) {
      expect(rule.message.toLowerCase()).toMatch(
        /front desk|member of staff|nearest/,
      );
    }
  });

  it('lets the clinician summary name the screen, because a nurse needs it', () => {
    // The distinction the banner in safety-rules.ts draws: the screen may be
    // named to staff, never to the patient.
    expect(byId('ACS_TRIAD').clinicianSummary).toMatch(/ACS/);
    expect(byId('ACS_TRIAD').message).not.toMatch(/ACS/i);
  });
});

describe('rule set shape', () => {
  it('is versioned', () => {
    expect(RULESET_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    for (const rule of RED_FLAG_RULES) {
      expect(Number.isInteger(rule.version)).toBe(true);
      expect(rule.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('has unique ids', () => {
    const ids = RED_FLAG_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every rule at least one condition', () => {
    // A rule with neither `all` nor `any` either matches everything or nothing,
    // depending on how an evaluator folds an empty list. Neither is a rule.
    for (const rule of RED_FLAG_RULES) {
      expect(rule.all.length + rule.any.length).toBeGreaterThan(0);
    }
  });

  it('gives every rule a clinician summary and an action', () => {
    for (const rule of RED_FLAG_RULES) {
      expect(rule.clinicianSummary.trim().length).toBeGreaterThan(0);
      expect(rule.recommendedAction.trim().length).toBeGreaterThan(0);
      expect(rule.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('only reads fields the interview actually asks about', () => {
    // A rule naming `face_drop` instead of `face_droop` is not broken, it is
    // silent: it evaluates cleanly and never fires.
    const known = new Set(STATIC_FIELDS.map((field) => field.key));
    for (const path of referencedFieldPaths()) {
      expect(known.has(path)).toBe(true);
    }
  });

  it('ranks severities from most to least urgent', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('urgent'));
    expect(severityRank('urgent')).toBeLessThan(severityRank('advisory'));
    expect(RED_FLAG_SEVERITIES).toContain('critical');
  });
});

describe('clinical coverage', () => {
  it.each([
    'ACS_TRIAD',
    'STROKE_SIGNS',
    'SEVERE_BREATHLESSNESS',
    'UPPER_GI_BLEED',
    'SEPSIS_SIGNS',
    'ANAPHYLAXIS',
    'SUICIDAL_IDEATION',
    'PREGNANCY_BLEEDING',
    'PAEDIATRIC_DANGER_SIGNS',
  ])('covers %s', (id) => {
    expect(byId(id)).toBeDefined();
  });

  it('encodes §29s worked example exactly', () => {
    // Chest pain + breathlessness + (sweating | sudden onset).
    const acs = byId('ACS_TRIAD');
    expect(acs.all).toEqual([
      { kind: 'complaint', anyOf: ['cardiac'] },
      { kind: 'yes', field: 'hpi.associated.breathlessness' },
    ]);
    expect(acs.any).toHaveLength(2);
    expect(acs.severity).toBe('critical');
  });

  it('keeps fresh rectal bleeding below haematemesis', () => {
    // Escalating a common benign finding to critical teaches the triage desk to
    // ignore this engine, which costs more than it saves.
    expect(severityRank(byId('UPPER_GI_BLEED').severity)).toBeLessThan(
      severityRank(byId('LOWER_GI_BLEED').severity),
    );
  });

  it('has a rule for not knowing, not just for knowing', () => {
    // §36 and Documents §19: "we did not ask" is neither a yes nor a no, and it
    // is sometimes actionable in its own right.
    const rule = byId('BLEEDING_PREGNANCY_STATUS_UNKNOWN');
    expect(rule.all).toContainEqual({
      kind: 'presence',
      field: 'ros.genitourinary.pregnancy_possible',
      presenceIn: ['unknown', 'not_assessed', 'declined'],
    });
    expect(rule.clinicianSummary).toMatch(/not a negative pregnancy status/i);
  });

  it('answers a self-harm disclosure with more than a queue instruction', () => {
    const rule = byId('SUICIDAL_IDEATION');
    expect(rule.message).toMatch(/thank you/i);
    expect(rule.message).toMatch(/14416/);
    expect(rule.recommendedAction).toMatch(/unaccompanied/i);
  });
});
