import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
      'The share of extracted values found verbatim in the source text, 0..1. ' +
      "Derived here; never a model's self-report.",
  })
  extractionConfidence?: number | null;

  @ApiPropertyOptional({
    description: 'The §26 envelope: values, facts, provenance, contradictions.',
  })
  extraction?: unknown;

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

/** The answer to `GET /patient-documents/:id/original`. */
export class PatientDocumentOriginalDto {
  @ApiProperty({ description: 'A signed URL that reads the stored original' })
  url: string;

  @ApiProperty({ description: 'Seconds until the URL stops working' })
  expiresInSeconds: number;

  @ApiProperty() expiresAt: Date;

  @ApiProperty() mimeType: string;
}
