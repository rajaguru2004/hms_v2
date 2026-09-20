import { linesFromText } from '../layout';
import { emptyExtraction, ExtractedDocument } from '../extraction-schema';
import { extractByRules } from '../rules-extractor';
import { mergeExtractions } from './merge';

const SOURCE = [
  'Patient:  Ramesh Kumar\tDate:  12/09/2026',
  'Rx',
  '1.\tTab. METFORMIN 500 mg',
  '1 tablet  -  twice daily  -  oral',
  '2.\tTab. AMLODIPINE 5 mg  -  once daily  -  30 days',
  'Dr. Anitha Raghavan, MD',
].join('\n');

const rulesOf = () => extractByRules(linesFromText(SOURCE), 'prescription');

/** A model answer, in the shape `normaliseExtraction` would have produced. */
function modelSaid(overrides: Partial<ExtractedDocument>): ExtractedDocument {
  return { ...emptyExtraction('prescription'), ...overrides };
}

describe('rules win', () => {
  it('keeps a rules value the model disagrees with', () => {
    const { extraction } = mergeExtractions(
      rulesOf(),
      modelSaid({
        medications: [
          {
            name: 'METFORMIN',
            strength: '850 mg',
            dose: null,
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: false,
          },
        ],
      }),
      SOURCE,
    );

    // The rules read `500 mg` off a named line. The model says 850. The page
    // says 500, and the reader that can point at the page wins.
    expect(extraction.medications[0].strength).toBe('500 mg');
  });

  it('lets the model fill a slot the rules left empty', () => {
    const { extraction, modelValues } = mergeExtractions(
      rulesOf(),
      modelSaid({
        medications: [
          {
            name: 'AMLODIPINE',
            strength: null,
            dose: '1 tablet',
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: false,
          },
        ],
      }),
      SOURCE,
    );

    expect(extraction.medications[1].dose).toBe('1 tablet');
    expect(modelValues).toBe(1);
  });

  it('attributes each slot to whichever reader produced it', () => {
    const { origins } = mergeExtractions(
      rulesOf(),
      modelSaid({
        medications: [
          {
            name: 'AMLODIPINE',
            strength: null,
            dose: '1 tablet',
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: false,
          },
        ],
      }),
      SOURCE,
    );

    // The objection to merging is that a merged record is one nobody
    // asserted. Per-value origins are the answer: every value stays
    // attributable to the reader that produced it.
    expect(origins.get('medications[1].name')?.producedBy).toBe('rules');
    expect(origins.get('medications[1].dose')?.producedBy).toBe('model');
  });
});

describe('the model may not invent', () => {
  it('drops a medication that is not on the page', () => {
    const { extraction } = mergeExtractions(
      rulesOf(),
      modelSaid({
        medications: [
          {
            name: 'Warfarin',
            strength: '5 mg',
            dose: null,
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: false,
          },
        ],
      }),
      SOURCE,
    );

    // Dropped at the merge rather than stored and scored down, because what
    // happens next is a patient being shown it and asked to confirm it.
    expect(extraction.medications.map((m) => m.name)).toEqual([
      'METFORMIN',
      'AMLODIPINE',
    ]);
  });

  it('drops an ungrounded scalar', () => {
    const { extraction } = mergeExtractions(
      rulesOf(),
      modelSaid({
        document: {
          type: 'prescription',
          date: null,
          facility: 'Apollo Hospital',
          author: null,
        },
      }),
      SOURCE,
    );

    expect(extraction.document.facility).toBeNull();
  });

  it('drops an ungrounded diagnosis', () => {
    const { extraction } = mergeExtractions(
      rulesOf(),
      modelSaid({ diagnosesRecorded: ['Chronic kidney disease'] }),
      SOURCE,
    );

    expect(extraction.diagnosesRecorded).toEqual([]);
  });

  it('accepts a reflowed follow-up, the one field paraphrase is allowed in', () => {
    // `collectExtractedValues` already exempts followUp from grounding,
    // because turning "Follow up: Review after 30 days." into "Review after
    // 30 days" is the model doing the right thing.
    const { extraction } = mergeExtractions(
      rulesOf(),
      modelSaid({ followUp: ['Review in one month'] }),
      SOURCE,
    );

    expect(extraction.followUp).toEqual(['Review in one month']);
  });

  it('adds a medication the rules missed but the page carries', () => {
    const source = `${SOURCE}\n3.\tTab. ATORVASTATIN`;
    const rules = extractByRules(linesFromText(source), 'prescription');

    const { extraction } = mergeExtractions(
      rules,
      modelSaid({
        medications: [
          {
            name: 'ATORVASTATIN',
            strength: '10 mg',
            dose: null,
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: true,
          },
        ],
      }),
      source,
    );

    expect(extraction.medications.map((m) => m.name)).toContain('ATORVASTATIN');
  });
});

describe('uncertainty survives the merge', () => {
  it('keeps a doubt either reader had', () => {
    const source = 'Rx\nTab. Metformin';
    const rules = extractByRules(linesFromText(source), 'prescription');
    const { extraction } = mergeExtractions(
      rules,
      modelSaid({
        medications: [
          {
            name: 'Metformin',
            strength: null,
            dose: null,
            frequency: null,
            route: null,
            duration: null,
            instructions: null,
            startDate: null,
            stopDate: null,
            uncertain: false,
          },
        ],
      }),
      source,
    );

    expect(extraction.medications[0].uncertain).toBe(true);
  });
});
