import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DescribeImageRequest,
  DescribeImageResult,
  ExtractFactsRequest,
  ExtractFactsResult,
  ExtractFromDocumentRequest,
  ExtractedFact,
  LlmProvider,
  PhraseQuestionRequest,
  PhraseQuestionResult,
  ReviewSummaryRequest,
  ReviewSummaryResult,
} from './llm-provider.interface';
import {
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  DOCUMENT_EXTRACTION_SCHEMA,
  DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
  DOCUMENT_VISION_PROMPT_VERSION,
  DOCUMENT_VISION_SCHEMA,
  DOCUMENT_VISION_SYSTEM_PROMPT,
  FACT_EXTRACTION_PROMPT_VERSION,
  FACT_EXTRACTION_SCHEMA,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  PromptFieldSummary,
  QUESTION_PHRASING_PROMPT_VERSION,
  QUESTION_PHRASING_SCHEMA,
  QUESTION_PHRASING_SYSTEM_PROMPT,
  REVIEW_SUMMARY_PROMPT_VERSION,
  REVIEW_SUMMARY_SCHEMA,
  REVIEW_SUMMARY_SYSTEM_PROMPT,
  buildFactExtractionUserPrompt,
  buildQuestionPhrasingUserPrompt,
  buildReviewSummaryUserPrompt,
} from './prompts';
import { findDiagnosticLanguage } from '../case-taking/engine/safety-rules';
import type { FieldDefinition } from '../case-taking/engine/field-registry';

/**
 * Ollama, behind `LlmProvider`.
 *
 * The only file in this system that knows a language model exists. Everything
 * above it deals in candidate facts and wording; everything below it is HTTP.
 *
 * Three decisions are worth the space:
 *
 * **Structured output is not optional.** Every call carries a `format` object,
 * which Ollama constrains the sampler with rather than merely asking for. That
 * turns "the model usually returns JSON" into "the model returns this shape",
 * and it is what makes the one-shot repair below a rare path instead of the
 * main one.
 *
 * **Nothing here throws at the caller.** A refused connection, a timeout, a
 * model that is still loading and a reply that will not parse all come back the
 * same way: a result with `degraded: true` and an empty or fallback payload. An
 * interview that ends because a model was slow is worse than an interview that
 * asks plainer questions, and on this box — 38% GPU offload, ten to twenty
 * tokens a second, seventy-four seconds to load cold — slow is the normal case.
 *
 * **The registry allow-list runs here, not at the call site.** A `fieldPath`
 * the engine does not know never leaves this file. Filtering downstream would
 * mean the invented path existed, briefly, in something that could log or
 * persist it.
 */

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  done?: boolean;
  error?: string;
}

/** What a single constrained call returns, before anybody trusts its contents. */
interface RawCall<T> {
  parsed: T | null;
  latencyMs: number;
  degradedReason?: string;
  repairAttempted: boolean;
}

/**
 * How long a caller waits before giving up and using its fallback.
 *
 * Generous by web standards and tight by this model's: a long extraction
 * measured twenty seconds warm and seventy-four cold. The timeout is not there
 * to make the call fast — nothing can — it is there so a wedged model releases
 * the request instead of holding a connection until the client gives up.
 */
const DEFAULT_TIMEOUT_MS = 90_000;

/** Availability is cached: `isAvailable` is called per turn and the answer rarely changes. */
const AVAILABILITY_TTL_MS = 30_000;

@Injectable()
export class OllamaProvider implements LlmProvider {
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  private availability: { value: boolean; checkedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('OLLAMA_URL') ?? 'http://127.0.0.1:11434'
    ).replace(/\/+$/, '');
    this.model = this.config.get<string>('OLLAMA_MODEL') ?? 'gemma3:4b';
    // A string, because that is what an environment variable is and Joi
    // validates it as one. Anything but the literal 'false' leaves it on.
    this.enabled = this.config.get<string>('AI_ENABLED') !== 'false';
    this.timeoutMs = Number(
      this.config.get<string>('AI_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS,
    );
  }

