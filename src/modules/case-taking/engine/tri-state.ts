/**
 * Tri-state facts — the representation every other file in this engine is built on.
 *
 * Case Taking §36 and Document Intelligence §19 both say the same thing from
 * two directions: the system must distinguish "no", "unknown", "not
 * applicable", "not assessed" and "prefer not to answer", and it must never
 * convert "not found" into "no". A chart that says "no known allergies" when
 * nobody ever asked is not an incomplete chart — it is a wrong one, and it is
 * wrong in the direction that gets somebody prescribed the drug that kills
 * them. Everything below exists to make that collapse hard to write rather than
 * merely discouraged.
 *
 * Three structural properties do the work:
 *
 *   1. A fact is never `boolean | null`. It is a discriminated union on
 *      `presence`, and the `value` field exists on exactly one member of that
 *      union. `fact.value` does not type-check until you have narrowed to
 *      `recorded`, so there is no "just read it and hope" path.
 *
 *   2. `not_assessed` is the only presence with no provenance, and every other
 *      presence requires one. To turn "nobody asked" into "the patient said no"
 *      you must invent a source and a verification status out of nothing. That
 *      is a visible act in a diff, not a forgotten `?? false`.
 *
 *   3. Absence is not representable as anything else. `presenceOf(undefined)`
 *      is `not_assessed`, and that is the only default in the file. There is no
 *      constructor, parser, or accessor anywhere here that produces `none`
 *      without being handed the assertion that backs it.
 *
 * Convention for boolean-kind fields: an asserted "no" is stored as `none`, not
 * as `recorded(false)`. Keeping the answer in the presence rather than in the
 * value is what makes "no" and "not asked" structurally different instead of
 * two values of the same shape. `recorded(false)` is tolerated on the read side
 * because extractors will produce it, but it is not the form this engine emits.
 */

/** The six presences. Order here is arbitrary; nothing may depend on it. */
export const FACT_PRESENCES = [
  'recorded',
  'none',
  'unknown',
  'not_applicable',
  'not_assessed',
  'declined',
] as const;

export type FactPresence = (typeof FACT_PRESENCES)[number];

/** Every presence except `recorded` — i.e. every presence with no value. */
export type AbsentPresence = Exclude<FactPresence, 'recorded'>;

/**
 * The presences that are claims about the patient rather than claims about the
 * interview. Each of these requires a provenance; `not_assessed` does not,
 * because there is nobody to attribute silence to.
 */
export type AssertedAbsentPresence = Exclude<
  FactPresence,
  'recorded' | 'not_assessed'
>;

/**
 * Where a fact came from (Case Taking §32, Documents §16).
 *
 * There is deliberately no `system_default`, `inferred` or `assumed` source.
 * Every member of this union is somebody asserting something. Without a source
 * that means "the system decided", no part of the system can manufacture an
 * assertion — the type has nowhere to put the lie.
 */
export const FACT_SOURCES = [
  'patient_voice',
  'patient_text',
  'patient_choice',
  'patient_correction',
  'uploaded_document',
  'existing_record',
  'clinician_confirmed',
] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

