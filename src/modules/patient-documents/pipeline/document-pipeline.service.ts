import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { buildDocumentFacts, describeFacts, FactTopic } from './document-facts';
import { ExtractedDocument } from './extraction-schema';
import { ExtractionMethod } from './extraction-method';
import { extractDocument } from './extractor';
import { assessImageQuality } from './image-quality';
import {
  linesFromText,
  readDocumentLines,
  readDocumentText,
  readPageText,
} from './layout';
import { extractByRules } from './rules-extractor';
import {
  assessCoverage,
  decideEscalation,
  EscalationReason,
  RulesCoverage,
} from './rules/coverage';
import { mergeExtractions } from './rules/merge';
import {
  extractionMessage,
  IMAGE_TOO_BLURRY,
  NO_TEXT_FOUND,
  UNREADABLE_DOCUMENT,
} from './messages';

/** Every §19 topic, so the ones a rule set did not cover can be named. */
const ALL_FACT_TOPICS: FactTopic[] = [
  'allergies',
  'medications',
  'diagnoses',
  'procedures',
  'investigations',
];

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
  /** Which reader produced it, for the audit log without parsing the blob. */
  extractionMethod: ExtractionMethod;
  /** Something was read, but not all of it. */
  extractionPartial: boolean;
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
  /**
   * §19, and the reason this whole pipeline is not a JSON transform.
   *
   * Absent when [extractionFailed] is set, and that is load-bearing rather
   * than tidy: every label in here is a sentence about the document, and there
   * is no honest sentence to write about a document nothing has read.
   */
  facts?: ReturnType<typeof describeFacts>;
  /** Which reader produced the values above. Inside the JSON so reads can see it. */
  extractionMethod: ExtractionMethod;
  /**
   * The extractor did not run — it failed, timed out, or the model was
   * unreachable. Never set because a document turned out to be empty.
   *
   * Recorded on the row because the alternative is inferring it from an empty
   * extraction, which is exactly the inference that produced "This document
   * does not mention medications" for a prescription listing three drugs while
   * the model was down.
   */
  extractionFailed?: true;
  /**
   * Something was read, but not all of it.
   *
   * A sibling of [extractionFailed], and the distinction is the whole point:
   * that one is "nobody looked", this is "somebody looked at part of it". The
   * deterministic reader makes this the ordinary case rather than a rare one —
   * it reads a printed prescription end to end and a handwritten one barely at
   * all — so absence here is not a finding, and [facts] says which topics went
   * unread rather than reporting them as absent.
   */
  extractionPartial?: true;
  /**
   * Why the gate wanted a second opinion, and what became of it.
   *
   * `modelEnabled` against `modelFailed` is what keeps "the model is switched
   * off on this box" distinguishable from "the model broke" when somebody
   * reads this row a month later. Without it both look like an empty
   * `medications[]`.
   */
  escalation: {
    reasons: EscalationReason[];
    modelEnabled: boolean;
    modelRan: boolean;
    modelFailed: boolean;
  };
  /** What the deterministic pass made of the page. Diagnostic, and for tuning. */
  coverage: RulesCoverage;
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
    /**
     * Two scales live in this slot, and [extractionSource] is the only thing
     * that says which:
     *
     *   `grounding`      the share of *model-produced* values found verbatim
     *                    in the source text — what this field has always held
     *   `rule_coverage`  how much of the page the deterministic reader
     *                    accounted for. Emphatically NOT a grounding score:
     *                    rules values are slices of the source text, so they
     *                    ground by construction and would read 1.0 for free.
     *
     * Rows written before the deterministic pass carry `derived`, which is
     * `grounding` under its old name. It is never written again, and every
     * reader has to tolerate it.
     *
     * The two are not comparable and must never be averaged together.
     */
    extraction: number | null;
    extractionSource: 'grounding' | 'rule_coverage' | 'derived';
    /** Always populated when a model produced values. Diagnostic. */
    grounding: number | null;
    /** Always populated when a rule set ran. Diagnostic. */
    ruleCoverage: number | null;
  };
  verificationStatus: 'unverified';
}

@Injectable()
export class DocumentPipelineService {
  private readonly logger = new Logger(DocumentPipelineService.name);

  /** Whether this deployment may call a language model for a document at all. */
  private readonly modelEnabled: boolean;
  /** Whether it may call the §9 vision fallback, the costliest call in the feature. */
  private readonly visionEnabled: boolean;

  constructor(
    private readonly ocr: SidecarOcrClient,
    @Inject(DOCUMENT_LLM) private readonly llm: DocumentLlm,
    /**
     * Optional so the pipeline stays constructible with two arguments.
     *
     * `ConfigModule` is global, so Nest supplies this in the running app; the
     * specs construct the service directly and an absent config then reads as
     * "enabled", which is the behaviour they already assert.
     */
    @Optional() config?: ConfigService,
  ) {
    // A string, because that is what an environment variable is and Joi
    // validates it as one. Anything but the literal 'false' leaves it on —
    // `ollama.provider.ts`'s convention, so that a typo cannot silently
    // disable extraction in production.
    this.modelEnabled =
      config?.get<string>('AI_ENABLED') !== 'false' &&
      config?.get<string>('MEDIHIVE_DOCUMENT_LLM_ENABLED') !== 'false';

    this.visionEnabled =
      this.modelEnabled &&
      config?.get<string>('MEDIHIVE_DOCUMENT_VISION_ENABLED') !== 'false';
  }

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

    const classification = await classifyDocument(text, this.llm, {
      modelEnabled: this.modelEnabled,
    });

