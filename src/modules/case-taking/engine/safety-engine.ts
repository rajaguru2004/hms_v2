/**
 * The safety engine — §30's second branch off the clinical state.
 *
 * `evaluate` is a pure function of state and rule set. It reads facts, never
 * conversation; it calls no model; it does not touch the clock. Two runs over
 * the same state produce byte-identical assessments, which is what lets a
 * clinician ask "why did this fire?" a month later and get a real answer.
 *
 * The one behaviour worth stating loudly: **a condition only matches an
 * assertion.** `{ kind: 'yes' }` matches a patient who said yes. It does not
 * match `unknown`, `declined`, `not_applicable`, or the far commoner case of
 * `not_assessed` — a question nobody has reached yet. An engine that treats
 * absence as a match fires on every empty interview, the triage desk learns
 * within a week that the alerts mean nothing, and the one real alert is
 * dismissed with the rest. That is the subtle bug this file is built around,
 * and `safety-engine.spec.ts` asserts it presence by presence.
 */

import { ClinicalState, readFactAt } from './clinical-state';
import { assertSafetyPhrasebooks, safetyMessageFor } from './safety-phrasebook';
import {
  STATIC_FIELDS,
  complaintCategories,
  complaintUnreadable,
  ComplaintCategory,
} from './field-registry';
import {
  Condition,
  RED_FLAG_RULES,
  RULESET_VERSION,
  RedFlagRule,
  RedFlagSeverity,
  referencedFieldPaths,
  severityRank,
} from './safety-rules';
import {
  FactPresence,
  FactValue,
  assertNever,
  booleanAnswer,
  presenceOf,
  readFact,
} from './tri-state';

/** One fact that contributed to a rule firing — the evidence, for the audit trail. */
export interface MatchedFact {
  readonly fieldPath: string;
  readonly presence: FactPresence;
  readonly value?: FactValue;
  /** Short human description of what the condition asked for. */
  readonly condition: string;
}

export interface TriggeredRule {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly severity: RedFlagSeverity;
  readonly title: string;
  readonly patientMessage: string;
  readonly clinicianSummary: string;
  readonly recommendedAction: string;
  readonly matched: readonly MatchedFact[];
}

export interface SafetyAssessment {
  readonly rulesetVersion: string;
  readonly triggered: readonly TriggeredRule[];
  readonly highestSeverity: RedFlagSeverity | null;
  /**
   * The single message to put in front of the patient: the one from the most
   * severe rule that fired. Showing five alerts at once turns an instruction
   * into a wall of text nobody reads.
   */
  readonly patientMessage: string | null;
}

export interface ConditionOutcome {
  readonly matched: boolean;
  readonly facts: readonly MatchedFact[];
}

