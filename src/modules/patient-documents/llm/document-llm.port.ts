/**
 * What this module needs from a language model, and nothing more.
 *
 * Declared here rather than imported from the AI module on purpose. This is the
 * consumer's port: it names the two calls the document pipeline makes, in the
 * shapes the pipeline wants, so the pipeline can be unit tested against an
 * object literal and so swapping Ollama for anything else is a change in one
 * adapter rather than in nine call sites.
 *
 * Two methods, because Documents §8 argues the two are not interchangeable.
 * `extractJson` is the primary path — OCR has already turned pixels into text
 * and the model's job is to turn text into fields. `transcribeImage` is the
 * fallback of §9, for the page OCR could not read, and it is deliberately
 * awkward to reach: it takes raw bytes, it is only called from one branch, and
 * the caller has to record that it happened.
 */

/** The injection token. A string so an override in a test module is one line. */
export const DOCUMENT_LLM = 'DOCUMENT_LLM';

/**
 * A JSON Schema the model must answer in.
 *
 * Kept as an opaque object rather than typed structurally: Ollama, llama.cpp
 * and the OpenAI-compatible servers all take JSON Schema, and narrowing it here
 * would only mean rewriting it in the adapter.
 */
export type JsonSchema = Record<string, unknown>;

export interface ExtractJsonRequest {
  /** What to do with the text. No patient data belongs here. */
  instruction: string;
  /** The OCR output. The only place document content enters the prompt. */
  text: string;
  /** The shape the answer must take. The server constrains decoding to it. */
  schema: JsonSchema;
  /** Milliseconds before the call is abandoned. */
  timeoutMs?: number;
}

export interface TranscribeImageRequest {
  /** The page, as uploaded. */
  image: Buffer;
  /** Its media type, so the adapter can refuse what the model cannot see. */
  mimeType: string;
  instruction: string;
  timeoutMs?: number;
}

/**
 * Note what is absent: a confidence.
 *
 * A benchmark of the local gemma3:4b returned exactly 0.95 on every extracted
 * fact in a run, including the one it got flatly wrong — the reasoning is
 * written out in `case-taking/engine/tri-state.ts`. A constant carries no
 * information, so this port does not carry it, and nothing downstream can
 * threshold on it or compare it against an OCR measurement. Extraction
 * confidence is computed by this module from evidence it can check.
 */
export interface DocumentLlm {
  /**
   * Answer [request.schema] from [request.text].
   *
   * Implementations must parse and return the object. A model that answers
   * with prose, or with JSON that does not fit the schema, is a failure the
   * adapter raises rather than a `null` the pipeline has to guess about.
   */
  extractJson<T>(request: ExtractJsonRequest): Promise<T>;

  /** Read a page the OCR engine could not. Documents §9. */
  transcribeImage(request: TranscribeImageRequest): Promise<string>;
}