  async isAvailable(): Promise<boolean> {
    if (!this.enabled) return false;

    const now = Date.now();
    if (
      this.availability &&
      now - this.availability.checkedAt < AVAILABILITY_TTL_MS
    ) {
      return this.availability.value;
    }

    let value = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const res = await fetch(`${this.baseUrl}/api/tags`, {
          signal: controller.signal,
        });
        value = res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      value = false;
    }

    this.availability = { value, checkedAt: now };
    return value;
  }

  async extractFacts(
    request: ExtractFactsRequest,
  ): Promise<ExtractFactsResult> {
    return this.runExtraction({
      systemPrompt: FACT_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: buildFactExtractionUserPrompt({
        utterance: request.utterance,
        fields: request.candidateFields.map(toPromptField),
        askedAbout: request.askedFieldPath,
        language: request.language,
      }),
      schema: FACT_EXTRACTION_SCHEMA,
      promptVersion: FACT_EXTRACTION_PROMPT_VERSION,
      candidateFields: request.candidateFields,
      // The utterance is the text an evidence span must be found in. A span
      // that is not in it did not come from the patient.
      evidenceSource: request.utterance,
    });
  }

  async extractFromDocumentText(
    request: ExtractFromDocumentRequest,
  ): Promise<ExtractFactsResult> {
    return this.runExtraction({
      systemPrompt: DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: buildFactExtractionUserPrompt({
        utterance: request.ocrText,
        fields: request.candidateFields.map(toPromptField),
        language: request.language,
      }),
      schema: DOCUMENT_EXTRACTION_SCHEMA,
      promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
      candidateFields: request.candidateFields,
      evidenceSource: request.ocrText,
    });
  }

  /**
   * Shared by the spoken turn and the scanned page, because the rules are the
   * same rules: only known field paths survive, and only spans that appear in
   * the source survive as spans.
   */
  private async runExtraction(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: object;
    promptVersion: string;
    candidateFields: readonly FieldDefinition[];
    evidenceSource: string;
  }): Promise<ExtractFactsResult> {
    const empty = (
      latencyMs: number,
      degradedReason?: string,
    ): ExtractFactsResult => ({
      facts: [],
      discardedPaths: [],
      model: this.model,
      latencyMs,
      degraded: true,
      degradedReason,
      promptVersion: input.promptVersion,
    });

    if (!(await this.isAvailable())) {
      return empty(0, 'model unavailable');
    }

    const call = await this.chat<{ facts?: unknown }>({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      schema: input.schema,
    });

    if (!call.parsed) return empty(call.latencyMs, call.degradedReason);

    const known = new Set(input.candidateFields.map((field) => field.key));
    const facts: ExtractedFact[] = [];
    const discardedPaths: string[] = [];

    for (const raw of Array.isArray(call.parsed.facts)
      ? call.parsed.facts
      : []) {
      const candidate = raw as Record<string, unknown>;
      const fieldPath =
        typeof candidate.fieldPath === 'string'
          ? candidate.fieldPath.trim()
          : '';
      const value =
        typeof candidate.value === 'string' ? candidate.value.trim() : '';

      if (!fieldPath || !value) continue;

      // The allow-list. A path the registry does not declare is not a field
      // that is merely unused — it is a slot in the chart the model made up,
      // and storing it would make the registry's completeness a lie.
      if (!known.has(fieldPath)) {
        discardedPaths.push(fieldPath);
        continue;
      }

      facts.push({
        fieldPath,
        value,
        evidenceSpan: verifiedSpan(
          candidate.evidenceSpan,
          input.evidenceSource,
        ),
      });
    }

    if (discardedPaths.length > 0) {
      this.logger.warn(
        `discarded ${discardedPaths.length} unknown field path(s) from extraction: ${discardedPaths.join(', ')}`,
      );
    }

    return {
      facts,
      discardedPaths,
      model: this.model,
      latencyMs: call.latencyMs,
      degraded: false,
      promptVersion: input.promptVersion,
    };
  }

  async phraseQuestion(
    request: PhraseQuestionRequest,
  ): Promise<PhraseQuestionResult> {
    const fallback = (
      latencyMs: number,
      degradedReason?: string,
    ): PhraseQuestionResult => ({
      question: request.fallbackPrompt,
      model: this.model,
      latencyMs,
      degraded: true,
      degradedReason,
      promptVersion: QUESTION_PHRASING_PROMPT_VERSION,
    });

    if (!(await this.isAvailable())) return fallback(0, 'model unavailable');

    const call = await this.chat<{ question?: unknown }>({
      messages: [
        { role: 'system', content: QUESTION_PHRASING_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildQuestionPhrasingUserPrompt({
            fallbackPrompt: request.fallbackPrompt,
            fieldLabel: request.field.label,
            choices: request.field.choices,
            lastPatientUtterance: request.lastPatientUtterance,
            language: request.language,
          }),
        },
      ],
      schema: QUESTION_PHRASING_SCHEMA,
    });

    const question =
      typeof call.parsed?.question === 'string'
        ? call.parsed.question.trim()
        : '';
    if (!question) return fallback(call.latencyMs, call.degradedReason);

    // The reworded question is still a question this system puts in front of a
    // patient, and §29 forbids this feature from stating a diagnosis anywhere.
    // The check is the safety engine's own, so the question and the red-flag
    // messages are held to one standard rather than two.
    const diagnostic = findDiagnosticLanguage(question);
    if (diagnostic) {
      this.logger.warn(
        `rejected a reworded question containing diagnostic language ("${diagnostic}"); asking the registry's phrasing instead`,
      );
      return fallback(call.latencyMs, `diagnostic language: ${diagnostic}`);
    }

    return {
      question,
      model: this.model,
      latencyMs: call.latencyMs,
      degraded: false,
      promptVersion: QUESTION_PHRASING_PROMPT_VERSION,
    };
  }

  async draftReviewSummary(
    request: ReviewSummaryRequest,
  ): Promise<ReviewSummaryResult> {
    const none = (
      latencyMs: number,
      degradedReason?: string,
    ): ReviewSummaryResult => ({
      summary: null,
      model: this.model,
      latencyMs,
      degraded: true,
      degradedReason,
      promptVersion: REVIEW_SUMMARY_PROMPT_VERSION,
    });

    if (!(await this.isAvailable())) return none(0, 'model unavailable');

    const call = await this.chat<{ summary?: unknown }>({
      messages: [
        { role: 'system', content: REVIEW_SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildReviewSummaryUserPrompt({
            sections: request.sections,
            language: request.language,
          }),
        },
      ],
      schema: REVIEW_SUMMARY_SCHEMA,
    });

    const summary =
      typeof call.parsed?.summary === 'string'
        ? call.parsed.summary.trim()
        : '';
    if (!summary) return none(call.latencyMs, call.degradedReason);

    const diagnostic = findDiagnosticLanguage(summary);
    if (diagnostic) {
      // Dropped rather than edited. The structured review is rendered by the
      // engine and survives on its own; the prose was the optional half.
      this.logger.warn(
        `discarded a review summary containing diagnostic language ("${diagnostic}")`,
      );
      return none(call.latencyMs, `diagnostic language: ${diagnostic}`);
    }

    return {
      summary,
      model: this.model,
      latencyMs: call.latencyMs,
      degraded: false,
      promptVersion: REVIEW_SUMMARY_PROMPT_VERSION,
    };
  }

  async describeImage(
    request: DescribeImageRequest,
  ): Promise<DescribeImageResult> {
    const none = (
      latencyMs: number,
      degradedReason?: string,
    ): DescribeImageResult => ({
      text: '',
      readable: false,
      model: this.model,
      latencyMs,
      degraded: true,
      degradedReason,
      promptVersion: DOCUMENT_VISION_PROMPT_VERSION,
    });

    if (!(await this.isAvailable())) return none(0, 'model unavailable');

    const call = await this.chat<{ text?: unknown; readable?: unknown }>({
      messages: [
        { role: 'system', content: DOCUMENT_VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: request.language
            ? `Transcribe this page. It is written in ${request.language}.`
            : 'Transcribe this page.',
          images: [request.imageBase64],
        },
      ],
      schema: DOCUMENT_VISION_SCHEMA,
    });

    const text = typeof call.parsed?.text === 'string' ? call.parsed.text : '';
    if (!text.trim()) return none(call.latencyMs, call.degradedReason);

    return {
      text,
      readable: call.parsed?.readable === true,
      model: this.model,
      latencyMs: call.latencyMs,
      degraded: false,
      promptVersion: DOCUMENT_VISION_PROMPT_VERSION,
    };
  }

  /**
   * One constrained call, with exactly one repair attempt.
   *
   * The repair feeds the parse error back and asks again. One, not a loop: a
   * model that produced unparseable JSON under a schema constraint is not
   * having a bad roll of the dice, and each retry costs the patient another
   * eight to twenty seconds of a background job that is already behind. After
   * one, the caller falls back — which every caller here can do.
   */
  private async chat<T>(input: {
    messages: OllamaMessage[];
    schema: object;
  }): Promise<RawCall<T>> {
    const startedAt = Date.now();

    const first = await this.post(input.messages, input.schema);
    if (first.error) {
      return {
        parsed: null,
        latencyMs: Date.now() - startedAt,
        degradedReason: first.error,
        repairAttempted: false,
      };
    }

    const parsed = safeParse<T>(first.content);
    if (parsed.ok) {
      return {
        parsed: parsed.value,
        latencyMs: Date.now() - startedAt,
        repairAttempted: false,
      };
    }

    this.logger.warn(
      `model returned unparseable JSON; one repair attempt: ${parsed.error}`,
    );

    const repair = await this.post(
      [
        ...input.messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: `That was not valid JSON: ${parsed.error}. Return the same information as valid JSON matching the schema, and nothing else.`,
        },
      ],
      input.schema,
    );

    if (repair.error) {
      return {
        parsed: null,
        latencyMs: Date.now() - startedAt,
        degradedReason: repair.error,
        repairAttempted: true,
      };
    }

    const reparsed = safeParse<T>(repair.content);
    return {
      parsed: reparsed.ok ? reparsed.value : null,
      latencyMs: Date.now() - startedAt,
      degradedReason: reparsed.ok
        ? undefined
        : `unparseable after repair: ${reparsed.error}`,
      repairAttempted: true,
    };
  }

  private async post(
    messages: OllamaMessage[],
    schema: object,
  ): Promise<{ content: string; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          // Greedy. Two runs over the same turn must produce the same facts,
          // or a case cannot be replayed and an extraction cannot be explained.
          options: { temperature: 0 },
          format: schema,
          messages,
        }),
      });

      if (!res.ok) {
        return { content: '', error: `ollama responded ${res.status}` };
      }

      const body = (await res.json()) as OllamaChatResponse;
      if (body.error) return { content: '', error: body.error };

      return { content: body.message?.content ?? '' };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : 'unknown transport failure';
      // Availability is re-checked next time rather than assumed: a model that
      // just timed out on a long prompt may answer a short one.
      this.availability = null;
      return { content: '', error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

function toPromptField(field: FieldDefinition): PromptFieldSummary {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    choices: field.choices,
  };
}

/**
 * A span survives only if it is actually in the source text.
 *
 * The local model, asked for the patient's own words, returned `"[3, 9]"` —
 * character offsets, and wrong ones. A span that cannot be found is dropped to
 * `undefined`, which the engine already handles: an uncertainty phrase anywhere
 * in the turn wins and the derivation is flagged `needsPatientConfirmation`.
 * The cost of the model ignoring the instruction is therefore a confirmation
 * tap, never a wrong fact.
 *
 * Case-insensitive because transcription and model both re-case freely; the
 * span returned is the SOURCE's spelling, not the model's, so what the engine
 * matches phrases against is what the patient actually said.
 */
function verifiedSpan(raw: unknown, source: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const span = raw.trim();
  if (span.length === 0) return undefined;

  const index = source.toLowerCase().indexOf(span.toLowerCase());
  return index === -1 ? undefined : source.slice(index, index + span.length);
}

function safeParse<T>(
  content: string,
): { ok: true; value: T } | { ok: false; error: string } {
  const text = content.trim();
  if (!text) return { ok: false, error: 'empty response' };

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unparseable',
    };
  }
}
