/**
 * The vocabulary printed Indian clinical documents are written in.
 *
 * Constants and three span helpers. No decisions, no parsing — those live in
 * the files that import this one, so that a regex can be read, tested and
 * argued with on its own.
 *
 * Two rules govern everything here, and both are about what these patterns are
 * *not* allowed to do:
 *
 * **They recognise, they never translate.** `FREQUENCY_CODE` matches `BD`; it
 * does not mean the extractor may write "twice daily". Every value the rules
 * emit is a verbatim slice of the page, because `confidence.ts` grounds a value
 * by looking for it in the OCR text — so a helpfully-expanded abbreviation is
 * indistinguishable downstream from one the model invented.
 *
 * **They must not match the neighbouring document type.** A lab report's
 * reference range column and a prescription's dosing grid look alike to a
 * careless pattern, and `13.0 - 17.0` read as a dosing schedule is a wrong
 * medication on a chart. Every pattern below that could stray is anchored or
 * bounded so it cannot, and `tokens.spec.ts` pins each of those cases.
 */

/** Dose forms, as a prefix before a drug name. */
export const FORM_PREFIX =
  /\b(?:tabs?|tablets?|t|caps?|capsules?|c|syp|syr|syrups?|susp|suspension|inj|injections?|oint|ointments?|cream|gel|lotion|drops?|eye\s+drops?|ear\s+drops?|neb|nebuli[sz]er|powder|sachets?|sach|supp|suppository|spray|inhaler|puff|patch|soln|solution|elixir|liq)\s*\.?\s+(?=[A-Za-z])/i;

/** `500mg`, `10 mcg`, `125 mg/5 ml`, `500/125 mg`, `40 IU`. */
export const STRENGTH =
  /\b\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(?:mcg|µg|ug|mg|gm|gms|g|kg|ml|mls|l|iu|i\.u\.|u|units?|meq|mmol|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:ml|mg|g|l)\b)?/i;

/** Latin dosing abbreviations and their spelled-out neighbours. */
export const FREQUENCY_CODE =
  /\b(?:od|o\.d\.|bd|b\.d\.|bid|b\.i\.d\.|tds|t\.d\.s\.|tid|t\.i\.d\.|qid|q\.i\.d\.|qds|qhs|hs|h\.s\.|sos|s\.o\.s\.|prn|p\.r\.n\.|stat|nocte|mane|q\d{1,2}h|once\s+(?:a\s+)?(?:daily|day)|twice\s+(?:a\s+)?(?:daily|day)|thrice\s+(?:a\s+)?(?:daily|day)|(?:two|three|four)\s+times\s+(?:a\s+)?(?:daily|day)|every\s+\d+\s*(?:hours?|hrs?|days?)|alternate\s+days?|every\s+other\s+day|once\s+a\s+week|weekly|fortnightly|monthly)\b/i;

/**
 * Slot notation — `1-0-1`, `1-1-1`, `0-0-1`, `1-0-0-1`.
 *
 * The single most dangerous pattern in this file, and the reason for every
 * restriction on it: single digits 0-2 only, no decimal point on either side,
 * three or four slots. Without those, a lab report's `13.0 - 17.0` reference
 * range and its `4000 - 11000` cell count both read as dosing schedules, and a
 * reference range parsed as a prescription is a medication nobody prescribed.
 * `tokens.spec.ts` asserts both negatives.
 */
export const SLOT_NOTATION = /(?<![\d.])[0-2](?:\s?[-–]\s?[0-2]){2,3}(?![\d.])/;

/**
 * `x 5 days`, `for 1 week`, `× 10 d`.
 *
 * Bounded with a lookbehind rather than `\b`, here and in [DOSE]: a word
 * boundary before `×` or `½` can never hold, because neither is a word
 * character, so `\b` would silently drop exactly the multiplication sign and
 * the vulgar fraction these patterns exist to read.
 */
export const DURATION_EXPLICIT =
  /(?<![A-Za-z0-9])(?:x|×|for|upto|up\s+to)\s*\d+\s*(?:days?|d|weeks?|wks?|wk|months?|mon|mth|years?|yrs?|yr)\b/i;

/** A bare `30 days`, only consulted after [DURATION_EXPLICIT] has had its turn. */
export const DURATION_BARE = /\b\d+\s*(?:days?|weeks?|wks?|months?|years?)\b/i;

