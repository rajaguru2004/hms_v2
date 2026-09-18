/**
 * Question selection — §12's adaptive questioning, made boring on purpose.
 *
 * The interview is adaptive because the *filter* narrows as facts arrive, not
 * because a model improvised. `selectNext` is a pure, total function of the
 * clinical state: filter the registry to fields that are still `not_assessed`
 * and whose `appliesWhen` holds, sort by a fixed key, take the head. The same
 * state produces the same question on every machine, on every run, forever —
 * which is what makes an interview reviewable after the fact.
 *
 * The sort key is (section order, −redFlagWeight, −priority, key). Section
 * order dominates, so a high red-flag question in the allergies section cannot
 * jump ahead of the chief complaint. That is deliberate, and it is safe for a
 * reason worth stating: the safety engine evaluates the whole state after every
 * answer, independently of this file. Question order changes *when* a red flag
 * is discovered, never *whether* it is. The final tie-break on `key` costs
 * nothing and means the output does not depend on the order fields happen to be
 * declared in the registry.
 */

import {
  ClinicalState,
  CompletionReport,
  computeCompletion,
  isPending,
  markAsked,
  pendingFieldPaths,
  readFactAt,
  sectionRank,
} from './clinical-state';
import { FieldDefinition, applicableFields } from './field-registry';
import { phrasingFor, spokenPhrasingFor as spokenPhrasing } from './phrasebook';
import { isAssessed } from './tri-state';

export interface SelectedQuestion {
  readonly field: FieldDefinition;
  /**
   * What to ask if the LLM is unavailable (§42). The conversational layer is
   * free to rephrase this in the patient's language; if it cannot, this is
   * asked verbatim and the interview degrades to a plain questionnaire rather
   * than stopping.
   */
  readonly fallbackPrompt: string;
  /** How many applicable questions, including this one, remain unanswered. */
  readonly remaining: number;
}

/**
 * How many questions one interview may put to a patient.
 *
 * The registry holds fifty fields and a chest-pain filter still leaves around
 * seventy applicable slots once the HPI branches open. Asked end to end that is
 * a sixty-nine question interview, which is what a real session produced: the
 * patient answered every one of them, on a phone, and the last screen they saw
 * said "Question 68 of 69". Nobody finishes that, and an interview nobody
 * finishes collects less than a short one everybody does.
 *
 * Ten is a product decision, not a clinical ceiling. Nothing here caps what a
 * *clinician* may record, and nothing caps what extraction may bank when a
 * patient volunteers it — `extractionMenu` and `renderCase` both still read the
 * full applicable set, so an answer that arrives unasked is still filed. This
 * governs one thing: how many times the interview opens its mouth.
 */
export const QUESTION_BUDGET = 10;

/**
 * A budget that constrains nothing, for callers that want the pre-budget set —
 * the relevance and ordering properties the registry guarantees, which are
 * still true of the whole applicable set and are what the selector's own tests
 * pin down. Spelled rather than passed as a bare `Infinity` so a reader meets
 * the intent before the arithmetic.
 */
export const NO_QUESTION_BUDGET = Number.POSITIVE_INFINITY;

/**
 * The fields this interview will actually spend its budget on.
 *
 * Two orderings are in play here and conflating them is the trap. `compareFields`
 * decides *when* a question is asked and is dominated by section order, which is
 * what makes the conversation flow chief complaint → history → review. Choosing
 * the ten by that same key would spend the whole budget on the first section and
 * a half: one chief-complaint question and nine of the thirteen HPI slots, with
 * `allergies.reported` — red-flag weight 85, and the one field this codebase
 * calls out as a permanent hole in a chart if it goes unasked — never reached at
 * all. A short interview must be short on narrative, not short on safety.
 *
 * So the ten are *chosen* by clinical weight (red-flag first, then priority) and
 * *asked* in `compareFields` order. For a generic adult that lands on the
 * complaint, its onset and severity, the associated symptoms a red-flag rule
 * reads, self-harm screening, current medications, allergies and an age band —
 * a defensible ten-question triage.
 *
 * ── Why answered and in-flight fields are kept unconditionally
 *
 * The applicable set moves as facts arrive: answering the chief complaint opens
 * the branch for its category, and those fields can outweigh ones already in the
 * budget. If the budget were recomputed purely by weight each turn, a field the
 * patient had already answered could fall out of it — `expected` would drop
 * below `addressed`, progress would run backwards, and a question already put to
 * the patient could be asked again after its extraction landed. Retaining
 * everything assessed or in flight makes the set monotonic in exactly the way
 * the progress bar and the selector both assume, and leaves the budget's free
 * slots to be refilled adaptively, which is the part worth keeping adaptive.
 *
 * The consequence is that the set can exceed [QUESTION_BUDGET] only by fields
 * that were already asked under a previous budget — never by ones the interview
 * is still about to ask.
 */
