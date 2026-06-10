import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreatePreTriageDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @ApiPropertyOptional({ example: 'male' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ example: '+251911123456' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Fever and cough' })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({ example: 'Symptoms started 3 days ago.' })
  @IsOptional()
  @IsString()
  briefHistory?: string;

  @ApiPropertyOptional({ example: 38.5 })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  bloodPressureSystolic?: number;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsInt()
  bloodPressureDiastolic?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsInt()
  pulseRate?: number;

  @ApiPropertyOptional({ example: 'adult_triage' })
  @IsOptional()
  @IsString()
  routedTo?: string;
}