/** `1 tablet`, `½ tab`, `5 ml`, `2 drops`, `1 puff`. See [DURATION_EXPLICIT] on the lookbehind. */
export const DOSE =
  /(?<![A-Za-z0-9])(?:\d+(?:\.\d+)?|½|¼|1\/2|1\/4|one|two|half|a)\s*(?:tab(?:let)?s?|cap(?:sule)?s?|ml|mls|drops?|puffs?|units?|iu|tsp|teaspoon(?:ful)?s?|tbsp|sachets?|spoon(?:ful)?s?|applications?|sprays?|pieces?)\b/i;

/** Route of administration. Only ever emitted when the document wrote it. */
export const ROUTE =
  /\b(?:orally|oral|p\.?\s?o\.?|per\s+oral|i\.?v\.?|intravenous(?:ly)?|i\.?m\.?|intramuscular(?:ly)?|s\/?\s?c|sub-?cutaneous(?:ly)?|s\.?l\.?|sublingual(?:ly)?|topical(?:ly)?|local\s+application|inhal(?:ed|ation|er)|nebulis(?:ed|ation)|nasal(?:ly)?|intranasal|per\s+rectum|rectal(?:ly)?|vaginal(?:ly)?|ophthalmic|transdermal)\b/i;

/** Administration instructions, captured verbatim. */
export const TIMING =
  /\b(?:after\s+(?:food|meals?|breakfast|lunch|dinner)|before\s+(?:food|meals?|breakfast|lunch|dinner)|with\s+(?:food|meals?|milk|water|plenty\s+of\s+water)|(?:on\s+an?\s+)?empty\s+stomach|b\.?b\.?f\.?|a\.?b\.?f\.?|early\s+morning|morning|afternoon|evening|night|at\s+bed\s?time|bed\s?time|do\s+not\s+crush|chew(?:able)?|dissolve|swallow\s+whole|as\s+(?:needed|required|directed)|when\s+required|if\s+(?:fever|pain|required))\b/i;

/**
 * Timing phrases that stand in for a frequency when nothing else does.
 *
 * A deliberate, enumerated exception rather than a general inference. On
 * `1 tablet - at bedtime - oral` the dose/frequency/route shape is plainly
 * there and leaving `frequency` null would escalate a correctly-read line to a
 * model that has nothing more to find. It applies only when no [FREQUENCY_CODE]
 * and no [SLOT_NOTATION] matched anywhere in the entry — see `prescription.ts`.
 */
export const TIMING_AS_FREQUENCY =
  /\b(?:at\s+bed\s?time|bed\s?time|nocte|at\s+night|morning\s+and\s+night|once\s+at\s+night)\b/i;

/**
 * Dates, in the forms Indian documents print them.
 *
 * Emitted verbatim and never reformatted, which means the DD/MM versus MM/DD
 * ambiguity is *preserved* rather than resolved. Resolving it would require
 * guessing, and a guess here silently moves a prescription by months.
 *
 * The numeric form back-references its own separator, and that is not
 * tidiness. Allowing the two separators to differ makes `13.0 - 17.0` — a
 * haemoglobin reference range, on every haematology report — parse as the 13th
 * of month 0, and the row then carries a date the lab never printed.
 */
export const DATE_VALUE =
  /\b(?:\d{1,2}\s*([/\-.])\s*\d{1,2}\s*\1\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-,]*\d{2,4})\b/i;

/** A lab unit, matched as a whole cell. */
export const UNIT_CELL =
  /^(?:%|g\/dl|gm\/dl|mg\/dl|mg\/l|g\/l|mmol\/l|µmol\/l|umol\/l|meq\/l|iu\/l|u\/l|iu\/ml|miu\/ml|ng\/ml|ng\/dl|pg\/ml|µg\/dl|ug\/dl|fl|pg|mm\/hr|secs?|ratio|index|\/ul|\/µl|\/cumm|cells\/cumm|lakhs\/cumm|million\/cumm|thou\/ul|x?10\^?\d+\/l)$/i;

