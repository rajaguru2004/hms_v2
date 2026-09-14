import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  RADIOLOGY_ORDER_STATUSES,
  RADIOLOGY_ORDER_URGENCIES,
  RADIOLOGY_REPORT_STATUSES,
} from '../../../common/enums/clinical-status.enum';

export class RadiologyQueryDto {
  @ApiPropertyOptional({
    enum: ['exams', 'orders', 'reports', 'stats'],
    default: 'exams',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'x-ray' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'urgent' })
  @IsOptional()
  @IsString()
  urgency?: string;

  @ApiPropertyOptional({ example: 'order-cuid' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({
    description: 'Restrict orders to one patient, for the mobile patient hub.',
    example: 'patient-cuid',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class RadiologyPostCompatDto {
  @ApiPropertyOptional({ enum: ['exam', 'order', 'report'], default: 'exam' })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'Chest X-Ray PA View' })
  @IsOptional()
  @IsString()
  examName?: string;

  @ApiPropertyOptional({ example: 'CXR-PA' })
  @IsOptional()
  @IsString()
  examCode?: string;

  @ApiPropertyOptional({ example: 'x-ray' })
  @IsOptional()
  @IsString()
  examCategory?: string;

  @ApiPropertyOptional({ example: 'Chest' })
  @IsOptional()
  @IsString()
  bodyPart?: string;

  @ApiPropertyOptional({ example: 'DR' })
  @IsOptional()
  @IsString()
  modality?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedDuration?: number;

  @ApiPropertyOptional({ example: 'Remove metal objects before exam' })
  @IsOptional()
  @IsString()
  preparationInstructions?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  contrastRequired?: boolean;

  @ApiPropertyOptional({ example: 'Plain radiograph of chest' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'consultation-cuid' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiPropertyOptional({ example: 'exam-cuid' })
  @IsOptional()
  @IsString()
  examId?: string;

  @ApiPropertyOptional({ example: 'Persistent cough' })
  @IsOptional()
  @IsString()
  clinicalIndication?: string;

  @ApiPropertyOptional({ example: 'Pneumonia' })
  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @ApiPropertyOptional({ example: 'Fever for 5 days' })
  @IsOptional()
  @IsString()
  relevantHistory?: string;

  @ApiPropertyOptional({ example: 'routine', enum: RADIOLOGY_ORDER_URGENCIES })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_ORDER_URGENCIES)
  urgency?: string;

  @ApiPropertyOptional({ example: 'Order notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'order-cuid' })
  @IsOptional()
  @IsString()
  orderId?: string;

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

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  hasCriticalFindings?: boolean;

  @ApiPropertyOptional({ example: 'Large pneumothorax' })
  @IsOptional()
  @IsString()
  criticalFindings?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  comparedWithPrevious?: boolean;

  @ApiPropertyOptional({ example: 'Stable compared to prior study' })
  @IsOptional()
  @IsString()
  comparisonNotes?: string;
}

export class RadiologyPatchCompatDto {
  @ApiProperty({ enum: ['exam', 'order', 'report'] })
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiProperty({ example: 'record-cuid' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ example: 'updated name' })
  @IsOptional()
  @IsString()
  examName?: string;

  @ApiPropertyOptional({ example: 'CXR-UPD' })
  @IsOptional()
  @IsString()
  examCode?: string;

  @ApiPropertyOptional({ example: 'x-ray' })
  @IsOptional()
  @IsString()
  examCategory?: string;

  @ApiPropertyOptional({ example: 'Chest' })
  @IsOptional()
  @IsString()
  bodyPart?: string;

  @ApiPropertyOptional({ example: 'DR' })
  @IsOptional()
  @IsString()
  modality?: string;

  @ApiPropertyOptional({ example: 600 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedDuration?: number;

  @ApiPropertyOptional({ example: 'Updated prep' })
  @IsOptional()
  @IsString()
  preparationInstructions?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  contrastRequired?: boolean;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'in_progress',
    enum: RADIOLOGY_ORDER_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_ORDER_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'urgent', enum: RADIOLOGY_ORDER_URGENCIES })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_ORDER_URGENCIES)
  urgency?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Persistent cough' })
  @IsOptional()
  @IsString()
  clinicalIndication?: string;

  @ApiPropertyOptional({ example: 'Pneumonia' })
  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @ApiPropertyOptional({ example: 'History' })
  @IsOptional()
  @IsString()
  relevantHistory?: string;

  @ApiPropertyOptional({ example: '2026-06-10T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '2026-06-10T10:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  examPerformedAt?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  performedById?: string;

  @ApiPropertyOptional({ example: 'Patient cancelled' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;

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

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  hasCriticalFindings?: boolean;

  @ApiPropertyOptional({ example: 'Critical details' })
  @IsOptional()
  @IsString()
  criticalFindings?: string;

  @ApiPropertyOptional({ example: 'Dr Smith' })
  @IsOptional()
  @IsString()
  criticalNotifiedTo?: string;

  @ApiPropertyOptional({ example: '2026-06-10T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  criticalNotifiedAt?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  comparedWithPrevious?: boolean;

  @ApiPropertyOptional({ example: 'Stable' })
  @IsOptional()
  @IsString()
  comparisonNotes?: string;

  @ApiPropertyOptional({ example: 'final', enum: RADIOLOGY_REPORT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_REPORT_STATUSES)
  reportStatus?: string;

  @ApiPropertyOptional({ example: '2026-06-10T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  verifiedAt?: string;
}
