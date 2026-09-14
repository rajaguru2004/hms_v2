import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../../../common/enums/clinical-status.enum';
import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsNotEmpty,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PharmacySaleItemDto {
  @ApiProperty({ example: 'drug-id' })
  @IsString()
  @IsNotEmpty()
  drugId: string;

  @ApiPropertyOptional({ example: 'batch-id' })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiProperty({ example: 'Paracetamol' })
  @IsString()
  @IsNotEmpty()
  drugName: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 5.5 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ example: 11.0 })
  @IsNumber()
  @Min(0)
  total: number;
}

export class CreatePharmacySaleDto {
  @ApiPropertyOptional({ example: 'patient-id' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'prescription-id' })
  @IsOptional()
  @IsString()
  prescriptionId?: string;

  @ApiProperty({ type: [PharmacySaleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PharmacySaleItemDto)
  items: PharmacySaleItemDto[];

  @ApiPropertyOptional({ example: 'cash', enum: PAYMENT_METHODS })
  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'paid', enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: string;
}

export class PharmacySaleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiPropertyOptional()
  patientId?: string;

  @ApiPropertyOptional()
  prescriptionId?: string;

  @ApiPropertyOptional()
  servedById?: string;

  @ApiProperty()
  saleDate: Date;

  @ApiPropertyOptional()
  saleType?: string;

  @ApiProperty({ description: 'JSON stringified items' })
  items: string;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  taxAmount: number;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  paymentStatus: string;

  @ApiPropertyOptional()
  paymentMethod?: string;

  @ApiProperty()
  amountPaid: number;

  @ApiPropertyOptional()
  amountDue?: number;

  @ApiProperty()
  receiptNumber: string;

  @ApiProperty()
  createdAt: Date;
}
