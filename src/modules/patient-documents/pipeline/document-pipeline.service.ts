import { Inject, Injectable, Logger } from '@nestjs/common';

import { DocumentLlm, DOCUMENT_LLM } from '../llm/document-llm.port';
import { OcrBlock, OcrPage, SidecarOcrClient } from '../ocr/sidecar-ocr.client';
import { classifyDocument, DocumentType } from './classifier';
import {
  buildProvenance,
  meanOcrConfidence,
  PageText,
  ValueProvenance,
} from './confidence';
import {
  Contradiction,
  ExistingRecord,
  findContradictions,
} from './contradictions';
import { buildDocumentFacts, describeFacts } from './document-facts';
import { emptyExtraction, ExtractedDocument } from './extraction-schema';
import { extractDocument } from './extractor';
import { assessImageQuality } from './image-quality';
import { readDocumentText, readPageText } from './layout';
import {
  AWAITING_REVIEW,
  IMAGE_TOO_BLURRY,
  NO_TEXT_FOUND,
  NOTHING_EXTRACTED,
  UNREADABLE_DOCUMENT,
} from './messages';

/**
 * Documents §24, as one method.
 *
 *     quality check -> OCR -> classify -> extract -> validate -> confidence
 *
 * and then a stop. The result is `needs_review` and it is never anything else
 * on the happy path, because §2 is the feature's first constraint: the system
 * "must never silently treat AI-extracted information as verified clinical
 * truth". There is no branch in this file that writes to a patient record and
 * no confidence high enough to earn one. What it produces is a proposal with
 * its evidence attached.
 *
 * Every failure leaves by the same door: a `status`, and a `message` written
 * for a patient. §27 names the thing that must not happen — `PP-OCR inference
 * exception` shown to somebody who wanted to know whether to take another
 * photograph — and the way that leaks is never a decision. It is an
 * `error.message` passed up through one layer that did not know where it would
 * end up. So this service catches, logs the real thing, and returns a sentence.
 */

/**
 * Below this the recogniser is guessing, and §9's fallback is worth its cost.
 *
 * Measured, not chosen from the air: the fixtures read at 0.986 and 0.991, and
 * a page that comes back under 0.6 is not a slightly worse version of that.
 */
const VISION_FALLBACK_BELOW = 0.6;

/** Text shorter than this is a caption or a stray mark, not a document. */
const MIN_USABLE_CHARS = 24;

/** With no usable text from either path, the honest answer is "take it again". */
const REJECT_BELOW = 0.35;

/**
 * A vision model declining, rather than reading.
 *
 * Anchored to the opening of the answer, because these are the shapes a refusal
 * takes and a transcription does not: a real prescription does not begin "I'm
 * sorry". It matters because a refusal is prose — long enough and English
 * enough to pass every length check downstream — and it would otherwise sail
 * into the classifier as the document's text.
 *
 * The list is observed rather than imagined. gemma3:4b handed the blurred
 * fixture answered "Please provide the text from the image. I need the actual
 * text to transcribe it for you", which is not a sentence anyone would predict
 * and is why the structural gate in `shouldTryVision` carries the real weight
 * here. Expect to add to this.
 */
const VISION_REFUSAL =
  /^\s*(i('m| am)?\s+(sorry|unable|afraid)|i\s+can(not|'t)|unfortunately|please\s+provide|i\s+need\s+the\s+actual|there\s+is\s+no\s+(text|readable|legible|visible)|no\s+text\s+(is\s+)?(visible|readable|legible)|the\s+image\s+is\s+(too\s+)?(blurry|unreadable|illegible|unclear))/i;

export type DocumentStatus = 'needs_review' | 'rejected_quality' | 'failed';

export interface PipelineInput {
  documentId: string;
  bytes: Buffer;
  mimeType: string;
  filename: string;
  /** The patient's current record, for §20. Read; never written. */
  record: ExistingRecord;
  /** Supplied rather than read from the clock, so a run can be replayed. */
  now: Date;
}

/** Everything the service writes back onto the row, and the sentence to show. */
export interface PipelineOutcome {
  status: DocumentStatus;
  docType: DocumentType | null;
  docTypeConfidence: number | null;
  ocrEngine: string | null;
  ocrConfidence: number | null;
  ocrText: string | null;
  ocrBlocks: OcrBlock[][] | null;
  pageCount: number;
  extraction: DocumentExtractionEnvelope | null;
  extractionConfidence: number | null;
  visionFallbackUsed: boolean;
  /** Written for a patient. Stored in `failureReason` when it is a failure. */
  message: string;
}

/**
 * The §26 envelope, as stored in `PatientDocument.extraction`.
 *
 * Keys are camelCase where §26 prints snake_case — the reasoning is in
 * `extraction-schema.ts`. `verificationStatus` reads `unverified` rather than
 * §16's `pending` for the same kind of reason: it is the case-taking engine's
 * vocabulary, these two structures will meet, and one of them having a private
 * word for the same state is how they stop meeting cleanly.
 */
