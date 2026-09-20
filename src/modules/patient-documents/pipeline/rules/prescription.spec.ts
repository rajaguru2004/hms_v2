import { DocumentLine, linesFromText } from '../layout';
import {
  extractMedications,
  isMedicationHead,
  parseMedicationEntry,
} from './prescription';

/** The three drug blocks of the prescription fixture, as `layout.ts` renders them. */
const FIXTURE_RX = [
  '1.\tTab. METFORMIN 500 mg',
  '1 tablet  -  twice daily  -  oral',
  'After food, 30 days',
  '2.\tTab. AMLODIPINE 5 mg',
  '1 tablet  -  once daily  -  oral',
  'Morning, 30 days',
  '3.\tTab. ATORVASTATIN 10 mg',
  '1 tablet  -  at bedtime  -  oral',
  '30 days',
].join('\n');

const oneOf = (text: string) =>
  parseMedicationEntry(linesFromText(text))?.medication;

describe('the prescription fixture', () => {
  const { medications } = extractMedications(linesFromText(FIXTURE_RX));

  it('finds all three drugs and nothing else', () => {
    expect(medications.map((m) => m.name)).toEqual([
      'METFORMIN',
      'AMLODIPINE',
      'ATORVASTATIN',
    ]);
  });

  it('reads every slot off the three-line block', () => {
    expect(medications[0]).toEqual({
      name: 'METFORMIN',
      strength: '500 mg',
      dose: '1 tablet',
      frequency: 'twice daily',
      route: 'oral',
      duration: '30 days',
      instructions: 'After food',
      startDate: null,
      stopDate: null,
      uncertain: false,
    });
  });

  it('earns its certainty instead of assuming it', () => {
    // The inverse of the model path, where an unstated `uncertain` means
    // uncertain because a model's silence is uninformative. Here the rules
    // know which evidence they had.
    expect(medications.every((m) => m.uncertain)).toBe(false);
  });
});

describe('what a medication line may not be read as', () => {
  it('does not invent a route from the dose form', () => {
    // `Tab.` does not mean oral and `Inj.` does not mean intravenous. Either
    // would be a value nobody wrote on the page.
    expect(oneOf('Tab. Metformin 500 mg OD')?.route).toBeNull();
    expect(oneOf('Inj. Ceftriaxone 1 g BD')?.route).toBeNull();
  });

  it('does not expand slot notation into an abbreviation', () => {
    expect(oneOf('Cap. Amoxycillin 500mg 1-0-1 x 5 days')?.frequency).toBe(
      '1-0-1',
    );
  });

  it('does not read a lab table row as a drug', () => {
    // Four cells and a reference range. Without both guards, every flagged
    // row in a haematology report becomes a prescribed medicine.
    const [row] = linesFromText('Haemoglobin\t11.2\tg/dL\t13.0 - 17.0');

    expect(isMedicationHead(row)).toBe(false);
  });
});

describe('the shapes an Indian prescription is written in', () => {
  it('reads a single-line entry', () => {
    expect(
      oneOf('Cap. Amoxycillin 500mg 1-0-1 x 5 days (after food)'),
    ).toMatchObject({
      name: 'Amoxycillin',
      strength: '500mg',
      frequency: '1-0-1',
      duration: 'x 5 days',
      instructions: 'after food',
    });
  });

  it('reads a route and a duration when the document wrote them', () => {
    expect(oneOf('Inj. Ceftriaxone 1 g IV BD x 3 days')).toMatchObject({
      name: 'Ceftriaxone',
      strength: '1 g',
      route: 'IV',
      frequency: 'BD',
      duration: 'x 3 days',
    });
  });

  it('reads a millilitre figure on a syrup as a dose, not a strength', () => {
    expect(oneOf('Syp. Ibugesic Plus 5ml TDS x 3 days')).toMatchObject({
      name: 'Ibugesic Plus',
      dose: '5ml',
      strength: null,
      frequency: 'TDS',
    });
  });

  it('keeps a bare-number strength inside the name rather than guessing', () => {
    // `Telma 40` is Indian shorthand with no unit. Splitting it would invent a
    // strength; keeping it verbatim is correct, costs entity completeness, and
    // therefore escalates — which is the right outcome.
    expect(oneOf('Tab. Telma 40 ½ tab OD')).toMatchObject({
      name: 'Telma 40',
      strength: null,
      dose: '½ tab',
      frequency: 'OD',
    });
  });

  it('treats a bedtime instruction as the frequency only when there is no other', () => {
    expect(
      oneOf('Tab. Atorvastatin 10 mg\n1 tablet - at bedtime - oral'),
    ).toMatchObject({
      frequency: 'at bedtime',
      instructions: null,
    });

    expect(oneOf('Tab. Atorvastatin 10 mg OD at bedtime')).toMatchObject({
      frequency: 'OD',
      instructions: 'at bedtime',
    });
  });
});

describe('uncertainty, measured from evidence', () => {
  /** A line whose name cell the recogniser read badly. */
  function poorlyRead(text: string, confidence: number): DocumentLine {
    const cells = text.split('\t').map((cell) => ({
      text: cell.trim(),
      confidence,
      left: null,
    }));
    return {
      page: 1,
      index: 0,
      cells,
      text: cells.map((c) => c.text).join('\t'),
      confidence,
      top: null,
      height: null,
    };
  }

  it('flags a name read off bad pixels', () => {
    const parsed = parseMedicationEntry([
      poorlyRead('Tab. METFORMIN 500 mg BD', 0.5),
    ]);

    expect(parsed?.medication.uncertain).toBe(true);
    expect(parsed?.reasons).toContain('low_block_confidence');
  });

  it('flags a name with nothing beside it', () => {
    const parsed = parseMedicationEntry(linesFromText('Tab. Metformin'));

    expect(parsed?.medication.uncertain).toBe(true);
    expect(parsed?.reasons).toContain('no_dosing_parsed');
  });

  it('does not read a schedule that cannot be one', () => {
    // `1-0-8` is not a dosing grid read badly — SLOT_NOTATION admits only
    // 0-2, so it is not read at all, and the entry falls to thin evidence.
    const parsed = parseMedicationEntry(
      linesFromText('Tab. Metformin 500 mg 1-0-8'),
    );

    expect(parsed?.medication.frequency).toBeNull();
    expect(parsed?.reasons).toContain('thin_evidence');
  });

  it('drops a head whose name reduced to nothing', () => {
    // Its lines stay unclaimed, so coverage counts them against the rule set
    // rather than quietly reporting a medication called "mg".
    const { medications } = extractMedications(linesFromText('Tab. 500 mg OD'));

    expect(medications).toEqual([]);
  });
});