/** Documents §17: confirmation is tracked separately from confidence. */
export const VERIFICATION_STATUSES = [
  'unverified',
  'patient_confirmed',
  'clinician_confirmed',
  'disputed',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Where a confidence number came from, so that a measured one and a
 * self-reported one are never mistaken for each other.
 */
export const CONFIDENCE_SOURCES = [
  /** Character-level confidence from the OCR engine. A real measurement. */
  'ocr',
  /** The language model's own estimate. Empirically a constant. Non-informative. */
  'model_self_report',
  /** Computed by this engine from deterministic evidence. */
  'derived',
] as const;

export type ConfidenceSource = (typeof CONFIDENCE_SOURCES)[number];

export interface FactProvenance {
  readonly source: FactSource;
  readonly verification: VerificationStatus;
  /**
   * 0..1, for display and telemetry only (Documents §17).
   *
   * NOTHING MAY GATE ON THIS. A benchmark against the local gemma3:4b returned
   * exactly 0.95 on every extracted fact in a run, including the one it got
   * flatly wrong. A number that is constant carries no information, and a
   * threshold over it is a coin toss wearing a lab coat. No safety rule reads
   * confidence (there is no condition kind that could), and no verification
   * status is derived from it.
   *
   * `confidenceSource` is what makes the number interpretable: an OCR engine's
   * character confidence is a real measurement, a language model's self-report
   * is not, and the two must never be compared or thresholded together.
   */
  readonly confidence?: number;
  readonly confidenceSource?: ConfidenceSource;
  /**
   * ISO-8601, supplied by the caller rather than read from the clock. Every
   * function in this engine is pure so that a state can be replayed and a
   * safety evaluation reproduced exactly; reading `Date.now()` here would end
   * that.
   */
  readonly recordedAt?: string;
  readonly documentId?: string;
  readonly page?: number;
  readonly note?: string;
  /**
   * The row that asserted this, when the fact came out of storage.
   *
   * Provenance rather than plumbing: "which record makes this claim" is the
   * same kind of question as "who said it" and "which document it came from".
   * The engine never reads it — nothing here may behave differently because a
   * fact has been persisted — but a reader who wants to correct one value needs
   * to be able to name it, and a review rendered without it is a page of
   * statements with no handle on any of them.
   */
  readonly factId?: string;
}

/** The only shape that carries a value. */
export interface RecordedFact<T> {
  readonly presence: 'recorded';
  readonly value: T;
  readonly provenance: FactProvenance;
}

/** A claim that there is nothing to record — and who made that claim. */
export interface AssertedAbsentFact {
  readonly presence: AssertedAbsentPresence;
  readonly provenance: FactProvenance;
}

/**
 * Nobody asked. No provenance, because there is no assertion to attribute —
 * and no `value` field, because there is nothing to read.
 */
export interface NotAssessedFact {
  readonly presence: 'not_assessed';
}

export type Fact<T> = RecordedFact<T> | AssertedAbsentFact | NotAssessedFact;

/** Values a clinical fact can hold once it is `recorded`. */
export type FactValue = string | number | boolean;

/**
 * Frozen so that a caller who gets this singleton out of a lookup cannot mutate
 * the shared instance into an assertion and poison every other reader.
 */
export const NOT_ASSESSED: NotAssessedFact = Object.freeze({
  presence: 'not_assessed',
});

function assertProvenance(
  provenance: FactProvenance | undefined,
  presence: FactPresence,
): FactProvenance {
  if (!provenance || typeof provenance !== 'object') {
    throw new Error(
      `a "${presence}" fact requires a provenance; refusing to record an unattributed clinical claim`,
    );
  }
  if (!FACT_SOURCES.includes(provenance.source)) {
    throw new Error(
      `a "${presence}" fact requires a known source (got ${JSON.stringify(provenance.source)})`,
    );
  }
  if (!VERIFICATION_STATUSES.includes(provenance.verification)) {
    throw new Error(
      `a "${presence}" fact requires a known verification status (got ${JSON.stringify(provenance.verification)})`,
    );
  }
  if (
    provenance.confidence !== undefined &&
    (provenance.confidence < 0 || provenance.confidence > 1)
  ) {
    throw new Error('confidence must lie in 0..1');
  }
  return provenance;
}

export function recorded<T>(
  value: T,
  provenance: FactProvenance,
): RecordedFact<T> {
  if (value === undefined || value === null) {
    // A "recorded" fact with no value is the same fabrication as a defaulted
    // negative wearing a different hat.
    throw new Error('a "recorded" fact requires a value');
  }
  return Object.freeze({
    presence: 'recorded',
    value,
    provenance: assertProvenance(provenance, 'recorded'),
  });
}

export function assertedAbsent(
  presence: AssertedAbsentPresence,
  provenance: FactProvenance,
): AssertedAbsentFact {
  return Object.freeze({
    presence,
    provenance: assertProvenance(provenance, presence),
  });
}

/** The patient said no. Not "we have no record of" — said no. */
export function assertedNone(provenance: FactProvenance): AssertedAbsentFact {
  return assertedAbsent('none', provenance);
}

/** We asked; the patient does not know (§19 "patient unsure"). */
export function patientUnsure(provenance: FactProvenance): AssertedAbsentFact {
  return assertedAbsent('unknown', provenance);
}

/** The question cannot apply to this patient — obstetric history in a man. */
export function notApplicable(provenance: FactProvenance): AssertedAbsentFact {
  return assertedAbsent('not_applicable', provenance);
}

/** We asked; the patient chose not to answer (§36 "prefer not to answer"). */
export function declined(provenance: FactProvenance): AssertedAbsentFact {
  return assertedAbsent('declined', provenance);
}

/**
 * The single normalisation point for absence. A fact that is not there is
 * `not_assessed`; this is the only default anywhere in the engine, and it is
 * deliberately the harmless one.
 */
export function presenceOf(
  fact: Fact<unknown> | undefined | null,
): FactPresence {
  return fact ? fact.presence : 'not_assessed';
}

export function isRecorded<T>(
  fact: Fact<T> | undefined | null,
): fact is RecordedFact<T> {
  return !!fact && fact.presence === 'recorded';
}

/** True when somebody actually answered — in any of the five asserted ways. */
export function isAssessed(fact: Fact<unknown> | undefined | null): boolean {
  return presenceOf(fact) !== 'not_assessed';
}

/**
 * The result of the one accessor. A discriminated union rather than
 * `T | undefined`, so that "there is no value" carries the reason with it and a
 * caller cannot mistake an absent reading for a falsy value.
 */
export type FactReading<T> =
  | {
      readonly kind: 'value';
      readonly presence: 'recorded';
      readonly value: T;
      readonly provenance: FactProvenance;
    }
  | {
      readonly kind: 'absent';
      readonly presence: AbsentPresence;
      readonly provenance?: FactProvenance;
    };

/**
 * The only way to look inside a fact.
 *
 * Returning a union rather than throwing is the right default because reading a
 * fact that nobody answered is the normal case during an interview, not an
 * error — most of the state is `not_assessed` most of the time. Throwing is
 * reserved for `requireValue`, which is for the places (rendering, export)
 * where an absent value means the caller has a bug.
 */
export function readFact<T>(fact: Fact<T> | undefined | null): FactReading<T> {
  if (!fact) {
    return { kind: 'absent', presence: 'not_assessed' };
  }
  if (fact.presence === 'recorded') {
    return {
      kind: 'value',
      presence: 'recorded',
      value: fact.value,
      provenance: fact.provenance,
    };
  }
  if (fact.presence === 'not_assessed') {
    return { kind: 'absent', presence: 'not_assessed' };
  }
  return {
    kind: 'absent',
    presence: fact.presence,
    provenance: fact.provenance,
  };
}

/**
 * Thrown when something tries to print or export a value that does not exist.
 * Carries the presence so the failure message names what actually happened
 * rather than saying "undefined".
 */
export class NonRecordedValueError extends Error {
  constructor(
    readonly presence: AbsentPresence,
    readonly fieldPath?: string,
  ) {
    super(
      `refusing to produce a value for ${fieldPath ?? 'a fact'}: its presence is "${presence}", not "recorded"`,
    );
    this.name = 'NonRecordedValueError';
  }
}

/**
 * Get the value or fail. Used by the renderer and by anything that exports the
 * case, where the alternative to throwing is printing a blank or a "No" — a
 * test failure instead of a chart entry nobody can trace.
 */
export function requireValue<T>(
  fact: Fact<T> | undefined | null,
  fieldPath?: string,
): T {
  const reading = readFact(fact);
  if (reading.kind === 'value') {
    return reading.value;
  }
  throw new NonRecordedValueError(reading.presence, fieldPath);
}

export type BooleanAnswer = 'yes' | 'no' | 'not_answered';

/**
 * Tri-state-aware reading of a yes/no field.
 *
 * `not_answered` covers `unknown`, `declined`, `not_applicable` and
 * `not_assessed` alike: none of them is a "no", and the safety engine must not
 * treat any of them as one. A recorded value that is not a boolean is also
 * `not_answered` rather than truthy — an extractor writing "maybe" into a
 * boolean slot must not become an affirmative answer to a red-flag question.
 */
export function booleanAnswer(
  fact: Fact<unknown> | undefined | null,
): BooleanAnswer {
  const reading = readFact(fact);
  if (reading.kind === 'value') {
    if (reading.value === true) return 'yes';
    if (reading.value === false) return 'no';
    return 'not_answered';
  }
  return reading.presence === 'none' ? 'no' : 'not_answered';
}

/**
 * Human-readable label for a presence.
 *
 * `overrides` lets a section supply its own wording for one presence —
 * allergies say "No known allergies" for `none`. It is deliberately keyed by
 * presence so that a section can rename *one* state without being able to make
 * two states share a label; the callers' tests assert exactly that.
 */
export function presenceLabel(
  presence: FactPresence,
  overrides?: Partial<Record<FactPresence, string>>,
): string {
  const override = overrides?.[presence];
  if (override) return override;

  switch (presence) {
    case 'recorded':
      return 'Recorded';
    case 'none':
      return 'None reported';
    case 'unknown':
      return 'Patient unsure';
    case 'not_applicable':
      return 'Not applicable';
    case 'not_assessed':
      return 'Not assessed';
    case 'declined':
      return 'Prefer not to answer';
    default:
      return assertNever(presence, 'presenceLabel');
  }
}

/**
 * Compile-time exhaustiveness. Adding a seventh presence turns every switch in
 * the engine into a type error, which is the point: a new clinical state should
 * not be able to appear silently in one place and be forgotten in six others.
 */
export function assertNever(value: never, context?: string): never {
  throw new Error(
    `unhandled case ${JSON.stringify(value)}${context ? ` in ${context}` : ''}`,
  );
}

/**
 * The boundary where untrusted JSON — model output, a resumed session, an
 * imported document extraction — becomes a fact.
 *
 * This is where the collapse actually happens in practice. A model that emits
 * `{"presence":"none"}` with no provenance is asserting a negative it was never
 * told; that must fail here rather than be tidied up with a default. Anything
 * unrecognisable degrades to `not_assessed`, because the safe reading of
 * garbage is "we do not know".
 */
export function parseFact(raw: unknown): Fact<FactValue> {
  if (!raw || typeof raw !== 'object') {
    return NOT_ASSESSED;
  }
  const candidate = raw as {
    presence?: unknown;
    value?: unknown;
    provenance?: unknown;
  };
  const presence = candidate.presence;
  if (
    typeof presence !== 'string' ||
    !(FACT_PRESENCES as readonly string[]).includes(presence)
  ) {
    return NOT_ASSESSED;
  }
  if (presence === 'not_assessed') {
    return NOT_ASSESSED;
  }

  const provenance = assertProvenance(
    candidate.provenance as FactProvenance | undefined,
    presence as FactPresence,
  );

  if (presence === 'recorded') {
    const value = candidate.value;
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new Error(
        'a "recorded" fact requires a string, number or boolean value',
      );
    }
    return recorded<FactValue>(value, provenance);
  }

  return assertedAbsent(presence as AssertedAbsentPresence, provenance);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Presence derivation — the model does not get a vote
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A probe of the local gemma3:4b, given a schema that let it choose a presence,
 * answered the utterance "…I don't know if I'm allergic to anything" with:
 *
 *     { "fieldPath": "allergies.known", "presence": "recorded",
 *       "value": "unknown", "confidence": 0.95 }
 *
 * That is the tri-state collapse in miniature, and it is worse than a plain
 * default because it is *confidently* wrong: `presence: 'recorded'` asserts the
 * patient told us something, and the thing they told us is the string
 * "unknown". A renderer prints that as known information. A prescriber reads it
 * as a completed safety check.
 *
 * So `presence` is not in the extraction schema at all. The model reports only
 * what it heard — a field path, a value, and the span of the utterance it came
 * from — and `derivePresence` below is the only thing in the system that may
 * turn an answer into a presence. It is deterministic: the same answer yields
 * the same presence on every run, and the rule that produced it is named in the
 * result so it can be argued with.
 *
 * ── Language coverage ──
 * The phrase lists are ENGLISH ONLY today. Tamil and Hindi are a later phase.
 * When the session language is not English an unmatched answer is still
 * derived, but flagged `needsPatientConfirmation`, because we cannot currently
 * tell "moonu naal" (three days) from "theriyala" (I don't know) by pattern.
 * The failure direction is deliberate: it costs a confirmation tap, not a
 * fabricated fact.
 */

export type FieldKind =
  | 'boolean'
  | 'text'
  | 'number'
  | 'choice'
  | 'duration'
  | 'scale';

/** Languages whose phrase lists exist. Everything else is flagged for confirmation. */
export const PHRASE_MATCHED_LANGUAGES: readonly string[] = ['en'];

/** Severity answers that are not a 0-10 number but are still a real answer. */
export const SCALE_BANDS: readonly string[] = ['mild', 'moderate', 'severe'];

/**
 * Reserved choice tokens. A touch interface offers these as buttons, and they
 * mean a presence rather than a value — "Not sure" is not an answer to the
 * question, it is a statement about the patient's knowledge.
 */
export const CHOICE_UNSURE = 'not_sure';
export const CHOICE_DECLINED = 'prefer_not_to_say';
export const CHOICE_NEGATIVE = 'no';
export const CHOICE_AFFIRMATIVE = 'yes';
export const CHOICE_NOT_APPLICABLE = 'not_applicable';

/**
 * How the answer reached us. Distinct from `FactSource`, which records
 * provenance for the chart; this records how to *interpret* the answer.
 */
export const ANSWER_MODALITIES = [
  'voice',
  'text',
  'choice',
  'skip',
  'no_answer',
  'uploaded_document',
  'existing_record',
  'correction',
] as const;

export type AnswerModality = (typeof ANSWER_MODALITIES)[number];

export interface ValueConstraints {
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  /** The value must match this to be accepted. */
  readonly pattern?: RegExp;
  /** Explains, in the rejection, what the answer probably belongs to instead. */
  readonly rejectReason?: string;
}

export interface FieldValueSpec {
  readonly kind: FieldKind;
  readonly choices?: readonly string[];
  readonly accepts?: ValueConstraints;
}

export type ValueValidation =
  | { readonly ok: true; readonly value: FactValue }
  | { readonly ok: false; readonly reason: string };

/** Values that are *about* not knowing rather than answers. Never `recorded`. */
const UNCERTAINTY_VALUE_TOKENS = [
  'unknown',
  'unsure',
  'not sure',
  'not_sure',
  'dont know',
  "don't know",
  'do not know',
  'no idea',
  'n/a',
  'na',
  'nil known',
  'not known',
  'unspecified',
  'undetermined',
  'null',
  'none given',
  'not stated',
];

/**
 * An explicit refusal. Checked first, because a refusal that is read as an
 * uncertainty gets re-asked, and re-asking a patient who has just said they
 * would rather not answer is its own kind of harm.
 */
const DECLINED_PHRASES: readonly RegExp[] = [
  /\b(i('| a)?m )?(would |'?d )?(rather|prefer) not\b/i,
  /\bdo ?n'?t want to (say|answer|talk|discuss)\b/i,
  /\bskip (this|that|it|the question)\b/i,
  /\bnext question\b/i,
  /\bnot answering\b/i,
  /\bno comment\b/i,
  /\bi'?ll pass\b/i,
  /^\s*pass\s*[.!]?\s*$/i,
  /\bprivate\b.*\bnot\b|\bthat'?s private\b/i,
];

/**
 * "I do not know". Checked BEFORE negation, because almost every way of saying
 * it in English contains a negation ("don't", "can't", "no idea") and a
 * negation-first order would turn every uncertainty into an asserted no — the
 * exact collapse this file exists to prevent.
 */
const UNCERTAINTY_PHRASES: readonly RegExp[] = [
  /\bi (do not|don'?t|dont) know\b/i,
  /\b(do not|don'?t|dont) know\b/i,
  /\bnot sure\b/i,
  /\bunsure\b/i,
  /\bno idea\b/i,
  /\b(can'?t|cannot|could ?n'?t) remember\b/i,
  /\b(do not|don'?t|dont) remember\b/i,
  /\b(can'?t|cannot) say\b/i,
  /\bnot certain\b/i,
  /\bhard to say\b/i,
  /\bwho knows\b/i,
  /\bmay ?be\b/i,
  /\bpossibly\b/i,
  /\bi think so\b/i,
  /\bi guess\b/i,
  /\bnever (been )?(checked|tested|told)\b/i,
  /\bthe doctor (would|will|might) know\b/i,
];

/** An asserted negative. Only reached once refusal and uncertainty are ruled out. */
const NEGATION_PHRASES: readonly RegExp[] = [
  /^\s*(no|nope|nah|negative)\b/i,
  /\bno,?\s/i,
  /\bnever\b/i,
  /\bnothing\b/i,
  /\bnone\b/i,
  /\bnot at all\b/i,
  /\bno known\b/i,
  /\bi (do not|don'?t|dont) have\b/i,
  /\bi (have|had) (not|n'?t|never)\b/i,
  /\bhaven'?t (had|got)\b/i,
  /\bthere (is|are|was|were) (no|none)\b/i,
];

const AFFIRMATION_PHRASES: readonly RegExp[] = [
  /^\s*(yes|yeah|yep|yup|aye|correct|right|true)\b/i,
  /\byes,?\s/i,
  /\bi do\b/i,
  /\bi have\b/i,
  /\bi did\b/i,
  /\bthat'?s right\b/i,
  /\bof course\b/i,
];

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  several: 3,
};

const DURATION_PATTERN =
  /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several)\s*(?:of\s+)?(second|minute|hour|day|week|month|year|sec|min|hr|hrs|wk|mo|yr)s?\b/i;

const SINCE_PATTERN =
  /\b(since|from)\s+(yesterday|today|this morning|last night|last week|last month|last year|birth|childhood|\d{4}|\w+day)\b/i;

const RELATIVE_DURATION_PATTERN =
  /\b(yesterday|this morning|last night|overnight|just now|a while|long time|many years|all my life|birth)\b/i;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normaliseToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Normalise a value of unknown provenance into a comparable token. A non-scalar
 * becomes the empty string rather than "[object Object]": an extractor handing
 * us an object where a choice belongs has produced a malformed answer, not a
 * new choice.
 */
function tokenOfUnknown(value: unknown): string {
  if (typeof value === 'string') return normaliseToken(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return normaliseToken(String(value));
  }
  return '';
}

function isUncertaintyValueToken(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim().toLowerCase().replace(/[._]+/g, ' ');
  return UNCERTAINTY_VALUE_TOKENS.some(
    (token) => cleaned === token.replace(/[._]+/g, ' '),
  );
}

/**
 * Does this value fit the shape its field declares?
 *
 * The same benchmark run put `hpi.radiation: "when I walk"` into the chart.
 * That is not a radiation answer — it says *when* the pain happens, not *where*
 * it spreads — and it belongs in `hpi.aggravating_factors`. A model that
 * slot-fills eagerly will do this all day, so the field's declared shape is the
 * check, and a value that fails it is discarded rather than stored. A rejected
 * answer leaves the field `not_assessed`, which means the interview asks again;
 * a stored one means a clinician reads a fabricated finding.
 */
export function validateFieldValue(
  spec: FieldValueSpec,
  raw: unknown,
): ValueValidation {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'no value' };
  }
  if (isUncertaintyValueToken(raw)) {
    // The literal case from the probe: value "unknown" is a statement about
    // knowledge, never a recorded finding.
    return {
      ok: false,
      reason: 'value is an uncertainty token, not an answer',
    };
  }

  const text = typeof raw === 'string' ? raw.trim() : '';
  const constraints = spec.accepts;

  switch (spec.kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const token = normaliseToken(text);
      if (['yes', 'true', 'y', '1'].includes(token)) {
        return { ok: true, value: true };
      }
      if (['no', 'false', 'n', '0'].includes(token)) {
        return { ok: true, value: false };
      }
      return { ok: false, reason: 'not a yes/no answer' };
    }

    case 'number': {
      const numeric = typeof raw === 'number' ? raw : Number(text);
      if (!Number.isFinite(numeric)) {
        return { ok: false, reason: 'not a number' };
      }
      if (constraints?.min !== undefined && numeric < constraints.min) {
        return { ok: false, reason: `below ${constraints.min}` };
      }
      if (constraints?.max !== undefined && numeric > constraints.max) {
        return { ok: false, reason: `above ${constraints.max}` };
      }
      return { ok: true, value: numeric };
    }

    case 'scale': {
      // A 0-10 number, or one of the named bands. "Quite bad" is neither, and
      // recording it as a severity invents a measurement nobody made.
      const numeric = typeof raw === 'number' ? raw : Number(text);
      if (Number.isFinite(numeric)) {
        const min = constraints?.min ?? 0;
        const max = constraints?.max ?? 10;
        if (numeric < min || numeric > max) {
          return { ok: false, reason: `outside the ${min}-${max} scale` };
        }
        return { ok: true, value: Math.round(numeric) };
      }
      const band = normaliseToken(text);
      if (SCALE_BANDS.includes(band)) return { ok: true, value: band };
      return {
        ok: false,
        reason: `not a ${constraints?.min ?? 0}-${constraints?.max ?? 10} rating or one of ${SCALE_BANDS.join(', ')}`,
      };
    }

    case 'choice': {
      const token = normaliseToken(text);
      const match = (spec.choices ?? []).find(
        (choice) => normaliseToken(choice) === token,
      );
      return match
        ? { ok: true, value: match }
        : { ok: false, reason: 'not one of the offered choices' };
    }

    case 'duration': {
      if (
        DURATION_PATTERN.test(text) ||
        SINCE_PATTERN.test(text) ||
        RELATIVE_DURATION_PATTERN.test(text)
      ) {
        return { ok: true, value: text };
      }
      return { ok: false, reason: 'not recognisable as a length of time' };
    }

    case 'text': {
      if (text.length === 0) return { ok: false, reason: 'empty' };
      if (constraints?.maxLength && text.length > constraints.maxLength) {
        return { ok: false, reason: 'too long' };
      }
      if (constraints?.pattern && !constraints.pattern.test(text)) {
        return {
          ok: false,
          reason:
            constraints.rejectReason ??
            'does not match the shape this field expects',
        };
      }
      return { ok: true, value: text };
    }

    default:
      return assertNever(spec.kind, 'validateFieldValue');
  }
}

/** Parse a duration into days where possible. Used for display and ordering only. */
export function durationInDays(text: string): number | null {
  const match = DURATION_PATTERN.exec(text);
  if (!match) return null;
  const quantity = Number.isFinite(Number(match[1]))
    ? Number(match[1])
    : (NUMBER_WORDS[match[1].toLowerCase()] ?? Number.NaN);
  if (!Number.isFinite(quantity)) return null;
  const unit = match[2].toLowerCase();
  const perDay: Readonly<Record<string, number>> = {
    second: 1 / 86400,
    sec: 1 / 86400,
    minute: 1 / 1440,
    min: 1 / 1440,
    hour: 1 / 24,
    hr: 1 / 24,
    hrs: 1 / 24,
    day: 1,
    week: 7,
    wk: 7,
    month: 30,
    mo: 30,
    year: 365,
    yr: 365,
  };
  const factor = perDay[unit];
  return factor === undefined ? null : quantity * factor;
}

export type PresenceReason =
  | 'never_asked'
  | 'no_answer'
  | 'explicit_skip'
  | 'declined_phrase'
  | 'declined_choice'
  | 'uncertainty_phrase'
  | 'uncertainty_phrase_without_span'
  | 'uncertainty_value_token'
  | 'uncertainty_choice'
  | 'negation_phrase'
  | 'negation_choice'
  | 'not_applicable_choice'
  | 'affirmation_phrase'
  | 'extracted_value'
  | 'value_failed_field_shape'
  | 'no_value_extracted';

export interface AnswerInput {
  readonly modality: AnswerModality;
  /** The whole turn, as transcribed or typed. */
  readonly utterance?: string;
  /**
   * The substring the extractor attributed to THIS field, and the single most
   * important input here.
   *
   * One turn commonly answers several fields: "I've had chest pain for three
   * days… I don't know if I'm allergic to anything" carries a duration and an
   * uncertainty. Deriving `hpi.duration` from the whole turn would find "I
   * don't know" and wrongly mark the duration unknown. When the extractor
   * supplies the span, each field is judged on its own words. When it does not,
   * an uncertainty phrase anywhere in the turn still wins — re-asking a
   * duration is cheap, fabricating one is not — and the result says so via
   * `needsPatientConfirmation`.
   */
  readonly evidenceSpan?: string;
  /**
   * What the extractor pulled out. NEVER a presence: the extraction schema has
   * no presence field, which is why this function exists.
   */
  readonly extractedValue?: unknown;
  readonly field: FieldValueSpec;
  /** BCP-47-ish session language. Phrase lists are English only today. */
  readonly language?: string;
}

export interface PresenceDerivation {
  readonly presence: FactPresence;
  /** Present only when `presence` is `recorded`. */
  readonly value?: FactValue;
  /** Which rule decided, so an odd derivation can be explained rather than guessed at. */
  readonly reason: PresenceReason;
  /** False when the session language has no phrase list yet. */
  readonly languageCovered: boolean;
  /**
   * True when the derivation is defensible but not certain: an unmatched
   * language, or an uncertainty phrase in a turn with no evidence span. The UI
   * should read the value back to the patient before treating it as settled.
   */
  readonly needsPatientConfirmation: boolean;
}

/**
 * The only function in this system that may produce a `FactPresence` from an
 * answer. Deterministic, total, and pure.
 *
 * Rule order is load-bearing and is the reverse of how tempting it is to write:
 * refusal, then uncertainty, then negation, then affirmation, then value. Any
 * other order collapses a state into a more confident one.
 */
export function derivePresence(input: AnswerInput): PresenceDerivation {
  const languageCovered =
    !input.language ||
    PHRASE_MATCHED_LANGUAGES.some((code) =>
      input.language!.toLowerCase().startsWith(code),
    );

  const settle = (
    presence: FactPresence,
    reason: PresenceReason,
    extras?: { value?: FactValue; needsPatientConfirmation?: boolean },
  ): PresenceDerivation => ({
    presence,
    value: extras?.value,
    reason,
    languageCovered,
    needsPatientConfirmation: extras?.needsPatientConfirmation ?? false,
  });

  if (input.modality === 'no_answer') {
    return settle('not_assessed', 'never_asked');
  }
  if (input.modality === 'skip') {
    return settle('declined', 'explicit_skip');
  }

  // A tapped button is unambiguous, needs no phrase matching, and works in
  // every language — which is why the touch fallback (§10) is not a lesser
  // path but the reliable one.
  if (input.modality === 'choice') {
    const token = tokenOfUnknown(input.extractedValue);
    if (token === CHOICE_UNSURE) return settle('unknown', 'uncertainty_choice');
    if (token === CHOICE_DECLINED) return settle('declined', 'declined_choice');
    if (token === CHOICE_NOT_APPLICABLE) {
      return settle('not_applicable', 'not_applicable_choice');
    }
    if (token === CHOICE_NEGATIVE && input.field.kind === 'boolean') {
      return settle('none', 'negation_choice');
    }
    const validated = validateFieldValue(input.field, input.extractedValue);
    return validated.ok
      ? settle('recorded', 'extracted_value', { value: validated.value })
      : settle('not_assessed', 'value_failed_field_shape');
  }

  const span = (input.evidenceSpan ?? '').trim();
  const whole = (input.utterance ?? '').trim();
  const text = span.length > 0 ? span : whole;
  const spanWasSupplied = span.length > 0;

  if (text.length === 0 && input.extractedValue === undefined) {
    return settle('not_assessed', 'no_answer');
  }

  if (languageCovered && text.length > 0) {
    if (matchesAny(text, DECLINED_PHRASES)) {
      return settle('declined', 'declined_phrase');
    }
    if (matchesAny(text, UNCERTAINTY_PHRASES)) {
      return settle(
        'unknown',
        spanWasSupplied
          ? 'uncertainty_phrase'
          : 'uncertainty_phrase_without_span',
        { needsPatientConfirmation: !spanWasSupplied },
      );
    }
  }

  // Second line of defence, independent of language: a value that is itself a
  // statement about not knowing is never a recorded finding, whatever the
  // model labelled it.
  if (isUncertaintyValueToken(input.extractedValue)) {
    return settle('unknown', 'uncertainty_value_token');
  }

  if (languageCovered && text.length > 0) {
    if (matchesAny(text, NEGATION_PHRASES)) {
      return settle('none', 'negation_phrase');
    }
    if (
      input.field.kind === 'boolean' &&
      matchesAny(text, AFFIRMATION_PHRASES)
    ) {
      return settle('recorded', 'affirmation_phrase', { value: true });
    }
  }

  if (input.extractedValue === undefined) {
    return settle('not_assessed', 'no_value_extracted');
  }

  const validated = validateFieldValue(input.field, input.extractedValue);
  if (!validated.ok) {
    // Rejected, not stored. The field stays `not_assessed`, so the interview
    // asks again rather than carrying a slot-filled guess into the chart.
    return settle('not_assessed', 'value_failed_field_shape');
  }
  return settle('recorded', 'extracted_value', {
    value: validated.value,
    needsPatientConfirmation: !languageCovered,
  });
}

/**
 * Build the fact an answer implies, presence and all.
 *
 * The provenance the caller supplies is about *where* the answer came from;
 * this function decides *what state* it represents. A caller cannot override
 * the presence, because there is no parameter for it.
 */
export function factFromAnswer(
  input: AnswerInput,
  provenance: FactProvenance,
): { fact: Fact<FactValue>; derivation: PresenceDerivation } {
  const derivation = derivePresence(input);

  if (derivation.presence === 'not_assessed') {
    return { fact: NOT_ASSESSED, derivation };
  }

  const stamped: FactProvenance = derivation.needsPatientConfirmation
    ? { ...provenance, verification: 'unverified' }
    : provenance;

  if (derivation.presence === 'recorded') {
    // `derivePresence` only reports `recorded` alongside a validated value, so
    // this cannot be undefined; the check keeps that promise enforced rather
    // than assumed.
    if (derivation.value === undefined) {
      throw new Error(
        'derivePresence reported "recorded" with no value; this is a bug in derivePresence, not in the answer',
      );
    }
    return { fact: recorded(derivation.value, stamped), derivation };
  }

  return {
    fact: assertedAbsent(derivation.presence, stamped),
    derivation,
  };
}
