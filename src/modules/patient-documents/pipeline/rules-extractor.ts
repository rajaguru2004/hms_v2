import { DocumentLine } from './layout';
import { DocumentType } from './classifier';
import { ExtractedDocument, emptyExtraction } from './extraction-schema';
import { FactTopic } from './document-facts';
import { collectExtractedValues } from './confidence';
import {
  authorFromSignature,
  facilityFromLetterhead,
  pickField,
  readLabelledFields,
} from './rules/fields';
import { captureSections, itemsFor } from './rules/sections';
import { extractMedications } from './rules/prescription';
import { extractInvestigations } from './rules/laboratory';
import { dischargeMedicationSection } from './rules/discharge';
import { DATE_VALUE } from './rules/tokens';
import {
  FieldOrigin,
  LineKey,
  lineKey,
  noteOrigin,
  ParseResult,
} from './rules/types';

/**
 * Deterministic extraction — the pipeline's first reader.
 *
 * Dispatches to a rule set, assembles the §26 envelope from what the rules
 * found, and reports which lines it accounted for so `coverage.ts` can say how
 * much of the document it understood.
 *
 * The contract is narrow and worth stating plainly: this produces **fewer**
 * findings than a language model would, and every finding it produces is a
 * verbatim slice of the page with a named rule and a line number behind it.
 * Where it produces too few, coverage says so loudly enough for the caller to
 * hand the document to something else.
 *
 * Pure and synchronous. No I/O, no Prisma, no clock, no model — which is what
 * makes it testable against literal strings and what makes it work on a box
 * with no GPU and no network.
 */

export type RuleSet =
  | 'prescription'
  | 'laboratory_report'
  | 'discharge_summary'
  | 'generic'
  | 'none';

export interface RulesExtraction extends ParseResult {
  ruleSet: RuleSet;
  /**
   * The §19 topics this rule set actually looked for.
   *
   * Everything else is *unread*, not absent — and the difference is what stops
   * `describeFacts` saying "this document does not mention allergies" about a
   * section the rules never tried to parse.
   */
  coveredTopics: FactTopic[];
  /** True when the header rule declined to choose between competing dates. */
  ambiguousDate: boolean;
}

/**
 * Which rules may read this document.
 *
 * `unknown` gets none. Not knowing what a document is means not knowing which
 * vocabulary applies to it, and a prescription parser turned loose on an
 * unidentified page finds medications in a radiology report.
 */
export function ruleSetFor(type: DocumentType): RuleSet {
  switch (type) {
    case 'prescription':
    case 'laboratory_report':
    case 'discharge_summary':
      return type;
    case 'unknown':
      return 'none';
    default:
      return 'generic';
  }
}

/** The §19 topics each rule set attempts. */
const COVERED: Record<RuleSet, FactTopic[]> = {
  prescription: ['medications', 'diagnoses', 'allergies'],
  laboratory_report: ['investigations'],
  discharge_summary: [
    'medications',
    'diagnoses',
    'procedures',
    'allergies',
    'investigations',
  ],
  generic: ['diagnoses', 'procedures', 'allergies'],
  none: [],
};