export interface DocumentExtractionEnvelope extends ExtractedDocument {
  /** §19, and the reason this whole pipeline is not a JSON transform. */
  facts: ReturnType<typeof describeFacts>;
  /** §16: every extracted value, and where on the page it came from. */
  sources: ValueProvenance[];
  /** Values the model produced that are not in the source text. §17. */
  ungrounded: string[];
  /** §20. Findings only — nothing here has been applied to the record. */
  contradictions: Contradiction[];
  /**
   * §17's two stages, kept apart.
   *
   * `ocr` is a recogniser's measurement and `extraction` is this module's
   * grounding score. They are stored side by side and are never combined:
   * `ocrSource`/`extractionSource` exist so that a later reader cannot mistake
   * one kind of number for the other.
   */
  confidence: {
    ocr: number | null;
    ocrSource: 'measured';
    extraction: number | null;
    extractionSource: 'derived';
  };
  verificationStatus: 'unverified';
}

@Injectable()
export class DocumentPipelineService {
  private readonly logger = new Logger(DocumentPipelineService.name);

  constructor(
    private readonly ocr: SidecarOcrClient,
    @Inject(DOCUMENT_LLM) private readonly llm: DocumentLlm,
  ) {}

  async run(input: PipelineInput): Promise<PipelineOutcome> {
    // §5. Before OCR, not after: a thumbnail comes back from the recogniser at
    // plausible confidence about the wrong characters, and no number
    // downstream can separate that from a good read.
    const quality = assessImageQuality(input.bytes, input.mimeType);
    if (!quality.ok) {
      return rejected(quality.message);
    }

    let pages: OcrPage[];
    let engine: string;
    try {
      const result = await this.ocr.read(
        input.bytes,
        input.mimeType,
        input.filename,
      );
      pages = result.pages;
      engine = result.engine;
    } catch (error) {
      // The client has already turned this into a sentence and logged the
      // original. Re-logged here with the document id, which the client does
      // not have, so a patient's report can be traced to a row.
      this.logger.warn(
        `OCR failed for document ${input.documentId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return { ...rejected(UNREADABLE_DOCUMENT), status: 'failed' };
    }

    const ocrConfidence = meanOcrConfidence(toPageTexts(pages));
    const ocrText = readDocumentText(pages);

    // §9. The fallback, and only when OCR has actually struggled — §8 spends a
    // section arguing that the vision model is not the primary path, and the
    // measurements back it: on this hardware the same page costs 15 seconds
    // through OCR plus the text model, or 22 through vision alone, and vision
    // dropped the document date and the OP number that OCR read cleanly.
    let text = ocrText;
    let visionFallbackUsed = false;
    if (this.shouldTryVision(input.mimeType, pages, ocrConfidence)) {
      const transcript = await this.transcribeWithVision(input);
      if (transcript) {
        text = transcript;
        visionFallbackUsed = true;
      }
    }

    if (!isUsable(text)) {
      // Nothing legible from either path. Which sentence depends on what the
      // recogniser saw: no blocks at all is a blank or wrong-side page, blocks
      // at floor confidence is a photograph that moved.
      const sawNothing = pages.every((page) => page.blocks.length === 0);
      return {
        ...rejected(sawNothing ? NO_TEXT_FOUND : IMAGE_TOO_BLURRY),
        ocrEngine: engine,
        ocrConfidence,
        ocrText: ocrText || null,
        ocrBlocks: pages.map((page) => page.blocks),
        pageCount: pages.length || 1,
        visionFallbackUsed,
      };
    }

    if (
      ocrConfidence !== null &&
      ocrConfidence < REJECT_BELOW &&
      !visionFallbackUsed
    ) {
      return {
        ...rejected(IMAGE_TOO_BLURRY),
        ocrEngine: engine,
        ocrConfidence,
        ocrText,
        ocrBlocks: pages.map((page) => page.blocks),
        pageCount: pages.length || 1,
      };
    }

    const classification = await classifyDocument(text, this.llm);

    let extraction: ExtractedDocument;
    try {
      extraction = await extractDocument(text, classification.type, this.llm);
    } catch (error) {
      // A document that was read but could not be structured is still worth
      // keeping — the original is evidence and the OCR text is searchable — so
      // this is `needs_review` with an empty extraction rather than a failure.
      this.logger.warn(
        `Extraction failed for document ${input.documentId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      extraction = emptyExtraction(classification.type);
    }

    const pageTexts = visionFallbackUsed
      ? [{ page: 1, text, meanConfidence: ocrConfidence }]
      : toPageTexts(pages);

    const provenance = buildProvenance(extraction, pageTexts, input.documentId);

    const envelope: DocumentExtractionEnvelope = {
      ...extraction,
      facts: describeFacts(
        buildDocumentFacts(extraction, text, {
          documentId: input.documentId,
          ocrConfidence,
          recordedAt: input.now.toISOString(),
        }),
      ),
      sources: provenance.sources,
      ungrounded: provenance.ungrounded,
      contradictions: findContradictions(extraction, input.record),
      confidence: {
        ocr: ocrConfidence,
        ocrSource: 'measured',
        extraction: provenance.extractionConfidence,
        extractionSource: 'derived',
      },
      verificationStatus: 'unverified',
    };

    return {
      // Always. There is no path from here to `verified` that does not go
      // through a person — §18, and the schema's own status vocabulary.
      status: 'needs_review',
      docType: classification.type,
      docTypeConfidence: classification.confidence,
      ocrEngine: engine,
      ocrConfidence,
      ocrText,
      ocrBlocks: pages.map((page) => page.blocks),
      pageCount: pages.length || 1,
      extraction: envelope,
      extractionConfidence: provenance.extractionConfidence,
      visionFallbackUsed,
      message: hasAnyFinding(extraction) ? AWAITING_REVIEW : NOTHING_EXTRACTED,
    };
  }

  /**
   * Whether this page is a candidate for §9's fallback.
   *
   * Three conditions, and the third is the one worth explaining.
   *
   * PDFs are excluded because there is nothing to send. A vision model needs
   * pixels; the pages of a PDF only become pixels inside the OCR sidecar at
   * 144 DPI, and the sidecar does not hand the renders back. Adding a
   * render-only endpoint is the fix; guessing is not.
   *
   * A page on which the detector found *zero* text regions is excluded too, and
   * that is not an optimisation. §9's list of fallback cases — handwriting,
   * poor scans, blurry photographs, overlapping stamps, complex layouts — are
   * all pages where PP-OCRv5 finds regions and then cannot read them. Zero
   * regions is a different finding: it is §27's "no detectable text", and it is
   * the detector making a measurement about the page rather than failing at
   * one. Asking a generative model to read a page that demonstrably has nothing
   * on it does not produce a reading, it produces whatever the model says when
   * it has nothing to go on — the blurred fixture came back as "Please provide
   * the text from the image", and a less chatty model would have come back with
   * a plausible prescription. There is no provenance that can be attached to
   * that, which under §16 means it cannot be stored.
   */
  private shouldTryVision(
    mimeType: string,
    pages: OcrPage[],
    ocrConfidence: number | null,
  ): boolean {
    if (!mimeType.startsWith('image/')) return false;
    if (pages.length !== 1) return false;

    const page = pages[0];
    if (!page || page.blocks.length === 0) return false;

    const text = readPageText(page);
    if (!isUsable(text)) return true;
    return ocrConfidence !== null && ocrConfidence < VISION_FALLBACK_BELOW;
  }

  private async transcribeWithVision(
    input: PipelineInput,
  ): Promise<string | null> {
    try {
      const transcript = await this.llm.transcribeImage({
        image: input.bytes,
        mimeType: input.mimeType,
        instruction:
          'Transcribe every line of text visible in this medical document, in ' +
          'reading order. Copy what is written exactly, including numbers and ' +
          'units. Do not summarise, explain, or add anything that is not ' +
          'written on the page. If nothing can be read, answer with nothing.',
      });

      if (!isUsable(transcript) || VISION_REFUSAL.test(transcript)) {
        return null;
      }
      return transcript;
    } catch (error) {
      // The fallback failing is not itself a failure: the caller still has
      // whatever OCR managed, and decides from there.
      this.logger.warn(
        `Vision fallback failed for document ${input.documentId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }
}

function toPageTexts(pages: OcrPage[]): PageText[] {
  return pages.map((page, index) => ({
    page: index + 1,
    text: readPageText(page),
    meanConfidence:
      typeof page.meanConfidence === 'number' ? page.meanConfidence : null,
  }));
}

function isUsable(text: string | null | undefined): boolean {
  return (text ?? '').trim().length >= MIN_USABLE_CHARS;
}

/** Whether the extraction found anything at all worth a patient's attention. */
function hasAnyFinding(extraction: ExtractedDocument): boolean {
  return (
    extraction.medications.length > 0 ||
    extraction.investigations.length > 0 ||
    extraction.diagnosesRecorded.length > 0 ||
    extraction.procedures.length > 0 ||
    extraction.allergies.length > 0 ||
    extraction.followUp.length > 0
  );
}

function rejected(message: string): PipelineOutcome {
  return {
    status: 'rejected_quality',
    docType: null,
    docTypeConfidence: null,
    ocrEngine: null,
    ocrConfidence: null,
    ocrText: null,
    ocrBlocks: null,
    pageCount: 1,
    extraction: null,
    extractionConfidence: null,
    visionFallbackUsed: false,
    message,
  };
}
