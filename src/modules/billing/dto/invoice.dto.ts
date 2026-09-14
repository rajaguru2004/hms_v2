import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OptionalPaginationDto } from '../../../common/dto/optional-pagination.dto';
import {
  INVOICE_PAYMENT_STATUSES,
  INVOICE_STATUSES,
} from '../../../common/enums/clinical-status.enum';

export class CreateInvoiceItemDto {
  @ApiProperty({ example: 'service' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: 'srv-cuid' })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiProperty({ example: 'Consultation Fee' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ default: 0, example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ default: 0, example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  @Min(0)
  total: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ example: 'patient-cuid' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'consultation-cuid' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiProperty({ type: [CreateInvoiceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @ApiPropertyOptional({ default: 0, example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ default: 0, example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercentage?: number;

  @ApiPropertyOptional({ example: 'Payment due on receipt.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsString()
  dueDate?: string;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ example: 'sent', enum: INVOICE_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(INVOICE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'paid', enum: INVOICE_PAYMENT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(INVOICE_PAYMENT_STATUSES)
  paymentStatus?: string;

  @ApiPropertyOptional({ example: 'Patient requested bill revision.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Insurance claims pending approval.' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

export class InvoiceListQueryDto extends OptionalPaginationDto {
  @ApiPropertyOptional({ example: 'draft' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;
}
