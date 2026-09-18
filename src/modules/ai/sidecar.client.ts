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
 * That argument is about queueing behind a busy *model*, so the breaker is per
 * capability. STT, TTS and OCR are three different models with three different
 * ways of going wrong, and one counter shared between them meant a missing
 * Tamil voice could switch off document reading. See `breakers` below.
 *
 * Every degradation here has somewhere to go. No STT means the patient types,
 * which §10 requires anyway because voice is never the only path. No TTS means
 * the question is read on screen. No OCR means a document waits rather than
 * being guessed at.
 */

/** What the sidecar can do with one language, right now, on this box. */
export interface SidecarLanguageStatus {
  /** Some engine can hear it. Always false for `or` — no model exists. */
  readonly stt: boolean;
  /** Some provider can speak it: the sidecar's `available`, not its preference. */
  readonly tts: boolean;
  /** Which provider would speak it — `indicf5`, `piper` — or null for none. */
  readonly provider: string | null;
}

/** One TTS engine's own account of itself, for the health check a human reads. */
export interface SidecarTtsProvider {
  readonly id: string;
  readonly ready: boolean;
  /** Why not, when not. For an engineer, never for a patient. */
  readonly detail: string;
  readonly languages: readonly string[];
}

export interface SidecarHealth {
  readonly ollama: boolean;
  readonly ollamaModels: readonly string[];
  readonly stt: boolean;
  readonly tts: boolean;
  readonly ocr: boolean;
  /**
   * Which languages can actually be heard and spoken on this box right now —
   * weights and reference audio present on its disk, which is a deployment
   * fact and not a code one.
   *
   * Distinct from `language.constants.ts`, which says what this system supports
   * in principle. The bare `stt` and `tts` booleans above are true when *any*
   * model loads, so `tts: true` was the answer while Tamil was missing. A
   * caller deciding whether to offer a microphone or a speaker for a particular
   * language reads these instead.
   */
  readonly sttLanguages: readonly string[];
  readonly ttsLanguages: readonly string[];
  /** Per language, both halves merged — the row a picker reads. */
  readonly languages: Readonly<Record<string, SidecarLanguageStatus>>;
  readonly ttsProviders: readonly SidecarTtsProvider[];
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

export type SidecarCapability = 'stt' | 'tts' | 'ocr' | 'health';

const CAPABILITIES: readonly SidecarCapability[] = [
  'stt',
  'tts',
  'ocr',
  'health',
];

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number;
}

export interface CircuitState {
  readonly open: boolean;
  readonly consecutiveFailures: number;
}

