import type { LlmCallMetadata } from './llm-provider.interface';

/**
 * The seam between a patient's own language and the English the clinical engine
 * reads.
 *
 * ── Why this exists at all
 *
 * `classifyComplaint` in `case-taking/engine/field-registry.ts` is an English
 * keyword table, and it was being run over the patient's untranslated words.
 * Measured on identical structured facts:
 *
 *   en  "chest pain for three days"          -> [cardiac, respiratory],
 *                                               64 applicable fields, ACS_TRIAD fires
 *   hi  "तीन दिन से सीने में दर्द हो रहा है"  -> [unclassified],
 *                                               44 applicable fields, ACS_TRIAD silent
 *
 * A Hindi patient with cardiac chest pain got no acute-coronary red flag. The
 * fix is not a bigger keyword table in eleven scripts — it is giving the English
 * classifier English to read.
 *
 * ── The one rule this interface is shaped around
 *
 * **Translation output is a derived field. The patient's own words remain the
 * stored fact.** That is why nothing here has a `replace`, a `normalise` or an
 * in-place variant, and why `TranslationResult` carries `originalText` beside
 * `englishText` rather than handing back a single string: a caller that wanted
 * to overwrite the patient would have to go out of its way to do it.
 *
 * A failed translation is therefore not an error condition. It is the system
 * doing exactly what it did yesterday, which is why `englishText` is nullable
 * and why `translateToEnglish` never rejects — see `TranslationResult`.
 */

/** Injection token. An interface cannot be one, and a class here would invite `instanceof`. */
export const TRANSLATION_PROVIDER = 'TRANSLATION_PROVIDER';

export interface TranslateToEnglishRequest {
  /** The patient's text, exactly as it was stored. Never modified by the callee. */
  readonly text: string;
  /**
   * BCP-47-ish source tag — the session's language. `en` (or anything that
   * normalises to it) must not cost a model call: translating English into
   * English is eight to twenty seconds of this box's CPU for no change.
   */
  readonly sourceLanguage: string;
}

/**
 * What came back, and — always — what went in.
 *
 * `degraded` is inherited from `LlmCallMetadata` and means the same thing it
 * means everywhere else in this module: the model did not answer usefully and
 * the caller is holding a fallback. Here the fallback is the patient's own
 * text, which the caller already has.
 */
export interface TranslationResult extends LlmCallMetadata {
  /** The input, byte for byte. The stored fact, and the thing that must survive. */
  readonly originalText: string;
  /**
   * The English rendering, or `null` when there is not one — unavailable model,
   * timeout, unparseable reply, or a reply that still carried untranslated
   * script. `null` is a normal outcome and the caller's instruction is simply
   * "use `originalText`".
   */
  readonly englishText: string | null;
  /** The tag that was asked for, normalised. */
  readonly sourceLanguage: string;
  /**
   * True when the text was already English and no model was called at all.
   * `englishText` then equals `originalText` and `latencyMs` is zero.
   */
  readonly passthrough: boolean;
}

export interface TranslationProvider {
  /**
   * The patient's text in English, or a result that says it is not.
   *
   * Never throws. Never rejects. Never mutates `request.text`.
   */
  translateToEnglish(
    request: TranslateToEnglishRequest,
  ): Promise<TranslationResult>;
}
