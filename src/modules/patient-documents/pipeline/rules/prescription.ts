import { DocumentLine } from '../layout';
import { ExtractedMedication } from '../extraction-schema';
import { clean } from '../extractor';
import {
  DOSE,
  DURATION_BARE,
  DURATION_EXPLICIT,
  ENUMERATOR,
  FORM_PREFIX,
  FREQUENCY_CODE,
  RANGE_CELL,
  ROUTE,
  SLOT_NOTATION,
  STRENGTH,
  TIMING,
  TIMING_AS_FREQUENCY,
  Span,
  claim,
  residue,
} from './tokens';
import { LineKey, lineKey } from './types';

/**
 * Medication lines, read by removing everything that is demonstrably not a name.
 *
 * A prescription line is dense and regular: a form, a name, a strength, an
 * amount, a schedule, a duration, sometimes a route and a timing note. Each of
 * those but the name has a vocabulary; the name does not, and no pattern for
 * "what a drug is called" survives contact with `PAN-D`, `Ibugesic Plus` and
 * `Amoxycillin` at once.
 *
 * So the parse runs the other way round. Every pattern claims its own
 * characters, in an order chosen so the greedier ones go first, and the longest
 * run left standing is the name. That makes the name a verbatim slice of the
 * line — which is what `confidence.ts` needs to ground it, and what stops this
 * file ever inventing a medication.
 *
 * Nothing here infers. `Tab.` does not mean the route was oral, `Inj.` does not
 * mean it was intravenous, and `1-0-1` is not rewritten as `BD`. All three
 * would be values no one wrote on the page.
 */

/** Below this, the pixels the name was read off were not good enough to trust. */
const LOW_BLOCK_CONFIDENCE = 0.8;

/** A name the recogniser split across boxes, read this crisply, is fine. */
const CRISP_ENOUGH = 0.92;

/** A medication runs to at most this many lines before the next one starts. */
const MAX_CONTINUATION_LINES = 3;

/** Forms measured by volume, where a millilitre figure is a dose and not a strength. */
const LIQUID_FORM =
  /^(?:syp|syr|syrup|susp|suspension|drops?|soln|solution|elixir|liq)\b/i;

/** Shapes a recogniser produces when it could not read a word. */
const GARBLED = /\d[a-z]{1,2}\d/i;

/**
 * A residue that is only a dose form, and therefore not a name.
 *
 * `Tab. 500 mg OD` reaches here with `Tab` left standing: [FORM_PREFIX]
 * requires a letter after the form word and this line has a digit, so nothing
 * claimed it. Stored, it is a medication called "Tab" with a real strength and
 * a real frequency attached — which looks enough like a drug to survive a
 * glance, and is the most convincing wrong value this file can produce.
 */
const FORM_WORD_ONLY =
  /^(?:tabs?|tablets?|caps?|capsules?|syp|syr|syrup|susp|suspension|inj|injections?|oint|ointment|cream|gel|lotion|drops?|neb|powder|sachets?|sach|supp|spray|inhaler|patch|soln|solution|elixir|liq|rx)\.?$/i;

/** Tokens that say a line carries dosing rather than starting a new drug. */
const DOSING_TOKENS = [
  DOSE,
  FREQUENCY_CODE,
  SLOT_NOTATION,
  DURATION_EXPLICIT,
  DURATION_BARE,
  ROUTE,
  TIMING,
];

function hasDosing(line: DocumentLine): boolean {
  return DOSING_TOKENS.some((pattern) => pattern.test(line.text));
}

/**
 * Whether this line starts a medication.
 *
 * Deliberately conservative. A false head splits one drug into two and shows a
 * patient a medicine they were never prescribed; a missed head costs coverage,
 * which escalates to a model that is better at the ambiguous line anyway. The
 * two errors do not cost the same, so the test leans to missing.
 */
