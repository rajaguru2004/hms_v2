import type { FieldDefinition } from '../case-taking/engine/field-registry';

/**
 * The seam between this system and any language model.
 *
 * Everything on this interface is optional to the caller in the strongest
 * sense: every method may return a degraded result, and every caller must have
 * something to do with one. §42 says the interview works offline, and on this
 * box "offline" is not hypothetical — gemma3:4b takes eight to twenty seconds
 * for an extraction and seventy-four to load cold, so a patient who waited on
 * it would experience a working model as an outage anyway.
 *
 * That is why nothing here returns a presence, a red flag, a next question, or
 * a decision of any kind. §30 draws the line and this interface is where it is
 * drawn: the model handles language, the application handles clinical fields,
 * question flow, safety rules, validation and state. What comes back from here
 * is *candidate* values and *wording*, both of which the engine is free to
 * reject.
 */

/** Injection token. An interface cannot be one, and a class here would invite `instanceof`. */
export const LLM_PROVIDER = 'LLM_PROVIDER';

/**
 * One value the model believes it read, before anything has believed it.
 *
 * There is no `presence` and no `confidence`, and neither omission is an
 * oversight — see `prompts/extraction.prompt.ts`.
 */
export interface ExtractedFact {
  readonly fieldPath: string;
  readonly value: string;
  /**
   * The patient's own words for this field, verbatim from the utterance.
   *
   * `undefined` when the model returned a span that does not appear in the
   * source text — which it does: asked for one, the local model has returned
   * character offsets. The engine treats a missing span conservatively and
   * flags `needsPatientConfirmation`, so the failure costs a confirmation tap
   * rather than a wrong fact.
   */
  readonly evidenceSpan?: string;
}

/** What every call here reports about itself, degraded or not. */
export interface LlmCallMetadata {
  readonly model: string;
  readonly latencyMs: number;
  /**
   * True when the model did not answer usefully and the caller is holding a
   * fallback. Never an exception: an interview must not end because a model
   * was slow.
   */
  readonly degraded: boolean;
  /** Why it degraded, for the log. Never shown to a patient. */
  readonly degradedReason?: string;
  readonly promptVersion: string;
}

export interface ExtractFactsRequest {
  readonly utterance: string;
  /**
   * The only field paths that may come back. Anything else is discarded before
   * the caller sees it — the model does not get to invent a slot in the chart.
   */
  readonly candidateFields: readonly FieldDefinition[];
  /** The field the interview had just asked about, when there was one. */
  readonly askedFieldPath?: string;
  readonly language?: string;
}

export interface ExtractFactsResult extends LlmCallMetadata {
  readonly facts: readonly ExtractedFact[];
  /** Paths the model returned that the registry does not know. Logged, never stored. */
  readonly discardedPaths: readonly string[];
}

export interface PhraseQuestionRequest {
  readonly field: FieldDefinition;
  /** The engine's plain phrasing. Returned as-is whenever the model cannot improve on it. */
  readonly fallbackPrompt: string;
  readonly lastPatientUtterance?: string;
  readonly language?: string;
}

export interface PhraseQuestionResult extends LlmCallMetadata {
  /** Always a usable question. Equals the fallback when `degraded` is true. */
  readonly question: string;
}

export interface ReviewSummaryRequest {
  /** Already rendered by `case-renderer`, so there is no raw value to reach past. */
  readonly sections: readonly { title: string; lines: readonly string[] }[];
  readonly language?: string;
}

export interface ReviewSummaryResult extends LlmCallMetadata {
  /** Null when the model could not produce a summary, or produced a forbidden one. */
  readonly summary: string | null;
}

export interface ExtractFromDocumentRequest {
  readonly ocrText: string;
  readonly candidateFields: readonly FieldDefinition[];
  readonly language?: string;
}

export interface DescribeImageRequest {
  /** Base64, no data-URI prefix — what Ollama's `images` array wants. */
  readonly imageBase64: string;
  readonly language?: string;
}

export interface DescribeImageResult extends LlmCallMetadata {
  readonly text: string;
  /** The model's own claim that the page was legible. A hint for routing, never a gate. */
  readonly readable: boolean;
}

export interface LlmProvider {
  /** Is a model reachable at all? Cheap, cached, and safe to call on a hot path. */
  isAvailable(): Promise<boolean>;

  extractFacts(request: ExtractFactsRequest): Promise<ExtractFactsResult>;

  phraseQuestion(request: PhraseQuestionRequest): Promise<PhraseQuestionResult>;

  draftReviewSummary(
    request: ReviewSummaryRequest,
  ): Promise<ReviewSummaryResult>;

  /** For the medical-document stream: OCR text in, candidate values out. */
  extractFromDocumentText(
    request: ExtractFromDocumentRequest,
  ): Promise<ExtractFactsResult>;

  /** For the medical-document stream: the page as pixels, when OCR could not read it. */
  describeImage(request: DescribeImageRequest): Promise<DescribeImageResult>;
}
