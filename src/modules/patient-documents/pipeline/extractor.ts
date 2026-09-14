import { DocumentLlm } from '../llm/document-llm.port';
import { DocumentType } from './classifier';
import {
  emptyExtraction,
  ExtractedDocument,
  ExtractedInvestigation,
  ExtractedMedication,
  instructionFor,
  schemaFor,
} from './extraction-schema';

/**
 * OCR text in, the §26 envelope out.
 *
 * The model is constrained by a JSON Schema, which buys the shape of the answer
 * and nothing about its content. Everything below the call is this module
 * disbelieving the model in specific, enumerated ways — because the ways a
 * small local model fills a schema it cannot satisfy are not random, they are
 * predictable, and each one is a clinical error if it survives:
 *
 *   It writes "N/A", "not mentioned", "-" or "none" into a string slot rather
 *   than the null the schema offers. `clean` turns those back into null. A
 *   medication named "Not specified" is not a medication.
 *
 *   It puts "None" or "Nil" into an array that should be empty. `cleanList`
 *   drops them. This one matters more than it looks: an allergies array
 *   containing the string "None" is how "the document mentioned no allergies"
 *   becomes a recorded assertion that the patient has none — §19's exact
 *   prohibition, arriving through the side door.
 *
 *   It answers a whole object where a string was asked for, or a string where
 *   an array was. Every reader here narrows before it reads.
 */

/** Truncation point for the model's context. gemma3:4b is served at 8k. */
const MAX_TEXT_CHARS = 12_000;

/**
 * Strings that mean "the model had nothing to put here".
 *
 * Matched whole, after trimming and lowercasing. Substring matching would eat
 * "Nil by mouth" and "None of the above", which are things documents say.
 */
const PLACEHOLDERS = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'nil',
  'none',
  'null',
  'unknown',
  'not applicable',
  'not available',
  'not mentioned',
  'not specified',
  'not stated',
  'not provided',
  'not recorded',
  'no',
  'no data',
  'none mentioned',
  'none specified',
  'none recorded',
  'not found',
]);

export async function extractDocument(
  text: string,
  type: DocumentType,
  llm: DocumentLlm,
): Promise<ExtractedDocument> {
  const raw = await llm.extractJson<Record<string, unknown>>({
    instruction: instructionFor(type),
    text: text.slice(0, MAX_TEXT_CHARS),
    schema: schemaFor(type),
    timeoutMs: 180_000,
  });

  return normaliseExtraction(raw, type);
}

/**
 * The model's answer, disbelieved into the envelope.
 *
 * Separated from the call so the whole disbelieving half can be tested against
 * literal objects — including the malformed ones a live model will not
 * reliably produce on demand.
 */
export function normaliseExtraction(
  raw: unknown,
  type: DocumentType,
): ExtractedDocument {
  const source = isRecord(raw) ? raw : {};
  const result = emptyExtraction(type);

  result.document.date = clean(source.documentDate);
  result.document.facility = clean(source.facility);
  result.document.author =
    clean(source.prescriber) ??
    clean(source.treatingPhysician) ??
    clean(source.orderedBy) ??
    clean(source.author);

  result.patient.name = clean(source.patientName);
  result.patient.identifier = clean(source.patientIdentifier);

  result.medications = asArray(source.medications)
    .map(normaliseMedication)
    .filter((entry): entry is ExtractedMedication => entry !== undefined);

  result.investigations = asArray(source.investigations)
    .map(normaliseInvestigation)
    .filter((entry): entry is ExtractedInvestigation => entry !== undefined);

  result.diagnosesRecorded = cleanList(source.diagnosesRecorded);
  result.procedures = cleanList(source.procedures);
  result.followUp = cleanList(source.followUp);
  result.allergies = cleanList(source.allergies);

  const admittedOn = clean(source.admittedOn);
  const dischargedOn = clean(source.dischargedOn);
  if (admittedOn || dischargedOn) {
    result.admission = { admittedOn, dischargedOn };
  }

  return result;
}

function normaliseMedication(entry: unknown): ExtractedMedication | undefined {
  if (!isRecord(entry)) return undefined;
  const name = clean(entry.name);
  if (!name) return undefined;

  return {
    name,
    strength: clean(entry.strength),
    dose: clean(entry.dose),
    frequency: clean(entry.frequency),
    route: clean(entry.route),
    duration: clean(entry.duration),
    instructions: clean(entry.instructions),
    startDate: clean(entry.startDate),
    stopDate: clean(entry.stopDate),
    // Anything other than an explicit `false` is uncertain. The schema asks
    // for a boolean and the model mostly supplies one; when it does not, the
    // two errors do not cost the same. A medication needlessly flagged for
    // review wastes a glance; one wrongly waved through is a dose nobody
    // checked. So the default is the one that puts a human in front of it.
    uncertain: entry.uncertain !== false,
  };
}

function normaliseInvestigation(
  entry: unknown,
): ExtractedInvestigation | undefined {
  if (!isRecord(entry)) return undefined;
  const test = clean(entry.test);
  if (!test) return undefined;

  return {
    test,
    result: clean(entry.result),
    unit: clean(entry.unit),
    referenceRange: clean(entry.referenceRange),
    flag: clean(entry.flag),
    date: clean(entry.date),
  };
}

/** A usable string, or null. Numbers are kept — a lab result is often one. */
export function clean(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed.length > 0 ? trimmed : null;
}

/** A list of usable strings. Placeholders are dropped, not preserved. */
export function cleanList(value: unknown): string[] {
  return asArray(value)
    .map(clean)
    .filter((entry): entry is string => entry !== null);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