export function evaluateCondition(
  state: ClinicalState,
  condition: Condition,
): ConditionOutcome {
  switch (condition.kind) {
    case 'yes': {
      const matched =
        booleanAnswer(readFactAt(state, condition.field)) === 'yes';
      return {
        matched,
        facts: matched
          ? [factEvidence(state, condition.field, 'answered yes')]
          : [],
      };
    }

    case 'no': {
      // An asserted negative, which is a real clinical statement and a legitimate
      // thing for a rule to key on. Still not satisfied by silence.
      const matched =
        booleanAnswer(readFactAt(state, condition.field)) === 'no';
      return {
        matched,
        facts: matched
          ? [factEvidence(state, condition.field, 'answered no')]
          : [],
      };
    }

    case 'any_yes': {
      const hits = condition.fields.filter(
        (field) => booleanAnswer(readFactAt(state, field)) === 'yes',
      );
      return {
        matched: hits.length > 0,
        facts: hits.map((field) => factEvidence(state, field, 'answered yes')),
      };
    }

    case 'presence': {
      const presence = presenceOf(readFactAt(state, condition.field));
      const matched = condition.presenceIn.includes(presence);
      return {
        matched,
        facts: matched
          ? [factEvidence(state, condition.field, `presence is ${presence}`)]
          : [],
      };
    }

    case 'choice': {
      const reading = readFact(readFactAt(state, condition.field));
      const matched =
        reading.kind === 'value' &&
        condition.oneOf.includes(String(reading.value));
      return {
        matched,
        facts: matched
          ? [
              factEvidence(
                state,
                condition.field,
                `is one of ${condition.oneOf.join(', ')}`,
              ),
            ]
          : [],
      };
    }

    case 'number': {
      const reading = readFact(readFactAt(state, condition.field));
      // A numeric comparison against a non-number is not "false", it is a
      // question that was never validly answered. Coercing "a lot" to NaN and
      // letting NaN >= 8 be false is the right outcome, but it must be
      // deliberate rather than incidental.
      const numeric =
        reading.kind === 'value' && typeof reading.value === 'number'
          ? reading.value
          : reading.kind === 'value' && typeof reading.value === 'string'
            ? Number(reading.value)
            : Number.NaN;
      const matched =
        Number.isFinite(numeric) &&
        compare(numeric, condition.op, condition.value);
      return {
        matched,
        facts: matched
          ? [
              factEvidence(
                state,
                condition.field,
                `${condition.op} ${condition.value}`,
              ),
            ]
          : [],
      };
    }

    case 'complaint': {
      const active = complaintCategories(state);
      const hits = condition.anyOf.filter((category: ComplaintCategory) =>
        active.includes(category),
      );

      // A complaint written in a script the classifier cannot read is not a
      // complaint that has been ruled out. Treat it as "cannot exclude" rather
      // than as "does not match".
      //
      // This is safe **because every rule here is a conjunction.** ACS_TRIAD is
      // cardiac-complaint AND breathlessness AND sweating; the two structured
      // answers are real evidence the patient gave, and they are what actually
      // carries the rule. A patient with a sprained ankle answers no to
      // breathlessness and the rule stays silent whatever their complaint says.
      //
      // Both of the obvious alternatives were tried and measured, and both are
      // worse. Classifying unreadable text as every category fired ACS_TRIAD on
      // a Tamil sprained ankle — every red flag then carried no information for
      // any non-English interview, which is the alarm fatigue
      // `safety-engine.spec.ts` opens by calling the engine's single most
      // important property. Treating it as no-match missed a Tamil chest pain
      // that had the whole triad recorded.
      //
      // The evidence string says which happened, so a clinician reading the
      // alert is never told the complaint was classified when it was not.
      if (hits.length === 0 && complaintUnreadable(state)) {
        return {
          matched: true,
          facts: [
            factEvidence(
              state,
              'chief_complaint.symptom',
              'not in a language this rule could read; not excluded',
            ),
          ],
        };
      }
      return {
        matched: hits.length > 0,
        facts:
          hits.length > 0
            ? [
                factEvidence(
                  state,
                  'chief_complaint.symptom',
                  `classified as ${hits.join(', ')}`,
                ),
              ]
            : [],
      };
    }

    default:
      return assertNever(condition, 'evaluateCondition');
  }
}

function compare(
  left: number,
  op: 'gt' | 'gte' | 'lt' | 'lte',
  right: number,
): boolean {
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      return assertNever(op, 'compare');
  }
}

function factEvidence(
  state: ClinicalState,
  fieldPath: string,
  condition: string,
): MatchedFact {
  const reading = readFact(readFactAt(state, fieldPath));
  return reading.kind === 'value'
    ? { fieldPath, presence: 'recorded', value: reading.value, condition }
    : { fieldPath, presence: reading.presence, condition };
}

