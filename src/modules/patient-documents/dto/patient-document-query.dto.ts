import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { DOCUMENT_TYPES } from '../pipeline/classifier';

/** The statuses a row can be listed by. Mirrors the schema's own comment. */
export const DOCUMENT_STATUSES = [
  'uploaded',
  'processing',
  'extracted',
  'needs_review',
  'verified',
  'failed',
  'rejected_quality',
] as const;

export class PatientDocumentQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES })
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  docType?: string;

  @ApiPropertyOptional({
    description: 'Only documents attached to this session',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  /**
   * Declared so the parameter is documented and so `forbidNonWhitelisted` does
   * not 400 a staff client that sends it — the same reason
   * `PortalStateQueryDto` carries one.
   *
   * It is not how the handler learns whose documents to list. `@PatientScope()`
   * is, and for a patient caller this field is discarded rather than
   * overwritten: under Express 5 `req.query` re-parses on every access, so a
   * guard's write to it does not survive to the next reader.
   */
  @ApiPropertyOptional({
    description:
      'Staff only: whose documents to list. Ignored for patient callers.',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
