import { linesFromText } from './layout';
import { collectExtractedValues, normaliseForMatch } from './confidence';
import { classifyByKeywords } from './classifier';
import { assessCoverage, decideEscalation } from './rules/coverage';
import { extractByRules, ruleSetFor } from './rules-extractor';

/** The prescription fixture, as `layout.ts` renders it. */
const PRESCRIPTION = [
  'SUNRISE MULTISPECIALITY CLINIC',
  '14 Station Road, Coimbatore 641002  ·  Ph 0422 244 1180',
  'PRESCRIPTION',
  'Patient:  Ramesh Kumar\tDate:  12/09/2026',
  'Age / Sex:  54 / Male\tOP No:  OP-2026-11847',
  'Diagnosis:  Type 2 Diabetes Mellitus, Hypertension',
  'Rx',
  '1.\tTab. METFORMIN 500 mg',
  '1 tablet  -  twice daily  -  oral',
  'After food, 30 days',
  '2.\tTab. AMLODIPINE 5 mg',
  '1 tablet  -  once daily  -  oral',
  'Morning, 30 days',
  '3.\tTab. ATORVASTATIN 10 mg',
  '1 tablet  -  at bedtime  -  oral',
  '30 days',
  'Advice:  Check fasting blood sugar after 2 weeks. Reduce salt intake.',
  'Follow up:  Review after 30 days.',
  'Dr. Anitha Raghavan, MD',
  'Reg. No. TN 54821',
].join('\n');

/** The lab fixture, as `layout.ts` renders it. */
const LAB_REPORT = [
  'METROLAB DIAGNOSTICS',
  'NABL accredited  ·  Report generated 12/09/2026 11:24',
  'COMPLETE BLOOD COUNT',
  'Patient:  Ramesh Kumar\tSample No:  ML-88213',
  'Age / Sex:  54 / Male\tCollected:  12/09/2026',
  'Referred by:  Dr. Anitha Raghavan',
  'TEST\tRESULT\tUNIT\tREFERENCE',
  'Haemoglobin\t11.2\t*\tg/dL\t13.0 - 17.0',
  'Total WBC Count\t8400\t/uL\t4000 - 11000',
  'Platelet Count\t250000\t/uL\t150000 - 410000',
  'Packed Cell Volume\t36.4\t*\t%\t40.0 - 50.0',
  'MCV\t82.1\t*\tfL\t83.0 - 101.0',
  'Random Blood Sugar\t168\t*\tmg/dL\t70 - 140',
  'Serum Creatinine\t0.9\tmg/dL\t0.7 - 1.3',
  '*  Outside the stated reference interval.',
  'Verified by:  Dr. S. Nandakumar, MD (Pathology)',
].join('\n');

const FIXTURES = {
  prescription: PRESCRIPTION,
  laboratory_report: LAB_REPORT,
} as const;

function readFixture(
  source: string,
  type: 'prescription' | 'laboratory_report',
) {
  const lines = linesFromText(source);
  const rules = extractByRules(lines, type);
  const coverage = assessCoverage(rules, lines, classifyByKeywords(source));
  return { rules, coverage, decision: decideEscalation(coverage) };
}

describe('the grounding invariant', () => {
  // The most valuable test here. Every value the rules emit must be a verbatim
  // slice of the page, because `confidence.ts` scores a value by looking for
  // it in the source text. This asserts that against the *real* grounding
  // helpers rather than a restatement of them, so any future pattern that
  // starts synthesising a value — reformatting a date, expanding `BD` — fails
  // immediately and here, rather than as an unexplained confidence drop.
  it.each(['prescription', 'laboratory_report'] as const)(
    'emits nothing that is not already on the %s',
    (type) => {
      const { rules } = readFixture(FIXTURES[type], type);
      const haystack = normaliseForMatch(FIXTURES[type]);

      for (const { field, value } of collectExtractedValues(rules.extraction)) {
        expect({
          field,
          grounded: haystack.includes(normaliseForMatch(value)),
        }).toEqual({ field, grounded: true });
      }
    },
  );
});

