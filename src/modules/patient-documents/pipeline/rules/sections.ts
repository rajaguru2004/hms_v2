import { DocumentLine } from '../layout';
import { clean } from '../extractor';
import { BOILERPLATE, ENUMERATOR } from './tokens';

/**
 * Headings, and the lines underneath them, copied out word for word.
 *
 * The narrative half of a medical document — diagnoses, procedures, advice,
 * allergies — is prose, and rules cannot read prose. They cannot tell a
 * diagnosis from a symptom from a differential that was considered and
 * rejected, and any pattern that claimed to would be wrong on the documents
 * that matter most.
 *
 * What rules *can* do reliably is find a heading and copy what is under it.
 * That is all this file does. A reviewer looking at verbatim lines under
 * `Final Diagnosis:` can see a mis-scoped capture and fix it in a glance; a
 * reviewer looking at a rule's *interpretation* of a sentence cannot tell it
 * apart from the document, which is the failure worth avoiding.
 *
 * So: one line in, at most one item out. No sentence splitting, ever.
 */

export type SectionTopic =
  | 'medications'
  | 'investigations'
  | 'diagnoses'
  | 'procedures'
  | 'followUp'
  | 'allergies';

export interface CapturedSection {
  topic: SectionTopic;
  /** The heading's own line. Claimed, so it does not count as unread. */
  heading: DocumentLine;
  /** The lines beneath the heading, for a type parser to re-read. */
  body: DocumentLine[];
  /** Verbatim items. Never summarised, never reflowed. */
  items: string[];
}

const HEADINGS: Record<SectionTopic, RegExp> = {
  diagnoses:
    /^(?:(?:final|primary|secondary|provisional|working|clinical|principal|discharge|admission)\s+)?diagnos[ei]s\b|^impression\b|^assessment\b|^conditions?\s+treated\b|^problem\s+list\b/i,
  procedures:
    /^(?:procedures?|operations?|surger(?:y|ies)|surgical\s+procedures?|operative\s+procedures?|interventions?|operation\s+notes?)\b/i,
  followUp:
    /^(?:follow[\s-]?up|review(?:\s+(?:on|after|date))?|next\s+(?:visit|appointment|review)|advice(?:\s+on\s+discharge)?|discharge\s+advice|instructions?\s+(?:to|for)\s+patient|general\s+instructions?)\b/i,
  allergies:
    /^(?:allerg(?:y|ies)|drug\s+allerg\w*|known\s+allerg\w*|food\s+allerg\w*|adverse\s+drug\s+reactions?)\b/i,
  medications:
    /^(?:rx|℞|medications?|discharge\s+medications?|medications?\s+on\s+discharge|treatment\s+(?:advised|given|on\s+discharge)|medicines?\s+(?:advised|prescribed)|drugs?\s+advised|advised\s+to\s+continue|to\s+continue)\b/i,
  investigations:
    /^(?:investigations?|lab(?:oratory)?\s+(?:results?|investigations?|findings?)|test\s+results?|relevant\s+investigations?)\b/i,
};

/**
 * Commas that are part of a diagnosis rather than between two of them.
 *
 * `Type 2 Diabetes Mellitus, Hypertension` is two conditions;
 * `Diabetes Mellitus, Type 2` is one written the other way round. The
 * difference is entirely in what follows the comma, so that is what this
 * looks at.
 */
const NO_SPLIT_AFTER =
  /^\s*(?:type\s*\d|stage\s*[ivx\d]|grade\s*[ivx\d]|gr\.?\s*\d|class\s*[ivx\d]|nyha|\d+\s*(?:mg|ml|%)|\d+\s*$)/i;

/**
 * Where a section stops when nothing else stopped it first.
 *
 * Not optional. A heading whose end is never detected swallows the rest of the
 * document into `diagnosesRecorded`, and the patient is shown a signature block
 * as a list of their conditions.
 */
const MAX_SECTION_LINES = 12;

