/**
 * Question phrasing — the one place the model is allowed to choose words the
 * patient will read.
 *
 * It is allowed to do that because it cannot change what is being asked. The
 * question itself is chosen by `selectNext` in the engine, from a registry of
 * fields written by hand; this call only rewords the registry's `prompt` so it
 * sounds like the conversation the patient is already having rather than a form
 * they are filling in.
 *
 * That boundary is the whole of §30: the model handles language, the
 * application handles which clinical fields exist and in what order. A phrasing
 * that drifts into asking something else is caught by the caller, which
 * compares the result against the field it asked for and falls back to
 * `fallbackPhrasing` from the engine rather than sending the model's version.
 *
 * Every caller must be able to skip this call entirely. On this box it costs
 * several seconds, and the patient must never wait on it — `fallbackPrompt`
 * from the selector is a complete, plain-English question on its own, and is
 * what ships when Ollama is slow, down or unconfigured.
 */

export const QUESTION_PHRASING_PROMPT_VERSION = '2026.09.1';

export const QUESTION_PHRASING_SYSTEM_PROMPT = [
  'You reword one question so it sounds like a person asking, not a form.',
  '',
  'Rules:',
  '1. Ask exactly the question you are given. Do not ask anything else, do not',
  '   add a second question, and do not answer it yourself.',
  '2. Never suggest what might be wrong with them, and never name a condition,',
  '   a test or a medicine. You are not diagnosing; you are asking.',
  '3. Plain words. Short sentence. No clinical vocabulary the patient did not',
  '   use first.',
  '4. Do not reassure and do not alarm. "That sounds serious" is not your call',
  '   to make and "don\'t worry" is not yours to promise.',
  '5. If the question offers choices, keep every one of them.',
  '',
  'Return JSON only.',
].join('\n');

export const QUESTION_PHRASING_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    question: { type: 'string' },
  },
  required: ['question'],
});

export function buildQuestionPhrasingUserPrompt(input: {
  /** The registry's plain phrasing — the question that must survive rewording. */
  fallbackPrompt: string;
  fieldLabel: string;
  choices?: readonly string[];
  /** The patient's last words, so the question can follow on from them. */
  lastPatientUtterance?: string;
  language?: string;
}): string {
  const lines = [`Question to ask: ${input.fallbackPrompt}`];

  if (input.choices && input.choices.length > 0) {
    lines.push(`Answers offered: ${input.choices.join(', ')}`);
  }
  if (input.lastPatientUtterance) {
    lines.push(`They just said: ${input.lastPatientUtterance}`);
  }
  if (input.language) {
    lines.push(`Ask in: ${input.language}`);
  }

  return lines.join('\n');
}
