import {
  BOILERPLATE,
  DATE_VALUE,
  DOSE,
  DURATION_EXPLICIT,
  FLAG_CELL,
  FORM_PREFIX,
  FREQUENCY_CODE,
  RANGE_CELL,
  RESULT_NUMERIC,
  RESULT_QUALITATIVE,
  ROUTE,
  SLOT_NOTATION,
  STRENGTH,
  UNIT_CELL,
  claim,
  residue,
  Span,
} from './tokens';

describe('slot notation, and the lab report it must not read', () => {
  it.each(['1-0-1', '1-1-1', '0-0-1', '1 - 0 - 1', '1-0-0-1'])(
    'reads %s as a dosing schedule',
    (text) => {
      expect(SLOT_NOTATION.test(text)).toBe(true);
    },
  );

  // The highest-value negatives in this suite. A lab report's reference range
  // column read as a dosing grid puts a medication nobody prescribed on a
  // chart, and both of these sit in the existing lab fixture.
  it.each([
    '13.0 - 17.0',
    '4000 - 11000',
    '150000 - 410000',
    '0.5 - 1.4',
    '12.5',
  ])('does not read %s as a dosing schedule', (text) => {
    expect(SLOT_NOTATION.test(text)).toBe(false);
  });

  it('does not read a date as a dosing schedule', () => {
    expect(SLOT_NOTATION.test('1-0-2026')).toBe(false);
  });
});

describe('the prescription lexicon', () => {
  it.each([
    '500mg',
    '500 mg',
    '10 mcg',
    '1 g',
    '125 mg/5 ml',
    '500/125 mg',
    '40 IU',
  ])('reads %s as a strength', (text) => {
    expect(STRENGTH.test(text)).toBe(true);
  });

  it.each(['Tab. ', 'T. ', 'Cap ', 'Syp. ', 'Inj. ', 'Oint. '])(
    'reads %s as a form prefix when a name follows',
    (prefix) => {
      expect(FORM_PREFIX.test(`${prefix}Metformin`)).toBe(true);
    },
  );

  it.each([
    'OD',
    'BD',
    'TDS',
    'QID',
    'HS',
    'SOS',
    'PRN',
    'twice daily',
    'once a day',
  ])('reads %s as a frequency', (text) => {
    expect(FREQUENCY_CODE.test(text)).toBe(true);
  });

  it.each(['1 tablet', '2 tabs', '½ tab', '5 ml', '2 drops', '1 puff'])(
    'reads %s as a dose',
    (text) => {
      expect(DOSE.test(text)).toBe(true);
    },
  );

  it.each(['x 5 days', 'for 1 week', '× 10 d', 'x 30 days'])(
    'reads %s as a duration',
    (text) => {
      expect(DURATION_EXPLICIT.test(text)).toBe(true);
    },
  );

  it.each(['oral', 'IV', 'I.M.', 'sublingual', 'topical', 'per rectum'])(
    'reads %s as a route',
    (text) => {
      expect(ROUTE.test(text)).toBe(true);
    },
  );
});

describe('the laboratory lexicon', () => {
  it.each(['g/dL', 'mg/dL', '/uL', 'cells/cumm', '%', 'IU/L'])(
    'reads %s as a unit cell',
    (text) => {
      expect(UNIT_CELL.test(text)).toBe(true);
    },
  );

  it.each(['13.0 - 17.0', '4000 - 11000', '< 200', 'Negative', 'up to 40'])(
    'reads %s as a reference range cell',
    (text) => {
      expect(RANGE_CELL.test(text)).toBe(true);
    },
  );

  it('does not read a bare result as a reference range', () => {
    expect(RANGE_CELL.test('11.2')).toBe(false);
  });

  it.each(['H', 'L', '*', '**', 'High', '↑'])(
    'reads %s as a flag cell',
    (text) => {
      expect(FLAG_CELL.test(text)).toBe(true);
    },
  );

  it('does not read a test name as a flag', () => {
    expect(FLAG_CELL.test('Haemoglobin')).toBe(false);
  });

  it.each(['11.2', '8400', '< 5'])('reads %s as a numeric result', (text) => {
    expect(RESULT_NUMERIC.test(text)).toBe(true);
  });

  it.each(['Positive', 'Negative', 'Not detected', 'Nil'])(
    'reads %s as a qualitative result',
    (text) => {
      expect(RESULT_QUALITATIVE.test(text)).toBe(true);
    },
  );
});

