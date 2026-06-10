import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  IsNotEmpty,
} from 'class-validator';

export class CreateBillingServiceDto {
  @ApiProperty({ example: 'General Consultation' })
  @IsString()
  @IsNotEmpty()
  serviceName: string;

  @ApiPropertyOptional({ example: 'SRV-001' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ example: 'consultation' })
  @IsOptional()
  @IsString()
  serviceCategory?: string;

  @ApiPropertyOptional({ example: 'Outpatient' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ default: false, example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ default: 0, example: 15.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxPercentage?: number;

  @ApiPropertyOptional({ default: true, example: true })
  @IsOptional()
  @IsBoolean()
  isCoveredByInsurance?: boolean;

  @ApiPropertyOptional({ example: 20.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceCopayPercentage?: number;

  @ApiPropertyOptional({ example: 'Standard outpatient consultation fee' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateBillingServiceDto {
  @ApiPropertyOptional({ example: 'General Consultation' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  serviceName?: string;

  @ApiPropertyOptional({ example: 'SRV-001' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ example: 'consultation' })
  @IsOptional()
  @IsString()
  serviceCategory?: string;

  @ApiPropertyOptional({ example: 'Outpatient' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 250.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 15.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxPercentage?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isCoveredByInsurance?: boolean;

  @ApiPropertyOptional({ example: 20.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceCopayPercentage?: number;

  @ApiPropertyOptional({ example: 'Standard outpatient consultation fee' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
