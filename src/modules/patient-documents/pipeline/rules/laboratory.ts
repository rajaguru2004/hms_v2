import { DocumentLine } from '../layout';
import { ExtractedInvestigation } from '../extraction-schema';
import { clean } from '../extractor';
import {
  BOILERPLATE,
  DATE_VALUE,
  FLAG_CELL,
  RANGE_CELL,
  RESULT_NUMERIC,
  RESULT_QUALITATIVE,
  UNIT_CELL,
} from './tokens';
import { LineKey, lineKey } from './types';

/**
 * Results tables, read by what each cell *is* rather than where it sits.
 *
 * This is the case where rules should beat the model outright, and `layout.ts`
 * says why in its own header: handed a flattened table, a model has to infer
 * which four consecutive lines were one row, and its documented failure is
 * attaching a reference range to the test above. The boxes already answer that
 * question, so nothing has to be inferred.
 *
 * Roles are assigned by content, right to left, and not by column index. The
 * fixture is the argument: a flagged row carries five cells and an unflagged
 * one carries four, because the `*` only exists when a value is out of range.
 * Index-based assignment reads the flagged rows one column out — unit as
 * reference range, result as unit — on exactly the rows a patient most needs
 * to be right.
 */

/** Column headings, used to find the table and claim its header row. */
const HEADER_CELL =
  /^(?:test|tests|investigation|parameter|description|examination|analyte|result|results|value|observed(?:\s+value)?|patient\s+value|unit|units|reference|reference\s+(?:range|value)|ref\.?\s*range|bio\.?\s*ref\.?\s*interval|biological\s+reference\s+interval|normal\s+(?:range|value)|normal|flag|status|remarks?)s?$/i;

/** A first cell that is a labelled field, not a test name. */
const LABELLED = /^[A-Za-z][A-Za-z0-9 ./'()&-]{1,34}?\s*:/;

/** Test names are words. A cell this numeric is a value that drifted left. */
const MIN_LETTER_RATIO = 0.6;

function letterRatio(text: string): number {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const solid = text.replace(/\s/g, '').length;
  return solid === 0 ? 0 : letters / solid;
}

/** Whether this row is the table's heading rather than a result. */
export function isHeaderRow(line: DocumentLine): boolean {
  const cells = line.cells.filter((cell) => cell.text.trim() !== '');
  return (
    cells.length >= 2 &&
    cells.every((cell) => HEADER_CELL.test(cell.text.trim()))
  );
}

/**
 * One row of a results table, or null.
 *
 * Roles are taken right to left because the rightmost columns are the ones
 * with closed vocabularies — a reference range and a unit are recognisable on
 * sight, a result is merely a number, and a test name is whatever is left.
 * Working inwards from the recognisable end means the ambiguous cells are
 * assigned last, when fewer candidates remain.
 */
export function parseTableRow(
  line: DocumentLine,
): ExtractedInvestigation | null {
  const cells = line.cells.map((cell) => cell.text.trim());
  if (cells.length < 2) return null;
  if (isHeaderRow(line)) return null;
  if (BOILERPLATE.test(line.text.trim())) return null;
  if (LABELLED.test(cells[0])) return null;

  const spare = new Set(cells.map((_, index) => index));
  const take = (
    predicate: (text: string) => boolean,
    from: 'left' | 'right',
  ): string | null => {
    const order = [...spare].sort((a, b) => (from === 'left' ? a - b : b - a));
    for (const index of order) {
      if (index === 0) continue; // cell 0 is the test name's seat
      if (!predicate(cells[index])) continue;
      spare.delete(index);
      return cells[index];
    }
    return null;
  };

  const referenceRange = take((text) => RANGE_CELL.test(text), 'right');
  const unit = take((text) => UNIT_CELL.test(text), 'right');
  const flag = take((text) => FLAG_CELL.test(text), 'right');
  const result = take(
    (text) => RESULT_NUMERIC.test(text) || RESULT_QUALITATIVE.test(text),
    'left',
  );

  const test = clean(cells[0]);
  if (test === null || result === null) return null;
  if (test.length < 3 || letterRatio(test) < MIN_LETTER_RATIO) return null;

  // The collection date is printed once, at the top of the report. Copying it
  // onto every row would say each result was measured that day, which the
  // document does not state and which makes a stale value look current. Only
  // a date printed *in the row* becomes the row's date.
  //
  // Read from the cells no role claimed, never from all of them: a cell that
  // is already this row's reference range is not also its date, and numeric
  // ranges are close enough in shape to dates to be mistaken for one.
  const inRow = [...spare]
    .filter((index) => index !== 0)
    .map((index) => cells[index])
    .find((text) => DATE_VALUE.test(text));

  return {
    test,
    result: clean(result),
    unit: clean(unit),
    referenceRange: clean(referenceRange),
    flag: clean(flag),
    date: inRow ? (DATE_VALUE.exec(inRow)?.[0] ?? null) : null,
  };
}

/** Every results row in [lines], and the lines they and their header consumed. */
export function extractInvestigations(lines: readonly DocumentLine[]): {
  investigations: ExtractedInvestigation[];
  claimed: Set<LineKey>;
  lineOf: DocumentLine[];
} {
  const investigations: ExtractedInvestigation[] = [];
  const claimed = new Set<LineKey>();
  const lineOf: DocumentLine[] = [];

  for (const line of lines) {
    // The header row is understood even though it yields no value, so it is
    // claimed. Left unclaimed it counts against coverage on every clean table.
    if (isHeaderRow(line)) {
      claimed.add(lineKey(line));
      continue;
    }

    const row = parseTableRow(line);
    if (!row) continue;

    investigations.push(row);
    lineOf.push(line);
    claimed.add(lineKey(line));
  }

  return { investigations, claimed, lineOf };
}