export function budgetedFields(
  state: ClinicalState,
  budget: number = QUESTION_BUDGET,
): readonly FieldDefinition[] {
  const applicable = applicableFields(state);

  const spoken: FieldDefinition[] = [];
  const free: FieldDefinition[] = [];
  for (const field of applicable) {
    if (isPending(state, field.key) || wasAsked(state, field.key)) {
      spoken.push(field);
    } else if (!isAssessed(readFactAt(state, field.key))) {
      free.push(field);
    }
    // Assessed, but never asked: known from a document or an existing record.
    // In neither list — see `wasAsked`.
  }

  const room = Math.max(0, budget - spoken.length);
  const chosen = free.slice().sort(compareByClinicalWeight).slice(0, room);

  return [...spoken, ...chosen].sort(compareFields);
}

/**
 * The sources that mean *the interview asked, and the patient answered*.
 *
 * `patient_correction` is deliberately absent, and it is the interesting one. A
 * correction is the patient disagreeing with something already on file — the
 * printed prescription said 500 mg, they say it is 1000 — and the interview
 * never spent a question to get it. Counting it would charge the budget for a
 * conversation it did not have.
 */
const ASKED_SOURCES: readonly string[] = [
  'patient_voice',
  'patient_text',
  'patient_choice',
];

/**
 * Whether this field cost the interview one of its questions.
 *
 * The budget governs how many times the interview opens its mouth, so only what
 * came back from an opened mouth may spend it. A fact lifted off an uploaded
 * prescription, or read from the patient's existing record, was never a
 * question — and charging it to the question budget produces the exact
 * inversion of what a patient expects: bringing your paperwork gets you *fewer*
 * questions answered about the things the paperwork does not cover.
 *
 * That is not hypothetical either. The demo patient who uploads a prescription
 * and a lab report arrives with sixteen facts on file, nine of them from the
 * documents and his own record. Counted flat, the budget was full before the
 * interview asked him anything, and the seed that builds him failed outright.
 *
 * Such a field is in neither list in `budgetedFields`: not spent, and not
 * offered — `outstandingFields` filters assessed fields out anyway, so it can
 * never be re-asked. It simply is not part of the question set, which is the
 * honest reading of a question nobody asked.
 */
function wasAsked(state: ClinicalState, fieldPath: string): boolean {
  const fact = readFactAt(state, fieldPath);
  // Discriminated on `presence` rather than through `isAssessed`, which returns
  // a plain boolean and so does not narrow the union — `not_assessed` is the
  // one member with no provenance to read.
  if (fact.presence === 'not_assessed') return false;
  return ASKED_SOURCES.includes(fact.provenance.source);
}

/**
 * Which questions matter most, ignoring where they sit in the conversation.
 *
 * `compareFields` with its leading section term removed. Used only to choose the
 * budget's members; the asking order stays `compareFields`.
 */
