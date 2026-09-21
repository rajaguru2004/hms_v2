import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  CORRECTION_KINDS,
  CORRECTION_TARGETS,
  DOCUMENT_ONLY_REASONS,
} from '../document-corrections';

/**
 * One correction, as it comes back.
 *
 * `originalValue` and `patientValue` are both present and both nullable, and
 * the pair is the whole point: §22's evidence chain needs the row to be able to
 * say "the model read X, the patient said it was Y". A shape that carried only
 * the current value would be a shape in which that sentence cannot be said.
 */
export class DocumentCorrectionDto {
  @ApiProperty({
    description: 'The path into the extraction, e.g. `medications[0].strength`',
  })
  path: string;

  @ApiProperty({ enum: CORRECTION_KINDS })
  kind: string;

  @ApiPropertyOptional({
    description: 'What the extraction says here. Null if it read nothing.',
  })
  originalValue?: string | null;

  @ApiPropertyOptional({
    description:
      'What the patient says instead. Null when they confirmed, when they are ' +
      'unsure, or when they asserted there is nothing here — `presence` is ' +
      'what tells those three apart.',
  })
  patientValue?: string | null;

  @ApiProperty({
    description:
      'The tri-state this landed on: recorded, none, unknown, not_applicable ' +
      'or declined. Never `not_assessed` — somebody looked.',
  })
  presence: string;

  @ApiProperty({
    description: 'Which rule in the case engine decided the presence.',
  })
  presenceReason: string;

  @ApiPropertyOptional() note?: string | null;

  @ApiProperty() correctedByUserId: string;
  @ApiProperty() correctedAt: string;

  @ApiProperty({
    enum: CORRECTION_TARGETS,
    description:
      '`case_fact` when the correction also superseded the fact this document ' +
      'contributed to an interview; `document_only` when it did not.',
  })
  target: string;

  @ApiPropertyOptional({
    enum: DOCUMENT_ONLY_REASONS,
    description:
      'Why it stayed on the document: `no_session` (the document is attached ' +
      'to no interview) or `no_case_field` (the value has no counterpart in ' +
      "the interview's fields — a recorded diagnosis, or a fact about the " +
      'piece of paper rather than the patient).',
  })
  documentOnlyReason?: string | null;

  @ApiPropertyOptional() caseFieldPath?: string | null;
  @ApiPropertyOptional() caseFactId?: string | null;

  @ApiPropertyOptional({
    description: 'The document-derived fact this replaced, if there was one.',
  })
  supersededFactId?: string | null;

  @ApiPropertyOptional({
    description:
      'When the patient confirmed the document after making this correction. ' +
      'Null while it is outstanding; stamped rather than removed, so ' +
      '"disputed and then settled" stays distinguishable from "never ' +
      'disputed".',
  })
  acknowledgedAt?: string | null;
}

/**
 * What a client gets back about one document.
 *
 * Shaped around a single question the patient dashboard has to answer on every
 * screen: is there anything here I should look at, and how sure is anyone about
 * it. So `message` is always present and always a sentence, `status` says where
 * the row is, and the two confidences are separate fields rather than one
 * blended score — §17, and `confidence.ts` on why blending them is worse than
 * showing neither.
 */
export class PatientDocumentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiPropertyOptional() sessionId?: string | null;

  @ApiProperty() mimeType: string;
  @ApiProperty() byteSize: number;
  @ApiProperty() pageCount: number;

  @ApiProperty({
    description:
      'uploaded, processing, extracted, needs_review, verified, failed, ' +
      'rejected_quality',
  })
  status: string;

  @ApiPropertyOptional({ description: 'null while unclassified, or "unknown"' })
  docType?: string | null;

  @ApiPropertyOptional({ description: 'How sure the classifier was, 0..1' })
  docTypeConfidence?: number | null;

  @ApiPropertyOptional({ description: 'Which engine read the page' })
  ocrEngine?: string | null;

  @ApiPropertyOptional({
    description:
      "The recogniser's measured confidence, 0..1. Never compared against " +
      'extractionConfidence — they measure different things.',
  })
  ocrConfidence?: number | null;

  @ApiPropertyOptional({
    description:
      'How well this document was read, 0..1. Derived here; never a ' +
      "model's self-report. WHAT IT MEASURES depends on which reader " +
      'produced the extraction, and `extraction.confidence.extractionSource` ' +
      'is the only thing that says which: `grounding` is the share of ' +
      'model-produced values found verbatim in the source text, while ' +
      '`rule_coverage` is how much of the page the deterministic reader ' +
      'accounted for. The two are not comparable and must not be averaged ' +
      'together across documents.',
  })
  extractionConfidence?: number | null;

  @ApiPropertyOptional({
    description: 'The §26 envelope: values, facts, provenance, contradictions.',
  })
  extraction?: unknown;

  @ApiProperty({
    type: [DocumentCorrectionDto],
    description:
      'What the patient said the extraction got wrong. A sibling of ' +
      '`extraction`, never a rewrite of it — each entry carries the value the ' +
      'model read as well as the value the patient gave, so a client can ' +
      'render the corrected reading while still showing what the page said.',
  })
  corrections: DocumentCorrectionDto[];

  @ApiProperty({
    description:
      'True while a correction is outstanding. Such a document is not ' +
      'verified, whatever it was before the correction arrived.',
  })
  hasOutstandingCorrections: boolean;

  @ApiProperty({
    description: 'Whether the page had to go to the vision model',
  })
  visionFallbackUsed: boolean;

  @ApiProperty({
    description: 'True when this is a copy of a document already held',
  })
  isDuplicate: boolean;

  @ApiPropertyOptional() duplicateOfId?: string | null;

  @ApiProperty({
    description:
      'What to show the patient. Always a sentence, never an engine message.',
  })
  message: string;

  @ApiProperty() uploadedAt: Date;
  @ApiPropertyOptional() processedAt?: Date | null;
  @ApiPropertyOptional() verifiedAt?: Date | null;
}

/** The answer to `PATCH /patient-documents/:documentId/extraction`. */
export class DocumentCorrectionResponseDto {
  @ApiProperty({ type: DocumentCorrectionDto })
  correction: DocumentCorrectionDto;

  @ApiProperty({
    type: PatientDocumentResponseDto,
    description:
      'The document afterwards, so one payload re-renders the review screen.',
  })
  document: PatientDocumentResponseDto;
}

/** The answer to `GET /patient-documents/:documentId/original`. */
export class PatientDocumentOriginalDto {
  @ApiProperty({ description: 'A signed URL that reads the stored original' })
  url: string;

  @ApiProperty({ description: 'Seconds until the URL stops working' })
  expiresInSeconds: number;

  @ApiProperty() expiresAt: Date;

  @ApiProperty() mimeType: string;
}
