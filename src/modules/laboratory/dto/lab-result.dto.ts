import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsIn,
} from 'class-validator';
import { LAB_RESULT_FLAGS } from '../../../common/enums/clinical-status.enum';

export class CreateLabResultDto {
  @ApiProperty({ example: 'order-cuid' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ example: 'test-cuid' })
  @IsString()
  @IsNotEmpty()
  testId: string;

  @ApiProperty({ example: '13.5' })
  @IsString()
  @IsNotEmpty()
  resultValue: string;

  @ApiPropertyOptional({ example: 'g/dL' })
  @IsOptional()
  @IsString()
  resultUnit?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isAbnormal?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @ApiPropertyOptional({ example: 'N', enum: LAB_RESULT_FLAGS })
  @IsOptional()
  @IsString()
  @IsIn(LAB_RESULT_FLAGS)
  flag?: string;

  @ApiPropertyOptional({ example: 'Normal CBC result' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateLabResultDto {
  @ApiPropertyOptional({ example: '14.0' })
  @IsOptional()
  @IsString()
  resultValue?: string;

  @ApiPropertyOptional({ example: 'g/dL' })
  @IsOptional()
  @IsString()
  resultUnit?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isAbnormal?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @ApiPropertyOptional({ example: 'N', enum: LAB_RESULT_FLAGS })
  @IsOptional()
  @IsString()
  @IsIn(LAB_RESULT_FLAGS)
  flag?: string;

  @ApiPropertyOptional({ example: 'Normal CBC result' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ example: '2024-01-01T10:00:00.000Z' })
  @IsOptional()
  verifiedAt?: Date;

  @ApiPropertyOptional({ example: 'user-cuid' })
  @IsOptional()
  @IsString()
  verifiedById?: string;
}

export class LabResultResponseDto {
  @ApiProperty({ example: 'result-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo' })
  organizationId: string | null;

  @ApiProperty({ example: 'order-cuid' })
  orderId: string;

  @ApiProperty({ example: 'test-cuid' })
  testId: string;

  @ApiProperty({ example: '13.5' })
  resultValue: string;

  @ApiProperty({ example: 'g/dL' })
  resultUnit: string | null;

  @ApiProperty({ example: false })
  isAbnormal: boolean;

  @ApiProperty({ example: false })
  isCritical: boolean;

  @ApiProperty({ example: 'N' })
  flag: string | null;

  @ApiProperty({ example: 12.0 })
  referenceRangeMin: number | null;

  @ApiProperty({ example: 16.0 })
  referenceRangeMax: number | null;

  @ApiProperty({ example: '12.0 - 16.0' })
  referenceRangeText: string | null;

  @ApiProperty({ example: 'level-1' })
  qcLevel: string | null;

  @ApiProperty({ example: true })
  qcPassed: boolean | null;

  @ApiProperty({ example: 'Analyzer-X' })
  methodUsed: string | null;

  @ApiProperty({ example: 'Beckman' })
  instrumentUsed: string | null;

  @ApiProperty({ example: 'enteredById' })
  enteredById: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  enteredAt: Date;

  @ApiProperty({ example: 'verifiedById' })
  verifiedById: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  verifiedAt: Date | null;

  @ApiProperty({ example: 'comment' })
  comment: string | null;

  @ApiProperty({ example: 'technicianNotes' })
  technicianNotes: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;
}
