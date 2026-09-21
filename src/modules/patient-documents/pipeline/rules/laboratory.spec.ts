import { linesFromText } from '../layout';
import {
  extractInvestigations,
  isHeaderRow,
  parseTableRow,
} from './laboratory';

/** The lab fixture's table, as `layout.ts` renders it. Flagged rows carry five cells. */
const FIXTURE_TABLE = [
  'TEST\tRESULT\tUNIT\tREFERENCE',
  'Haemoglobin\t11.2\t*\tg/dL\t13.0 - 17.0',
  'Total WBC Count\t8400\t/uL\t4000 - 11000',
  'Platelet Count\t250000\t/uL\t150000 - 410000',
  'Packed Cell Volume\t36.4\t*\t%\t40.0 - 50.0',
  'MCV\t82.1\t*\tfL\t83.0 - 101.0',
  'Random Blood Sugar\t168\t*\tmg/dL\t70 - 140',
  'Serum Creatinine\t0.9\tmg/dL\t0.7 - 1.3',
].join('\n');

const rowOf = (text: string) => parseTableRow(linesFromText(text)[0]);

describe('roles by content, not by column', () => {
  it('reads a flagged five-cell row and an unflagged four-cell row alike', () => {
    // The whole argument for content-based roles. Index-based assignment reads
    // the flagged rows one column out — unit as reference range, result as
    // unit — on exactly the rows a patient most needs to be right.
    expect(rowOf('Haemoglobin\t11.2\t*\tg/dL\t13.0 - 17.0')).toEqual({
      test: 'Haemoglobin',
      result: '11.2',
      unit: 'g/dL',
      referenceRange: '13.0 - 17.0',
      flag: '*',
      date: null,
    });

    expect(rowOf('Total WBC Count\t8400\t/uL\t4000 - 11000')).toEqual({
      test: 'Total WBC Count',
      result: '8400',
      unit: '/uL',
      referenceRange: '4000 - 11000',
      flag: null,
      date: null,
    });
  });

  it('reads a qualitative result', () => {
    expect(rowOf('HIV I & II\tNon-reactive\tNon-reactive')).toMatchObject({
      test: 'HIV I & II',
      result: 'Non-reactive',
    });
  });
});

describe('the whole fixture table', () => {
  const { investigations } = extractInvestigations(
    linesFromText(FIXTURE_TABLE),
  );

  it('finds exactly the seven results', () => {
    expect(investigations.map((i) => i.test)).toEqual([
      'Haemoglobin',
      'Total WBC Count',
      'Platelet Count',
      'Packed Cell Volume',
      'MCV',
      'Random Blood Sugar',
      'Serum Creatinine',
    ]);
  });

  it('gives every row a result and a reference range', () => {
    expect(investigations.every((i) => i.result !== null)).toBe(true);
    expect(investigations.every((i) => i.referenceRange !== null)).toBe(true);
  });

  it('flags exactly the four values the report marked', () => {
    expect(investigations.filter((i) => i.flag !== null)).toHaveLength(4);
  });

  it('does not copy the collection date onto every row', () => {
    // The date is printed once at the top. Copied down it asserts each result
    // was measured that day, which makes a stale value look current.
    expect(investigations.every((i) => i.date === null)).toBe(true);
  });
});

describe('what a table row is not', () => {
  it('rejects the header row', () => {
    expect(isHeaderRow(linesFromText('TEST\tRESULT\tUNIT\tREFERENCE')[0])).toBe(
      true,
    );
    expect(rowOf('TEST\tRESULT\tUNIT\tREFERENCE')).toBeNull();
  });

  it('rejects a section banner', () => {
    expect(rowOf('HAEMATOLOGY')).toBeNull();
  });

  it('rejects the footnote that explains the asterisk', () => {
    expect(rowOf('*  Outside the stated reference interval.')).toBeNull();
  });

  it('rejects the header block above the table', () => {
    expect(rowOf('Patient:  Ramesh Kumar\tSample No:  ML-88213')).toBeNull();
    expect(rowOf('Age / Sex:  54 / Male\tCollected:  12/09/2026')).toBeNull();
    expect(rowOf('Referred by:  Dr. Anitha Raghavan')).toBeNull();
  });

  it('rejects a row with a test but no result', () => {
    // It lands in the unclaimed lines instead, where coverage counts it.
    expect(rowOf('Differential Count\t\t')).toBeNull();
  });

  it('does not prefix a sub-test with the heading above it', () => {
    // `Differential Count - Neutrophils` is a string nobody printed, and an
    // invented string is an ungrounded one.
    const { investigations } = extractInvestigations(
      linesFromText('Differential Count\nNeutrophils\t62\t%\t40 - 80'),
    );

    expect(investigations.map((i) => i.test)).toEqual(['Neutrophils']);
  });
});
