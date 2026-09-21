import {
  FactSource,
  VerificationStatus,
} from '../../case-taking/engine/tri-state';
import { ExtractedDocument } from './extraction-schema';

/**
 * Documents §16 and §17: where each value came from, and how much to believe it.
 *
 * §17 asks for confidence "at multiple stages" and the schema gives them
 * separate columns — `ocrConfidence` and `extractionConfidence`. Nothing in
 * this file ever combines them, and that is the point rather than an oversight.
 * They measure different things on incomparable scales: one is a recogniser's
 * per-character score, the other is a property of the mapping from text to
 * fields. Averaging them produces a number that means nothing and reads like it
 * means something, and a threshold over that number decides whether a human
 * looks at a prescription.
 *
 * The extraction number is *derived* here rather than asked for. A model's
 * self-reported confidence on this stack is a constant 0.95 — the benchmark is
 * written up in `case-taking/engine/tri-state.ts` — so the question becomes
 * what can be measured instead, and the answer is grounding: does the string
 * the model returned actually occur in the text it was given?
 *
 * That is a narrow question and it is worth being clear about what it does not
 * answer. A grounded value can still be in the wrong field — a reference range
 * copied into the result column is perfectly grounded. What grounding catches
 * is the failure that matters more, which is the model writing down a
 * medication that is not on the page. Every extracted value is checked, the
 * fraction that were found is the score, and a value that was not found is
 * marked in its own provenance entry so a reviewer can go straight to it.
 */

/** §16's "possible sources", for anything this module produces. */
const DOCUMENT_SOURCE: FactSource = 'uploaded_document';

/** §16's `verification_status: pending`, in the engine's vocabulary. */
const UNVERIFIED: VerificationStatus = 'unverified';

export interface ValueProvenance {
  /** Where in the extraction this value sits, e.g. `medications[0].name`. */
  field: string;
  value: string;
  source: FactSource;
  documentId: string;
  /** 1-based, or null when the value could not be located on any page. */
  page: number | null;
  /** Whether this exact text was found in the OCR output. */
  grounded: boolean;
  /** The recogniser's measurement for the page. Never the model's opinion. */
  ocrConfidence: number | null;
  verification: VerificationStatus;
  /**
   * Which reader produced this value.
   *
   * A reviewer looking at a wrong value needs to know which reader to
   * distrust, and the two fail in different ways: a rule mis-parses a layout
   * and does it identically on every document from that clinic, while a model
   * misreads one page and never repeats it.
   */
  producedBy: 'rules' | 'model';
  /** The named rule, for the deterministic path. Null for model values. */
  rule: string | null;
}

export interface ProvenanceResult {
  sources: ValueProvenance[];
  /**
   * 0..1 — the share of extracted values found in the source text.
   *
   * Null when there was nothing to check. Not zero: a document that yielded no
   * values has an undefined extraction quality, and zero would sort it beside a
   * document whose every value was invented.
   */
  extractionConfidence: number | null;
  /**
   * The same measure over model-produced values only.
   *
   * The number worth publishing once the rules run first. Rule-extracted
   * values are slices of the source text, so they ground by construction and
   * counting them measures arithmetic rather than evidence — an extraction
   * that is ninety per cent rules would report 0.97 whatever the model did.
   *
   * Null when the model produced nothing, which is the ordinary case on a box
   * with no GPU.
   */
  modelGrounding: number | null;
  /** The values that could not be found. The reviewer's shortlist. */
  ungrounded: string[];
}

/** One page's text, as the grounding check wants it. */
export interface PageText {
  /** 1-based, so it can be printed in a citation. */
  page: number;
  text: string;
  /** The recogniser's mean confidence for this page. */
  meanConfidence: number | null;
}

/**
 * Compare-ready text.
 *
 * Punctuation and case are exactly what differs between "Dr.Anitha
 * Raghavan,MD" as the recogniser ran the words together and "Dr. Anitha
 * Raghavan, MD" as the model tidied it up. Both are the same evidence and
 * neither is wrong, so neither is allowed to matter.
 */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every value in an extraction, with the path that names it. */
