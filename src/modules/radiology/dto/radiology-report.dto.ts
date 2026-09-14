import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { RADIOLOGY_REPORT_STATUSES } from '../../../common/enums/clinical-status.enum';

export class CreateRadiologyReportDto {
  @ApiProperty({ example: 'order-cuid' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiPropertyOptional({ example: 'PA chest radiograph obtained' })
  @IsOptional()
  @IsString()
  technique?: string;

  @ApiPropertyOptional({ example: 'No focal consolidation' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ example: 'No acute cardiopulmonary abnormality' })
  @IsOptional()
  @IsString()
  impression?: string;

  @ApiPropertyOptional({ example: 'Clinical follow-up' })
  @IsOptional()
  @IsString()
  recommendations?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  hasCriticalFindings?: boolean;

  @ApiPropertyOptional({ example: 'Large pneumothorax' })
  @IsOptional()
  @IsString()
  criticalFindings?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  comparedWithPrevious?: boolean;

  @ApiPropertyOptional({ example: 'Stable compared to prior study' })
  @IsOptional()
  @IsString()
  comparisonNotes?: string;
}

export class UpdateRadiologyReportDto extends PartialType(
  CreateRadiologyReportDto,
) {
  @ApiPropertyOptional({ example: 'Dr Smith' })
  @IsOptional()
  @IsString()
  criticalNotifiedTo?: string;

  @ApiPropertyOptional({ example: '2026-06-10T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  criticalNotifiedAt?: string;

  @ApiPropertyOptional({
    example: '[{"url":"https://example.com/image.jpg","caption":"PA"}]',
  })
  @IsOptional()
  @IsString()
  images?: string;

  @ApiPropertyOptional({ example: '1.2.840.113619' })
  @IsOptional()
  @IsString()
  dicomStudyUid?: string;

  @ApiPropertyOptional({ example: 'Chest X-Ray Normal Template' })
  @IsOptional()
  @IsString()
  templateUsed?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  reportedById?: string;

  @ApiPropertyOptional({ example: '2026-06-10T11:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  reportedAt?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  verifiedById?: string;

  @ApiPropertyOptional({ example: '2026-06-10T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  verifiedAt?: string;

  @ApiPropertyOptional({ example: 'final', enum: RADIOLOGY_REPORT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_REPORT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Typo correction' })
  @IsOptional()
  @IsString()
  amendmentReason?: string;

  @ApiPropertyOptional({ example: '2026-06-10T13:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  amendedAt?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  amendedById?: string;
}

export class RadiologyReportResponseDto {
  @ApiProperty({ example: 'report-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo', nullable: true })
  organizationId: string | null;

  @ApiProperty({ example: 'order-cuid' })
  orderId: string;

  @ApiProperty({ example: 'PA chest radiograph obtained', nullable: true })
  technique: string | null;

  @ApiProperty({ example: 'No focal consolidation', nullable: true })
  findings: string | null;

  @ApiProperty({
    example: 'No acute cardiopulmonary abnormality',
    nullable: true,
  })
  impression: string | null;

  @ApiProperty({ example: 'Clinical follow-up', nullable: true })
  recommendations: string | null;

  @ApiProperty({ example: false })
  hasCriticalFindings: boolean;

  @ApiProperty({ example: 'Large pneumothorax', nullable: true })
  criticalFindings: string | null;

  @ApiProperty({ example: false })
  comparedWithPrevious: boolean;

  @ApiProperty({ example: 'Stable compared to prior study', nullable: true })
  comparisonNotes: string | null;

  @ApiProperty({ example: 'draft' })
  status: string;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  updatedAt: Date;
}
