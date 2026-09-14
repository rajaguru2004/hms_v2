/**
 * Red-flag rules, as data.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MESSAGE A PATIENT SEES MUST NEVER DIAGNOSE.
 *
 * §29 is explicit. "Some of what you have described needs to be seen quickly.
 * Please tell the front desk." — never "you are having a heart attack". A
 * patient told they are having a heart attack by a phone is a patient having a
 * panic attack in a waiting room, and if the screen is wrong we have caused
 * harm for nothing. Every `message` below is a routing instruction, not a
 * conclusion. `assertMessagesDoNotDiagnose` enforces it at module load, so a
 * well-meaning edit fails at import rather than in a waiting room.
 *
 * `clinicianSummary` may name the *screen* ("meets the ACS screening triad")
 * because a triage nurse needs to know which rule fired and why. It still never
 * asserts a diagnosis about the patient, and it is never shown to the patient.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Why data and not prompt text: a rule expressed as data can be diffed, code
 * reviewed by a clinician who does not read TypeScript, versioned per rule,
 * unit tested against a synthetic state, and pointed at when somebody asks why
 * the alert fired. A sentence in a system prompt is none of those things, and
 * it changes behaviour silently when the model behind it changes.
 *
 * Every condition is tri-state aware by construction. There is no
 * `{ field, equals: true }` shape to write; there is `{ kind: 'yes' }`, which
 * means "the patient asserted yes" and matches nothing else. `unknown`,
 * `declined`, `not_applicable` and `not_assessed` are not affirmatives, and a
 * safety engine that treats them as such fires on absent data — which produces
 * exactly the alert fatigue that gets safety engines switched off.
 */

import { ComplaintCategory } from './field-registry';
import { FactPresence } from './tri-state';

export const RED_FLAG_SEVERITIES = ['critical', 'urgent', 'advisory'] as const;
export type RedFlagSeverity = (typeof RED_FLAG_SEVERITIES)[number];

export function severityRank(severity: RedFlagSeverity): number {
  return RED_FLAG_SEVERITIES.indexOf(severity);
}

export type Condition =
  /** The patient asserted yes. Nothing else matches — not `unknown`, not silence. */
  | { readonly kind: 'yes'; readonly field: string }
  /** The patient asserted no (presence `none`, or a recorded `false`). */
  | { readonly kind: 'no'; readonly field: string }
  /**
   * At least one of these fields is an asserted yes. The only OR that is
   * allowed inside `all`, so that a rule stays one flat, readable row instead
   * of growing a nested boolean tree that nobody can review.
   */
  | { readonly kind: 'any_yes'; readonly fields: readonly string[] }
  /**
   * Matches on the *presence* itself. This is how a rule says "we do not know,
   * and not knowing is itself actionable" — see
   * BLEEDING_PREGNANCY_STATUS_UNKNOWN below.
   */
  | {
      readonly kind: 'presence';
      readonly field: string;
      readonly presenceIn: readonly FactPresence[];
    }
  | {
      readonly kind: 'choice';
      readonly field: string;
      readonly oneOf: readonly string[];
    }
  | {
      readonly kind: 'number';
      readonly field: string;
      readonly op: 'gt' | 'gte' | 'lt' | 'lte';
      readonly value: number;
    }
  /** The deterministic complaint classifier put the presentation in one of these. */
  | {
      readonly kind: 'complaint';
      readonly anyOf: readonly ComplaintCategory[];
    };

export interface RedFlagRule {
  readonly id: string;
  /** Bumped whenever the conditions or the message change. Per rule, not per file. */
  readonly version: number;
  readonly severity: RedFlagSeverity;
  /** Names the screen, for the triage list. Never shown to the patient. */
  readonly title: string;
  /** All of these must match. */
  readonly all: readonly Condition[];
  /** At least one of these must match, when the list is non-empty. */
  readonly any: readonly Condition[];
  /** Patient-facing. Routing instruction only — see the banner above. */
  readonly message: string;
  /** Clinician-facing explanation of why the rule fired. */
  readonly clinicianSummary: string;
  readonly recommendedAction: string;
}

/**
 * Bumped when rules are added or removed. Stored alongside a completed case so
 * that a case reviewed in a year can be read against the rules that actually
 * ran on it.
 */
export const RULESET_VERSION = '2026.09.1';

/**
 * A national helpline is deployment-specific. 14416 is India's Tele-MANAS line,
 * which is correct for the initial MediHive deployments; a deployment outside
 * India must override this rule's message rather than shipping a number that
 * rings nowhere.
 */
const TELE_MANAS = 'Tele-MANAS on 14416';

