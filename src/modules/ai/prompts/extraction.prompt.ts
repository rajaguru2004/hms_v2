/**
 * Fact extraction — the prompt that turns a sentence into candidate values.
 *
 * Two things are deliberately absent from the schema below, and both absences
 * are load-bearing.
 *
 * **There is no `presence` field.** Asked to extract from "I don't know if I'm
 * allergic to anything", gemma3:4b returned `presence: "recorded", value:
 * "unknown"` — an "I don't know" encoded as something the patient *told* us,
 * which is the exact path to a fabricated "no known allergies" in a chart. A
 * schema with nowhere to put that claim cannot make it. `derivePresence()` in
 * the engine's `tri-state.ts` is the only thing in this system allowed to
 * decide what state an answer represents, and it decides it from the patient's
 * own words rather than from the model's opinion of them.
 *
 * **There is no `confidence` field.** The same benchmark returned exactly 0.95
 * on every fact in a run, including the one it got flatly wrong. A constant is
 * not a signal, and a field that invites a threshold over a constant is worse
 * than no field at all.
 *
 * What the schema does demand is `evidenceSpan`, and the phrasing of that
 * instruction is the single most argued-over line in this file — see
 * `EVIDENCE_SPAN_INSTRUCTION`.
 */

/**
 * Bumped whenever the wording, the schema or the rules change. Stored with the
 * facts a run produces so an odd extraction can be read against the prompt that
 * actually produced it, not the one in the working tree today.
 */
export const FACT_EXTRACTION_PROMPT_VERSION = '2026.09.1';

/**
 * Why this is spelled out at length rather than "include the relevant span".
 *
 * Asked for an `evidenceSpan` without this paragraph, the local model returned
 * `"[3, 9]"` — character offsets, and wrong ones: that range of "I have had
 * chest pain for three days" is "ave ha". The engine reads `evidenceSpan` as
 * *text*, and it is what keeps one turn's several answers apart: "I've had
 * chest pain for three days… I don't know if I'm allergic to anything" carries
 * a duration and an uncertainty, and judging the duration against the whole
 * turn finds the "I don't know" that was meant for the allergies.
 *
 * A span that does not appear in the utterance is discarded by the caller
 * rather than trusted, so a model that ignores this degrades to a confirmation
 * tap instead of a wrong fact. The instruction still earns its place: the
 * degradation costs the patient a question.
 */
export const EVIDENCE_SPAN_INSTRUCTION = [
  "evidenceSpan must be the patient's own words, copied character for character",
  'from the message, containing only the part that answers THIS field.',
  'It is text, never numbers and never character positions.',
  'If you cannot copy an exact phrase from the message, omit the whole fact.',
].join(' ');

export const FACT_EXTRACTION_SYSTEM_PROMPT = [
  'You read what a patient said and copy out the plain facts it contains.',
  'You are not a clinician. You do not diagnose, interpret, or complete the picture.',
  '',
  'Rules:',
  '1. Only report something the patient actually said. Never infer, never assume,',
  '   never fill a field because it is usually filled.',
  '2. If the patient said they do not know, or would rather not say, or said no —',
  '   report NOTHING for that field. Those are not values. Omit the field entirely.',
  '3. One field per fieldPath, and only fieldPaths from the list you are given.',
  '   A fieldPath not on the list is discarded, so inventing one wastes the turn.',
  `4. ${EVIDENCE_SPAN_INSTRUCTION}`,
  '5. value is the shortest phrase that answers the field. "three days", not',
  '   "the patient has had it for three days".',
  '6. When in doubt, return fewer facts. An empty list is a good answer.',
  '',
  'Return JSON only.',
].join('\n');

/**
 * The `format` object sent to Ollama.
 *
 * Frozen and exported so the spec can assert on the exact shape: a `presence`
 * or `confidence` key appearing here in a future edit is the regression this
 * whole module exists to prevent, and a test that reads the constant catches it
 * without a model call.
 */
export const FACT_EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldPath: { type: 'string' },
          value: { type: 'string' },
          evidenceSpan: { type: 'string' },
        },
        required: ['fieldPath', 'value', 'evidenceSpan'],
      },
    },
  },
  required: ['facts'],
});

/** One line of the candidate-field menu the model is allowed to choose from. */
export interface PromptFieldSummary {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly choices?: readonly string[];
}

/**
 * The field menu, rendered for the prompt.
 *
 * Choices are listed because a `choice` field the model answers in prose is a
 * value the registry then rejects, and a rejected value costs the patient the
 * question again. Listing them is cheaper than re-asking.
 */
export function renderFieldMenu(fields: readonly PromptFieldSummary[]): string {
  return fields
    .map((field) => {
      const choices =
        field.choices && field.choices.length > 0
          ? ` — one of: ${field.choices.join(', ')}`
          : '';
      return `- ${field.key} (${field.kind}) ${field.label}${choices}`;
    })
    .join('\n');
}

export function buildFactExtractionUserPrompt(input: {
  utterance: string;
  fields: readonly PromptFieldSummary[];
  /** The field the interview had just asked about, when there was one. */
  askedAbout?: string;
  language?: string;
}): string {
  const lines = ['Fields you may fill:', renderFieldMenu(input.fields), ''];

  if (input.askedAbout) {
    // Named rather than restricted to: a patient answering "how long?" with
    // "three days, and I'm also short of breath" has told us two things, and a
    // prompt that accepts only the asked field throws the second one away.
    lines.push(
      `The patient was just asked about: ${input.askedAbout}. They may also have mentioned other things; report those too.`,
      '',
    );
  }

  if (input.language && !input.language.toLowerCase().startsWith('en')) {
    // The value is copied in the patient's language and translated downstream,
    // never by this call: a translated value cannot be matched back to the
    // evidence span it came from, and the span is what keeps the fields apart.
    lines.push(
      `The patient is speaking ${input.language}. Copy their words as they said them; do not translate.`,
      '',
    );
  }

  lines.push('What the patient said:', input.utterance);
  return lines.join('\n');
}