/** A reference range, matched as a whole cell. */
export const RANGE_CELL =
  /^\(?\s*(?:[<>≤≥]?\s*\d+(?:\.\d+)?\s*(?:[-–—]|to)\s*[<>≤≥]?\s*\d+(?:\.\d+)?|[<>≤≥]\s*\d+(?:\.\d+)?|up\s*to\s*\d+(?:\.\d+)?|negative|non[-\s]?reactive|nil|absent|normal)\s*\)?$/i;

/** An out-of-range marker, matched as a whole cell. Whatever the lab printed. */
export const FLAG_CELL =
  /^(?:h|l|hi|lo|high|low|\*{1,3}|↑|↓|a|ab|abnormal|critical|panic|borderline|\+{1,3})$/i;

/** A numeric result, matched as a whole cell. */
export const RESULT_NUMERIC = /^[<>≤≥]?\s*\d+(?:[.,]\d+)?$/;

/** A qualitative result, matched as a whole cell. A closed list on purpose. */
export const RESULT_QUALITATIVE =
  /^(?:positive|negative|reactive|non[-\s]?reactive|present|absent|normal|abnormal|traces?|nil|detected|not\s+detected|seen|not\s+seen|clear|turbid|pale\s+yellow|yellow)$/i;

/** A leading list marker, stripped before anything else reads the line. */
export const ENUMERATOR = /^\s*(?:\(?\d{1,2}[.):]|[-–•*·>]|[a-z][.)])\s+/i;

/**
 * Lines that are printed on every page and belong to no rule.
 *
 * Load-bearing for the coverage metric rather than for parsing: these are
 * excluded from the denominator entirely, neither claimed nor unclaimed.
 * Without that, a lab report's footer and letterhead alone push a clean read
 * past the unclaimed-line threshold and every correct extraction escalates to
 * a model it did not need.
 */
export const BOILERPLATE =
  /^(?:\[?page\s*\d|this\s+is\s+a\s+computer\s+generated|computer\s*-?\s*generated|not\s+valid\s+for\s+medico|end\s+of\s+(?:report|prescription)|\*+\s*(?:values?\s+)?outside|terms\s+and\s+conditions|(?:ph|tel|mob|fax)\.?\s*[:\d(]|e-?mail|www\.|https?:|gstin|reg\.?\s*no|licen[cs]e\s+no|nabl|nabh|iso\s+\d|signature)|^[-=_*·•.\s]+$/i;

/** A span of a line some rule has taken. */
export interface Span {
  start: number;
  end: number;
  text: string;
}

/** Whether [start, end) overlaps anything already taken. */
function overlaps(taken: readonly Span[], start: number, end: number): boolean {
  return taken.some((span) => start < span.end && end > span.start);
}

/**
 * The first match of [pattern] that no earlier rule has already taken.
 *
 * Claiming is what keeps the patterns from reading each other's text: once
 * `500 mg` is a strength, [DOSE] cannot also read it as an amount, and
 * whatever survives every claim is the drug's name. The caller owns [taken]
 * and the order it calls in — see `prescription.ts`, where that order is the
 * parse.
 */
export function claim(
  text: string,
  pattern: RegExp,
  taken: Span[],
): Span | null {
  const scan = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');

  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(taken, start, end)) continue;

    const span = { start, end, text: match[0].trim() };
    taken.push(span);
    return span;
  }

  return null;
}

/**
 * The longest run of [text] no rule took, trimmed of punctuation.
 *
 * How a drug's name is found: not by a pattern for what a name looks like —
 * there isn't one that holds across `PAN-D`, `Ibugesic Plus` and
 * `Amoxycillin` — but by removing everything that is demonstrably something
 * else and keeping the largest piece left standing. A slice, so it grounds.
 */
export function residue(text: string, taken: readonly Span[]): string {
  const ordered = [...taken].sort((a, b) => a.start - b.start);
  const gaps: string[] = [];
  let cursor = 0;

  for (const span of ordered) {
    if (span.start > cursor) gaps.push(text.slice(cursor, span.start));
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < text.length) gaps.push(text.slice(cursor));

  return gaps
    .map((gap) =>
      gap.replace(/^[\s\-–—:;,.|/()[\]]+|[\s\-–—:;,.|/()[\]]+$/g, ''),
    )
    .reduce(
      (longest, gap) => (gap.length > longest.length ? gap : longest),
      '',
    );
}
