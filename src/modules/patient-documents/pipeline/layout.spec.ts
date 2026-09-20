import { OcrBlock, OcrPage } from '../ocr/sidecar-ocr.client';
import {
  groupIntoRows,
  linesFromText,
  readDocumentLines,
  readPageText,
} from './layout';

/** A recognised region, given a bounding box by its row and column. */
function block(
  text: string,
  top: number,
  left: number,
  height = 30,
  confidence = 0.98,
): OcrBlock {
  const right = left + Math.max(40, text.length * 12);
  return {
    text,
    box: [
      [left, top],
      [right, top],
      [right, top + height],
      [left, top + height],
    ],
    confidence,
  };
}

function page(blocks: OcrBlock[]): OcrPage {
  return {
    blocks,
    text: blocks.map((b) => b.text).join('\n'),
    meanConfidence: 0.98,
  };
}

describe('reading order from coordinates', () => {
  it('reassembles a results table the recogniser returned column-first', () => {
    // The real failure: PP-OCRv5 walks the lab report's columns, so the
    // engine's own join reads test, result, unit, range as four lines.
    const table = page([
      block('Haemoglobin', 400, 90),
      block('Total WBC Count', 444, 90),
      block('11.2', 400, 600),
      block('8400', 444, 600),
      block('g/dL', 400, 800),
      block('/uL', 444, 800),
      block('13.0 - 17.0', 400, 980),
      block('4000 - 11000', 444, 980),
    ]);

    expect(readPageText(table)).toBe(
      [
        'Haemoglobin\t11.2\tg/dL\t13.0 - 17.0',
        'Total WBC Count\t8400\t/uL\t4000 - 11000',
      ].join('\n'),
    );
  });

  it('keeps a superscript marker on the line it belongs to', () => {
    // A small "*" box sits well inside a tall cell. Measured against the taller
    // box it barely overlaps, which would start a row of its own.
    const rows = groupIntoRows([
      block('Haemoglobin', 400, 90, 34),
      block('*', 408, 730, 16),
      block('11.2', 400, 600, 34),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].map((b) => b.text)).toEqual(['Haemoglobin', '11.2', '*']);
  });

  it('keeps separate lines separate', () => {
    const rows = groupIntoRows([
      block('PRESCRIPTION', 100, 90),
      block('Patient: Ramesh Kumar', 160, 90),
      block('Date: 12/09/2026', 160, 700),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1].map((b) => b.text)).toEqual([
      'Patient: Ramesh Kumar',
      'Date: 12/09/2026',
    ]);
  });

  it('falls back to the engine order when there are no coordinates', () => {
    // What a vision-model transcription looks like — and the right answer
    // there, because the model produced it in reading order already.
    const transcribed: OcrPage = {
      blocks: [],
      text: 'PRESCRIPTION\nTab. METFORMIN 500 mg',
      meanConfidence: 0,
    };

    expect(readPageText(transcribed)).toBe(
      'PRESCRIPTION\nTab. METFORMIN 500 mg',
    );
  });
});

describe('lines, for the rules extractor', () => {
  const table = page([
    block('Haemoglobin', 400, 90),
    block('11.2', 400, 600),
    block('g/dL', 400, 800),
    block('13.0 - 17.0', 400, 980),
    block('Total WBC Count', 444, 90),
    block('8400', 444, 600),
  ]);

  it('renders a line exactly as readPageText renders that row', () => {
    // The invariant the whole deterministic path rests on. `confidence.ts`
    // grounds a value against readPageText's output, and every rules value is
    // a slice of a line's `text`. If these two ever disagreed, correctly-read
    // values would be reported as invented.
    const lines = readDocumentLines([table]);

    expect(lines.map((line) => line.text).join('\n')).toBe(readPageText(table));
  });

  it('carries the column geometry that readPageText throws away', () => {
    const [first] = readDocumentLines([table]);

    expect(first.cells.map((cell) => cell.text)).toEqual([
      'Haemoglobin',
      '11.2',
      'g/dL',
      '13.0 - 17.0',
    ]);
    expect(first.cells.map((cell) => cell.left)).toEqual([90, 600, 800, 980]);
    expect(first.page).toBe(1);
    expect(first.index).toBe(0);
  });

  it('takes the worst cell confidence, not the mean', () => {
    // A line is as legible as its worst word. Averaging lets three crisp cells
    // carry one garbled drug name over any threshold — and the garbled one is
    // exactly the cell worth escalating over.
    const [line] = readDocumentLines([
      page([
        block('Tab.', 100, 90, 30, 0.99),
        block('METF0RM1N', 100, 200, 30, 0.42),
        block('500 mg', 100, 500, 30, 0.97),
      ]),
    ]);

    expect(line.confidence).toBe(0.42);
  });

  it('numbers pages, so a citation can name one', () => {
    const lines = readDocumentLines([
      page([block('page one', 100, 90)]),
      page([block('page two', 100, 90)]),
    ]);

    expect(lines.map((line) => [line.page, line.index])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it('splits text into cells on tabs, for fixtures and vision transcripts', () => {
    const lines = linesFromText('Patient:\tRamesh Kumar\nDate:\t12/09/2026');

    expect(lines).toHaveLength(2);
    expect(lines[0].cells.map((cell) => cell.text)).toEqual([
      'Patient:',
      'Ramesh Kumar',
    ]);
    expect(lines[1].text).toBe('Date:\t12/09/2026');
  });

  it('reports an absent coordinate as unknown, never as low', () => {
    // A transcript has no boxes. Reading a measurement out of that absence is
    // how "we could not tell" becomes "we measured it and it was bad".
    const [line] = linesFromText('Tab. METFORMIN 500 mg');

    expect(line.confidence).toBe(1);
    expect(line.top).toBeNull();
    expect(line.cells[0].left).toBeNull();
  });

  it('falls back to the engine order when a page has no coordinates', () => {
    const transcribed: OcrPage = {
      blocks: [],
      text: 'PRESCRIPTION\nTab. METFORMIN 500 mg',
      meanConfidence: 0,
    };

    expect(readDocumentLines([transcribed]).map((line) => line.text)).toEqual([
      'PRESCRIPTION',
      'Tab. METFORMIN 500 mg',
    ]);
  });
});