export const RED_FLAG_RULES: readonly RedFlagRule[] = [
  {
    id: 'ACS_TRIAD',
    version: 1,
    severity: 'critical',
    title: 'Chest pain with breathlessness and sweating or sudden onset',
    // §29's worked example, verbatim: chest pain + breathlessness + (sweating |
    // sudden onset). The complaint condition carries "chest pain", because the
    // classifier is what turned the patient's words into a cardiac
    // presentation in the first place.
    all: [
      { kind: 'complaint', anyOf: ['cardiac'] },
      { kind: 'yes', field: 'hpi.associated.breathlessness' },
    ],
    any: [
      { kind: 'yes', field: 'hpi.associated.sweating' },
      { kind: 'choice', field: 'hpi.onset', oneOf: ['sudden'] },
    ],
    message:
      'Some of what you have described needs to be checked quickly. Please tell the front desk now, and stay where the staff can see you.',
    clinicianSummary:
      'Cardiac-category complaint with breathlessness, plus diaphoresis or sudden onset. Meets the ACS screening triad.',
    recommendedAction:
      'Immediate triage. ECG and vitals before the patient returns to the waiting area.',
  },
  {
    id: 'STROKE_SIGNS',
    version: 1,
    severity: 'critical',
    title: 'Sudden focal neurological signs',
    all: [],
    any: [
      { kind: 'yes', field: 'ros.neurological.face_droop' },
      { kind: 'yes', field: 'ros.neurological.arm_weakness' },
      { kind: 'yes', field: 'ros.neurological.speech_difficulty' },
      { kind: 'yes', field: 'ros.neurological.sudden_vision_loss' },
    ],
    message:
      'What you have described needs to be looked at straight away. Please tell the front desk now — do not wait in the queue.',
    clinicianSummary:
      'One or more FAST-positive findings reported: facial droop, limb weakness, speech difficulty or sudden visual loss.',
    recommendedAction:
      'Immediate triage. Time of onset must be established; the stroke pathway is time-critical.',
  },
  {
    id: 'THUNDERCLAP_HEADACHE',
    version: 1,
    severity: 'critical',
    title: 'Sudden severe headache',
    all: [{ kind: 'yes', field: 'ros.neurological.sudden_worst_headache' }],
    any: [],
    message:
      'What you have described needs to be looked at straight away. Please tell the front desk now.',
    clinicianSummary:
      'Headache reported as sudden in onset and the worst ever experienced.',
    recommendedAction: 'Immediate triage.',
  },
  {
    id: 'ACTIVE_SEIZURE',
    version: 1,
    severity: 'critical',
    title: 'Seizure reported',
    all: [{ kind: 'yes', field: 'ros.neurological.seizure' }],
    any: [],
    message:
      'What you have described needs to be checked right away. Please tell the front desk now.',
    clinicianSummary: 'Fit or convulsion reported during this episode.',
    recommendedAction:
      'Immediate triage. Establish whether the patient is post-ictal and whether this is a first event.',
  },
  {
    id: 'SEVERE_BREATHLESSNESS',
    version: 1,
    severity: 'critical',
    title: 'Breathlessness at rest',
    all: [],
    any: [
      { kind: 'yes', field: 'ros.respiratory.breathless_at_rest' },
      { kind: 'yes', field: 'ros.respiratory.cannot_complete_sentences' },
    ],
    message:
      'Your breathing needs to be checked right away. Please tell the front desk now and stay seated.',
    clinicianSummary:
      'Breathlessness at rest, or inability to complete a sentence in one breath.',
    recommendedAction:
      'Immediate triage. Oxygen saturation and respiratory rate before the patient is seated.',
  },
  {
    id: 'ANAPHYLAXIS',
    version: 1,
    severity: 'critical',
    title: 'Allergic reaction with airway or circulatory involvement',
    all: [
      {
        kind: 'any_yes',
        fields: [
          'ros.allergic.reaction_happening_now',
          'ros.allergic.throat_or_lip_swelling',
          'ros.dermatological.sudden_widespread_rash',
        ],
      },
    ],
    any: [
      { kind: 'yes', field: 'ros.allergic.throat_or_lip_swelling' },
      { kind: 'yes', field: 'ros.respiratory.breathless_at_rest' },
      { kind: 'yes', field: 'ros.respiratory.cannot_complete_sentences' },
      { kind: 'yes', field: 'hpi.associated.breathlessness' },
      { kind: 'yes', field: 'hpi.associated.fainting' },
    ],
    message:
      'This needs attention immediately. Please tell the nearest member of staff now — do not wait for your turn.',
    clinicianSummary:
      'Reaction in progress or sudden widespread rash, with airway swelling, breathlessness or syncope.',
    recommendedAction:
      'Immediate triage. Adrenaline should be available at the point of assessment.',
  },
  {
    id: 'UPPER_GI_BLEED',
    version: 1,
    severity: 'critical',
    title: 'Haematemesis or melaena',
    all: [],
    any: [
      { kind: 'yes', field: 'ros.gastrointestinal.vomiting_blood' },
      { kind: 'yes', field: 'ros.gastrointestinal.black_stools' },
    ],
    message:
      'What you have described needs to be checked quickly. Please tell the front desk now and stay seated.',
    clinicianSummary:
      'Vomiting of blood or coffee-ground material, or black tarry stools.',
    recommendedAction:
      'Immediate triage. Pulse and blood pressure, including a postural check if tolerated.',
  },
  {
    id: 'LOWER_GI_BLEED',
    version: 1,
    severity: 'urgent',
    // Deliberately a rung below the upper GI rule. Fresh rectal bleeding is
    // common and usually benign; escalating every case of it to "critical"
    // teaches the triage desk to ignore this engine, which costs more lives
    // than it saves. Severity is a clinical judgement encoded once, here, where
    // it can be argued with.
    title: 'Fresh rectal bleeding',
    all: [{ kind: 'yes', field: 'ros.gastrointestinal.blood_in_stool' }],
    any: [],
    message:
      'Please mention this at the front desk when you check in, so it can be looked at today.',
    clinicianSummary: 'Fresh blood per rectum reported.',
    recommendedAction:
      'Prioritise ahead of routine appointments. Escalate if pulse or blood pressure are abnormal.',
  },
  {
    id: 'SEPSIS_SIGNS',
    version: 1,
    severity: 'critical',
    title: 'Fever with systemic signs',
    all: [
      {
        kind: 'any_yes',
        fields: ['ros.constitutional.fever', 'hpi.associated.fever'],
      },
    ],
    any: [
      { kind: 'yes', field: 'ros.constitutional.rigors' },
      { kind: 'yes', field: 'ros.neurological.confusion' },
      { kind: 'yes', field: 'ros.respiratory.fast_breathing' },
      { kind: 'yes', field: 'ros.genitourinary.reduced_urine_output' },
    ],
    message:
      'Some of what you have described needs urgent attention. Please tell the front desk now and stay where the staff can see you.',
    clinicianSummary:
      'Fever with at least one of: rigors, new confusion, tachypnoea, reduced urine output.',
    recommendedAction:
      'Immediate triage. Full observation set and a sepsis screen.',
  },
  {
    id: 'SUICIDAL_IDEATION',
    version: 1,
    severity: 'critical',
    title: 'Thoughts of self-harm reported',
    all: [{ kind: 'yes', field: 'ros.psychiatric.self_harm_thoughts' }],
    any: [],
    // The one message that says something to the patient rather than only
    // routing them. A patient who has just disclosed this and is answered with
    // a queue instruction has been told their disclosure did not register.
    message: `Thank you for telling us — that took something to say, and you should not have to manage it on your own. Please tell the front desk now so that someone can speak with you today. If things feel unsafe before then, you can call ${TELE_MANAS} at any hour.`,
    clinicianSummary:
      'Patient reported thoughts of self-harm or of ending their life during case taking.',
    recommendedAction:
      'Do not leave the patient unaccompanied in the waiting area. Same-day mental health assessment.',
  },
  {
    id: 'PREGNANCY_BLEEDING',
    version: 1,
    severity: 'critical',
    title: 'Bleeding in a possible pregnancy',
    all: [
      { kind: 'yes', field: 'ros.genitourinary.pregnancy_possible' },
      { kind: 'yes', field: 'ros.genitourinary.vaginal_bleeding' },
    ],
    any: [],
    message:
      'What you have described needs to be checked quickly. Please tell the front desk now and stay seated.',
    clinicianSummary:
      'Vaginal bleeding with pregnancy reported as possible or confirmed.',
    recommendedAction:
      'Immediate triage. Pregnancy test and observations; consider ectopic until excluded.',
  },
  {
    id: 'BLEEDING_PREGNANCY_STATUS_UNKNOWN',
    version: 1,
    severity: 'urgent',
    title: 'Bleeding with pregnancy status not established',
    // The rule that exists because of §36 and Documents §19. When pregnancy has
    // not been asked, or the patient is unsure, the safe reading is neither
    // "pregnant" (which would over-trigger PREGNANCY_BLEEDING on no evidence)
    // nor "not pregnant" (which is the fabricated negative the whole engine
    // exists to prevent). It is "we do not know, and someone must find out" —
    // which is a rule of its own, at a lower severity.
    all: [
      { kind: 'yes', field: 'ros.genitourinary.vaginal_bleeding' },
      {
        kind: 'presence',
        field: 'ros.genitourinary.pregnancy_possible',
        presenceIn: ['unknown', 'not_assessed', 'declined'],
      },
    ],
    any: [],
    message:
      'Please mention this at the front desk when you check in, so it can be looked at today.',
    clinicianSummary:
      'Vaginal bleeding reported; pregnancy status is unknown, declined or was never asked. Not a negative pregnancy status.',
    recommendedAction:
      'Establish pregnancy status before the patient is seated.',
  },
  {
    id: 'PAEDIATRIC_DANGER_SIGNS',
    version: 1,
    severity: 'critical',
    title: 'Paediatric danger signs',
    all: [
      {
        kind: 'choice',
        field: 'social.age_band',
        oneOf: ['infant', 'child'],
      },
    ],
    any: [
      { kind: 'yes', field: 'ros.paediatric.not_feeding' },
      { kind: 'yes', field: 'ros.paediatric.unrousable' },
      { kind: 'yes', field: 'ros.paediatric.convulsions' },
      { kind: 'yes', field: 'ros.paediatric.fast_breathing' },
      { kind: 'yes', field: 'ros.paediatric.sunken_eyes' },
    ],
    message:
      'What you have described about your child needs to be checked right away. Please tell the front desk now — do not wait in the queue.',
    clinicianSummary:
      'Child with one or more WHO danger signs: not feeding, abnormally sleepy, convulsions, fast breathing, or signs of dehydration.',
    recommendedAction: 'Immediate paediatric triage.',
  },
];