export function evaluateRule(
  state: ClinicalState,
  rule: RedFlagRule,
): TriggeredRule | null {
  // A rule with neither `all` nor `any` cannot fire. `safety-rules.ts` rejects
  // such a rule at load time; this guard covers rule sets injected at runtime
  // by a deployment or a test, where "matches everything" would be catastrophic
  // and "matches nothing" is merely useless.
  if (rule.all.length === 0 && rule.any.length === 0) return null;

  const matched: MatchedFact[] = [];

  for (const condition of rule.all) {
    const outcome = evaluateCondition(state, condition);
    if (!outcome.matched) return null;
    matched.push(...outcome.facts);
  }

  if (rule.any.length > 0) {
    const hits = rule.any
      .map((condition) => evaluateCondition(state, condition))
      .filter((outcome) => outcome.matched);
    if (hits.length === 0) return null;
    for (const hit of hits) matched.push(...hit.facts);
  }

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    severity: rule.severity,
    // English on every rule, in every language. This is the triage list a
    // clinician reads, and it must not change shape with the patient's
    // language — same rule as `field.label` in `phrasebook.ts`.
    title: rule.title,
    // The one string here the patient hears. `state.language` is the session's
    // OUTPUT language, set by `loadState`, so a red flag comes out in the same
    // language as the question that preceded it rather than switching to
    // English at the one moment the patient most needs to understand it.
    //
    // Falls back to `rule.message` for English, an unreviewed book with the
    // gate shut, or a rule the book has no instruction for. A translation can
    // never suppress a flag: everything above this line has already decided
    // the rule fired.
    patientMessage: safetyMessageFor(rule.id, rule.message, state.language),
    clinicianSummary: rule.clinicianSummary,
    recommendedAction: rule.recommendedAction,
    matched: dedupeEvidence(matched),
  };
}

function dedupeEvidence(facts: readonly MatchedFact[]): readonly MatchedFact[] {
  const seen = new Set<string>();
  const unique: MatchedFact[] = [];
  for (const fact of facts) {
    const signature = `${fact.fieldPath}|${fact.condition}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(fact);
  }
  return unique;
}

/**
 * Evaluate the whole rule set against the state.
 *
 * Results are sorted by severity and then by rule id, never by evaluation
 * order, so that adding a rule in the middle of the file does not reshuffle an
 * existing case's alert list.
 */
export function evaluate(
  state: ClinicalState,
  rules: readonly RedFlagRule[] = RED_FLAG_RULES,
): SafetyAssessment {
  const triggered = rules
    .map((rule) => evaluateRule(state, rule))
    .filter((result): result is TriggeredRule => result !== null)
    .sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity);
      if (bySeverity !== 0) return bySeverity;
      return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    });

  const highest = triggered[0];
  return {
    rulesetVersion: RULESET_VERSION,
    triggered,
    highestSeverity: highest ? highest.severity : null,
    patientMessage: highest ? highest.patientMessage : null,
  };
}

/* ─────────────────────────── load-time invariants ─────────────────────────── */

/**
 * Every field a rule reads must exist in the registry.
 *
 * A rule that names `ros.neurological.face_drop` instead of `face_droop` is not
 * a broken rule — it is a *silent* one. It evaluates cleanly, never matches,
 * and the stroke screen is simply gone. Nothing in the test suite would notice
 * unless it happened to test that exact rule, so the check runs at import.
 */
function assertRulesReferenceRealFields(): void {
  const known = new Set(STATIC_FIELDS.map((field) => field.key));
  const missing = referencedFieldPaths().filter((path) => !known.has(path));
  if (missing.length > 0) {
    throw new Error(
      `safety-engine: rules reference field paths that are not in the registry: ${missing.join(', ')}. ` +
        'A rule pointing at a field the interview never asks can never fire.',
    );
  }
}

assertRulesReferenceRealFields();

// Here rather than in `safety-phrasebook.ts` itself, so the books are checked
// against the rule set by the module that owns the join between them — and so
// that importing the books for a test or a tool does not run the check twice.
// A half-translated book, a translation for a rule that no longer exists, or a
// crisis instruction with the helpline number dropped all fail this startup.
assertSafetyPhrasebooks();
