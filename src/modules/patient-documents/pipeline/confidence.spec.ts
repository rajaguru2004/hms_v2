import {
  buildProvenance,
  meanOcrConfidence,
  normaliseForMatch,
} from './confidence';
import { emptyExtraction, ExtractedDocument } from './extraction-schema';

const PAGE_ONE = [
  'PRESCRIPTION',
  'Patient: Ramesh Kumar',
  'Date: 12/09/2026',
  '1. Tab. METFORMIN 500 mg',
  '1 tablet - twice daily - oral',
  'Dr.Anitha Raghavan,MD',
].join('\n');

function withMedication(
  name: string,
  strength: string | null = '500 mg',
): ExtractedDocument {
  const extraction = emptyExtraction('prescription');
  extraction.document.date = '12/09/2026';
  extraction.document.author = 'Dr. Anitha Raghavan, MD';
  extraction.patient.name = 'Ramesh Kumar';
  extraction.medications = [
    {
      name,
      strength,
      dose: '1 tablet',
      frequency: 'twice daily',
      route: 'oral',
      duration: null,
      instructions: null,
      startDate: null,
      stopDate: null,
      uncertain: false,
    },
  ];
  return extraction;
}

const PAGES = [{ page: 1, text: PAGE_ONE, meanConfidence: 0.9859 }];

describe('grounding — is the value actually on the page', () => {
  it('ignores the punctuation the recogniser ran together', () => {
    // "Dr.Anitha Raghavan,MD" on the page against "Dr. Anitha Raghavan, MD"
    // from the model. Same evidence; neither spelling is wrong.
    expect(normaliseForMatch('Dr.Anitha Raghavan,MD')).toBe(
      normaliseForMatch('Dr. Anitha Raghavan, MD'),
    );
  });

  it('scores an extraction that copied the page at 1', () => {
    const result = buildProvenance(withMedication('METFORMIN'), PAGES, 'doc-1');

    expect(result.extractionConfidence).toBe(1);
    expect(result.ungrounded).toEqual([]);
  });

  it('names the value that is not on the page', () => {
    // The failure that matters: a medication nobody prescribed.
    const result = buildProvenance(
      withMedication('GLIMEPIRIDE'),
      PAGES,
      'doc-1',
    );

    expect(result.ungrounded).toContain('medications[0].name');
    expect(result.extractionConfidence).toBeLessThan(1);
    expect(
      result.sources.find((s) => s.field === 'medications[0].name')?.grounded,
    ).toBe(false);
  });

  it('cites the page a value was found on', () => {
    const result = buildProvenance(
      withMedication('METFORMIN'),
      [
        {
          page: 1,
          text: 'REFERRAL LETTER\nDear Dr Menon',
          meanConfidence: 0.97,
        },
        { page: 2, text: PAGE_ONE, meanConfidence: 0.98 },
      ],
      'doc-1',
    );

    const cited = result.sources.find((s) => s.field === 'medications[0].name');
    expect(cited?.page).toBe(2);
    expect(cited?.documentId).toBe('doc-1');
    expect(cited?.source).toBe('uploaded_document');
    expect(cited?.verification).toBe('unverified');
  });

  it('carries the OCR confidence of the page the value came from', () => {
    const result = buildProvenance(withMedication('METFORMIN'), PAGES, 'doc-1');
    const cited = result.sources.find((s) => s.field === 'medications[0].name');

    expect(cited?.ocrConfidence).toBe(0.9859);
  });

  it('answers null, not zero, when there was nothing to check', () => {
    // An empty extraction has an undefined quality. Zero would sort it beside
    // an extraction whose every value was invented.
    const result = buildProvenance(emptyExtraction('other'), PAGES, 'doc-1');

    expect(result.extractionConfidence).toBeNull();
  });
});

describe('the two confidences stay apart', () => {
  it('measures OCR across the pages and nothing else', () => {
    expect(
      meanOcrConfidence([
        { page: 1, text: 'a', meanConfidence: 0.9 },
        { page: 2, text: 'b', meanConfidence: 0.8 },
      ]),
    ).toBe(0.85);
  });

  it('is null when the recogniser reported nothing', () => {
    expect(
      meanOcrConfidence([{ page: 1, text: 'a', meanConfidence: null }]),
    ).toBeNull();
  });

  it('does not let a perfect OCR read carry a bad extraction', () => {
    // The whole reason the numbers are separate. A clean scan whose extraction
    // invented a drug must not average out to "fine".
    const pages = [{ page: 1, text: PAGE_ONE, meanConfidence: 1 }];
    const result = buildProvenance(
      withMedication('GLIMEPIRIDE', '2 mg'),
      pages,
      'd',
    );

    expect(meanOcrConfidence(pages)).toBe(1);
    expect(result.extractionConfidence).toBeLessThan(0.8);
    expect(result.ungrounded).toEqual([
      'medications[0].name',
      'medications[0].strength',
    ]);
  });
});
