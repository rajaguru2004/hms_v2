import { DocumentLine } from '../layout';
import { ExtractedDocument } from '../extraction-schema';

/**
 * What every rule-set parser hands back, so coverage can be measured the same
 * way whatever produced the values.
 */

/** A line, addressed. Page-qualified, so page 2 line 4 is not page 1 line 4. */
export type LineKey = string;

export function lineKey(line: DocumentLine): LineKey {
  return `${line.page}:${line.index}`;
}

/** Where one value came from, and by which rule. */
export interface FieldOrigin {
  producedBy: 'rules' | 'model';
  /** The named rule, e.g. `medication.block`. Null for model values. */
  rule: string | null;
  /** The line it was read off. Null for model values. */
  line: number | null;
  /** The page it was read off. Null for model values. */
  page: number | null;
}

export interface ParseResult {
  extraction: ExtractedDocument;
  /** Lines some rule consumed at least one character from. */
  claimed: Set<LineKey>;
  /** Field path to the rule that produced it. Keys match `collectExtractedValues`. */
  origins: Map<string, FieldOrigin>;
  /** Per-entity uncertainty evidence, keyed `medications[0]`. Diagnostic only. */
  uncertainty: Record<string, string[]>;
}

/** An empty result, for a parser that declined to read anything. */
export function emptyParse(extraction: ExtractedDocument): ParseResult {
  return {
    extraction,
    claimed: new Set(),
    origins: new Map(),
    uncertainty: {},
  };
}

/** Record that [rule] produced the value at [path], reading it off [line]. */
export function noteOrigin(
  origins: Map<string, FieldOrigin>,
  path: string,
  rule: string,
  line: DocumentLine | null,
): void {
  origins.set(path, {
    producedBy: 'rules',
    rule,
    line: line?.index ?? null,
    page: line?.page ?? null,
  });
}