/* ─────────────────────────── load-time invariants ─────────────────────────── */

/**
 * Words and phrasings that turn a routing instruction into a diagnosis.
 *
 * The check is on condition names and on the grammar of telling somebody what
 * they have. It deliberately does not ban "you have", because "what you have
 * described" is the most natural non-diagnostic opening in English and banning
 * it would push authors toward worse sentences.
 */
const DIAGNOSTIC_PATTERNS: readonly RegExp[] = [
  /\bheart attack\b/i,
  /\bmyocardial\b/i,
  /\bstroke\b/i,
  /\bsepsis\b|\bseptic\b/i,
  /\banaphylax/i,
  /\bappendicitis\b/i,
  /\bcancer\b|\btumou?r\b/i,
  /\bembolism\b|\baneurysm\b|\binfarct/i,
  /\bangina\b|\bpneumonia\b|\bmeningitis\b/i,
  /\bectopic\b|\bmiscarriage\b/i,
  /\bulcer\b|\bhaemorrhage\b|\bhemorrhage\b/i,
  /\bdiagnos/i,
  /\byou are (having|suffering)\b/i,
  /\bthis (is|looks|sounds) like\b/i,
  /\bwe think you\b/i,
  /\b(probably|likely|possibly) a\b/i,
];

export function findDiagnosticLanguage(message: string): string | null {
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return match[0];
  }
  return null;
}

