import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceItemDto } from './invoice.dto';

export class BillingQueryDto {
  @ApiPropertyOptional({
    enum: ['invoices', 'services', 'payments', 'stats'],
    default: 'invoices',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'consultation' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'unpaid' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'invoice-cuid' })
  @IsOptional()
  @IsString()
  invoiceId?: string;
}

export class BillingPostCompatDto {
  @ApiPropertyOptional({
    enum: ['invoice', 'service', 'payment'],
    default: 'invoice',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  // BillingService fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCoveredByInsurance?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  insuranceCopayPercentage?: number;

  // Invoice fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiPropertyOptional({ type: [CreateInvoiceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discountPercentage?: number;

  // Payment fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobileMoneyProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chequeNumber?: string;

  // Shared fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BillingPatchCompatDto {
  @ApiProperty({ enum: ['invoice', 'service'] })
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiProperty({ example: 'record-cuid' })
  @IsString()
  @IsNotEmpty()
  id: string;

  // Updates properties (from Invoice & BillingService updates)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cancellationReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCoveredByInsurance?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  insuranceCopayPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
