import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TranslateToEnglishRequest,
  TranslationProvider,
  TranslationResult,
} from './translation-provider.interface';
import {
  TRANSLATION_PROMPT_VERSION,
  TRANSLATION_SCHEMA,
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationUserPrompt,
} from './prompts';
import {
  findLanguage,
  normaliseLanguage,
} from '../../common/constants/language.constants';

/**
 * Ollama, behind `TranslationProvider`.
 *
 * A near-twin of `ollama.provider.ts` and deliberately so: `stream: false`,
 * `temperature: 0`, the schema sent as `format` rather than asked for in prose,
 * one repair attempt, a cached `/api/tags` availability probe, and a degraded
 * result in place of every exception. What differs is only what has to.
 *
 * ── Three things this file is careful about
 *
 * **The port is 8080, not 11434.** The instance serving this box listens on
 * 8080; a default of 11434 would make every translation quietly degrade and the
 * classification bug would look unfixed.
 *
 * **The model is gemma3:4b and may not be gemma3:12b.** 12b cannot load here —
 * it does not merely run slowly, it takes the server down, which would also
 * take extraction and question phrasing with it. A configured 12b is refused in
 * the constructor and logged rather than honoured, because the failure mode of
 * obeying is worse than the failure mode of ignoring.
 *
 * **Nothing here is ever on the turn path.** The caller runs it inside an
 * already fire-and-forget background job, and this class never throws so that
 * staying off the hot path is the caller's only remaining obligation.
 */

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  error?: string;
}

interface RawCall<T> {
  parsed: T | null;
  latencyMs: number;
  degradedReason?: string;
}

/** The instance on this box. Not 11434 — see the class comment. */
const DEFAULT_TRANSLATION_URL = 'http://127.0.0.1:8080';

/** The only model this runs on. See `refuseUnloadableModel`. */
const DEFAULT_TRANSLATION_MODEL = 'gemma3:4b';

/**
 * Models known to be unloadable on this hardware. Configuring one is treated as
 * a mistake rather than an instruction: loading it crashes the server that
 * extraction and question phrasing also depend on.
 */
const UNLOADABLE_MODELS: readonly string[] = ['gemma3:12b'];

/**
 * Shorter than extraction's ninety seconds because the output is shorter — a
 * sentence, not a fact list — and because a translation that has not arrived in
 * a minute has missed the interview it was for. The caller degrades cleanly, so
 * the cost of the cap is a classification that stays as blunt as it is today.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Availability is cached the same way and for the same reason as the LLM provider's. */
const AVAILABILITY_TTL_MS = 30_000;

/** What `model` says when no model ran. Passthrough is not a call. */
const NO_MODEL = 'none';

/**
 * Every script the eleven supported Indic languages are written in:
 * Devanagari (hi, mr), Bengali–Assamese (bn, as), Gurmukhi (pa), Gujarati (gu),
 * Odia (or), Tamil (ta), Telugu (te), Kannada (kn), Malayalam (ml).
 *
 * Used for one check only — see `looksTranslated`.
 */
const INDIC_SCRIPT = /[ऀ-ൿ]/;

@Injectable()
export class OllamaTranslationProvider implements TranslationProvider {
  private readonly logger = new Logger(OllamaTranslationProvider.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  private availability: { value: boolean; checkedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('OLLAMA_TRANSLATION_URL') ??
      DEFAULT_TRANSLATION_URL
    ).replace(/\/+$/, '');
    this.model = this.refuseUnloadableModel(
      this.config.get<string>('OLLAMA_TRANSLATION_MODEL') ??
        DEFAULT_TRANSLATION_MODEL,
    );
    // Two switches, both string-valued because that is what an environment
    // variable is. Anything but the literal 'false' leaves translation on.
    this.enabled =
      this.config.get<string>('AI_ENABLED') !== 'false' &&
      this.config.get<string>('AI_TRANSLATION_ENABLED') !== 'false';
    this.timeoutMs = Number(
      this.config.get<string>('AI_TRANSLATION_TIMEOUT_MS') ??
        DEFAULT_TIMEOUT_MS,
    );
  }

  /**
   * A configured model that cannot load here is ignored, loudly.
   *
   * Honouring it would crash the Ollama process, and that process is also
   * serving extraction and question phrasing. Falling back to gemma3:4b costs
   * whatever quality 12b would have had; obeying costs the whole AI surface.
   */
  private refuseUnloadableModel(model: string): string {
    if (UNLOADABLE_MODELS.includes(model.trim().toLowerCase())) {
      this.logger.error(
        `translation model "${model}" cannot load on this hardware and would take the Ollama server down with it; using ${DEFAULT_TRANSLATION_MODEL} instead`,
      );
      return DEFAULT_TRANSLATION_MODEL;
    }
    return model;
  }

  /** Is a model reachable at all? Cheap, cached, and never throws. */
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