export function isMedicationHead(line: DocumentLine): boolean {
  const text = line.text;

  // A table row is not a prescription line. Without this, a lab report's
  // `Haemoglobin 11.2 g/dL 13.0 - 17.0` reads as a drug at a strength.
  if (line.cells.length >= 4) return false;
  if (line.cells.some((cell) => RANGE_CELL.test(cell.text))) return false;

  const formPrefix = FORM_PREFIX.exec(text);
  if (
    formPrefix &&
    /^[A-Za-z]{3}/.test(text.slice(formPrefix.index + formPrefix[0].length))
  ) {
    return true;
  }

  if (ENUMERATOR.test(text) && STRENGTH.test(text)) return true;

  return (
    STRENGTH.test(text) &&
    (FREQUENCY_CODE.test(text) || SLOT_NOTATION.test(text))
  );
}

/** The lines of one medication: its head, and whatever continued it. */
function groupEntries(lines: readonly DocumentLine[]): DocumentLine[][] {
  const entries: DocumentLine[][] = [];

  for (const line of lines) {
    if (line.text.trim() === '') continue;

    if (isMedicationHead(line)) {
      entries.push([line]);
      continue;
    }

    const current = entries[entries.length - 1];
    if (!current || current.length > MAX_CONTINUATION_LINES) continue;

    // Either the line carries dosing, or it is indented to sit under the name
    // above it. The indent case is what reads the fixture's third row —
    // `30 days` alone under ATORVASTATIN — which no vocabulary would catch.
    const head = current[0];
    const nameLeft = head.cells[head.cells.length - 1]?.left ?? null;
    const thisLeft = line.cells[0]?.left ?? null;
    const aligned =
      nameLeft !== null &&
      thisLeft !== null &&
      Math.abs(nameLeft - thisLeft) <= 12;

    if (hasDosing(line) || aligned) current.push(line);
  }

  return entries;
}

/** One medication, and the evidence for how much to believe it. */
export interface ParsedMedication {
  medication: ExtractedMedication;
  reasons: string[];
  lines: DocumentLine[];
}

/**
 * Read one medication out of the lines that make it up.
 *
 * The claim order is the parse: strength before dose, so `500 mg` cannot also
 * be read as an amount; duration's explicit form before its bare one, so
 * `x 5 days` is not truncated to `5 days`; everything before the name, because
 * the name is defined as what is left.
 */
export function parseMedicationEntry(
  entry: readonly DocumentLine[],
): ParsedMedication | null {
  const [head] = entry;
  if (!head) return null;

  const formPrefix = FORM_PREFIX.exec(head.text);
  const liquid = formPrefix !== null && LIQUID_FORM.test(formPrefix[0].trim());

  // Settled for the whole entry before any line is read, because the timing
  // exception below depends on there being no real frequency anywhere in it.
  const hasRealFrequency = entry.some(
    (line) => FREQUENCY_CODE.test(line.text) || SLOT_NOTATION.test(line.text),
  );

  let strength: string | null = null;
  let dose: string | null = null;
  let frequency: string | null = null;
  let route: string | null = null;
  let duration: string | null = null;
  let instructions: string | null = null;
  let headTaken: Span[] = [];

  for (const line of entry) {
    const taken: Span[] = [];
    const isHead = line === head;

    if (isHead) {
      claim(line.text, ENUMERATOR, taken);
      if (formPrefix) claim(line.text, FORM_PREFIX, taken);
    }

    const quantityFirst = liquid ? [DOSE, STRENGTH] : [STRENGTH, DOSE];
    const first = claim(line.text, quantityFirst[0], taken);
    if (liquid) dose ??= first?.text ?? null;
    else strength ??= first?.text ?? null;

    route ??= claim(line.text, ROUTE, taken)?.text ?? null;

    // The enumerated exception. `1 tablet - at bedtime - oral` plainly fills
    // the dose/frequency/route shape, and leaving frequency null there would
    // escalate a correctly-read line to a model with nothing more to find.
    // It applies only when the entry carries no real frequency at all.
    if (frequency === null) {
      frequency =
        claim(line.text, FREQUENCY_CODE, taken)?.text ??
        claim(line.text, SLOT_NOTATION, taken)?.text ??
        (hasRealFrequency
          ? null
          : (claim(line.text, TIMING_AS_FREQUENCY, taken)?.text ?? null));
    }

    duration ??=
      claim(line.text, DURATION_EXPLICIT, taken)?.text ??
      claim(line.text, DURATION_BARE, taken)?.text ??
      null;

    const second = claim(line.text, quantityFirst[1], taken);
    if (liquid) strength ??= second?.text ?? null;
    else dose ??= second?.text ?? null;

    instructions ??= claim(line.text, TIMING, taken)?.text ?? null;

    if (isHead) headTaken = taken;
  }

  const name = clean(residue(head.text, headTaken));
  if (
    name === null ||
    name.length < 3 ||
    !/[A-Za-z]{3}/.test(name) ||
    FORM_WORD_ONLY.test(name)
  ) {
    return null;
  }

  const nameCells = head.cells.filter(
    (cell) => name.includes(cell.text) && cell.text !== '',
  );
  const nameConfidence = nameCells.length
    ? Math.min(...nameCells.map((cell) => cell.confidence))
    : head.confidence;

  const reasons = uncertaintyReasons({
    name,
    nameConfidence,
    nameSpanned: nameCells.length > 1,
    strength,
    dose,
    frequency,
    duration,
  });

  return {
    medication: {
      name,
      strength,
      dose,
      frequency,
      route,
      duration,
      instructions,
      startDate: null,
      stopDate: null,
      uncertain: reasons.length > 0,
    },
    reasons,
    lines: [...entry],
  };
}

