/**
 * One utterance, read for every field it happens to answer.
 *
 * ── What this replaced, and why it is smaller than what it replaced
 *
 * `extractFacts` on `LlmProvider`. A patient's opening narrative — "I've had
 * chest pain for three days, it comes and goes, worse when I climb the stairs,
 * no fever" — answers four fields, and only one of them was asked. The engine's
 * synchronous path files the asked one; everything else used to go to
 * gemma3:4b in the background: eight to twenty seconds of a 4 GB card, landing
 * minutes later, and only when Ollama happened to be running.
 *
 * What the model actually produced was a list of `{fieldPath, value, span}` —
 * and then the engine threw away its opinion of what those meant, because
 * `presence` was deliberately removed from its schema after it read "I don't
 * know if I'm allergic to anything" as a recorded allergy. So the model's real
 * job was narrower than it looked: spot that "three days" is a duration and
 * "comes and goes" is a timing. That is a vocabulary lookup, the vocabulary is
 * finite, and it is now written down in `answer-phrases.ts` where a Tamil
 * speaker can correct it in a diff.
 *
 * ── The rule this file follows, which the model could not be held to
 *
 * **A field is only harvested when the utterance names it unambiguously.**
 * Nothing here guesses. The measured failure of the model was eager slot
 * filling — it put `hpi.radiation: "when I walk"` on a chart, which is an
 * aggravating factor and not a radiation — and the defence against it was
 * per-field validation after the fact. This file does not need that defence for
 * the same reason a dictionary does not: it only claims what it can look up.
 *
 * Every candidate still goes through `derivePresence`, exactly as the model's
 * did. This produces *text attributed to a field*; the engine decides what
 * state that text represents, and may refuse it.
 *
 * ── Why it runs in front of the response rather than behind it
 *
 * Because it can. The whole background-job apparatus — the fire-and-forget
 * promise, the re-read of state minutes later, the second safety pass, the
 * `awaiting_extraction` status a patient could get stuck in — existed to hide
 * twenty seconds of model latency. This is regex matching over one sentence:
 * microseconds. The facts land before the next question is chosen, which means
 * the selector sees them and does not ask what the patient has already told us.
 * That is a better interview, and it is a consequence of the model leaving.
 */

import { ClinicalState, readFactAt } from './clinical-state';
import { FieldDefinition, applicableFields, fieldsFor } from './field-registry';
import { AnswerPhrases, phrasesFor } from './answer-phrases';
import { FieldKind } from './tri-state';

/**
 * One field the utterance appears to answer, and the words that answered it.
 *
 * `span` is what `derivePresence` will be handed as the evidence for this
 * field, and it is a real substring of what the patient said — never a
 * paraphrase and never the whole turn. The distinction matters: given the whole
 * turn, "I've had it three days, I don't know about allergies" derives the
 * duration as *unknown*, because the uncertainty phrase is in there somewhere.
 * A span is what keeps each field judged on its own words.
 */
export interface HarvestedField {
  readonly fieldPath: string;
  readonly span: string;
  /** Which rule found it, for the log and for an argument about an odd reading. */
  readonly reason: string;
}

/** How many fields one utterance may fill. A narrative is not a questionnaire. */
const HARVEST_LIMIT = 6;

/**
 * Clauses, in the order they were spoken.
 *
 * Split on the punctuation a recogniser actually emits and on the conjunctions
 * that join two statements about different things. This is what gives each
 * field a span rather than the whole turn: "chest pain for three days, comes
 * and goes, no fever" is three clauses and three different fields.
 *
 * Deliberately crude. A clause boundary in the wrong place costs a span that is
 * longer or shorter than ideal, and `derivePresence` is robust to both; a
 * parser good enough to be subtle would be a thing to maintain.
 */
const CONJUNCTION = /\s+(?:and|but|also|மற்றும்|ஆனா|ஆனால்|और|लेकिन|पर)\s+/iu;

