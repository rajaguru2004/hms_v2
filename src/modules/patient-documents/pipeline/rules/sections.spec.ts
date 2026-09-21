import { linesFromText } from '../layout';
import { captureSections, itemsFor, splitInline } from './sections';

const sectionsOf = (text: string) => captureSections(linesFromText(text));

describe('inline heading values', () => {
  it('splits a list of conditions', () => {
    expect(splitInline('Type 2 Diabetes Mellitus, Hypertension')).toEqual([
      'Type 2 Diabetes Mellitus',
      'Hypertension',
    ]);
  });

  it('keeps a condition whose type is written after the comma', () => {
    // The difference between two diagnoses and one written the other way
    // round is entirely in what follows the comma.
    expect(splitInline('Diabetes Mellitus, Type 2')).toEqual([
      'Diabetes Mellitus, Type 2',
    ]);
  });

  it('splits the list but not the condition inside it', () => {
    expect(splitInline('Diabetes Mellitus, Type 2, Hypertension')).toEqual([
      'Diabetes Mellitus, Type 2',
      'Hypertension',
    ]);
  });

  it('does not split a sentence on its full stops', () => {
    // One line yields at most one item. Sentence splitting is interpretation.
    expect(
      splitInline(
        'Check fasting blood sugar after 2 weeks. Reduce salt intake.',
      ),
    ).toEqual(['Check fasting blood sugar after 2 weeks. Reduce salt intake.']);
  });
});

describe('capturing a section', () => {
  it('reads the prescription fixture diagnosis inline', () => {
    const sections = sectionsOf(
      'Diagnosis:  Type 2 Diabetes Mellitus, Hypertension',
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].topic).toBe('diagnoses');
    expect(sections[0].items).toEqual([
      'Type 2 Diabetes Mellitus',
      'Hypertension',
    ]);
  });

  it('reads the lines beneath a heading, one item each', () => {
    const sections = sectionsOf(
      [
        'Final Diagnosis:',
        '1. Type 2 Diabetes Mellitus',
        '2. Hypertension',
      ].join('\n'),
    );

    expect(sections[0].items).toEqual([
      'Type 2 Diabetes Mellitus',
      'Hypertension',
    ]);
  });

  it('stops at the next heading', () => {
    const sections = sectionsOf(
      [
        'Diagnosis:  Type 2 Diabetes Mellitus',
        'Procedures:',
        'Coronary angiography',
      ].join('\n'),
    );

    expect(itemsFor(sections, 'diagnoses')).toEqual([
      'Type 2 Diabetes Mellitus',
    ]);
    expect(itemsFor(sections, 'procedures')).toEqual(['Coronary angiography']);
  });

  it('stops at a signature block rather than swallowing it', () => {
    const sections = sectionsOf(
      ['Follow up:', 'Review after 30 days.', 'Dr. Anitha Raghavan, MD'].join(
        '\n',
      ),
    );

    expect(itemsFor(sections, 'followUp')).toEqual(['Review after 30 days.']);
  });

  it('does not run past its cap and swallow the rest of the document', () => {
    const sections = sectionsOf(
      ['Diagnosis:', ...Array.from({ length: 30 }, (_, n) => `line ${n}`)].join(
        '\n',
      ),
    );

    expect(sections[0].items.length).toBeLessThanOrEqual(12);
  });

  it('reads Advice and Follow up as the same topic', () => {
    const sections = sectionsOf(
      [
        'Advice:  Check fasting blood sugar after 2 weeks.',
        'Follow up:  Review after 30 days.',
      ].join('\n'),
    );

    expect(itemsFor(sections, 'followUp')).toEqual([
      'Check fasting blood sugar after 2 weeks.',
      'Review after 30 days.',
    ]);
  });

  it('reads a bare Rx as the medication heading', () => {
    const sections = sectionsOf('Rx\n1.\tTab. METFORMIN 500 mg');

    expect(sections[0].topic).toBe('medications');
    expect(sections[0].body).toHaveLength(1);
  });

  it('does not read a sentence that merely starts like a heading', () => {
    // "Review" opens a heading and also opens a great many sentences.
    expect(
      sectionsOf('Review of systems was unremarkable across all major domains'),
    ).toHaveLength(0);
  });

  it('finds no allergy section in the prescription fixture', () => {
    // The fixture has none, deliberately. §19 turns on this staying empty:
    // an absent section is not an assertion that the patient has no allergies.
    const sections = sectionsOf(
      [
        'Diagnosis:  Type 2 Diabetes Mellitus, Hypertension',
        'Rx',
        '1.\tTab. METFORMIN 500 mg',
        'Follow up:  Review after 30 days.',
      ].join('\n'),
    );

    expect(itemsFor(sections, 'allergies')).toEqual([]);
  });

  it('keeps a denial verbatim rather than resolving it', () => {
    // `document-facts.ts` is the single owner of turning "Nil" into a
    // presence. Duplicating that judgement here is how the two drift.
    const sections = sectionsOf('Allergies:  No known drug allergies');

    expect(itemsFor(sections, 'allergies')).toEqual([
      'No known drug allergies',
    ]);
  });
});
