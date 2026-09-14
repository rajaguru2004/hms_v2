/**
 * The clinical state document — §13, generalised.
 *
 * §13 shows the state as a nested JSON object with `null` holes. We store it
 * instead as a flat map from dotted field path to `Fact`, for two reasons that
 * are really one reason.
 *
 * First, a nested object cannot tell "the key is missing" apart from "the key
 * is there and holds null", and the whole engine turns on that distinction. A
 * flat map with a single read accessor has exactly one place where absence is
 * interpreted, and that place returns `NOT_ASSESSED`.
 *
 * Second, the safety rules, the question registry and the renderer all address
 * facts by path. Keeping the storage flat means a rule can name
 * `hpi.associated.breathlessness` as a string constant and never walk a tree
 * that may or may not have been created yet.
 *
 * Every function here is pure. `applyFact` returns a new state; nothing is
 * mutated in place. An interview is therefore a fold over answers, and any
 * point in it can be reconstructed and re-evaluated — which matters when a
 * clinician asks why the safety engine fired.
 */

import {
  Fact,
  FactValue,
  NOT_ASSESSED,
  isAssessed,
  presenceOf,
  FactPresence,
} from './tri-state';

/**
 * The eleven sections of a MediHive case. Note what is not here: there is no
 * `diagnosis`, `impression` or `assessment` section, and there never will be.
 * See the comment at the top of field-registry.ts.
 */
