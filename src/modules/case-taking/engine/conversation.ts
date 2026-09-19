/**
 * The half-sentence in front of the question that makes this a conversation.
 *
 * ── What it is for
 *
 * A questionnaire asks ten questions. A person asks one, hears the answer, says
 * something that proves they heard it, and asks the next. The difference is not
 * the questions — the registry's wording is already careful, plain and specific
 * — it is the two or three words in between, and their absence is most of what
 * made this interview feel like a form being read at somebody.
 *
 * Two kinds, and they compose:
 *
 *   • an **acknowledgement** of the answer just given — "Alright.", "சரி.",
 *     "ठीक है।" — chosen by what the engine made of it, so "I don't know" gets
 *     "That's alright." and not "Good.";
 *   • a **lead-in** when the interview moves to a new section — "Now a few
 *     questions about your past health." A patient who has been describing
 *     chest pain and is suddenly asked about their sleep deserves to be told
 *     the subject changed.
 *
 * ── Why this is not a language model
 *
 * For the same reason none of the rest of this engine is, and one more. The
 * wording sits next to the questions in the phrasebook, gets translated by the
 * same route and reviewed by the same person; a model improvising warmth into a
 * clinical interview is a model improvising, and the thing it would eventually
 * improvise is reassurance nobody is qualified to give. "It sounds like nothing
 * serious" is one plausible token away from "Alright" and would be indefensible.
 *
 * ── The one place it stays silent
 *
 * When a red flag has just fired. `patientMessage` is spoken before the next
 * question and it is a routing instruction — "tell the front desk now, do not
 * wait in the queue". Prefixing that with "Good." is the interview sounding
 * pleased about the answer that triggered it.
 */

import { FactPresence } from './tri-state';
import { SectionKey } from './clinical-state';
import { conversationFor } from './phrasebook';

export interface LeadInput {
  /** What the engine made of the answer just given, or null on the first turn. */
  readonly presence: FactPresence | null;
  /** The section of the question just answered, or null. */
  readonly previousSection: SectionKey | null;
  /** The section of the question about to be asked. */
  readonly nextSection: SectionKey;
  /** The session's OUTPUT language — what the patient reads and hears. */
  readonly language?: string;
  /**
   * How many questions have been asked. Used only to vary the wording, and
   * only so that the same answer twice running does not produce the same word
   * twice running — which reads worse than no acknowledgement at all.
   *
   * Deterministic on purpose: the same interview replays identically, which is
   * a property every other part of this engine has and this one should not be
   * the exception to.
   */
  readonly turnIndex: number;
  /** True when a rule fired on this turn. Silences the acknowledgement. */
  readonly safetyFired: boolean;
}

/**
 * The words to say before the next question, or the empty string.
 *
 * Empty is a perfectly good answer and is the right one often: on the first
 * question of an interview, after a red flag, and whenever the phrasebook for
 * this language has nothing drafted. A caller concatenates it and gets the bare
 * question, which is exactly what shipped before this file existed.
 */
export function leadFor(input: LeadInput): string {
  const book = conversationFor(input.language);
  if (!book) return '';

  const parts: string[] = [];

  const acknowledgement = acknowledgementFor(input, book.acknowledgements);
  if (acknowledgement) parts.push(acknowledgement);

  // Only on a real change, and never into the section the interview opens with
  // — "Now, about what is bothering you" as the very first thing said is a
  // lead-in to a conversation that has not started.
  if (
    input.previousSection !== null &&
    input.previousSection !== input.nextSection
  ) {
    const leadIn = book.sections[input.nextSection];
    if (leadIn) parts.push(leadIn);
  }

  return parts.join(' ');
}

/** Which acknowledgement fits what the engine made of the last answer. */
function acknowledgementFor(
  input: LeadInput,
  words: ConversationAcknowledgements,
): string | null {
  if (input.safetyFired) return null;
  if (input.presence === null) return null;

  const list = listFor(input.presence, words);
  if (list.length === 0) return null;

  // Rotate rather than randomise. A random pick makes two runs of the same
  // interview differ, and every other output of this engine is reproducible
  // from the state — a property that is worth more than variety.
  return list[input.turnIndex % list.length];
}

function listFor(
  presence: FactPresence,
  words: ConversationAcknowledgements,
): readonly string[] {
  switch (presence) {
    case 'recorded':
      return words.recorded;
    case 'none':
      return words.none;
    case 'unknown':
      return words.unknown;
    case 'declined':
      return words.declined;
    // `not_assessed` means the answer was not readable and the question is
    // about to be asked again; "Alright." in front of a repeat is the interview
    // claiming to have understood something it did not. `not_applicable` is
    // never the result of a patient's answer.
    case 'not_assessed':
    case 'not_applicable':
      return [];
  }
}

/** What a language has to supply to be acknowledged in at all. */
export interface ConversationAcknowledgements {
  /** After a value was recorded. */
  readonly recorded: readonly string[];
  /** After an asserted no. Never congratulatory — a "no" is not good news. */
  readonly none: readonly string[];
  /** After "I don't know". Must not sound like a correction. */
  readonly unknown: readonly string[];
  /** After a refusal. Must not sound like disappointment. */
  readonly declined: readonly string[];
}

export interface ConversationPhrases {
  readonly acknowledgements: ConversationAcknowledgements;
  /** Keyed by the section being entered. Partial: a miss means no lead-in. */
  readonly sections: Readonly<Partial<Record<SectionKey, string>>>;
}
