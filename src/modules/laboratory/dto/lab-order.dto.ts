import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  LAB_ORDER_PRIORITIES,
  LAB_ORDER_STATUSES,
} from '../../../common/enums/clinical-status.enum';

export class OrderTestItemDto {
  @ApiProperty({ example: 'test-id' })
  @IsString()
  @IsNotEmpty()
  testId: string;

  @ApiProperty({ example: 'Complete Blood Count' })
  @IsString()
  @IsNotEmpty()
  testName: string;

  @ApiPropertyOptional({ example: 'routine' })
  @IsOptional()
  @IsString()
  urgency?: string;
}

export class CreateLabOrderDto {
  @ApiProperty({ example: 'patient-cuid' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'consultation-cuid' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiProperty({ type: [OrderTestItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderTestItemDto)
  tests: OrderTestItemDto[];

  @ApiPropertyOptional({ example: 'Suspected Anemia' })
  @IsOptional()
  @IsString()
  clinicalIndication?: string;

  @ApiPropertyOptional({ example: 'Anemia' })
  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @ApiPropertyOptional({
    example: 'routine',
    default: 'routine',
    enum: LAB_ORDER_PRIORITIES,
  })
  @IsOptional()
  @IsString()
  @IsIn(LAB_ORDER_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ example: 'Patient has history of fatigue' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLabOrderDto {
  @ApiPropertyOptional({
    example: 'sample_collected',
    enum: LAB_ORDER_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(LAB_ORDER_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'urgent', enum: LAB_ORDER_PRIORITIES })
  @IsOptional()
  @IsString()
  @IsIn(LAB_ORDER_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ example: '2024-01-01T10:00:00.000Z' })
  @IsOptional()
  sampleCollectedAt?: Date;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  sampleCollectedById?: string;

  @ApiPropertyOptional({ example: 'ACC-123456' })
  @IsOptional()
  @IsString()
  accessionNumber?: string;

  @ApiPropertyOptional({ example: 'Patient has history of fatigue' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Hemolyzed sample' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class LabOrderResponseDto {
  @ApiProperty({ example: 'order-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo' })
  organizationId: string;

  @ApiProperty({ example: 'patient-cuid' })
  patientId: string;

  @ApiProperty({ example: 'consultation-cuid' })
  consultationId: string | null;

  @ApiProperty({ example: 'user-admin' })
  requestedById: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  orderDate: Date;

  @ApiProperty({ example: 'LAB123456789' })
  orderNumber: string;

  @ApiProperty({ example: '[{"testId":"id","testName":"name"}]' })
  tests: string;

  @ApiProperty({ example: 'clinicalIndication' })
  clinicalIndication: string | null;

  @ApiProperty({ example: 'provisionalDiagnosis' })
  provisionalDiagnosis: string | null;

  @ApiProperty({ example: 'routine' })
  priority: string;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  sampleCollectedAt: Date | null;

  @ApiProperty({ example: 'sampleCollectedById' })
  sampleCollectedById: string | null;

  @ApiProperty({ example: 'accessionNumber' })
  accessionNumber: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  resultsEnteredAt: Date | null;

  @ApiProperty({ example: 'resultsEnteredById' })
  resultsEnteredById: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  resultsVerifiedAt: Date | null;

  @ApiProperty({ example: 'resultsVerifiedById' })
  resultsVerifiedById: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  resultsReportedAt: Date | null;

  @ApiProperty({ example: 'notes' })
  notes: string | null;

  @ApiProperty({ example: 'rejectionReason' })
  rejectionReason: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'user-admin' })
  createdById: string | null;
}