  async translateToEnglish(
    request: TranslateToEnglishRequest,
  ): Promise<TranslationResult> {
    // Captured once, before anything else happens, and returned on every path.
    // The patient's text is the stored fact; this method's contract is that it
    // comes back out of here identical to how it went in.
    const originalText = request.text;
    const sourceLanguage = normaliseLanguage(request.sourceLanguage);

    const notTranslated = (
      latencyMs: number,
      degradedReason: string,
    ): TranslationResult => ({
      originalText,
      englishText: null,
      sourceLanguage,
      passthrough: false,
      model: this.model,
      latencyMs,
      degraded: true,
      degradedReason,
      promptVersion: TRANSLATION_PROMPT_VERSION,
    });

    // ── The free cases, settled before any thought of a model ───────────────

    if (originalText.trim().length === 0) {
      return {
        originalText,
        englishText: null,
        sourceLanguage,
        passthrough: false,
        model: NO_MODEL,
        latencyMs: 0,
        degraded: false,
        degradedReason: 'nothing to translate',
        promptVersion: TRANSLATION_PROMPT_VERSION,
      };
    }

    if (sourceLanguage === '' || sourceLanguage === 'en') {
      // English in, English out, and not one second of this box's CPU spent on
      // it. A missing tag counts as English because that is what the session
      // default is, and because guessing at a language is how a translation
      // arrives that nobody asked for.
      return {
        originalText,
        englishText: originalText,
        sourceLanguage: sourceLanguage || 'en',
        passthrough: true,
        model: NO_MODEL,
        latencyMs: 0,
        degraded: false,
        promptVersion: TRANSLATION_PROMPT_VERSION,
      };
    }

    if (!(await this.isAvailable())) {
      return notTranslated(0, 'model unavailable');
    }

    // ── The call ────────────────────────────────────────────────────────────

    const call = await this.chat<{ english?: unknown }>({
      messages: [
        { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildTranslationUserPrompt({
            text: originalText,
            sourceLanguage,
            sourceLanguageName: findLanguage(sourceLanguage)?.englishName,
          }),
        },
      ],
      schema: TRANSLATION_SCHEMA,
    });

    const english =
      typeof call.parsed?.english === 'string'
        ? call.parsed.english.trim()
        : '';

    if (english.length === 0) {
      return notTranslated(
        call.latencyMs,
        call.degradedReason ?? 'model returned no english text',
      );
    }

    if (!looksTranslated(english)) {
      // The model echoed the source instead of translating it. Feeding that to
      // an English keyword table is exactly the bug this module exists to fix,
      // so it is dropped rather than passed on as if it were English.
      this.logger.warn(
        `translation for a ${sourceLanguage} utterance came back still in its own script; treating it as untranslated`,
      );
      return notTranslated(call.latencyMs, 'reply was not in English');
    }

    return {
      originalText,
      englishText: english,
      sourceLanguage,
      passthrough: false,
      model: this.model,
      latencyMs: call.latencyMs,
      degraded: false,
      promptVersion: TRANSLATION_PROMPT_VERSION,
    };
  }

  /**
   * One constrained call, with exactly one repair attempt.
   *
   * Same posture as `OllamaProvider.chat`: `safeParse` is intolerant of prose,
   * so a model that wrapped its JSON in a sentence gets told once and then the
   * caller degrades. A loop here would cost the background job another twenty
   * seconds per turn for a model that has already shown it is not going to
   * comply.
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
      };
    }

    const parsed = safeParse<T>(first.content);
    if (parsed.ok) {
      return { parsed: parsed.value, latencyMs: Date.now() - startedAt };
    }

    this.logger.warn(
      `translation model returned unparseable JSON; one repair attempt: ${parsed.error}`,
    );

    const repair = await this.post(
      [
        ...input.messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: `That was not valid JSON: ${parsed.error}. Return the same translation as valid JSON matching the schema, and nothing else.`,
        },
      ],
      input.schema,
    );

    if (repair.error) {
      return {
        parsed: null,
        latencyMs: Date.now() - startedAt,
        degradedReason: repair.error,
      };
    }

    const reparsed = safeParse<T>(repair.content);
    return {
      parsed: reparsed.ok ? reparsed.value : null,
      latencyMs: Date.now() - startedAt,
      degradedReason: reparsed.ok
        ? undefined
        : `unparseable after repair: ${reparsed.error}`,
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
          // Greedy. The same utterance must translate the same way twice, or a
          // classification cannot be explained after the fact.
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
      // Re-checked next time rather than assumed dead: a model that timed out
      // on one utterance may answer the next.
      this.availability = null;
      return { content: '', error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Did the model actually translate, or did it hand the source back?
 *
 * The only check applied to the output, and a narrow one on purpose. English
 * contains no Devanagari, Bengali, Tamil or Malayalam characters, so a reply
 * that still does is one the model did not translate — and a reply the English
 * keyword table would read exactly as badly as the original. Everything else
 * about the translation's quality is beyond anything this file can measure, and
 * a cleverer heuristic here would start rejecting good translations, which
 * costs a red flag rather than saving one.
 */
function looksTranslated(english: string): boolean {
  return !INDIC_SCRIPT.test(english);
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
