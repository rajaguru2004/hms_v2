import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRadiologyExamDto {
  @ApiProperty({ example: 'Chest X-Ray PA View' })
  @IsString()
  @IsNotEmpty()
  examName: string;

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

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  contrastRequired?: boolean;

  @ApiPropertyOptional({ example: 'Plain radiograph of chest' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRadiologyExamDto extends PartialType(
  CreateRadiologyExamDto,
) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RadiologyExamResponseDto {
  @ApiProperty({ example: 'exam-cuid' })
  id: string;

  @ApiProperty({ example: 'org-demo' })
  organizationId: string;

  @ApiProperty({ example: 'Chest X-Ray PA View' })
  examName: string;

  @ApiProperty({ example: 'CXR-PA', nullable: true })
  examCode: string | null;

  @ApiProperty({ example: 'x-ray', nullable: true })
  examCategory: string | null;

  @ApiProperty({ example: 'Chest', nullable: true })
  bodyPart: string | null;

  @ApiProperty({ example: 'DR', nullable: true })
  modality: string | null;

  @ApiProperty({ example: 500, nullable: true })
  price: number | null;

  @ApiProperty({ example: 15, nullable: true })
  estimatedDuration: number | null;

  @ApiProperty({ example: 'Remove metal objects', nullable: true })
  preparationInstructions: string | null;

  @ApiProperty({ example: false })
  contrastRequired: boolean;

  @ApiProperty({ example: 'Plain radiograph', nullable: true })
  description: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-10T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'user-id', nullable: true })
  createdById: string | null;
}
