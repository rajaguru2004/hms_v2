/**
 * The review summary — §34's "here is what we understood about you", in prose.
 *
 * The structured review document is rendered by the engine's `case-renderer`,
 * which throws rather than print a value for a fact that has none. This call
 * only adds a readable paragraph on top of that document, and it is given the
 * *rendered* lines rather than the state: every line it receives has already
 * been through `renderItem`, so "Not assessed" and "Patient unsure" arrive as
 * those words and there is no `value` field for the model to reach past them
 * into.
 *
 * It is therefore structurally unable to turn "we never asked" into "no", which
 * is the failure §36 is written against. What it can still do is editorialise,
 * so rule 2 forbids it and the caller drops the summary — keeping the
 * structured document, which is the part that matters — if the safety
 * engine's diagnostic-language check finds anything in it.
 */

export const REVIEW_SUMMARY_PROMPT_VERSION = '2026.09.1';

export const REVIEW_SUMMARY_SYSTEM_PROMPT = [
  'You read back a summary of what a patient told a hospital, in their own terms.',
  '',
  'Rules:',
  '1. Say only what is in the lines you are given. Add nothing.',
  '2. Never name a condition, a diagnosis, a cause or a treatment. Not even a',
  '   likely one, not even as a question. You are repeating, not concluding.',
  '3. A line that says "Not assessed", "Patient unsure" or "Prefer not to say"',
  '   means nobody knows. Say so plainly. Never write it as a no, and never',
  '   quietly leave it out — a missing line reads as nothing to report.',
  '4. Speak to the patient as "you". Short sentences.',
  '5. End by inviting them to correct anything that is wrong.',
  '',
  'Return JSON only.',
].join('\n');

export const REVIEW_SUMMARY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
});

export function buildReviewSummaryUserPrompt(input: {
  /** Already-rendered "Label: display" lines, grouped by section title. */
  sections: readonly { title: string; lines: readonly string[] }[];
  language?: string;
}): string {
  const body = input.sections
    .map((section) =>
      [section.title, ...section.lines.map((line) => `  ${line}`)].join('\n'),
    )
    .join('\n\n');

  return input.language
    ? `Write the summary in ${input.language}.\n\n${body}`
    : body;
}
