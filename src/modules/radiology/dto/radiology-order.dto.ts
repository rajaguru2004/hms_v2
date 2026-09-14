import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { OptionalPaginationDto } from '../../../common/dto/optional-pagination.dto';
import {
  RADIOLOGY_ORDER_STATUSES,
  RADIOLOGY_ORDER_URGENCIES,
} from '../../../common/enums/clinical-status.enum';

export class CreateRadiologyOrderDto {
  @ApiProperty({ example: 'patient-cuid' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'consultation-cuid' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiProperty({ example: 'exam-cuid' })
  @IsString()
  @IsNotEmpty()
  examId: string;

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

  @ApiPropertyOptional({
    example: 'routine',
    default: 'routine',
    enum: RADIOLOGY_ORDER_URGENCIES,
  })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_ORDER_URGENCIES)
  urgency?: string;

  @ApiPropertyOptional({ example: 'Wheelchair patient' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRadiologyOrderDto extends PartialType(
  CreateRadiologyOrderDto,
) {
  @ApiPropertyOptional({
    example: 'in_progress',
    enum: RADIOLOGY_ORDER_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(RADIOLOGY_ORDER_STATUSES)
  status?: string;

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

  @ApiPropertyOptional({ example: '2026-06-10T11:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  reportCreatedAt?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  reportedById?: string;

  @ApiPropertyOptional({ example: '2026-06-10T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  reportVerifiedAt?: string;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  verifiedById?: string;

  @ApiPropertyOptional({ example: 'Patient did not arrive' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

export class RadiologyOrderResponseDto {
  @ApiProperty({ example: 'order-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo' })
  organizationId: string;

  @ApiProperty({ example: 'patient-cuid' })
  patientId: string;

  @ApiProperty({ example: 'consultation-cuid', nullable: true })
  consultationId: string | null;

  @ApiProperty({ example: 'user-cuid' })
  requestedById: string;

  @ApiProperty({ example: 'exam-cuid' })
  examId: string;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  orderDate: Date;

  @ApiProperty({ example: 'RAD1718000000000' })
  orderNumber: string;

  @ApiProperty({ example: 'Persistent cough', nullable: true })
  clinicalIndication: string | null;

  @ApiProperty({ example: 'Pneumonia', nullable: true })
  provisionalDiagnosis: string | null;

  @ApiProperty({ example: 'Fever for 5 days', nullable: true })
  relevantHistory: string | null;

  @ApiProperty({ example: 'routine' })
  urgency: string;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ example: '2026-06-10T10:00:00.000Z', nullable: true })
  scheduledDate: Date | null;

  @ApiProperty({ example: '2026-06-10T10:30:00.000Z', nullable: true })
  examPerformedAt: Date | null;

  @ApiProperty({ example: 'user-cuid', nullable: true })
  performedById: string | null;

  @ApiProperty({ example: '2026-06-10T11:00:00.000Z', nullable: true })
  reportCreatedAt: Date | null;

  @ApiProperty({ example: 'user-cuid', nullable: true })
  reportedById: string | null;

  @ApiProperty({ example: '2026-06-10T12:00:00.000Z', nullable: true })
  reportVerifiedAt: Date | null;

  @ApiProperty({ example: 'user-cuid', nullable: true })
  verifiedById: string | null;

  @ApiProperty({ example: 'Wheelchair patient', nullable: true })
  notes: string | null;

  @ApiProperty({ example: 'Patient did not arrive', nullable: true })
  cancellationReason: string | null;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'user-cuid', nullable: true })
  createdById: string | null;
}

export class RadiologyOrderListQueryDto extends OptionalPaginationDto {
  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'urgent' })
  @IsOptional()
  @IsString()
  urgency?: string;

  @ApiPropertyOptional({
    description: 'Restrict orders to one patient, for the mobile patient hub.',
    example: 'patient-cuid',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
