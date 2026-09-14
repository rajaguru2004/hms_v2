// eslint-disable-next-line @typescript-eslint/no-require-imports
import FuzzySet = require('fuzzyset.js');

import { CONTRADICTION_FOUND } from './messages';
import { ExtractedDocument } from './extraction-schema';

/**
 * Documents §20. What the document says, against what the record already holds.
 *
 * The whole of this file is read-only with respect to the patient record, and
 * that is the requirement rather than an implementation detail: §20 says the
 * system "should flag the difference for verification" and "should not
 * automatically overwrite either record". So nothing here writes. It produces
 * findings, the findings go on the document row, and a human decides.
 *
 * ── The direction that is not checked ───────────────────────────────────────
 *
 * Only what the document asserts is compared against the record. The reverse —
 * the record holds a penicillin allergy, this prescription does not mention one
 * — is not a finding and is not reported, because it is not a disagreement. A
 * prescription that says nothing about allergies has not contradicted anything;
 * it has been silent, and §19 is unambiguous about what silence is worth.
 * Reporting it would be this module deriving a negative from an absence in the
 * one place the rest of the pipeline works hardest not to.
 */

/** The patient record, reduced to the three lists worth comparing. */
export interface ExistingRecord {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
}

export type ContradictionTopic = 'allergies' | 'medications' | 'diagnoses';

export interface Contradiction {
  topic: ContradictionTopic;
  /**
   * `absent_from_record` — the document names something the record does not
   * hold. §20's worked example: a prescription for a diabetes medicine against
   * a record with no diabetes history.
   *
   * `differs_from_record` — the record holds the same item with a different
   * value. A strength that changed between two prescriptions is either a dose
   * adjustment nobody has recorded yet or a misread digit, and the two look
   * identical from here.
   */
  kind: 'absent_from_record' | 'differs_from_record';
  documentValue: string;
  /** What the record holds on this topic, so a reviewer sees both sides. */
  recordValues: string[];
  /**
   * False when the record's list for this topic was empty.
   *
   * This is the difference between a conflict and a first entry. A patient
   * whose record has no medications listed and who uploads a prescription has
   * not contradicted anything — that is new information. It is still surfaced,
   * because §20 wants the difference shown, but a client that words the two
   * cases identically would tell half its patients their records disagree with
   * themselves on their first upload.
   */
  recordHadEntries: boolean;
  /** Written for a patient. §20's own sentence. */
  message: string;
}

/**
 * Where a document value stops being a *misspelling* of a record value.
 *
 * Only the second of the two matchers uses it — see `matchesRecordValue`.
 * Gram similarity is the wrong tool for the common case and the numbers say so:
 * "Metformin" against "Tab Metformin 500mg (1-0-1)" scores 0.33, below anything
 * that could be a threshold, because the record entry is mostly dosing and the
 * grams are diluted by it. Containment settles that case. What is left for
 * fuzzy matching is "Amlodipin" against "Amlodipine 5mg" — a recogniser dropping
 * a character — which scores 0.64.
 */
const SAME_ITEM_THRESHOLD = 0.55;

/** Shorter than this, a containment test matches everything. */
const MIN_CONTAINMENT_CHARS = 4;

/**
 * Everything in [extraction] that the record does not agree with.
 *
 * Empty is the common and correct answer.
 */
export function findContradictions(
  extraction: ExtractedDocument,
  record: ExistingRecord,
): Contradiction[] {
  return [
    ...compare(
      'medications',
      extraction.medications.map((medication) => ({
        text: [medication.name, medication.strength]
          .filter(Boolean)
          .join(' ')
          .trim(),
        key: medication.name,
      })),
      record.currentMedications,
    ),
    ...compare(
      'allergies',
      extraction.allergies.map((value) => ({ text: value, key: value })),
      record.allergies,
    ),
    ...compare(
      'diagnoses',
      extraction.diagnosesRecorded.map((value) => ({
        text: value,
        key: value,
      })),
      record.chronicConditions,
    ),
  ];
}

