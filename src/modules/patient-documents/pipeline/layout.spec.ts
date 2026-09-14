import { OcrBlock, OcrPage } from '../ocr/sidecar-ocr.client';
import { groupIntoRows, readPageText } from './layout';

/** A recognised region, given a bounding box by its row and column. */
function block(text: string, top: number, left: number, height = 30): OcrBlock {
  const right = left + Math.max(40, text.length * 12);
  return {
    text,
    box: [
      [left, top],
      [right, top],
      [right, top + height],
      [left, top + height],
    ],
    confidence: 0.98,
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