export function compareByClinicalWeight(
  a: FieldDefinition,
  b: FieldDefinition,
): number {
  const byRedFlag = b.redFlagWeight - a.redFlagWeight;
  if (byRedFlag !== 0) return byRedFlag;

  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Every field that still owes an answer: within this interview's budget and not
 * yet assessed. `unknown`, `declined` and `not_applicable` all count as
 * answered — re-asking a question the patient has already declined is how a
 * well-meaning interview becomes an interrogation.
 *
 * Fields still in flight are outstanding but not *askable*: see `askableFields`.
 */
export function outstandingFields(
  state: ClinicalState,
  budget: number = QUESTION_BUDGET,
): readonly FieldDefinition[] {
  return budgetedFields(state, budget)
    .filter((field) => !isAssessed(readFactAt(state, field.key)))
    .slice()
    .sort(compareFields);
}

/**
 * What the interview may ask right now: outstanding, minus anything already put
 * to the patient and awaiting extraction.
 *
 * This is the concession to an eight-second extraction. The next question is
 * chosen and spoken while the previous answer is still being parsed, so the
 * selector is always reading a state one turn behind. Without the pending
 * filter it would see the field it just asked about still sitting at
 * `not_assessed` and ask it again, and the patient would hear the same question
 * twice in a row — which reads as the system not listening, and is the fastest
 * way to lose a patient's trust in an interview.
 */
export function askableFields(
  state: ClinicalState,
): readonly FieldDefinition[] {
  return outstandingFields(state).filter(
    (field) => !isPending(state, field.key),
  );
}

export function compareFields(a: FieldDefinition, b: FieldDefinition): number {
  const bySection = sectionRank(a.section) - sectionRank(b.section);
  if (bySection !== 0) return bySection;

  const byRedFlag = b.redFlagWeight - a.redFlagWeight;
  if (byRedFlag !== 0) return byRedFlag;

  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The next question, or `null` when there is nothing askable.
 *
 * `null` does not mean "finished": it can also mean "everything left is waiting
 * on extraction". `interviewStatus` tells the two apart, and the caller must
 * consult it before declaring the interview complete.
 *
 * Pure and synchronous by design. It runs on the hot path, in front of the
 * model rather than behind it, so that the patient hears the next question
 * immediately instead of after the eight-to-twenty seconds extraction takes on
 * the 4 GB card.
 */
export function selectNext(state: ClinicalState): SelectedQuestion | null {
  const askable = askableFields(state);
  const field = askable[0];
  if (!field) return null;
  return {
    field,
    // The session's OUTPUT language — `state.language` — carried on the state
    // since it was built. Not the patient's: what they speak governs the
    // recogniser, what the interview answers in governs this, and since
    // `outputLanguage` is `en` for every session today every question here
    // comes out of the registry's own English `prompt`. A session with no
    // language, or one whose translation nobody has reviewed, gets the same
    // English wording — never an empty prompt.
    fallbackPrompt: fallbackPhrasing(field, state.language),
    remaining: outstandingFields(state).length,
  };
}

/**
 * Select the next question and record that it was asked, in one step.
 *
 * Two steps invite the bug: select, speak, forget to mark, select again, ask
 * again. Returning the marked state alongside the question makes the correct
 * sequence the shortest one to write.
 */
export function selectNextAndMarkAsked(
  state: ClinicalState,
): { question: SelectedQuestion; state: ClinicalState } | null {
  const question = selectNext(state);
  if (!question) return null;
  return { question, state: markAsked(state, question.field.key) };
}

export type InterviewStatus = 'ready' | 'awaiting_extraction' | 'complete';

/**
 * Why `selectNext` returned what it did. The distinction matters: submitting a
 * case as complete while two answers are still in the extraction queue loses
 * them silently.
 */
export function interviewStatus(state: ClinicalState): InterviewStatus {
  if (askableFields(state).length > 0) return 'ready';
  return pendingFieldPaths(state).length > 0
    ? 'awaiting_extraction'
    : 'complete';
}

/**
 * The next `limit` questions. A touch interface (§10) can show several at once;
 * the voice interface asks them one at a time. Both read from the same ordering
 * so that switching modality mid-interview does not reshuffle the questions.
 */
export function selectNextBatch(
  state: ClinicalState,
  limit: number,
): readonly SelectedQuestion[] {
  const askable = askableFields(state);
  const outstanding = outstandingFields(state).length;
  return askable.slice(0, Math.max(0, limit)).map((field, index) => ({
    field,
    fallbackPrompt: fallbackPhrasing(field, state.language),
    remaining: outstanding - index,
  }));
}

export function isComplete(state: ClinicalState): boolean {
  return interviewStatus(state) === 'complete';
}

export function interviewProgress(state: ClinicalState): CompletionReport {
  // The completion denominator is the budgeted set, not the whole registry and
  // not even the whole applicable set: a chest-pain interview never asks the GI
  // review, and a ten-question interview never asks most of what is left. The
  // denominator has to be what will actually be asked or the bar cannot reach
  // 100% — which is the same reason it was the applicable set and not the
  // registry before the budget existed.
  return computeCompletion(state, budgetedFields(state));
}

/**
 * The question as the patient hears it: the registry's `prompt` plus a hint
 * about the shape of the expected answer.
 *
 * The answer hint matters more offline than online: without a model to
 * interpret "a bit sore", a patient needs to hear what kind of answer the form
 * can take. Choice values are stored in snake_case for the state and spoken as
 * words, so the same constant serves both.
 *
 * The wording itself now lives in `phrasebook.ts`, which is where the
 * translations sit beside it. This stayed a function here, with the same name
 * and the same English output, because it is what `SelectedQuestion` is built
 * from and what the service quotes back in a "we could not read that" message —
 * moving the callers would have been a bigger change than moving the strings.
 *
 * `language` is the session's OUTPUT language, not the request's and not the
 * patient's: it is the language the question is asked in. Omit it and you get
 * English, which is what every existing caller and every existing test expects
 * — and, since `outputLanguage` defaults to `en`, what every live session gets
 * too. The phrasebooks stay wired to this argument, so pointing a session's
 * `outputLanguage` at `hi` is all it takes to serve the Hindi wording again.
 */
export function fallbackPhrasing(
  field: FieldDefinition,
  language?: string,
): string {
  return phrasingFor(field, language);
}

/**
 * The same question with the answer hint left off, for anything that speaks it.
 *
 * Re-exported here beside [fallbackPhrasing] rather than imported from the
 * phrasebook at each call site, so the two phrasings of one question are found
 * together and a reader choosing between them sees both.
 */
export function spokenPhrasingFor(
  field: FieldDefinition,
  language?: string,
): string {
  return spokenPhrasing(field, language);
}