@Injectable()
export class SidecarClient {
  private readonly logger = new Logger(SidecarClient.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;

  /**
   * One breaker per capability, not one for the service.
   *
   * ── Why this changed
   *
   * A single counter meant any capability's failures could switch off the
   * others, and the eleven-language work turned that from a theoretical
   * coupling into a live outage. A language with no voice answers 503, so a
   * patient whose phone is set to Tamil tapping "read aloud" three times used
   * to open the one breaker and take **speech recognition and document
   * reading** down for everyone on the box for thirty seconds. A missing
   * reference recording is configuration; it must not be able to stop a
   * different model reading a prescription.
   *
   * The docblock at the top of this file argues that the breaker exists
   * because the sidecar runs one uvicorn worker and a slow request occupies
   * it. That argument is about queueing behind a busy *model*, and it holds per
   * model: OCR being wedged is a reason to stop queueing OCR. It was never an
   * argument for three unrelated models sharing a verdict about each other's
   * health.
   */
  private readonly breakers: Readonly<Record<SidecarCapability, BreakerState>> =
    Object.freeze({
      stt: { consecutiveFailures: 0, openedAt: 0 },
      tts: { consecutiveFailures: 0, openedAt: 0 },
      ocr: { consecutiveFailures: 0, openedAt: 0 },
      health: { consecutiveFailures: 0, openedAt: 0 },
    });

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
      const body = (await res.json()) as Record<string, unknown>;
      return {
        ollama: body.ollama === true,
        ollamaModels: stringList(body.ollamaModels),
        stt: body.stt === true,
        tts: body.tts === true,
        ocr: body.ocr === true,
        // An older sidecar sends none of these, and empty is the honest reading
        // of that: we do not know what it can hear or speak. They are NOT
        // filled in from the supported set — guessing that a voice exists is
        // how a Tamil question gets read aloud in English.
        sttLanguages: stringList(body.sttLanguages),
        ttsLanguages: stringList(body.ttsLanguages),
        languages: languageTable(body.languages),
        ttsProviders: ttsProviders(body.ttsProviders),
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
    // Send the language whenever the caller knows it. Omitting it lets Whisper
    // detect, which is the fallback and not the goal.
    //
    // ── This reverses the note that used to stand here
    //
    // The old argument was that auto-detect is the right default for a patient
    // who code-switches mid-sentence: "எனக்கு three days-ஆ chest pain இருக்கு".
    // It does not survive contact with how detection actually works. Whisper
    // does not decode a recording language by language; it runs language ID
    // over the opening window, picks ONE language, and decodes the whole clip
    // in it. A code-switched sentence therefore gets a coin-flip between Tamil
    // and English — which means the same patient saying the same thing twice
    // can come back in Tamil script once and in Latin the next time, and
    // nothing downstream can tell why. Naming the language does not suppress
    // the English words; they are transcribed either way. It removes the
    // coin-flip.
    //
    // Against Indic languages the coin-flip is also worse than it sounds: Hindi
    // and Marathi share a script, Bengali and Assamese share a script, and the
    // ID is running on a couple of seconds of a sick person speaking quietly.
    // A misdetect does not degrade the transcript, it returns a confident one
    // in the wrong script.
    //
    // And it is measurably slower. Warm STT with the language named is 2.073 s
    // against 3.857 s without it, for identical output text — the detection
    // pass is roughly 46% of the wait, paid on every answer.
    //
    // So: the session's language when there is one, detection when there is
    // not.
    //
    // Odia never gets this far. It has no model at all, so `sttLanguageFor`
    // answers `undefined` for it — and `undefined` here means "detect", not
    // "refuse". A detect on Odia audio returns a confident transcript in a
    // neighbouring language at HTTP 200, so the refusal cannot live here; it
    // lives in `CaseTakingService.transcribe`, which checks the language table
    // and answers 400 before the recording is ever sent.
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

  /**
   * Where a breaker stands, for `/health` and for the verification script.
   *
   * Called with no capability it answers for the service as a whole — open if
   * *anything* is open, and the worst run of failures — because that is the
   * shape the existing callers read and "is the sidecar in trouble" is still a
   * fair question. `circuitStates()` is the honest per-capability answer, and
   * is what a caller deciding whether to offer the microphone should read.
   */
  circuitState(capability?: SidecarCapability): CircuitState {
    if (capability) {
      return {
        open: this.isOpen(capability),
        consecutiveFailures: this.breakers[capability].consecutiveFailures,
      };
    }
    return {
      open: CAPABILITIES.some((each) => this.isOpen(each)),
      consecutiveFailures: Math.max(
        ...CAPABILITIES.map((each) => this.breakers[each].consecutiveFailures),
      ),
    };
  }

  /** Every breaker, separately. Three models, three failure modes, three verdicts. */
  circuitStates(): Readonly<Record<SidecarCapability, CircuitState>> {
    return Object.freeze({
      stt: this.circuitState('stt'),
      tts: this.circuitState('tts'),
      ocr: this.circuitState('ocr'),
      health: this.circuitState('health'),
    });
  }

  private isOpen(capability: SidecarCapability): boolean {
    const breaker = this.breakers[capability];
    if (breaker.consecutiveFailures < FAILURE_THRESHOLD) return false;
    if (Date.now() - breaker.openedAt >= OPEN_DURATION_MS) {
      // Half-open: one request is let through. It is not reset to zero here —
      // a probe that fails must re-open immediately rather than spend another
      // three patients' requests earning its way back to the threshold.
      return false;
    }
    return true;
  }

  private async request(
    capability: SidecarCapability,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    if (!this.enabled) {
      throw new SidecarUnavailableError(
        capability,
        MESSAGES[capability].disabled,
      );
    }

    if (this.isOpen(capability)) {
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
        // request — an empty file, a file type it will not read, an Odia
        // recording it has no model for. That is not evidence the service is
        // unhealthy, so it must not count towards the breaker or one bad upload
        // would cut off the next three patients.
        const detail = await readDetail(res);
        if (isRefusal(capability, res.status)) {
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

      this.breakers[capability].consecutiveFailures = 0;
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

  private recordFailure(capability: SidecarCapability, reason: string): void {
    const breaker = this.breakers[capability];
    breaker.consecutiveFailures++;
    if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
      breaker.openedAt = Date.now();
    }
    this.logger.warn(
      `sidecar ${capability} failed (${breaker.consecutiveFailures} in a row): ${reason}`,
    );
  }
}

/**
 * Whether a non-OK status is this request being refused rather than the service
 * being unwell.
 *
 * Anything below 500 always is. The interesting case is **503 from `/tts`**,
 * which since the eleven-language rewrite means "no provider can speak that
 * language" — a permanent, correct, cheap answer about configuration. Counting
 * it as a failure was an outage waiting to happen: nine of the eleven languages
 * have no voice on this box today, so three read-aloud taps from one Tamil
 * patient opened the breaker. With per-capability breakers that would now only
 * take TTS down, and that is still wrong — an English patient would lose
 * read-aloud for thirty seconds because somebody else asked for Tamil.
 *
 * Deliberately narrow. A 503 from `/stt` or `/ocr` still counts, because
 * neither of them uses it to mean "not configured": the recogniser refuses Odia
 * with a 400 by name, so a 503 there is a model that will not load, which is
 * exactly what the breaker is for.
 */
function isRefusal(capability: SidecarCapability, status: number): boolean {
  if (status < 500) return true;
  return capability === 'tts' && status === 503;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The per-language capability table, read defensively.
 *
 * `available` is the sidecar's word for "a provider can speak this now", and it
 * is the one this reads — not `preferred`, which names the provider that
 * *should* serve the language and is true for eleven languages that mostly
 * cannot be spoken yet. Reading the preference would put the speaker button in
 * front of a patient who would then hear nothing.
 *
 * A row that is not an object is dropped rather than defaulted, and a missing
 * table yields an empty one. "We could not tell" is not "everything works".
 */
function languageTable(
  value: unknown,
): Readonly<Record<string, SidecarLanguageStatus>> {
  if (typeof value !== 'object' || value === null) return Object.freeze({});

  const table: Record<string, SidecarLanguageStatus> = {};
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    table[code] = {
      stt: row.stt === true,
      tts: row.available === true,
      provider: typeof row.provider === 'string' ? row.provider : null,
    };
  }
  return Object.freeze(table);
}

function ttsProviders(value: unknown): readonly SidecarTtsProvider[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((raw): raw is Record<string, unknown> => {
      return typeof raw === 'object' && raw !== null;
    })
    .map((raw) => ({
      id: typeof raw.id === 'string' ? raw.id : 'unknown',
      ready: raw.ready === true,
      detail: typeof raw.detail === 'string' ? raw.detail : '',
      languages: stringList(raw.languages),
    }));
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