export function collectExtractedValues(
  extraction: ExtractedDocument,
): Array<{ field: string; value: string }> {
  const values: Array<{ field: string; value: string }> = [];

  const push = (field: string, value: string | null): void => {
    if (value) values.push({ field, value });
  };

  push('document.date', extraction.document.date);
  push('document.facility', extraction.document.facility);
  push('document.author', extraction.document.author);
  push('patient.name', extraction.patient.name);
  push('patient.identifier', extraction.patient.identifier);

  extraction.medications.forEach((medication, index) => {
    const at = `medications[${index}]`;
    push(`${at}.name`, medication.name);
    push(`${at}.strength`, medication.strength);
    push(`${at}.dose`, medication.dose);
    push(`${at}.frequency`, medication.frequency);
    push(`${at}.route`, medication.route);
    push(`${at}.duration`, medication.duration);
  });

  extraction.investigations.forEach((investigation, index) => {
    const at = `investigations[${index}]`;
    push(`${at}.test`, investigation.test);
    push(`${at}.result`, investigation.result);
    push(`${at}.unit`, investigation.unit);
    push(`${at}.referenceRange`, investigation.referenceRange);
  });

  extraction.diagnosesRecorded.forEach((value, index) =>
    push(`diagnosesRecorded[${index}]`, value),
  );
  extraction.procedures.forEach((value, index) =>
    push(`procedures[${index}]`, value),
  );
  extraction.allergies.forEach((value, index) =>
    push(`allergies[${index}]`, value),
  );

  if (extraction.admission) {
    push('admission.admittedOn', extraction.admission.admittedOn);
    push('admission.dischargedOn', extraction.admission.dischargedOn);
  }

  // `followUp` is deliberately absent. It is free prose that the model
  // reasonably reflows — "Review after 30 days" from "Follow up: Review after
  // 30 days." — so scoring it as ungrounded would penalise the extraction for
  // doing the right thing with the one field where paraphrase is acceptable.

  return values;
}

/**
 * Provenance for every extracted value, and the extraction confidence with it.
 *
 * Computed together because they are the same pass over the same data: the
 * score is the grounding outcome counted up, and publishing one without the
 * other would leave a reviewer with a number and no way to see what produced
 * it.
 */
export function buildProvenance(
  extraction: ExtractedDocument,
  pages: PageText[],
  documentId: string,
  /**
   * Which reader produced each value, keyed as `collectExtractedValues` keys.
   *
   * Optional, and absent means "a model produced all of it" — which is what
   * every caller meant before the deterministic pass existed, and what every
   * row stored before it is.
   */
  origins?: ReadonlyMap<
    string,
    { producedBy: 'rules' | 'model'; rule: string | null }
  >,
): ProvenanceResult {
  const normalisedPages = pages.map((page) => ({
    ...page,
    normalised: normaliseForMatch(page.text),
  }));

  const values = collectExtractedValues(extraction);
  const sources: ValueProvenance[] = [];
  const ungrounded: string[] = [];

  for (const { field, value } of values) {
    const needle = normaliseForMatch(value);
    const found = needle
      ? normalisedPages.find((page) => page.normalised.includes(needle))
      : undefined;

    if (!found) ungrounded.push(field);

    const origin = origins?.get(field);
    sources.push({
      field,
      value,
      source: DOCUMENT_SOURCE,
      documentId,
      page: found?.page ?? null,
      grounded: Boolean(found),
      ocrConfidence: found?.meanConfidence ?? null,
      verification: UNVERIFIED,
      producedBy: origin?.producedBy ?? 'model',
      rule: origin?.rule ?? null,
    });
  }

  return {
    sources,
    extractionConfidence:
      values.length === 0
        ? null
        : round((values.length - ungrounded.length) / values.length),
    modelGrounding: scoreGrounding(
      sources,
      (entry) => entry.producedBy === 'model',
    ),
    ungrounded,
  };
}

/**
 * The grounded share of some subset of values, or null when the subset is empty.
 *
 * Null rather than zero, for the reason [ProvenanceResult.extractionConfidence]
 * gives: "nothing was checked" and "everything checked was invented" are
 * opposite findings and must not share a number.
 */
export function scoreGrounding(
  sources: readonly ValueProvenance[],
  include: (source: ValueProvenance) => boolean = () => true,
): number | null {
  const subset = sources.filter(include);
  if (subset.length === 0) return null;
  return round(subset.filter((entry) => entry.grounded).length / subset.length);
}

/** The recogniser's own number for the document: the mean across its pages. */
export function meanOcrConfidence(pages: PageText[]): number | null {
  const scores = pages
    .map((page) => page.meanConfidence)
    .filter((score): score is number => typeof score === 'number');
  if (scores.length === 0) return null;
  return round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