function compare(
  topic: ContradictionTopic,
  documentItems: Array<{ text: string; key: string }>,
  recordValues: string[],
): Contradiction[] {
  const usable = recordValues.map((value) => value.trim()).filter(Boolean);
  const matcher = usable.length > 0 ? FuzzySet(usable) : null;
  const findings: Contradiction[] = [];

  for (const item of documentItems) {
    if (!item.key.trim()) continue;

    const matched = matchesRecordValue(item.key, usable, matcher);

    if (!matched) {
      findings.push({
        topic,
        kind: 'absent_from_record',
        documentValue: item.text || item.key,
        recordValues: usable,
        recordHadEntries: usable.length > 0,
        message: CONTRADICTION_FOUND,
      });
      continue;
    }

    // Same item, both sides carrying a quantity, and the quantities disagree.
    // Checked only when both sides state one: a record entry of bare
    // "Metformin" does not disagree with "Metformin 500 mg", it is less
    // specific than it, and treating "less specific" as "different" would flag
    // most of a well-kept record.
    const documentAmounts = amountsIn(item.text);
    const recordAmounts = amountsIn(matched);
    const disagrees =
      documentAmounts.length > 0 &&
      recordAmounts.length > 0 &&
      !documentAmounts.some((amount) => recordAmounts.includes(amount));

    if (disagrees) {
      findings.push({
        topic,
        kind: 'differs_from_record',
        documentValue: item.text,
        recordValues: [matched],
        recordHadEntries: true,
        message: CONTRADICTION_FOUND,
      });
    }
  }

  return findings;
}

/**
 * The record entry that is the same item as [key], or nothing.
 *
 * Containment first, because that is what a real record looks like: the entry
 * is the drug name with its dosing wrapped around it, or the condition name
 * inside a longer phrase. Both directions are tested — the document sometimes
 * carries the longer string, as when a lab report names "Serum Creatinine" and
 * the record says "creatinine".
 *
 * Fuzzy matching is second and narrow: it is for a spelling that slipped, not
 * for deciding whether two clinical terms mean the same thing. Nothing here
 * knows that atenolol and metoprolol are both beta blockers, and it should not
 * start guessing — a wrong match here hides a real difference.
 */
function matchesRecordValue(
  key: string,
  recordValues: string[],
  matcher: ReturnType<typeof FuzzySet> | null,
): string | null {
  const needle = normalise(key);

  if (needle.length >= MIN_CONTAINMENT_CHARS) {
    const contained = recordValues.find((value) => {
      const hay = normalise(value);
      if (hay.length < MIN_CONTAINMENT_CHARS) return false;
      return hay.includes(needle) || needle.includes(hay);
    });
    if (contained) return contained;
  }

  const best = matcher?.get(key)?.[0];
  return best && best[0] >= SAME_ITEM_THRESHOLD ? best[1] : null;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Quantities in a free-text medication line: `500mg`, `5 mg`, `10 ml`. */
function amountsIn(text: string): string[] {
  const matches = text
    .toLowerCase()
    .matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)\b/g);
  return Array.from(matches, (match) => `${match[1]}${match[2]}`);
}

/**
 * The three record lists, out of the columns that store them as JSON strings.
 *
 * `Patient.allergies`, `.chronicConditions` and `.currentMedications` are
 * `String?` holding a JSON array — a shape that predates this module. A column
 * that is sometimes JSON, sometimes a bare comma-separated line somebody typed,
 * and sometimes null is read defensively or not at all.
 */
export function readExistingRecord(patient: {
  allergies?: string | null;
  chronicConditions?: string | null;
  currentMedications?: string | null;
}): ExistingRecord {
  return {
    allergies: parseList(patient.allergies),
    chronicConditions: parseList(patient.chronicConditions),
    currentMedications: parseList(patient.currentMedications),
  };
}

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) =>
          typeof entry === 'string' ? entry : describeEntry(entry),
        )
        .filter((entry): entry is string => Boolean(entry));
    }
  } catch {
    // Not JSON. Falls through to the comma-separated reading below rather than
    // discarding the row: a clinic that typed "penicillin, sulfa" into the
    // field still recorded two allergies, and dropping them here would mean
    // every uploaded document silently disagreed with an empty list.
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** An object entry — `{name, dose}` — flattened to the text worth matching. */
function describeEntry(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const parts = [
    'name',
    'drugName',
    'substance',
    'condition',
    'dosage',
    'strength',
  ]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string');
  return parts.length > 0 ? parts.join(' ') : null;
}
