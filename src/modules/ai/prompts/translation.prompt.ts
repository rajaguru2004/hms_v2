/**
 * Translation — the prompt that turns a patient's sentence into English for the
 * clinical engine, and nothing else.
 *
 * ── What this prompt is forbidden to do, and why each ban is here
 *
 * **No adding.** A 4B model asked to translate "सीने में दर्द" will happily
 * return "chest pain, possibly cardiac in origin". The second clause is a
 * diagnosis the patient never made, and `classifyComplaint` would read it as
 * evidence. The translated text feeds a keyword table; a word the model
 * invented is a red flag the patient did not earn, in either direction.
 *
 * **No softening.** "बहुत तेज़ दर्द" is severe pain. A translation that lands on
 * "some discomfort" is the same failure as the classification bug this module
 * exists to fix, pointed the other way: it silently downgrades an emergency.
 *
 * **Numbers and durations verbatim.** "तीन दिन" is three days, not "a few
 * days". `hpi.duration` is a field with a shape, and the safety rules read
 * durations — ACS_TRIAD included. A rounded number is a changed fact.
 *
 * **Pass English through unchanged.** Code-switching is the normal case here,
 * not the exotic one: "எனக்கு three days-ஆ chest pain இருக்கு" is how people
 * actually speak in a clinic. The English fragments in that sentence are
 * already the patient's own words and already what the classifier wants; a
 * model that "improves" them to "thoracic pain of three days' duration" has
 * rewritten the patient for no gain.
 *
 * ── What the schema does NOT have
 *
 * There is no `confidence` and no `notes`, for the same reason
 * `extraction.prompt.ts` has no `presence`: a field the model can fill is a
 * field something downstream will eventually read as a clinical claim. The only
 * thing this call is allowed to produce is English text.
 */

/**
 * Bumped whenever the wording, the schema or the rules change. Logged with the
 * call so an odd translation can be read against the prompt that produced it.
 */
export const TRANSLATION_PROMPT_VERSION = '2026.09.1';

/**
 * The code-switching rule, spelled out rather than implied.
 *
 * Pulled out as its own constant so the spec can assert it is still in the
 * system prompt: it is the single instruction most likely to be lost in a
 * well-meaning edit that shortens the prompt, and losing it means English
 * fragments coming back paraphrased.
 */
export const CODE_SWITCHING_INSTRUCTION = [
  'Patients mix English into their own language constantly.',
  'Any English word or phrase already in the message is copied through exactly',
  'as written — same words, same spelling. Do not restate it, do not translate',
  'it, do not replace it with a medical term.',
].join(' ');

export const TRANSLATION_SYSTEM_PROMPT = [
  'You translate what a patient said into English, word for word in meaning.',
  'You are not a clinician and you are not an editor. You add nothing.',
  '',
  'Rules:',
  '1. Translate into English. Preserve the clinical meaning exactly.',
  '2. Do NOT add anything. No explanation, no cause, no diagnosis, no medical',
  '   term the patient did not use. If they said "chest pain", that is "chest',
  '   pain" — never "angina", never "possibly cardiac".',
  '3. Do NOT soften and do NOT strengthen. "very severe pain" stays very',
  '   severe. "a little uncomfortable" stays a little uncomfortable.',
  '4. Keep every number, quantity, dose and duration exactly as said. "three',
  '   days" is "three days", never "a few days" and never "3-4 days".',
  `5. ${CODE_SWITCHING_INSTRUCTION}`,
  '6. Do NOT answer, interpret, summarise or shorten. Uncertainty stays',
  '   uncertain: "I do not know" is "I do not know", not an omission.',
  '7. If part of the message is unreadable or makes no sense, translate the',
  '   rest and leave that part out rather than guessing at it.',
  '',
  'Return JSON only.',
].join('\n');

/**
 * The `format` object sent to Ollama.
 *
 * Frozen and exported so the spec can assert the exact shape. One key, one
 * string: the narrowest schema in this module, and deliberately so.
 */
export const TRANSLATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    english: { type: 'string' },
  },
  required: ['english'],
});

export function buildTranslationUserPrompt(input: {
  text: string;
  /** The language's English name when we have one — "Hindi" reads better to the model than "hi". */
  sourceLanguageName?: string;
  sourceLanguage: string;
}): string {
  const named = input.sourceLanguageName ?? input.sourceLanguage;
  return [
    `The patient is speaking ${named}. Translate their message into English.`,
    'Copy any English already in it through unchanged.',
    '',
    'Message:',
    input.text,
  ].join('\n');
}