function assertMessagesDoNotDiagnose(rules: readonly RedFlagRule[]): void {
  for (const rule of rules) {
    const offending = findDiagnosticLanguage(rule.message);
    if (offending) {
      throw new Error(
        `safety-rules: the patient message for ${rule.id} contains "${offending}". ` +
          'Patient messages route, they do not diagnose (§29). Rewrite the message; ' +
          'the condition name belongs in clinicianSummary.',
      );
    }
  }
}

function assertRulesAreWellFormed(rules: readonly RedFlagRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error(`safety-rules: duplicate rule id ${rule.id}`);
    }
    seen.add(rule.id);

    if (rule.version < 1 || !Number.isInteger(rule.version)) {
      throw new Error(`safety-rules: ${rule.id} needs an integer version >= 1`);
    }
    if (rule.all.length === 0 && rule.any.length === 0) {
      // A rule with no conditions would either match everything or nothing
      // depending on how the evaluator folds an empty list. Neither is a rule.
      throw new Error(
        `safety-rules: ${rule.id} has no conditions; a half-written rule must not ship`,
      );
    }
    if (rule.message.trim().length === 0) {
      throw new Error(`safety-rules: ${rule.id} has no patient message`);
    }
  }
}

assertMessagesDoNotDiagnose(RED_FLAG_RULES);
assertRulesAreWellFormed(RED_FLAG_RULES);

/** Every field path any rule reads. Used by the engine's load-time check. */
export function referencedFieldPaths(
  rules: readonly RedFlagRule[] = RED_FLAG_RULES,
): readonly string[] {
  const paths = new Set<string>();
  for (const rule of rules) {
    for (const condition of [...rule.all, ...rule.any]) {
      if (condition.kind === 'any_yes') {
        for (const field of condition.fields) paths.add(field);
      } else if (condition.kind !== 'complaint') {
        paths.add(condition.field);
      }
    }
  }
  return [...paths].sort();
}