export const SECTION_KEYS = [
  'chief_complaint',
  'hpi',
  'ros',
  'past_medical',
  'surgical',
  'medications',
  'allergies',
  'family',
  'social',
  'ayush',
  'investigations',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * The order a clinician reads a case in, which is also the order the interview
 * walks (§38's final output follows it). Declared as an array rather than
 * derived from `SECTION_KEYS` so that changing the reading order is a visible,
 * single-line edit rather than a side effect of reordering a type.
 */
export const SECTION_ORDER: readonly SectionKey[] = [
  'chief_complaint',
  'hpi',
  'ros',
  'past_medical',
  'surgical',
  'medications',
  'allergies',
  'family',
  'social',
  'ayush',
  'investigations',
];

export const SECTION_TITLES: Readonly<Record<SectionKey, string>> = {
  chief_complaint: 'Chief Complaint',
  hpi: 'History of Present Illness',
  ros: 'Review of Systems',
  past_medical: 'Past Medical History',
  surgical: 'Surgical History',
  medications: 'Medications',
  allergies: 'Allergies',
  family: 'Family History',
  social: 'Personal / Social History',
  ayush: 'AYUSH Assessment',
  investigations: 'Previous Investigations',
};

export function sectionRank(section: SectionKey): number {
  const index = SECTION_ORDER.indexOf(section);
  // Unreachable while SECTION_ORDER covers SECTION_KEYS; the spec pins that.
  return index === -1 ? SECTION_ORDER.length : index;
}

export function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

/**
 * A field path is `section` followed by at least one `.name` or `[index]`
 * segment: `hpi.onset`, `ros.cardiovascular.chest_pain`,
 * `medications[0].name`.
 *
 * The leading segment must be a known section, which incidentally closes the
 * prototype-pollution hole: `__proto__.x` is not a section, so it cannot be
 * used as a path at all.
 */
const FIELD_PATH_PATTERN = /^[a-z_]+(?:\.[a-z0-9_]+|\[\d+\])+$/;

export interface ParsedFieldPath {
  readonly section: SectionKey;
  /** The path with the section stripped: `associated.breathlessness`. */
  readonly remainder: string;
  /** Repeated-group index when the path addresses one, e.g. 0 in `medications[0].name`. */
  readonly groupIndex?: number;
}

export function parseFieldPath(fieldPath: string): ParsedFieldPath {
  if (typeof fieldPath !== 'string' || !FIELD_PATH_PATTERN.test(fieldPath)) {
    throw new Error(`malformed field path: ${JSON.stringify(fieldPath)}`);
  }
  const head = /^[a-z_]+/.exec(fieldPath);
  const section = head ? head[0] : '';
  if (!isSectionKey(section)) {
    throw new Error(
      `field path ${JSON.stringify(fieldPath)} does not start with a known section`,
    );
  }
  const indexMatch = /\[(\d+)\]/.exec(fieldPath);
  return {
    section,
    remainder: fieldPath.slice(section.length).replace(/^\./, ''),
    groupIndex: indexMatch ? Number(indexMatch[1]) : undefined,
  };
}

export function sectionOf(fieldPath: string): SectionKey {
  return parseFieldPath(fieldPath).section;
}

export interface ClinicalState {
  readonly sessionId: string;
  /** ISO-8601 or any caller-chosen stamp; never read from the clock here. */
  readonly startedAt?: string;
  /** Interview language (§5), carried so the fallback phrasing layer can use it. */
  readonly language?: string;
  readonly facts: Readonly<Record<string, Fact<FactValue>>>;
  /**
   * Questions that have been put to the patient but whose answer has not been
   * extracted yet, mapped to the revision at which they were asked.
   *
   * This exists because extraction is slow — eight seconds for a short answer
   * on the 4 GB card, twenty for a long one — so the next question is selected
   * and spoken while the previous answer is still being parsed. Without this,
   * the selector would look at a state one turn behind, see the field still
   * `not_assessed`, and ask the same question again.
   *
   * It is deliberately NOT a seventh presence. "Asked, awaiting extraction" is
   * a fact about the *session*, not about the patient: it says nothing about
   * whether they have allergies, only about where the pipeline has got to.
   * Making it a presence would put it in front of every switch in the engine,
   * and sooner or later one of them would read it as an answer — which is the
   * same collapse as reading `not_assessed` as `none`, one level up. So
   * `readFactAt` still returns `NOT_ASSESSED` for a pending field, the safety
   * engine still sees nothing, the renderer still prints "Not assessed", and
   * only the selector consults this map.
   */
  readonly pending: Readonly<Record<string, number>>;
  /** Monotonic; every `applyFact` produces a new one. */
  readonly revision: number;
}

export function createClinicalState(init?: {
  sessionId?: string;
  startedAt?: string;
  language?: string;
  facts?: Readonly<Record<string, Fact<FactValue>>>;
}): ClinicalState {
  const facts: Record<string, Fact<FactValue>> = Object.create(null) as Record<
    string,
    Fact<FactValue>
  >;
  for (const [path, fact] of Object.entries(init?.facts ?? {})) {
    parseFieldPath(path);
    facts[path] = fact;
  }
  return Object.freeze({
    sessionId: init?.sessionId ?? 'session',
    startedAt: init?.startedAt,
    language: init?.language,
    facts: Object.freeze(facts),
    pending: Object.freeze(Object.create(null) as Record<string, number>),
    revision: 0,
  });
}

/**
 * The single read accessor for the state.
 *
 * `hasOwnProperty` rather than a bare index because the facts map is addressed
 * by strings that ultimately derive from model output. `state.facts['toString']`
 * on a normal object literal returns a Function, and a Function is truthy —
 * which is how a "fact" with no presence at all could reach a caller. Reading
 * through an own-property check means a path we never wrote reads as
 * `NOT_ASSESSED`, which is the only safe answer.
 */
export function readFactAt(
  state: ClinicalState,
  fieldPath: string,
): Fact<FactValue> {
  const stored = Object.prototype.hasOwnProperty.call(state.facts, fieldPath)
    ? state.facts[fieldPath]
    : undefined;
  return stored ?? NOT_ASSESSED;
}

export function presenceAt(
  state: ClinicalState,
  fieldPath: string,
): FactPresence {
  return presenceOf(readFactAt(state, fieldPath));
}

/**
 * Record one fact, returning a new state.
 *
 * A path that already holds a fact is replaced, because §35 lets the patient
 * correct anything. The superseded fact is not kept here — its replacement
 * carries its own provenance (`patient_correction`), which is what makes the
 * change auditable without this module growing a history model that the
 * persistence layer already owns.
 */
export function applyFact(
  state: ClinicalState,
  fieldPath: string,
  fact: Fact<FactValue>,
): ClinicalState {
  parseFieldPath(fieldPath);
  if (!fact || typeof fact.presence !== 'string') {
    throw new Error(
      `applyFact requires a Fact; got ${JSON.stringify(fact)} for ${fieldPath}`,
    );
  }
  const facts: Record<string, Fact<FactValue>> = Object.assign(
    Object.create(null),
    state.facts,
  ) as Record<string, Fact<FactValue>>;
  facts[fieldPath] = fact;
  return Object.freeze({
    ...state,
    facts: Object.freeze(facts),
    // The answer has landed, so the question is no longer in flight. This holds
    // even when the derived presence is `not_assessed` — extraction ran and
    // produced nothing usable, which means the question is askable again rather
    // than stuck waiting for a result that already came back empty.
    pending: withoutPending(state.pending, fieldPath),
    revision: state.revision + 1,
  });
}

function withoutPending(
  pending: Readonly<Record<string, number>>,
  fieldPath: string,
): Readonly<Record<string, number>> {
  if (!Object.prototype.hasOwnProperty.call(pending, fieldPath)) return pending;
  const next: Record<string, number> = Object.assign(
    Object.create(null),
    pending,
  ) as Record<string, number>;
  delete next[fieldPath];
  return Object.freeze(next);
}

/**
 * Record that a question has been put to the patient.
 *
 * The caller does this the moment the question is spoken, not when the answer
 * arrives — that is the whole point. Bumps the revision so that pending age can
 * be measured in turns.
 */
export function markAsked(
  state: ClinicalState,
  fieldPath: string,
): ClinicalState {
  parseFieldPath(fieldPath);
  const pending: Record<string, number> = Object.assign(
    Object.create(null),
    state.pending,
  ) as Record<string, number>;
  pending[fieldPath] = state.revision + 1;
  return Object.freeze({
    ...state,
    pending: Object.freeze(pending),
    revision: state.revision + 1,
  });
}

/**
 * Release a question back into the queue — extraction crashed, the patient
 * changed the subject, the turn was abandoned. Without this a lost extraction
 * would silently retire a question forever, which for `allergies.reported`
 * means a chart with a permanent hole nobody is told about.
 */
export function clearPending(
  state: ClinicalState,
  fieldPath: string,
): ClinicalState {
  const pending = withoutPending(state.pending, fieldPath);
  if (pending === state.pending) return state;
  return Object.freeze({ ...state, pending });
}

export function isPending(state: ClinicalState, fieldPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.pending, fieldPath);
}

export function pendingFieldPaths(state: ClinicalState): readonly string[] {
  return Object.keys(state.pending).sort();
}

/**
 * Release everything that has been in flight for more than `maxAgeRevisions`
 * turns. A supervisor calls this rather than trusting extraction to always come
 * back; the default of two turns is roughly forty seconds at the measured
 * extraction latency, by which point a lost job is lost.
 */
export function expirePending(
  state: ClinicalState,
  maxAgeRevisions = 2,
): ClinicalState {
  const stale = Object.entries(state.pending)
    .filter(([, askedAt]) => state.revision - askedAt > maxAgeRevisions)
    .map(([fieldPath]) => fieldPath);
  return stale.reduce(
    (next, fieldPath) => clearPending(next, fieldPath),
    state,
  );
}

export interface FactEntry {
  readonly fieldPath: string;
  readonly fact: Fact<FactValue>;
}

/** Apply a batch — one extraction pass usually yields several facts at once. */
export function applyFacts(
  state: ClinicalState,
  entries: readonly FactEntry[],
): ClinicalState {
  return entries.reduce(
    (next, entry) => applyFact(next, entry.fieldPath, entry.fact),
    state,
  );
}

export function factEntries(state: ClinicalState): readonly FactEntry[] {
  return Object.keys(state.facts)
    .sort()
    .map((fieldPath) => ({ fieldPath, fact: readFactAt(state, fieldPath) }));
}

export function factsInSection(
  state: ClinicalState,
  section: SectionKey,
): readonly FactEntry[] {
  return factEntries(state).filter(
    (entry) => sectionOf(entry.fieldPath) === section,
  );
}

/**
 * Indices already used by a repeated group such as `medications` or
 * `allergies`. Sorted ascending and de-duplicated, so a renderer can walk items
 * in a stable order without assuming the interview filled them in sequence.
 */
export function groupIndices(
  state: ClinicalState,
  prefix: string,
): readonly number[] {
  const pattern = new RegExp(`^${escapeForRegExp(prefix)}\\[(\\d+)\\]`);
  const found = new Set<number>();
  for (const fieldPath of Object.keys(state.facts)) {
    const match = pattern.exec(fieldPath);
    if (match) found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function nextGroupIndex(state: ClinicalState, prefix: string): number {
  const used = groupIndices(state, prefix);
  return used.length === 0 ? 0 : used[used.length - 1] + 1;
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The minimum a field must expose for completion to count it. Declared
 * structurally so that `field-registry.ts` can pass its `FieldDefinition`s
 * straight in without this module importing the registry — the dependency runs
 * registry → state, never both ways.
 */
export interface FieldExpectation {
  readonly key: string;
  readonly section: SectionKey;
}

export interface SectionCompletion {
  readonly section: SectionKey;
  readonly title: string;
  readonly expected: number;
  readonly addressed: number;
  readonly percent: number;
  readonly complete: boolean;
  readonly outstanding: readonly string[];
}

export interface CompletionReport {
  readonly expected: number;
  readonly addressed: number;
  readonly percent: number;
  readonly complete: boolean;
  readonly sections: readonly SectionCompletion[];
}

/**
 * §37's progress bar.
 *
 * A field counts as addressed when its presence is anything other than
 * `not_assessed`. "Unknown", "declined" and "not applicable" are finished
 * interview steps — asking again would just annoy the patient — while
 * `not_assessed` is the only state that still owes a question. This is the same
 * rule the selector uses, and it has to be, or progress would reach 100% while
 * questions remained.
 *
 * `applicableFields` is supplied by the caller from the registry after
 * `appliesWhen` filtering. A section with nothing applicable is 100% complete,
 * not 0%: a chest-pain interview never asks the GI review, and it must still be
 * able to finish.
 */
export function computeCompletion(
  state: ClinicalState,
  applicableFields: readonly FieldExpectation[],
): CompletionReport {
  const bySection = new Map<SectionKey, FieldExpectation[]>();
  for (const field of applicableFields) {
    const bucket = bySection.get(field.section);
    if (bucket) bucket.push(field);
    else bySection.set(field.section, [field]);
  }

  const sections: SectionCompletion[] = SECTION_ORDER.filter((section) =>
    bySection.has(section),
  ).map((section) => {
    const fields = bySection.get(section) ?? [];
    const outstanding = fields
      .filter((field) => !isAssessed(readFactAt(state, field.key)))
      .map((field) => field.key);
    const addressed = fields.length - outstanding.length;
    return {
      section,
      title: SECTION_TITLES[section],
      expected: fields.length,
      addressed,
      percent: percentOf(addressed, fields.length),
      complete: outstanding.length === 0,
      outstanding,
    };
  });

  const expected = applicableFields.length;
  const addressed = sections.reduce((sum, s) => sum + s.addressed, 0);
  return {
    expected,
    addressed,
    percent: percentOf(addressed, expected),
    complete: addressed === expected,
    sections,
  };
}

export function computeSectionCompletion(
  state: ClinicalState,
  section: SectionKey,
  applicableFields: readonly FieldExpectation[],
): SectionCompletion {
  const fields = applicableFields.filter((field) => field.section === section);
  const report = computeCompletion(state, fields);
  return (
    report.sections[0] ?? {
      section,
      title: SECTION_TITLES[section],
      expected: 0,
      addressed: 0,
      percent: 100,
      complete: true,
      outstanding: [],
    }
  );
}

function percentOf(addressed: number, expected: number): number {
  if (expected <= 0) return 100;
  return Math.round((addressed / expected) * 100);
}