/** Past this many items a "list" is a page of prose that matched a heading. */
const MAX_ITEMS = 20;

/** A gap this much larger than the document's usual line spacing is a new block. */
const PARAGRAPH_GAP_RATIO = 2.2;

/** The heading text, and whatever was printed on the same line after it. */
function headingOf(
  line: DocumentLine,
): { topic: SectionTopic; inline: string } | null {
  const first = line.cells[0]?.text.trim() ?? '';
  if (first === '') return null;

  for (const [topic, pattern] of Object.entries(HEADINGS)) {
    const match = pattern.exec(first);
    if (!match || match.index !== 0) continue;

    const rest = first.slice(match[0].length);
    const separated = /^\s*[:\-–]/.test(rest);
    const bare = rest.trim() === '';

    // A heading is a label with a colon, or a short line that is nothing but
    // the heading word. Anything else beginning with "review" is a sentence.
    if (!separated && !bare) continue;
    if (bare && first.split(/\s+/).length > 6) continue;

    const inline = separated
      ? rest.replace(/^\s*[:\-–]\s*/, '')
      : line.cells
          .slice(1)
          .map((cell) => cell.text)
          .join(' ');

    return { topic: topic as SectionTopic, inline: inline.trim() };
  }

  return null;
}

/** The document's usual line spacing, for telling a paragraph break from a line break. */
function medianGap(lines: readonly DocumentLine[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1];
    const current = lines[i];
    if (previous.top === null || current.top === null) continue;
    if (previous.page !== current.page) continue;
    const gap = current.top - previous.top;
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** One line's worth of items — which is at most one. */
function itemsOfLine(line: DocumentLine): string[] {
  const text = line.text.replace(/\t/g, ' ').replace(ENUMERATOR, '').trim();
  const value = clean(text);
  return value === null ? [] : [value];
}

/**
 * The items on a heading's own line.
 *
 * The only structured parse in this file: an inline list split on its
 * separators. It operates on a single line and every piece it returns is a
 * contiguous slice of that line, so the output still grounds.
 */
export function splitInline(value: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (character !== ',' && character !== ';') continue;
    if (character === ',' && NO_SPLIT_AFTER.test(value.slice(i + 1))) continue;

    parts.push(value.slice(start, i));
    start = i + 1;
  }
  parts.push(value.slice(start));

  return parts
    .map((part) => clean(part.trim()))
    .filter((part): part is string => part !== null && part.length >= 3);
}

/** Every heading on the page, with what was printed under it. */
export function captureSections(lines: DocumentLine[]): CapturedSection[] {
  const gap = medianGap(lines);
  const sections: CapturedSection[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const heading = headingOf(lines[i]);
    if (!heading) continue;

    const body: DocumentLine[] = [];
    for (
      let j = i + 1;
      j < lines.length && body.length < MAX_SECTION_LINES;
      j += 1
    ) {
      const line = lines[j];
      const text = line.text.trim();

      if (headingOf(line)) break;
      if (text === '' || BOILERPLATE.test(text)) break;
      if (/^dr\.?\s/i.test(text)) break;

      const previous = lines[j - 1];
      if (
        gap !== null &&
        line.top !== null &&
        previous.top !== null &&
        line.page === previous.page &&
        line.top - previous.top > gap * PARAGRAPH_GAP_RATIO
      ) {
        break;
      }

      body.push(line);
    }

    const items = [
      ...(heading.inline ? splitInline(heading.inline) : []),
      ...body.flatMap(itemsOfLine),
    ].slice(0, MAX_ITEMS);

    sections.push({ topic: heading.topic, heading: lines[i], body, items });
  }

  return sections;
}

/** Every item captured for one topic, in document order. */
export function itemsFor(
  sections: readonly CapturedSection[],
  topic: SectionTopic,
): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const section of sections) {
    if (section.topic !== topic) continue;
    for (const item of section.items) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return items;
}
