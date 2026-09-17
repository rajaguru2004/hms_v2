import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCodes } from '../../../common/exceptions/error-codes';
import {
  DocumentLlm,
  ExtractJsonRequest,
  TranscribeImageRequest,
} from './document-llm.port';

/**
 * `DocumentLlm` over Ollama's `/api/generate`.
 *
 * STOPGAP. The AI module owns model access for the platform, and when its
 * provider lands this class should be deleted and `DOCUMENT_LLM` bound to an
 * adapter over it — the port next door is the whole contract, so that is one
 * provider line in `PatientDocumentsModule`. It exists because a pipeline that
 * cannot run end to end is a pipeline nobody has actually tested, and the model
 * is already on this box.
 *
 * Two details are load-bearing rather than incidental:
 *
 *   `format` is a JSON Schema, not the string "json". Ollama constrains
 *   decoding to the schema, so a missing field comes back as the schema's null
 *   rather than as the model's improvisation. Documents §11 asks for extraction
 *   "without inventing missing values"; this is the part of that which can be
 *   enforced rather than requested.
 *
 *   `temperature` is 0. The same page read twice should extract the same
 *   fields, because a clinician looking at two different answers from one
 *   document has no way to tell which is the reading error.
 */
@Injectable()
export class OllamaDocumentLlm implements DocumentLlm {
  private readonly logger = new Logger(OllamaDocumentLlm.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('OLLAMA_URL') || 'http://127.0.0.1:11434'
    ).replace(/\/$/, '');
    // MEDIHIVE_DOCUMENT_MODEL first so this pipeline can be pinned to its own
    // model, then OLLAMA_MODEL — which is what .env.local and every deployment
    // actually set, and what the rest of the app reads. Without that second
    // step the two halves silently disagree: changing OLLAMA_MODEL moved the
    // AI module and left document extraction on the hardcoded default, which
    // only looked correct because the default happened to match.
    this.model =
      this.configService.get<string>('MEDIHIVE_DOCUMENT_MODEL') ||
      this.configService.get<string>('OLLAMA_MODEL') ||
      'gemma3:4b';
  }

  async extractJson<T>(request: ExtractJsonRequest): Promise<T> {
    const raw = await this.generate(
      {
        model: this.model,
        prompt: `${request.instruction}\n\n---\n${request.text}\n---`,
        format: request.schema,
        stream: false,
        options: { temperature: 0, num_ctx: 8192 },
      },
      request.timeoutMs ?? 120_000,
    );

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Schema-constrained decoding makes this rare, and "rare" is exactly why
      // it must not be swallowed: a silent `{}` here would look downstream like
      // a document that contained nothing.
      this.logger.warn(
        `Model returned unparseable JSON (${raw.length} chars) for a document extraction`,
      );
      throw new AppException(
        'The document could not be read into structured information',
        ErrorCodes.PATIENT_DOCUMENT_UNREADABLE,
      );
    }
  }

  async transcribeImage(request: TranscribeImageRequest): Promise<string> {
    if (!request.mimeType.startsWith('image/')) {
      // A PDF is not an image to a vision model. Rendering its pages is the
      // OCR sidecar's job and it does not expose the renders, so there is
      // nothing to fall back to — see `shouldTryVisionFallback`.
      throw new AppException(
        'Only images can be read by the vision model',
        ErrorCodes.PATIENT_DOCUMENT_UNSUPPORTED_TYPE,
      );
    }

    return this.generate(
      {
        model: this.model,
        prompt: request.instruction,
        images: [request.image.toString('base64')],
        stream: false,
        options: { temperature: 0, num_ctx: 8192 },
      },
      // Vision is several times slower than the text path on this hardware —
      // about 22 seconds against 15 for the same page — which is the practical
      // half of the §8 argument for not routing every document through it.
      request.timeoutMs ?? 300_000,
    );
  }

  private async generate(
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<string> {
    // An abort rather than a bare await: a wedged model would otherwise hold
    // the pipeline open until the process restarts, and the patient is
    // watching a spinner the whole time.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }

      const payload = (await response.json()) as { response?: string };
      return (payload.response ?? '').trim();
    } catch (error) {
      this.logger.error(
        `Ollama call failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new AppException(
        'The document could not be read into structured information',
        ErrorCodes.PATIENT_DOCUMENT_UNREADABLE,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
