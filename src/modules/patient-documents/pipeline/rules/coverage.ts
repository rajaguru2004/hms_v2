import { DocumentLine } from '../layout';
import { Classification, ASK_MODEL_BELOW } from '../classifier';
import { RuleSet, RulesExtraction } from '../rules-extractor';
import { BOILERPLATE } from './tokens';
import { lineKey } from './types';

/**
 * How much of this document the rules actually accounted for.
 *
 * The escalation signal, and it has to be its own measurement rather than a
 * reuse of the grounding score in `confidence.ts`. Grounding asks whether a
 * value appears in the source text; the rules produce values *by slicing* that
 * text, so the answer is yes by construction and a parse that found one drug
 * out of five would report near-perfect confidence. Coverage asks the question
 * grounding cannot — how much of the page was understood, and how complete is
 * what came back.
 *
 * Nothing here decides anything clinical. It decides whether to ask for a
 * second opinion.
 */

export type EscalationReason =
  | 'no_rule_set'
  | 'generic_rule_set'
  | 'weak_classification'
  | 'no_entities'
  | 'sparse_entities'
  | 'missing_required'
  | 'unclaimed_lines'
  | 'uncertain_entities'
  | 'ambiguous_date';

export interface RulesCoverage {
  ruleSet: RuleSet;
  /** 0..1 — the header fields this document type promises, that were filled. */
  requiredSatisfaction: number;
  required: { field: string; satisfied: boolean }[];
  /** 0..1 — weighted per-entity slot completeness. Null when there are no entities. */
  entityCompleteness: number | null;
  entityCount: number;
  /** 0..1 — the share of substantive lines some rule consumed. */
  lineClaim: number;
  bodyLineCount: number;
  /** The reviewer's shortlist, and a model's if one is asked. Capped. */
  unclaimedLines: { page: number; index: number; text: string }[];
  uncertainEntities: number;
  docTypeConfidence: number;
  /** The header rule declined to choose between competing unlabelled dates. */
  ambiguousDate: boolean;
  /** Published on the row. Never used to decide — see [decideEscalation]. */
  score: number;
  uncertainty: Record<string, string[]>;
}

export interface EscalationDecision {
  escalate: boolean;
  reasons: EscalationReason[];
  /**
   * Whether absence in this extraction means anything.
   *
   * The licence `describeFacts` needs before it may say "this document does
   * not mention allergies". False whenever a rule set did not look, or looked
   * and was not confident it had finished.
   */
  rulesAreComplete: boolean;
}

/** At most one of a type's header fields may be missing. */
const REQUIRED_SATISFACTION_MIN = 0.6;

/** Three weighted slots of six: name, strength and a schedule. */
const ENTITY_COMPLETENESS_MIN = 0.5;

/** Past a third unclaimed, there is a printed section with no rule behind it. */
const LINE_CLAIM_MIN = 0.65;

/** Below this many substantive lines the ratio swings by whole lines. */
const MIN_LINES_FOR_COVERAGE = 6;

/** Past forty, a shortlist is a haystack. */
const MAX_UNCLAIMED_LISTED = 40;

/**
 * Slot weights, because absence is not equally informative across fields.
 *
 * `route` and `duration` are missing from most real OPD prescriptions, so
 * weighting them like a name would escalate nearly every correct read.
 */
const MEDICATION_WEIGHTS: Record<string, number> = {
  name: 3,
  strength: 2,
  frequency: 2,
  dose: 1,
  duration: 1,
  route: 0.5,
  instructions: 0.5,
};

const INVESTIGATION_WEIGHTS: Record<string, number> = {
  test: 3,
  result: 3,
  unit: 2,
  referenceRange: 2,
};

/** The header fields each document type promises to carry. */
const REQUIRED: Record<RuleSet, string[]> = {
  prescription: ['patient.name', 'document.date', 'document.author'],
  laboratory_report: ['patient.name', 'document.date', 'document.facility'],
  discharge_summary: [
    'patient.name',
    'admission.dischargedOn',
    'document.author',
  ],
  generic: ['patient.name'],
  none: [],
};

function valueAt(
  extraction: RulesExtraction['extraction'],
  path: string,
): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      extraction,
    );
}

/**
 * Lines that count toward the claim ratio.
 *
 * Furniture is excluded entirely — neither claimed nor unclaimed. Without
 * this, a lab report's letterhead and footer alone push a clean read past the
 * threshold and every correct extraction escalates to a model it did not need.
 */
function isSubstantive(
  line: DocumentLine,
  index: number,
  total: number,
): boolean {
  const text = line.text.trim();
  if (text.length < 3) return false;
  if (!/[A-Za-z]{3}/.test(text)) return false;
  if (BOILERPLATE.test(text)) return false;
  // Letterhead and signature block: printed on every page, owned by no rule.
  if (line.page === 1 && index < 2) return false;
  if (index >= total - 2) return false;
  return true;
}

