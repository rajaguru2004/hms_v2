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
 * One printed row, rendered.
 *
 * The single definition of how a row becomes a string, used by both
 * [readPageText] and [readDocumentLines]. The two must agree byte for byte:
 * `confidence.ts` grounds a value by asking whether it appears in the text
 * `readPageText` produced, and the rules extractor only ever emits slices of a
 * [DocumentLine.text]. If these two ever rendered a row differently, every
 * rules-extracted value on that row would read as ungrounded.
 */
function rowText(row: OcrBlock[]): string {
  return row.map((block) => block.text.trim()).join('\t');
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
  return rows.map(rowText).join('\n');
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

/**
 * One cell of a printed line — a single recogniser block, with what it knew.
 *
 * `confidence` and `left` are the two things `readPageText` throws away and the
 * rules extractor cannot work without: the first is the only honest input to a
 * medication's `uncertain` flag (a measurement of the pixels the name came
 * from, not a model's opinion of itself), and the second is what tells a lab
 * table's columns apart and what attaches an indented continuation line to the
 * drug above it.
 */
export interface LineCell {
  /** Verbatim, trimmed. Never normalised — see [DocumentLine.text]. */
  text: string;
  /** The recogniser's score for this block. 1 when it did not say. */
  confidence: number;
  /** Left edge in page pixels. Null for text-derived lines, which have no boxes. */
  left: number | null;
}

/**
 * A printed line, with the geometry that proves it was one.
 *
 * The rules extractor's input. Every value it emits is a contiguous slice of
 * some line's [text], which is what makes the whole deterministic path
 * grounded by construction rather than by checking.
 */
export interface DocumentLine {
  /** 1-based. */
  page: number;
  /** 0-based within the page. With [page], the key a rule claims. */
  index: number;
  cells: LineCell[];
  /** Cells tab-joined — byte-identical to this row inside [readPageText]. */
  text: string;
  /**
   * The *minimum* cell confidence, not the mean.
   *
   * A line is as legible as its worst word. Averaging lets six crisp cells
   * carry one garbled drug name over any threshold, and the garbled one is
   * precisely the cell worth escalating over.
   */
  confidence: number;
  /** Top edge and height in page pixels; null for text-derived lines. */
  top: number | null;
  height: number | null;
}

/** A block's confidence, defaulting to "it did not say" rather than to zero. */
function blockConfidence(block: OcrBlock): number {
  return typeof block.confidence === 'number' &&
    Number.isFinite(block.confidence)
    ? block.confidence
    : 1;
}

/** One page as lines, with geometry when the blocks carried any. */
function pageLines(page: OcrPage, pageNumber: number): DocumentLine[] {
  const rows = groupIntoRows(page.blocks);
  if (rows.length === 0) return linesFromText(page.text ?? '', pageNumber);

  return rows.map((row, index) => {
    const cells: LineCell[] = row.map((block) => {
      const xs = (block.box ?? []).map((point) => point?.[0]);
      const usable = xs.length > 0 && xs.every((x) => typeof x === 'number');
      return {
        text: block.text.trim(),
        confidence: blockConfidence(block),
        left: usable ? Math.min(...xs) : null,
      };
    });

    const ys = row
      .flatMap((block) => (block.box ?? []).map((point) => point?.[1]))
      .filter((y): y is number => typeof y === 'number');

    return {
      page: pageNumber,
      index,
      cells,
      text: rowText(row),
      confidence: cells.reduce(
        (lowest, cell) => Math.min(lowest, cell.confidence),
        1,
      ),
      top: ys.length > 0 ? Math.min(...ys) : null,
      height: ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : null,
    };
  });
}

/**
 * Every page of a document as lines. The rules extractor's input.
 *
 * Page-numbered rather than flattened, because §16 wants a citation to name a
 * page and because a coverage metric that cannot tell page 1 line 4 from page 2
 * line 4 counts the same line twice.
 */
export function readDocumentLines(pages: OcrPage[]): DocumentLine[] {
  return pages.flatMap((page, index) => pageLines(page, index + 1));
}

/**
 * Lines from a plain string, for text that never had boxes.
 *
 * Two callers: the §9 vision fallback, whose transcript is a model's prose and
 * carries no coordinates, and every spec in `rules/`, which is why this exists
 * as an export rather than a private helper — it lets a test fixture be a
 * template literal with tabs for cell boundaries instead of a hand-built pile
 * of `OcrBlock`s.
 *
 * `confidence` is 1 and `left`/`top` are null: unknown, never low. Anything
 * downstream that treats a null coordinate as a measurement would be reading a
 * fact out of the absence of one.
 */
export function linesFromText(text: string, page = 1): DocumentLine[] {
  return text.split('\n').map((line, index) => {
    const cells: LineCell[] = line
      .split('\t')
      .map((cell) => ({ text: cell.trim(), confidence: 1, left: null }));

    return {
      page,
      index,
      cells,
      text: cells.map((cell) => cell.text).join('\t'),
      confidence: 1,
      top: null,
      height: null,
    };
  });
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