    // Lines rather than the joined text: the rules need indices to measure
    // coverage, page numbers to cite, and per-cell confidence to decide what
    // to mark uncertain. Same ternary as `pageTexts` below and for the same
    // reason — a vision transcript has no boxes to read any of that from.
    const lines = visionFallbackUsed
      ? linesFromText(text)
      : readDocumentLines(pages);

    const rules = extractByRules(lines, classification.type);
    const coverage = assessCoverage(rules, lines, classification);
    const decision = decideEscalation(coverage);

    let extraction: ExtractedDocument = rules.extraction;
    let origins = rules.origins;
    let method: ExtractionMethod = rules.ruleSet === 'none' ? 'none' : 'rules';
    let modelRan = false;
    let modelFailed = false;

    if (decision.escalate && this.modelEnabled) {
      try {
        const fromModel = await extractDocument(
          text,
          classification.type,
          this.llm,
        );
        const merged = mergeExtractions(rules, fromModel, text);
        extraction = merged.extraction;
        origins = merged.origins;
        method = method === 'none' ? 'model' : 'rules_then_model';
        modelRan = true;
      } catch (error) {
        // The second opinion not arriving is not a failure of the reading.
        // Whatever the rules read is still real, still cited and still worth
        // showing; discarding it here would throw away the only reading
        // anybody has, which is what the old `emptyExtraction` did.
        this.logger.warn(
          `Model extraction failed for document ${input.documentId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        modelFailed = true;
      }
    }

    // The reading is complete when the rules cleared their own gate, or when a
    // model read the whole text. Everything that turns an extraction into
    // sentences depends on this being right — `describeFacts` above all.
    const complete =
      modelRan || (!decision.escalate && decision.rulesAreComplete);
    const producedAnything = hasAnyValue(extraction);
    const nobodyLooked = method === 'none' && !producedAnything;

    this.logger.debug(
      `Document ${input.documentId} read by ${method}: ` +
        `score=${coverage.score} claim=${coverage.lineClaim} ` +
        `required=${coverage.requiredSatisfaction} ` +
        `reasons=[${decision.reasons.join(',')}]`,
    );

    const pageTexts = visionFallbackUsed
      ? [{ page: 1, text, meanConfidence: ocrConfidence }]
      : toPageTexts(pages);

    const provenance = buildProvenance(
      extraction,
      pageTexts,
      input.documentId,
      origins,
    );

    // Two scales live in `confidence.extraction`, and `extractionSource` is
    // what keeps them apart. Grounding measures model output against the page;
    // for a rules-only read it would be 1.0 by construction and would measure
    // nothing, so coverage is published instead and labelled as such.
    // `modelRan` as well as the score, and not only for belt and braces: the
    // grounding label must never be attached to a reading no model took part
    // in, whatever the arithmetic happens to say.
    const usesGrounding = modelRan && provenance.modelGrounding !== null;

    const unread = complete
      ? undefined
      : new Set(
          ALL_FACT_TOPICS.filter(
            (topic) => !rules.coveredTopics.includes(topic),
          ),
        );

    const envelope: DocumentExtractionEnvelope = {
      ...extraction,
      extractionMethod: method,
      ...(nobodyLooked
        ? { extractionFailed: true as const }
        : {
            facts: describeFacts(
              buildDocumentFacts(extraction, text, {
                documentId: input.documentId,
                ocrConfidence,
                recordedAt: input.now.toISOString(),
              }),
              unread,
            ),
          }),
      ...(complete || nobodyLooked ? {} : { extractionPartial: true as const }),
      escalation: {
        reasons: decision.reasons,
        modelEnabled: this.modelEnabled,
        modelRan,
        modelFailed,
      },
      coverage,
      sources: provenance.sources,
      ungrounded: provenance.ungrounded,
      contradictions: findContradictions(extraction, input.record),
      confidence: {
        ocr: ocrConfidence,
        ocrSource: 'measured',
        extraction: usesGrounding ? provenance.modelGrounding : coverage.score,
        extractionSource: usesGrounding ? 'grounding' : 'rule_coverage',
        grounding: provenance.extractionConfidence,
        ruleCoverage: rules.ruleSet === 'none' ? null : coverage.score,
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
      extractionConfidence: envelope.confidence.extraction,
      extractionMethod: method,
      extractionPartial: !complete && !nobodyLooked,
      visionFallbackUsed,
      message: extractionMessage({
        method,
        partial: !complete && !nobodyLooked,
        failed: nobodyLooked && modelFailed,
        hasFindings: hasAnyFinding(extraction),
      }),
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
    // Switched off on a box with no accelerator. `visionFallbackUsed` then
    // stays false, which is the truthful value — nothing was attempted.
    if (!this.visionEnabled) return false;
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

/**
 * Whether any reader got anything at all off this document.
 *
 * Wider than [hasAnyFinding], which asks whether there is anything clinical
 * worth a patient's attention. This asks whether anybody read anything —
 * a patient name and a date count — because that is the difference between
 * "nobody looked" and "somebody looked and this page had no medicine on it".
 */
function hasAnyValue(extraction: ExtractedDocument): boolean {
  return (
    hasAnyFinding(extraction) ||
    extraction.document.date !== null ||
    extraction.document.facility !== null ||
    extraction.document.author !== null ||
    extraction.patient.name !== null ||
    extraction.patient.identifier !== null ||
    extraction.admission !== null
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
    // A rejected document was never read, so no reader produced it and there
    // is no partial reading to report. `none` is the honest answer, not a
    // default.
    extractionMethod: 'none',
    extractionPartial: false,
    visionFallbackUsed: false,
    message,
  };
}
