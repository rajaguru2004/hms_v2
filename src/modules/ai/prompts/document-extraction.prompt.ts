/**
 * Reading a document — OCR text in, candidate values out.
 *
 * Built now, for the medical-document stream to call later, because the rule it
 * has to carry is the same rule as the interview's and it is cheaper to write
 * once than to rediscover: Documents §19 says "not found" must never become
 * "no". A prescription that does not mention allergies is not a prescription
 * saying the patient has none.
 *
 * So this schema, like the interview's, has no `presence`. It reports what is
 * printed on the page and nothing about what is absent from it. The engine
 * decides what the reading means, and a field no document mentioned stays
 * `not_assessed` — which is the truth.
 *
 * `evidenceSpan` here is the line of OCR text the value was read from, so that
 * a doctor reviewing an extracted dose can be shown the words it came from. The
 * caller checks it against the OCR text and discards the fact if it is not
 * there, exactly as it does for a spoken turn.
 */

export const DOCUMENT_EXTRACTION_PROMPT_VERSION = '2026.09.1';

export const DOCUMENT_EXTRACTION_SYSTEM_PROMPT = [
  'You read the text of a medical document and copy out what is printed on it.',
  '',
  'Rules:',
  '1. Only report what the document actually says. If a value is not printed,',
  '   omit the field. A document that does not mention something is not a',
  '   document saying there is nothing to mention.',
  '2. Never correct, expand or standardise a medicine name. Copy it exactly as',
  '   printed, misspellings and all. Somebody downstream matches it against a',
  '   catalogue; a guess made here cannot be told from a reading.',
  '3. evidenceSpan is the line of text the value was read from, copied',
  '   character for character. If you cannot copy it, omit the fact.',
  '4. OCR text is often garbled. An unreadable value is omitted, never repaired.',
  '5. Only fieldPaths from the list you are given.',
  '',
  'Return JSON only.',
].join('\n');

export const DOCUMENT_EXTRACTION_SCHEMA = Object.freeze({
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

/**
 * The vision call — the same page, as pixels, when OCR could not read it.
 *
 * gemma3:4b is multimodal, which is why the 4 GB card only gets 38% of it
 * offloaded: the CLIP encoder loads alongside the language weights. The cost is
 * already paid, so the fallback is free in VRAM terms and expensive only in
 * seconds.
 *
 * The prompt asks for a transcription rather than an interpretation. A vision
 * model asked what a prescription *means* will tell you, confidently, and the
 * answer will have no words on the page behind it. Asked what it *says*, a
 * wrong reading is still a reading, and the extraction pass that follows
 * applies the same evidence-span check to it as to real OCR text.
 */
export const DOCUMENT_VISION_PROMPT_VERSION = '2026.09.1';

export const DOCUMENT_VISION_SYSTEM_PROMPT = [
  'You transcribe what is written on a photographed medical document.',
  '',
  'Rules:',
  '1. Transcribe. Do not interpret, summarise, or explain what anything means.',
  '2. Copy names, numbers, doses and units exactly as written, including',
  '   anything you think is a mistake.',
  '3. Keep the lines in the order they appear on the page.',
  '4. If part of the page is unreadable, write [unreadable] there. Never guess',
  '   at what it probably said.',
  '',
  'Return JSON only.',
].join('\n');

export const DOCUMENT_VISION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    text: { type: 'string' },
    readable: { type: 'boolean' },
  },
  required: ['text', 'readable'],
});
