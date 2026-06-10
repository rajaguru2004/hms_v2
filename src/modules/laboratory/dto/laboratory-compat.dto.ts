import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  Min,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LaboratoryQueryDto {
  @ApiPropertyOptional({
    enum: ['tests', 'orders', 'results', 'stats'],
    default: 'tests',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'hematology' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'routine' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ example: 'order-id' })
  @IsOptional()
  @IsString()
  orderId?: string;
}

export class OrderTestCompatItemDto {
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

export class LaboratoryPostCompatDto {
  @ApiPropertyOptional({
    enum: ['test', 'order', 'result'],
    default: 'test',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  // Test fields
  @ApiPropertyOptional({ example: 'Complete Blood Count' })
  @IsOptional()
  @IsString()
  testName?: string;

  @ApiPropertyOptional({ example: 'CBC' })
  @IsOptional()
  @IsString()
  testCode?: string;

  @ApiPropertyOptional({ example: 'hematology' })
  @IsOptional()
  @IsString()
  testCategory?: string;

  @ApiPropertyOptional({ example: 'quantitative' })
  @IsOptional()
  @IsString()
  testType?: string;

  @ApiPropertyOptional({ example: 'blood' })
  @IsOptional()
  @IsString()
  specimenType?: string;

  @ApiPropertyOptional({ example: '2ml' })
  @IsOptional()
  @IsString()
  specimenVolume?: string;

  @ApiPropertyOptional({ example: 'EDTA Tube' })
  @IsOptional()
  @IsString()
  specimenContainer?: string;

  @ApiPropertyOptional({ example: 'numeric' })
  @IsOptional()
  @IsString()
  resultType?: string;

  @ApiPropertyOptional({ example: 'g/dL' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: '12-16' })
  @IsOptional()
  @IsString()
  referenceRanges?: string;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  turnaroundTime?: number;

  @ApiPropertyOptional({ example: 'Hematology Lab' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 'Fasting' })
  @IsOptional()
  @IsString()
  preparationInstructions?: string;

  @ApiPropertyOptional({ example: 'Anemia screen' })
  @IsOptional()
  @IsString()
  clinicalSignificance?: string;

  // Order fields
  @ApiPropertyOptional({ example: 'patient-id' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'consultation-id' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiPropertyOptional({ type: [OrderTestCompatItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderTestCompatItemDto)
  tests?: OrderTestCompatItemDto[];

  @ApiPropertyOptional({ example: 'Suspected Anemia' })
  @IsOptional()
  @IsString()
  clinicalIndication?: string;

  @ApiPropertyOptional({ example: 'Anemia' })
  @IsOptional()
  @IsString()
  provisionalDiagnosis?: string;

  @ApiPropertyOptional({ example: 'routine' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ example: 'Some order notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Result fields
  @ApiPropertyOptional({ example: 'order-id' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 'test-id' })
  @IsOptional()
  @IsString()
  testId?: string;

  @ApiPropertyOptional({ example: '13.5' })
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

  @ApiPropertyOptional({ example: 'N' })
  @IsOptional()
  @IsString()
  flag?: string;

  @ApiPropertyOptional({ example: 'Normal CBC result' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class LaboratoryPatchCompatDto {
  @ApiProperty({ enum: ['test', 'order', 'result'] })
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiProperty({ example: 'record-id' })
  @IsString()
  @IsNotEmpty()
  id: string;

  // Flattened update fields
  @ApiPropertyOptional({ example: 'completed' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'routine' })
  @IsOptional()
  @IsString()
  priority?: string;

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

  @ApiPropertyOptional({ example: 'N' })
  @IsOptional()
  @IsString()
  flag?: string;

  @ApiPropertyOptional({ example: 'Normal CBC result' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ example: 'Some order notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Complete Blood Count' })
  @IsOptional()
  @IsString()
  testName?: string;

  @ApiPropertyOptional({ example: 160 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  verifiedAt?: string;
}
