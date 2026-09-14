import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The Python sidecar — speech in, speech out, and reading photographs.
 *
 * It is a separate process on loopback because these are Python model runtimes
 * with their own interpreter and their own ways of wedging, and a wedged model
 * must not take the hospital API down. That argument only holds if this client
 * treats it as a service that can be down, which is what the timeout and the
 * breaker below are for.
 *
 * The breaker matters more here than it would in front of a database. The
 * sidecar runs one uvicorn worker and its transcription is synchronous, so a
 * single slow request occupies it: without a breaker, ten patients tapping the
 * microphone queue ten sixty-second waits behind each other and every one of
 * them sees a spinner. Opening the circuit turns that into ten immediate,
 * written refusals and a keyboard — a degradation the patient can act on.
 *
 * Every degradation here has somewhere to go. No STT means the patient types,
 * which §10 requires anyway because voice is never the only path. No TTS means
 * the question is read on screen. No OCR means a document waits rather than
 * being guessed at.
 */

export interface SidecarHealth {
  readonly ollama: boolean;
  readonly ollamaModels: readonly string[];
  readonly stt: boolean;
  readonly tts: boolean;
  readonly ocr: boolean;
}

export interface TranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly confidence: number;
}

export interface Transcript {
  readonly text: string;
  /**
   * The exponentiated mean log-probability faster-whisper reports.
   *
   * Unlike the language model's self-reported 0.95, this is a real measurement
   * of a real quantity, which is why it is allowed to reach a `FactProvenance`
   * with `confidenceSource: 'derived'`. It still gates nothing on its own.
   */
  readonly confidence: number;
  readonly language: string;
  readonly segments: readonly TranscriptSegment[];
  readonly durationMs: number;
}

export interface OcrBlock {
  readonly text?: string;
  readonly confidence?: number;
  readonly box?: unknown;
}

export interface OcrPage {
  readonly text: string;
  readonly meanConfidence: number;
  readonly blocks: readonly OcrBlock[];
}

export interface OcrResult {
  readonly pageCount: number;
  readonly pages: readonly OcrPage[];
}

/**
 * Raised when the sidecar cannot serve a request — down, timed out, or the
 * breaker is open.
 *
 * `patientMessage` is a written sentence rather than a status code because the
 * sidecar's own errors are written that way for the same reason: it is shown to
 * a patient, and "We couldn't hear that clearly" is a thing somebody can act
 * on where `503` is not.
 */
export class SidecarUnavailableError extends Error {
  constructor(
    readonly capability: 'stt' | 'tts' | 'ocr' | 'health',
    readonly patientMessage: string,
    readonly cause?: unknown,
  ) {
    super(`sidecar ${capability}: ${patientMessage}`);
    this.name = 'SidecarUnavailableError';
  }
}

/** Consecutive failures before the circuit opens. */
const FAILURE_THRESHOLD = 3;

/** How long it stays open before one probe is let through. */
const OPEN_DURATION_MS = 30_000;

/**
 * Transcription is slow and that is fine — it happens while the patient is
 * looking at the next question, not while they wait for it. The ceiling exists
 * so a wedged worker is released, not to make the call quick.
 */
const TIMEOUT_MS: Readonly<Record<'stt' | 'tts' | 'ocr' | 'health', number>> = {
  health: 3_000,
  stt: 120_000,
  tts: 30_000,
  ocr: 120_000,
};