/**
 * Why this medication might be wrong, measured rather than self-reported.
 *
 * The model path defaults to uncertain because a model's silence tells you
 * nothing — see `extractor.ts`'s `normaliseMedication`. Here the default is the
 * other way round, and deliberately so: the rules know exactly which evidence
 * they had, so certainty is earned from it instead of assumed away. Do not
 * "fix" the asymmetry; the two paths know different things.
 */
function uncertaintyReasons(input: {
  name: string;
  nameConfidence: number;
  nameSpanned: boolean;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
}): string[] {
  const reasons: string[] = [];

  if (input.nameConfidence < LOW_BLOCK_CONFIDENCE) {
    reasons.push('low_block_confidence');
  }
  if (input.nameSpanned && input.nameConfidence < CRISP_ENOUGH) {
    reasons.push('name_spanned_cells');
  }
  if (
    input.name.length < 4 ||
    GARBLED.test(input.name) ||
    (input.name.match(/[^A-Za-z0-9\-.()\s]/g) ?? []).length >= 2
  ) {
    reasons.push('name_shape_failed');
  }
  if (
    input.strength === null &&
    input.frequency === null &&
    input.dose === null
  ) {
    reasons.push('no_dosing_parsed');
  }

  // There is deliberately no "implausible schedule" reason. `1-0-8` is not a
  // dosing grid this file reads *badly* — [SLOT_NOTATION] admits only 0-2, so
  // it is not read at all, and the entry falls to `thin_evidence` on its own.
  // A reason that checked the frequency for a high digit would instead flag
  // `q6h`, which means every six hours and is perfectly ordinary.

  const filled = [
    input.strength,
    input.dose,
    input.frequency,
    input.duration,
  ].filter((slot) => slot !== null).length;
  if (filled < 2) reasons.push('thin_evidence');

  return reasons;
}

/** Every medication in [lines], with the lines each one consumed. */
export function extractMedications(lines: readonly DocumentLine[]): {
  medications: ExtractedMedication[];
  claimed: Set<LineKey>;
  uncertainty: Record<string, string[]>;
  lineOf: DocumentLine[];
} {
  const medications: ExtractedMedication[] = [];
  const claimed = new Set<LineKey>();
  const uncertainty: Record<string, string[]> = {};
  const lineOf: DocumentLine[] = [];

  for (const entry of groupEntries(lines)) {
    const parsed = parseMedicationEntry(entry);
    // A head whose name reduced to nothing is not a medication, and its lines
    // stay unclaimed so coverage counts them against the rule set.
    if (!parsed) continue;

    const index = medications.length;
    medications.push(parsed.medication);
    lineOf.push(entry[0]);
    if (parsed.reasons.length)
      uncertainty[`medications[${index}]`] = parsed.reasons;
    for (const line of parsed.lines) claimed.add(lineKey(line));
  }

  return { medications, claimed, uncertainty, lineOf };
}