export function extractByRules(
  lines: DocumentLine[],
  type: DocumentType,
): RulesExtraction {
  const ruleSet = ruleSetFor(type);
  const extraction = emptyExtraction(type);
  const claimed = new Set<LineKey>();
  const origins = new Map<string, FieldOrigin>();
  const uncertainty: Record<string, string[]> = {};

  if (ruleSet === 'none') {
    return {
      extraction,
      claimed,
      origins: new Map(),
      uncertainty,
      ruleSet,
      coveredTopics: [],
      ambiguousDate: false,
    };
  }

  const fields = readLabelledFields(lines);
  const sections = captureSections(lines);

  // ── Header ────────────────────────────────────────────────────────────────
  const header = {
    patientName: pickField(fields, 'patientName'),
    // A lab report's sample number is the last resort and is allowed only
    // there; on a prescription it would be a cross-reference to nothing.
    patientIdentifier: pickField(
      fields,
      'patientIdentifier',
      type === 'laboratory_report' ? 4 : 3,
    ),
    documentDate: pickField(fields, 'documentDate'),
    author: pickField(fields, 'author'),
    facility: pickField(fields, 'facility'),
    admittedOn: pickField(fields, 'admittedOn'),
    dischargedOn: pickField(fields, 'dischargedOn'),
  };

  extraction.patient.name = header.patientName?.value ?? null;
  extraction.patient.identifier = header.patientIdentifier?.value ?? null;
  extraction.document.date = header.documentDate?.value ?? null;
  extraction.document.author = header.author?.value ?? null;
  extraction.document.facility = header.facility?.value ?? null;

  for (const [name, field] of Object.entries(header)) {
    if (!field) continue;
    claimed.add(`${field.page}:${field.lineIndex}`);
    origins.set(pathFor(name), {
      producedBy: 'rules',
      rule: 'header.labelled',
      line: field.lineIndex,
      page: field.page,
    });
  }

  // A letterhead and a signature are not labelled, and reading them is worth
  // the two heuristics — but only the constrained versions in `fields.ts`.
  if (extraction.document.facility === null) {
    const letterhead = facilityFromLetterhead(lines);
    if (letterhead) {
      extraction.document.facility = letterhead.text.trim();
      claimed.add(lineKey(letterhead));
      noteOrigin(origins, 'document.facility', 'header.letterhead', letterhead);
    }
  }

  if (extraction.document.author === null) {
    const signature = authorFromSignature(lines);
    if (signature) {
      extraction.document.author = signature.text.trim();
      claimed.add(lineKey(signature));
      noteOrigin(origins, 'document.author', 'header.signature', signature);
    }
  }

  // An unlabelled date is not taken from the page at large. A letterhead's
  // printing date silently becoming the prescription date is a real clinical
  // error, and abstaining is the house answer — `classifier.ts` does the same
  // thing with `unknown`.
  //
  // Every date on every line, not the first of each: two competing dates are
  // as likely to be printed on one line — `Printed 01/02/2026, reviewed
  // 03/04/2026` — as on two, and reading only the first makes that line look
  // unambiguous.
  const everyDate = new RegExp(DATE_VALUE.source, 'gi');
  const ambiguousDate =
    extraction.document.date === null &&
    new Set(
      lines.flatMap((line) =>
        [...line.text.matchAll(everyDate)].map((match) => match[0]),
      ),
    ).size > 1;

  // ── Admission ─────────────────────────────────────────────────────────────
  if (header.admittedOn || header.dischargedOn) {
    extraction.admission = {
      admittedOn: header.admittedOn?.value ?? null,
      dischargedOn: header.dischargedOn?.value ?? null,
    };
  }

  // ── Narrative sections ────────────────────────────────────────────────────
  extraction.diagnosesRecorded = itemsFor(sections, 'diagnoses');
  extraction.procedures = itemsFor(sections, 'procedures');
  extraction.followUp = itemsFor(sections, 'followUp');
  extraction.allergies = itemsFor(sections, 'allergies');

  for (const section of sections) {
    if (section.items.length === 0) continue;
    claimed.add(lineKey(section.heading));
    for (const line of section.body) claimed.add(lineKey(line));
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  if (ruleSet === 'prescription') {
    const rx = sections.find((section) => section.topic === 'medications');
    const scope = rx ? rx.body : lines;
    const found = extractMedications(scope);

    extraction.medications = found.medications;
    Object.assign(uncertainty, found.uncertainty);
    for (const key of found.claimed) claimed.add(key);
    if (rx) claimed.add(lineKey(rx.heading));
    found.lineOf.forEach((line, index) =>
      noteOrigin(
        origins,
        `medications[${index}].name`,
        'medication.block',
        line,
      ),
    );
  }

  if (ruleSet === 'laboratory_report') {
    const found = extractInvestigations(lines);
    extraction.investigations = found.investigations;
    for (const key of found.claimed) claimed.add(key);
    found.lineOf.forEach((line, index) =>
      noteOrigin(origins, `investigations[${index}].test`, 'lab.row', line),
    );
  }

  if (ruleSet === 'discharge_summary') {
    // Scoped, and null is a real answer — see `discharge.ts`. A summary that
    // did not separate its discharge drugs from its narrative yields none.
    const section = dischargeMedicationSection(sections);
    if (section) {
      const found = extractMedications(section.body);
      extraction.medications = found.medications;
      Object.assign(uncertainty, found.uncertainty);
      for (const key of found.claimed) claimed.add(key);
      claimed.add(lineKey(section.heading));
      found.lineOf.forEach((line, index) =>
        noteOrigin(
          origins,
          `medications[${index}].name`,
          'medication.block',
          line,
        ),
      );
    }

    const investigations = sections.find((s) => s.topic === 'investigations');
    if (investigations) {
      const found = extractInvestigations(investigations.body);
      extraction.investigations = found.investigations;
      for (const key of found.claimed) claimed.add(key);
      found.lineOf.forEach((line, index) =>
        noteOrigin(origins, `investigations[${index}].test`, 'lab.row', line),
      );
    }
  }

  // Every value this file produced came from a rule, so every value gets an
  // origin — not just the ones a parser happened to name above.
  //
  // This is load-bearing rather than tidy. `buildProvenance` treats a value
  // with no origin as model output, which is correct for the callers that
  // predate this file and wrong for a partially-stamped rules extraction: it
  // made `medications[0].strength` look like something a model said, which in
  // turn made `modelGrounding` non-null on a box where no model had run, which
  // in turn published a grounding score of 1.0 as though it meant something.
  for (const { field } of collectExtractedValues(extraction)) {
    if (origins.has(field)) continue;
    noteOrigin(origins, field, ruleFor(field), null);
  }

  return {
    extraction,
    claimed,
    origins,
    uncertainty,
    ruleSet,
    coveredTopics: COVERED[ruleSet],
    ambiguousDate,
  };
}

/** Which family of rules produced a field, from where it sits in the envelope. */
function ruleFor(field: string): string {
  if (field.startsWith('medications')) return 'medication.block';
  if (field.startsWith('investigations')) return 'lab.row';
  if (field.startsWith('diagnoses')) return 'section.diagnoses';
  if (field.startsWith('procedures')) return 'section.procedures';
  if (field.startsWith('allergies')) return 'section.allergies';
  if (field.startsWith('admission')) return 'header.labelled';
  return 'header.labelled';
}

/** Header field name to the path `collectExtractedValues` will key it under. */
function pathFor(name: string): string {
  switch (name) {
    case 'patientName':
      return 'patient.name';
    case 'patientIdentifier':
      return 'patient.identifier';
    case 'documentDate':
      return 'document.date';
    case 'author':
      return 'document.author';
    case 'facility':
      return 'document.facility';
    case 'admittedOn':
      return 'admission.admittedOn';
    default:
      return 'admission.dischargedOn';
  }
}

export type { ExtractedDocument };