function clausesOf(utterance: string): readonly string[] {
  return utterance
    .split(/[,;.!?]+/u)
    .flatMap(splitOnConjunction)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Split on "and", but only where both halves stand on their own.
 *
 * "and" joins clauses and it also sits inside the idioms this file most needs
 * to read whole: "comes and goes", "on and off", "now and then". Splitting
 * unconditionally turned "it comes and goes" into "it comes" and "goes" and
 * lost `hpi.timing` entirely — the harvest found nothing, in the one sentence
 * it was written for.
 *
 * Two words a side is the test. It is crude and it is the right crudeness: the
 * halves of an idiom are short ("goes", "off", "then") and the halves of two
 * real statements are not ("chest pain for three days", "no fever").
 */
function splitOnConjunction(piece: string): readonly string[] {
  const parts = piece.split(CONJUNCTION);
  if (parts.length === 1) return [piece];
  const standAlone = parts.every(
    (part) => part.trim().split(/\s+/u).filter(Boolean).length >= 2,
  );
  return standAlone ? parts : [piece];
}

/**
 * Is this key a member of a repeated group — `medications[0].name`?
 *
 * The bracket is the test, and it is the whole of it. `groupTemplateKey` looks
 * like the function for this and is not: it answers "what template does this
 * key belong to", returning the key itself for an ordinary field rather than
 * null. Read as a null check it excluded **every field in the registry**, and
 * the harvest returned nothing at all — silently, because an empty harvest is
 * also what "the patient volunteered nothing" looks like.
 */
function isGroupMember(key: string): boolean {
  return key.includes('[');
}

/** Does any of this language's word lists for `token` appear in `text`? */
function namesChoice(
  phrases: readonly AnswerPhrases[],
  token: string,
  text: string,
): boolean {
  return phrases.some((entry) =>
    (entry.choiceWords[token] ?? []).some((pattern) => pattern.test(text)),
  );
}

/** A duration is a number word or digit next to a unit, or a relative phrase. */
function namesDuration(
  phrases: readonly AnswerPhrases[],
  text: string,
): boolean {
  return phrases.some((entry) => {
    if (entry.relativeDuration.some((pattern) => pattern.test(text))) {
      return true;
    }
    if (!entry.durationUnits.some((unit) => unit.pattern.test(text))) {
      return false;
    }
    if (/\d/.test(text)) return true;
    return Object.keys(entry.numberWords).some((numberWord) =>
      new RegExp(`(?<!\\p{L})${numberWord}(?!\\p{L})`, 'iu').test(text),
    );
  });
}

/** A severity is a 0-10 number or one of the named bands. */
function namesSeverity(
  phrases: readonly AnswerPhrases[],
  text: string,
): boolean {
  const digits = /(?<!\d)(\d{1,2})(?!\d)/.exec(text);
  if (digits && Number(digits[1]) <= 10) return true;
  return phrases.some((entry) =>
    entry.scaleBands.some((band) => band.pattern.test(text)),
  );
}

/**
 * Whether this clause asserts a symptom rather than denying it.
 *
 * Only ever consulted for the `hpi.associated.*` booleans, where the polarity
 * is the entire answer: "no fever" and "fever" name the same field and mean
 * opposite things. Returning the clause unchanged lets `derivePresence` decide
 * — its negation lists are the ones that already know how "no" is said in
 * three languages, and duplicating that judgement here is how the two would
 * come to disagree.
 */
function associatedSymptomWords(field: FieldDefinition): readonly RegExp[] {
  const leaf = field.key.split('.').pop() ?? '';
  const words: Readonly<Record<string, readonly RegExp[]>> = {
    breathlessness: [
      /\bbreathless|short(ness)? of breath|difficulty breathing\b/i,
      /(?<!\p{L})(?:மூச்சு\s*(?:திணற|வாங்க|முட்ட))/u,
      /(?<!\p{L})(?:(?:साँस|सांस)\s*(?:फूल|लेने\s*में))(?!\p{L})/u,
    ],
    sweating: [
      /\bsweat(ing|y)?\b/i,
      /(?<!\p{L})(?:வியர்வ|வேர்க்)/u,
      /(?<!\p{L})(?:पसीना)(?!\p{L})/u,
    ],
    nausea: [
      /\bnausea|feel(ing)? sick|vomit/i,
      /(?<!\p{L})(?:குமட்ட|வாந்தி)/u,
      /(?<!\p{L})(?:उल्टी|जी\s*मिचला)(?!\p{L})/u,
    ],
    palpitations: [
      /\bpalpitation|heart (racing|pounding)\b/i,
      /(?<!\p{L})(?:படபடப்)/u,
      /(?<!\p{L})(?:धड़कन)(?!\p{L})/u,
    ],
    fainting: [
      /\bfaint(ed|ing)?|black(ed)? out|passed out\b/i,
      /(?<!\p{L})(?:மயக்க)/u,
      /(?<!\p{L})(?:बेहोश|चक्कर)(?!\p{L})/u,
    ],
    fever: [
      /\bfever|temperature\b/i,
      /(?<!\p{L})(?:காய்ச்சல்|ஜுர)/u,
      /(?<!\p{L})(?:बुखार|बुख़ार|ज्वर)(?!\p{L})/u,
    ],
  };
  return words[leaf] ?? [];
}

/**
 * Read one utterance for everything it answers beyond the question asked.
 *
 * `askedFieldPath` is excluded: the synchronous path has already filed that
 * one from the patient's own words, and harvesting it again would write a
 * second fact from the same sentence.
 *
 * Returns candidates in registry order, capped. Nothing here writes anything.
 */
export function harvest(input: {
  readonly state: ClinicalState;
  readonly utterance: string;
  readonly language?: string;
  readonly askedFieldPath?: string;
}): readonly HarvestedField[] {
  const utterance = input.utterance.trim();
  if (utterance.length === 0) return [];

  const phrases = phrasesFor(input.language);
  const clauses = clausesOf(utterance);

  // Only fields that are applicable, unanswered, and not the one just filed.
  // `applicableFields` is what keeps a harvest from filling in an obstetric
  // field for a patient the registry has ruled it out for.
  const candidates = applicableFields(input.state).filter(
    (field) =>
      field.key !== input.askedFieldPath &&
      readFactAt(input.state, field.key).presence === 'not_assessed' &&
      // Repeated-group members are addressed by index and a narrative does not
      // carry one. `medications[0].name` is asked, never harvested.
      !isGroupMember(field.key),
  );

  const found: HarvestedField[] = [];
  const taken = new Set<string>();

  for (const field of candidates) {
    if (found.length >= HARVEST_LIMIT) break;
    if (taken.has(field.key)) continue;

    for (const clause of clauses) {
      const hit = readClause(field, clause, phrases);
      if (!hit) continue;
      found.push({ fieldPath: field.key, span: clause, reason: hit });
      taken.add(field.key);
      break;
    }
  }

  return found;
}

/**
 * The part of the utterance that answers the question that was asked.
 *
 * ── The bug this exists for
 *
 * "chest pain for three days, it comes and goes, no fever" was filed against
 * `chief_complaint.symptom` as **`none`** — an asserted absence of a chief
 * complaint — because `derivePresence` had no span, judged the field against
 * the whole turn, and found "no fever" in it. The patient's complaint was
 * destroyed by a denial they had made about something else.
 *
 * `AnswerInput` already separates the two things that were being conflated:
 * `evidenceSpan` is what the presence is judged from, `extractedValue` is what
 * gets stored. The span was the missing half, and this file already knows how
 * to find one — it splits the same utterance into clauses to attribute
 * everything else.
 *
 * ── The rule
 *
 * The first clause this field can actually read, and failing that the first
 * clause at all. A patient asked a question answers it and then volunteers; the
 * answer is at the front. For a `text` field — which reads anything and is
 * therefore never matched by `readClause` — the first clause is the rule, and
 * it is the right one: "chest pain" is the complaint, "no fever" is an answer
 * to a question nobody has asked yet.
 *
 * Returns null for a single-clause utterance, where there is nothing to choose
 * between and the caller's existing behaviour is already correct.
 */
export function spanForAsked(
  utterance: string,
  field: FieldDefinition,
  language?: string,
): string | null {
  const clauses = clausesOf(utterance);
  if (clauses.length <= 1) return null;

  const phrases = phrasesFor(language);
  const readable = clauses.find(
    (clause) => readClause(field, clause, phrases) !== null,
  );
  return readable ?? clauses[0];
}

/** What, if anything, this clause says about this field. */
function readClause(
  field: FieldDefinition,
  clause: string,
  phrases: readonly AnswerPhrases[],
): string | null {
  // An associated symptom is named or it is not, and the polarity is left to
  // `derivePresence` — "no fever" and "fever" both land here.
  const symptom = associatedSymptomWords(field);
  if (symptom.length > 0) {
    return symptom.some((pattern) => pattern.test(clause))
      ? 'symptom named'
      : null;
  }

  const kind: FieldKind = field.kind;

  if (kind === 'duration') {
    return namesDuration(phrases, clause) ? 'duration phrase' : null;
  }

  if (kind === 'scale') {
    return namesSeverity(phrases, clause) ? 'severity phrase' : null;
  }

  if (kind === 'choice') {
    const named = (field.choices ?? []).find((choice) =>
      namesChoice(phrases, choice, clause),
    );
    return named ? `choice word (${named})` : null;
  }

  // `text` and `number` are deliberately never harvested. A text field accepts
  // whatever it is given, so harvesting one means claiming an arbitrary clause
  // is the answer to it — which is precisely the eager slot filling that put
  // "when I walk" in `hpi.radiation`. They are asked instead.
  return null;
}

/**
 * The fields a harvest may write to, for a caller that wants to reason about
 * coverage without running one.
 *
 * Exported for the tests and for nothing else: the harvest itself reads
 * `applicableFields` directly, and a second list that could disagree with it is
 * the bug this function exists to make visible rather than to introduce.
 */
export function harvestableFields(
  state: ClinicalState,
): readonly FieldDefinition[] {
  return fieldsFor(state).filter(
    (field) =>
      !isGroupMember(field.key) &&
      (field.kind === 'duration' ||
        field.kind === 'scale' ||
        field.kind === 'choice' ||
        associatedSymptomWords(field).length > 0),
  );
}
