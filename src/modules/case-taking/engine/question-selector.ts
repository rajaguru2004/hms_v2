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
import { phrasingFor } from './phrasebook';
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
 * Every field that still owes an answer: applicable to this patient and not yet
 * assessed. `unknown`, `declined` and `not_applicable` all count as answered —
 * re-asking a question the patient has already declined is how a well-meaning
 * interview becomes an interrogation.
 *
 * Fields still in flight are outstanding but not *askable*: see `askableFields`.
 */
export function outstandingFields(
  state: ClinicalState,
): readonly FieldDefinition[] {
  return applicableFields(state)
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
  // The completion denominator is the applicable set, not the whole registry:
  // a chest-pain interview never asks the GI review, and must still be able to
  // reach 100%.
  return computeCompletion(state, applicableFields(state));
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