describe('the prescription fixture, end to end', () => {
  const { rules, coverage, decision } = readFixture(
    PRESCRIPTION,
    'prescription',
  );

  it('reads the header', () => {
    expect(rules.extraction.patient.name).toBe('Ramesh Kumar');
    expect(rules.extraction.patient.identifier).toBe('OP-2026-11847');
    expect(rules.extraction.document.date).toBe('12/09/2026');
    // The whole signature line, verbatim. Trimming the qualification off
    // would be a tidier string that is no longer a slice of the page.
    expect(rules.extraction.document.author).toBe('Dr. Anitha Raghavan, MD');
    expect(rules.extraction.document.facility).toBe(
      'SUNRISE MULTISPECIALITY CLINIC',
    );
  });

  it('reads all three medications', () => {
    expect(rules.extraction.medications.map((m) => m.name)).toEqual([
      'METFORMIN',
      'AMLODIPINE',
      'ATORVASTATIN',
    ]);
  });

  it('reads the diagnoses and the advice', () => {
    expect(rules.extraction.diagnosesRecorded).toEqual([
      'Type 2 Diabetes Mellitus',
      'Hypertension',
    ]);
    expect(rules.extraction.followUp).toEqual([
      'Check fasting blood sugar after 2 weeks. Reduce salt intake.',
      'Review after 30 days.',
    ]);
  });

  it('records no allergies, because the document mentions none', () => {
    // §19. The fixture has no allergy section deliberately, and an empty list
    // here must stay an empty list rather than becoming an assertion.
    expect(rules.extraction.allergies).toEqual([]);
  });

  it('accounts for the page and does not ask for a second opinion', () => {
    expect(coverage.requiredSatisfaction).toBe(1);
    expect(coverage.lineClaim).toBeGreaterThanOrEqual(0.65);
    expect(decision.reasons).toEqual([]);
    expect(decision.escalate).toBe(false);
    expect(decision.rulesAreComplete).toBe(true);
  });
});

describe('the laboratory fixture, end to end', () => {
  const { rules, decision } = readFixture(LAB_REPORT, 'laboratory_report');

  it('reads all seven results', () => {
    expect(rules.extraction.investigations).toHaveLength(7);
  });

  it('falls through to the sample number for the identifier', () => {
    expect(rules.extraction.patient.identifier).toBe('ML-88213');
  });

  it('records no medications, because a lab report prescribes none', () => {
    expect(rules.extraction.medications).toEqual([]);
  });

  it('accounts for the page and does not ask for a second opinion', () => {
    expect(decision.reasons).toEqual([]);
    expect(decision.escalate).toBe(false);
  });
});

describe('when the rules should ask for help', () => {
  it('reads nothing at all from an unidentified document', () => {
    // Not knowing what a document is means not knowing which vocabulary
    // applies, and a prescription parser turned loose on an unknown page
    // finds medications in a radiology report.
    const lines = linesFromText(PRESCRIPTION);
    const rules = extractByRules(lines, 'unknown');

    expect(ruleSetFor('unknown')).toBe('none');
    expect(rules.extraction.medications).toEqual([]);
    expect(rules.claimed.size).toBe(0);
  });

  it('escalates a narrative document it can only skim', () => {
    const lines = linesFromText('CHEST PA VIEW\nCardiac silhouette normal.');
    const rules = extractByRules(lines, 'imaging_report');
    const coverage = assessCoverage(rules, lines, {
      type: 'imaging_report',
      confidence: 0.9,
      method: 'layout_keywords',
    });

    expect(decideEscalation(coverage).reasons).toContain('generic_rule_set');
    expect(decideEscalation(coverage).rulesAreComplete).toBe(false);
  });

  it('escalates a prescription whose drugs it could not read', () => {
    const source = [
      'Patient:  Ramesh Kumar\tDate:  12/09/2026',
      'Rx',
      'contmue her metformm, add amlodipme 5 at night',
      'Advice:  Reduce salt intake.',
      'Dr. Anitha Raghavan, MD',
    ].join('\n');
    const lines = linesFromText(source);
    const rules = extractByRules(lines, 'prescription');
    const coverage = assessCoverage(rules, lines, classifyByKeywords(source));

    expect(rules.extraction.medications).toEqual([]);
    expect(decideEscalation(coverage).reasons).toContain('no_entities');
  });

  it('escalates when several unlabelled dates compete', () => {
    const source = [
      'CITY SCANS AND IMAGING',
      'Patient:  Ramesh Kumar',
      'Printed 01/02/2026 and reviewed 03/04/2026',
      'Rx',
      'Tab. METFORMIN 500 mg BD',
      'Dr. Anitha Raghavan, MD',
    ].join('\n');
    const lines = linesFromText(source);
    const rules = extractByRules(lines, 'prescription');

    expect(rules.extraction.document.date).toBeNull();
    expect(rules.ambiguousDate).toBe(true);
  });
});