@Injectable()
export class SidecarClient {
  private readonly logger = new Logger(SidecarClient.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;

  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('AI_SIDECAR_URL') ?? 'http://127.0.0.1:8801'
    ).replace(/\/+$/, '');
    this.enabled = this.config.get<string>('AI_ENABLED') !== 'false';
  }

  /**
   * What can actually run right now, or null when the sidecar is unreachable.
   *
   * Null rather than a thrown error or an all-false object: "we could not ask"
   * and "it answered that nothing works" are different facts, and a caller
   * deciding whether to offer the microphone needs to tell them apart. This is
   * the same distinction the tri-state makes one layer up.
   */
  async health(): Promise<SidecarHealth | null> {
    if (!this.enabled) return null;

    try {
      const res = await this.request('health', '/health', { method: 'GET' });
      const body = (await res.json()) as Partial<SidecarHealth> & {
        ollamaModels?: string[];
      };
      return {
        ollama: body.ollama === true,
        ollamaModels: body.ollamaModels ?? [],
        stt: body.stt === true,
        tts: body.tts === true,
        ocr: body.ocr === true,
      };
    } catch {
      return null;
    }
  }

  async transcribe(
    audio: Buffer,
    options: { filename?: string; mimeType?: string; language?: string } = {},
  ): Promise<Transcript> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], {
        type: options.mimeType ?? 'audio/wav',
      }),
      options.filename ?? 'audio.wav',
    );
    // Whisper detects the language when none is given, which is the right
    // default for a patient who code-switches mid-sentence. A session that
    // knows its language passes it and gets a better result.
    if (options.language) form.append('language', options.language);

    const res = await this.request('stt', '/stt', {
      method: 'POST',
      body: form,
    });

    const body = (await res.json()) as Partial<Transcript>;
    return {
      text: typeof body.text === 'string' ? body.text : '',
      confidence: typeof body.confidence === 'number' ? body.confidence : 0,
      language: typeof body.language === 'string' ? body.language : 'unknown',
      segments: Array.isArray(body.segments) ? body.segments : [],
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
    };
  }

  async speak(text: string, language = 'en'): Promise<Buffer> {
    const res = await this.request('tts', '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async readDocument(
    file: Buffer,
    options: { filename?: string; mimeType?: string } = {},
  ): Promise<OcrResult> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file)], {
        type: options.mimeType ?? 'application/octet-stream',
      }),
      options.filename ?? 'document',
    );

    const res = await this.request('ocr', '/ocr', {
      method: 'POST',
      body: form,
    });

    const body = (await res.json()) as Partial<OcrResult>;
    return {
      pageCount: typeof body.pageCount === 'number' ? body.pageCount : 0,
      pages: Array.isArray(body.pages) ? body.pages : [],
    };
  }

  /** Where the breaker stands, for `/health` and for the verification script. */
  circuitState(): { open: boolean; consecutiveFailures: number } {
    return {
      open: this.isOpen(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private isOpen(): boolean {
    if (this.consecutiveFailures < FAILURE_THRESHOLD) return false;
    if (Date.now() - this.openedAt >= OPEN_DURATION_MS) {
      // Half-open: one request is let through. It is not reset to zero here —
      // a probe that fails must re-open immediately rather than spend another
      // three patients' requests earning its way back to the threshold.
      return false;
    }
    return true;
  }

  private async request(
    capability: 'stt' | 'tts' | 'ocr' | 'health',
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    if (!this.enabled) {
      throw new SidecarUnavailableError(
        capability,
        MESSAGES[capability].disabled,
      );
    }

    if (this.isOpen()) {
      throw new SidecarUnavailableError(capability, MESSAGES[capability].down);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[capability]);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!res.ok) {
        // A 4xx is the sidecar working correctly and refusing this particular
        // request — an empty file, a file type it will not read. That is not
        // evidence the service is unhealthy, so it must not count towards the
        // breaker or one bad upload would cut off the next three patients.
        const detail = await readDetail(res);
        if (res.status < 500) {
          throw new SidecarUnavailableError(
            capability,
            detail ?? MESSAGES[capability].refused,
          );
        }
        this.recordFailure(capability, `responded ${res.status}`);
        throw new SidecarUnavailableError(
          capability,
          detail ?? MESSAGES[capability].down,
        );
      }

      this.consecutiveFailures = 0;
      return res;
    } catch (error) {
      if (error instanceof SidecarUnavailableError) throw error;

      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${TIMEOUT_MS[capability]}ms`
          : error instanceof Error
            ? error.message
            : 'unknown transport failure';

      this.recordFailure(capability, reason);
      throw new SidecarUnavailableError(
        capability,
        MESSAGES[capability].down,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private recordFailure(capability: string, reason: string): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.openedAt = Date.now();
    }
    this.logger.warn(
      `sidecar ${capability} failed (${this.consecutiveFailures} in a row): ${reason}`,
    );
  }
}

/**
 * The words a patient reads when a capability is missing.
 *
 * Written here rather than passed up as a status code, for the reason the
 * sidecar's README gives about its own errors: this text reaches a screen. Each
 * one names the alternative, because a refusal that does not say what to do
 * instead is a dead end.
 */
const MESSAGES: Readonly<
  Record<'stt' | 'tts' | 'ocr' | 'health', Record<string, string>>
> = {
  health: {
    disabled: 'Assistance features are switched off on this system.',
    down: 'We could not reach the speech and document service.',
    refused: 'We could not reach the speech and document service.',
  },
  stt: {
    disabled: 'Voice input is switched off. Please type your answer.',
    down: 'We could not hear that clearly. Please type your answer instead.',
    refused:
      'We could not use that recording. Please try again, or type your answer.',
  },
  tts: {
    disabled: 'Reading aloud is switched off. The question is on screen.',
    down: 'We cannot read this aloud right now. The question is on screen.',
    refused: 'We cannot read this aloud right now. The question is on screen.',
  },
  ocr: {
    disabled: 'Document reading is switched off. You can tell us instead.',
    down: 'We could not read this document right now. Your upload is saved and we will try again.',
    refused:
      'We could not read this document. Try a clearer photo, or tell us what it says.',
  },
};

/** The sidecar writes its refusals as sentences; pass them through when it does. */
async function readDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === 'string' && body.detail.trim().length > 0
      ? body.detail
      : null;
  } catch {
    return null;
  }
}