function weightedCompleteness(
  entity: Record<string, unknown>,
  weights: Record<string, number>,
): number {
  let filled = 0;
  let total = 0;
  for (const [slot, weight] of Object.entries(weights)) {
    total += weight;
    if (entity[slot] !== null && entity[slot] !== undefined) filled += weight;
  }
  return total === 0 ? 1 : filled / total;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function assessCoverage(
  rules: RulesExtraction,
  lines: readonly DocumentLine[],
  classification: Classification,
): RulesCoverage {
  const { extraction } = rules;

  const required = REQUIRED[rules.ruleSet].map((field) => ({
    field,
    satisfied: valueAt(extraction, field) != null,
  }));
  const requiredSatisfaction =
    required.length === 0
      ? 1
      : required.filter((entry) => entry.satisfied).length / required.length;

  const entities = [
    ...extraction.medications.map((medication) =>
      weightedCompleteness(
        medication as unknown as Record<string, unknown>,
        MEDICATION_WEIGHTS,
      ),
    ),
    ...extraction.investigations.map((investigation) =>
      weightedCompleteness(
        investigation as unknown as Record<string, unknown>,
        INVESTIGATION_WEIGHTS,
      ),
    ),
  ];
  const entityCompleteness =
    entities.length === 0
      ? null
      : entities.reduce((sum, value) => sum + value, 0) / entities.length;

  const substantive = lines.filter((line, index) =>
    isSubstantive(line, index, lines.length),
  );
  const unclaimed = substantive.filter(
    (line) => !rules.claimed.has(lineKey(line)),
  );
  const lineClaim =
    substantive.length === 0
      ? 1
      : (substantive.length - unclaimed.length) / substantive.length;

  const uncertainEntities = extraction.medications.filter(
    (medication) => medication.uncertain,
  ).length;

  // Absent entities are not incomplete ones: a referral letter legitimately
  // has none, and `requiredSatisfaction` already punishes a prescription that
  // found none. Treating null as zero would punish the same failure twice.
  const completeness = entityCompleteness ?? 1;

  return {
    ruleSet: rules.ruleSet,
    requiredSatisfaction: round(requiredSatisfaction),
    required,
    entityCompleteness:
      entityCompleteness === null ? null : round(entityCompleteness),
    entityCount: entities.length,
    lineClaim: round(lineClaim),
    bodyLineCount: substantive.length,
    unclaimedLines: unclaimed.slice(0, MAX_UNCLAIMED_LISTED).map((line) => ({
      page: line.page,
      index: line.index,
      text: line.text.trim(),
    })),
    uncertainEntities,
    docTypeConfidence: classification.confidence,
    ambiguousDate: rules.ambiguousDate,
    score: round(
      requiredSatisfaction *
        (0.5 + 0.5 * completeness) *
        (0.4 + 0.6 * lineClaim),
    ),
    uncertainty: rules.uncertainty,
  };
}

/**
 * Whether to ask a model, and why.
 *
 * A conjunction rather than a weighted score, and `classifyByKeywords` already
 * makes the argument at the top of `classifier.ts`: either signal being bad
 * should sink the answer, and averaging lets a strong one carry a weak one. A
 * perfect medication block on a page whose header did not parse is not a
 * document that was understood.
 *
 * [RulesCoverage.score] exists for the row and for tuning. It is deliberately
 * not consulted here — a single number cannot say *which* thing went wrong,
 * and the reasons are what make a stored row diagnosable a month later.
 */
export function decideEscalation(coverage: RulesCoverage): EscalationDecision {
  const reasons: EscalationReason[] = [];

  if (coverage.ruleSet === 'none') reasons.push('no_rule_set');
  // The generic set reads headers and verbatim sections and nothing else, so
  // it never finishes a narrative document. It escalates by construction.
  if (coverage.ruleSet === 'generic') reasons.push('generic_rule_set');

  // Imported from `classifier.ts` rather than retyped, so the two cannot
  // drift. The coupling has a deliberate consequence: a model-named type
  // carries a fixed confidence below this line, so a document only a model
  // could name is a document only a model may extract.
  if (coverage.docTypeConfidence < ASK_MODEL_BELOW) {
    reasons.push('weak_classification');
  }

  const wantsEntities =
    coverage.ruleSet === 'prescription' ||
    coverage.ruleSet === 'laboratory_report';
  if (wantsEntities && coverage.entityCount === 0) reasons.push('no_entities');

  if (
    coverage.entityCompleteness !== null &&
    coverage.entityCompleteness < ENTITY_COMPLETENESS_MIN
  ) {
    reasons.push('sparse_entities');
  }

  if (coverage.requiredSatisfaction < REQUIRED_SATISFACTION_MIN) {
    reasons.push('missing_required');
  }

  if (
    coverage.bodyLineCount >= MIN_LINES_FOR_COVERAGE &&
    coverage.lineClaim < LINE_CLAIM_MIN
  ) {
    reasons.push('unclaimed_lines');
  }

  if (coverage.uncertainEntities > 0) reasons.push('uncertain_entities');

  // The rules found several dates and none of them labelled, so they declined
  // to pick. A model reading the whole page may be able to tell which is the
  // document's own date; a coin toss here moves a prescription by months.
  if (coverage.ambiguousDate) reasons.push('ambiguous_date');

  return {
    escalate: reasons.length > 0,
    reasons,
    rulesAreComplete: reasons.length === 0 && coverage.ruleSet !== 'generic',
  };
}
