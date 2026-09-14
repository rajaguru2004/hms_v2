import { OcrBlock, OcrPage } from '../ocr/sidecar-ocr.client';

/**
 * Reading order, from the coordinates the recogniser already returned.
 *
 * Documents §25 gives this its own box in the architecture, separate from both
 * OCR and the model, and the lab report is why. PP-OCRv5 returns the blocks of
 * a seven-row results table in an order that walks the columns as much as the
 * rows, so the engine's own `"\n".join` reads:
 *
 *     Haemoglobin
 *     11.2
 *     g/dL
 *     13.0 - 17.0
 *     Total WBC Count
 *     8400
 *
 * A language model handed that has to infer that four consecutive lines were
 * one row, and it will usually be right and occasionally attach a reference
 * range to the test above. The boxes say which blocks shared a line, so nothing
 * has to be inferred: group by vertical overlap, sort by x, join with tabs.
 *
 * This is deliberately geometry and not cleverness. It does not know what a
 * table is, it will not merge two columns of an actual two-column letter, and
 * it makes no attempt at cell alignment. It answers one question — which of
 * these blocks were printed on the same line — which is the question the
 * `"\n".join` throws away.
 */

/**
 * How much of a line's height two blocks must share to count as one row.
 *
 * Generous, because the boxes around a tall test name and a short numeric
 * result are not the same height and their centres do not coincide.
 */
const ROW_OVERLAP_RATIO = 0.5;

interface PlacedBlock {
  block: OcrBlock;
  top: number;
  bottom: number;
  left: number;
}

/**
 * The page's text in reading order, rows tab-separated.
 *
 * Falls back to the engine's own ordering when the blocks carry no usable
 * coordinates — which is what a vision-model transcription looks like, and is
 * the right answer there because the model produced its text in reading order
 * to begin with.
 */
export function readPageText(page: OcrPage): string {
  const rows = groupIntoRows(page.blocks);
  if (rows.length === 0) return page.text ?? '';
  return rows
    .map((row) => row.map((block) => block.text.trim()).join('\t'))
    .join('\n');
}

/** Every page of a document, separated so a citation can name a page. */
export function readDocumentText(pages: OcrPage[]): string {
  return pages
    .map((page, index) =>
      pages.length > 1
        ? `[page ${index + 1}]\n${readPageText(page)}`
        : readPageText(page),
    )
    .join('\n\n');
}

/** Blocks gathered into printed lines, top to bottom, each left to right. */
export function groupIntoRows(blocks: OcrBlock[]): OcrBlock[][] {
  const placed: PlacedBlock[] = [];

  for (const block of blocks) {
    const ys = (block.box ?? []).map((point) => point?.[1]);
    const xs = (block.box ?? []).map((point) => point?.[0]);
    if (ys.length === 0 || ys.some((y) => typeof y !== 'number')) continue;
    placed.push({
      block,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      left: Math.min(...xs),
    });
  }

  if (placed.length === 0) return [];

  placed.sort((a, b) => a.top - b.top || a.left - b.left);

  const rows: PlacedBlock[][] = [];
  for (const candidate of placed) {
    const current = rows[rows.length - 1];
    if (current && sharesLine(current, candidate)) {
      current.push(candidate);
    } else {
      rows.push([candidate]);
    }
  }

  return rows.map((row) =>
    [...row].sort((a, b) => a.left - b.left).map((entry) => entry.block),
  );
}

/**
 * Whether [candidate] was printed on the same line as a row already open.
 *
 * Measured against the row's own extent rather than against its first block, so
 * a row that starts with a short header and continues with a taller one keeps
 * accepting members. The ratio is taken over the *shorter* of the two boxes:
 * against the taller one, a small superscript marker sitting squarely inside a
 * tall cell would score as barely overlapping and start a row of its own.
 */
function sharesLine(row: PlacedBlock[], candidate: PlacedBlock): boolean {
  const top = Math.min(...row.map((entry) => entry.top));
  const bottom = Math.max(...row.map((entry) => entry.bottom));

  const overlap =
    Math.min(bottom, candidate.bottom) - Math.max(top, candidate.top);
  if (overlap <= 0) return false;

  const shorter = Math.min(bottom - top, candidate.bottom - candidate.top);
  if (shorter <= 0) return false;

  return overlap / shorter >= ROW_OVERLAP_RATIO;
}
