import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCodes } from '../../../common/exceptions/error-codes';
import { UNREADABLE_DOCUMENT } from '../pipeline/messages';

/** One recognised region: what it said, where it was, how sure the engine was. */
export interface OcrBlock {
  text: string;
  /** Four corner points, clockwise from top-left, in page pixels. */
  box: number[][];
  confidence: number;
}

export interface OcrPage {
  /** Blocks joined in the engine's own order. Use `readPageText` for tables. */
  text: string;
  /** Mean per-block confidence. A real measurement, unlike a model's own. */
  meanConfidence: number;
  blocks: OcrBlock[];
}

export interface OcrResult {
  pageCount: number;
  pages: OcrPage[];
  /** Recorded on the row so a bad read can later be attributed to an engine. */
  engine: string;
}

/**
 * The OCR half of the AI sidecar, over HTTP.
 *
 * The sidecar is a separate process because PP-OCRv5 is a Python model runtime
 * with its own failure modes, and a wedged model should not take the hospital
 * API down with it — `ai-sidecar/README.md` makes that argument at length. The
 * consequence here is that every call has a timeout and every failure has a
 * sentence: this client is the boundary at which a Python traceback stops being
 * a thing anybody downstream can accidentally show a patient.
 */
@Injectable()
export class SidecarOcrClient {
  private readonly logger = new Logger(SidecarOcrClient.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('MEDIHIVE_SIDECAR_URL') ||
      'http://127.0.0.1:8801'
    ).replace(/\/$/, '');
  }

  /** Whether OCR could run at all, for a health check. Never throws. */
  async available(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: 'GET' },
        3_000,
      );
      if (!response.ok) return false;
      const payload = (await response.json()) as { ocr?: boolean };
      return payload.ocr === true;
    } catch {
      return false;
    }
  }

  /**
   * Every page of one document.
   *
   * A multi-page discharge summary comes back as one result with an ordered
   * list of pages, never as several documents: the page number is half of a
   * citation back to the evidence, and it is worthless if the pages have been
   * split into rows that no longer know they were one sheaf.
   */
  async read(
    bytes: Buffer,
    mimeType: string,
    filename: string,
    timeoutMs = 180_000,
  ): Promise<OcrResult> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      filename,
    );

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/ocr`,
      { method: 'POST', body: form },
      timeoutMs,
    );

    if (!response.ok) {
      // The sidecar's `detail` is already written for a patient — it is the
      // same contract this module keeps. It is logged rather than forwarded
      // blind, because a 503 from a service that has not finished loading its
      // weights is an operational fact and not something to read out loud.
      const detail = await response.text();
      this.logger.error(
        `OCR sidecar refused a document: ${response.status} ${detail}`,
      );
      throw new AppException(
        UNREADABLE_DOCUMENT,
        ErrorCodes.PATIENT_DOCUMENT_UNREADABLE,
      );
    }

    const payload = (await response.json()) as {
      pageCount: number;
      pages: OcrPage[];
    };

    return {
      pageCount: payload.pageCount,
      pages: payload.pages ?? [],
      engine: 'pp-ocrv5-mobile',
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: abort.signal });
    } catch (error) {
      this.logger.error(
        `OCR sidecar unreachable at ${this.baseUrl}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw new AppException(
        UNREADABLE_DOCUMENT,
        ErrorCodes.PATIENT_DOCUMENT_UNREADABLE,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