describe('dates', () => {
  it.each([
    '12/09/2026',
    '12-09-2026',
    '2026-09-12',
    '12-Sep-2026',
    '12 Sep 2026',
  ])('reads %s as a date', (text) => {
    expect(DATE_VALUE.test(text)).toBe(true);
  });

  it('takes only the date out of a timestamp, so the slice still grounds', () => {
    expect(DATE_VALUE.exec('12/09/2026 11:24')?.[0]).toBe('12/09/2026');
  });

  // On every haematology report ever printed. With mismatched separators
  // allowed, this parses as the 13th of month 0 and the row carries a date
  // the laboratory never wrote.
  it.each(['13.0 - 17.0', '0.7 - 1.3', '70 - 140', '40.0 - 50.0'])(
    'does not read the reference range %s as a date',
    (text) => {
      expect(DATE_VALUE.test(text)).toBe(false);
    },
  );

  it('does not accept a date whose separators disagree', () => {
    expect(DATE_VALUE.test('12/09-2026')).toBe(false);
  });
});

describe('boilerplate', () => {
  it.each([
    'Page 1 of 2',
    '[page 2]',
    'This is a computer generated report',
    'Not valid for medico-legal purposes',
    'Tel: 080-12345678',
    'www.metrolab.in',
    '--------------------',
  ])('excludes %s from the coverage denominator', (text) => {
    expect(BOILERPLATE.test(text)).toBe(true);
  });

  it('does not exclude a line a rule should read', () => {
    expect(BOILERPLATE.test('Tab. METFORMIN 500 mg')).toBe(false);
  });
});

describe('span claiming', () => {
  it('stops a later pattern re-reading what an earlier one took', () => {
    // `500 mg` is a strength. Without claiming, DOSE would read the same
    // characters again as an amount and the name would lose them too.
    const line = 'Tab. METFORMIN 500 mg 1 tablet twice daily';
    const taken: Span[] = [];

    expect(claim(line, STRENGTH, taken)?.text).toBe('500 mg');
    expect(claim(line, DOSE, taken)?.text).toBe('1 tablet');
    expect(claim(line, FREQUENCY_CODE, taken)?.text).toBe('twice daily');
  });

  it('returns null when everything matching is already taken', () => {
    const taken: Span[] = [];
    expect(claim('500 mg', STRENGTH, taken)?.text).toBe('500 mg');
    expect(claim('500 mg', STRENGTH, taken)).toBeNull();
  });

  it('leaves the drug name as the longest survivor', () => {
    const line = 'Tab. METFORMIN 500 mg 1 tablet twice daily oral';
    const taken: Span[] = [];
    claim(line, FORM_PREFIX, taken);
    claim(line, STRENGTH, taken);
    claim(line, ROUTE, taken);
    claim(line, FREQUENCY_CODE, taken);
    claim(line, DOSE, taken);

    expect(residue(line, taken)).toBe('METFORMIN');
  });

  it('keeps a two-word brand name whole', () => {
    const line = 'Syp. Ibugesic Plus 5ml TDS x 3 days';
    const taken: Span[] = [];
    claim(line, FORM_PREFIX, taken);
    claim(line, DURATION_EXPLICIT, taken);
    claim(line, FREQUENCY_CODE, taken);
    claim(line, DOSE, taken);

    expect(residue(line, taken)).toBe('Ibugesic Plus');
  });
});
