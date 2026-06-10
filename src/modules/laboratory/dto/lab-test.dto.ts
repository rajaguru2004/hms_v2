import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsBoolean,
  IsNotEmpty,
} from 'class-validator';

export class CreateLabTestDto {
  @ApiProperty({ example: 'Complete Blood Count' })
  @IsString()
  @IsNotEmpty()
  testName: string;

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

  @ApiPropertyOptional({ example: '{"male": {"min": 13.5, "max": 17.5}}' })
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
}

export class UpdateLabTestDto {
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

  @ApiPropertyOptional({ example: '{"male": {"min": 13.5, "max": 17.5}}' })
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

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LabTestResponseDto {
  @ApiProperty({ example: 'test-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo' })
  organizationId: string;

  @ApiProperty({ example: 'Complete Blood Count' })
  testName: string;

  @ApiProperty({ example: 'CBC' })
  testCode: string | null;

  @ApiProperty({ example: 'hematology' })
  testCategory: string | null;

  @ApiProperty({ example: 'quantitative' })
  testType: string | null;

  @ApiProperty({ example: 'blood' })
  specimenType: string | null;

  @ApiProperty({ example: '2ml' })
  specimenVolume: string | null;

  @ApiProperty({ example: 'EDTA Tube' })
  specimenContainer: string | null;

  @ApiProperty({ example: 'numeric' })
  resultType: string | null;

  @ApiProperty({ example: 'g/dL' })
  unit: string | null;

  @ApiProperty({ example: '{"male": {"min": 13.5, "max": 17.5}}' })
  referenceRanges: string | null;

  @ApiProperty({ example: 150 })
  price: number | null;

  @ApiProperty({ example: 24 })
  turnaroundTime: number | null;

  @ApiProperty({ example: 'Hematology Lab' })
  department: string | null;

  @ApiProperty({ example: 'Fasting' })
  preparationInstructions: string | null;

  @ApiProperty({ example: 'Anemia screen' })
  clinicalSignificance: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'user-admin' })
  createdById: string | null;
}
