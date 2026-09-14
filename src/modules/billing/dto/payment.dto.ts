import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OptionalPaginationDto } from '../../../common/dto/optional-pagination.dto';
import { PAYMENT_METHODS } from '../../../common/enums/clinical-status.enum';
import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 'invoice-cuid' })
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'cash' })
  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_METHODS)
  paymentMethod: string;

  @ApiPropertyOptional({ example: 'TXN-998877' })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional({ example: 'CBE Birr' })
  @IsOptional()
  @IsString()
  mobileMoneyProvider?: string;

  @ApiPropertyOptional({ example: 'Commercial Bank of Ethiopia' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: 'CHQ-112233' })
  @IsOptional()
  @IsString()
  chequeNumber?: string;

  @ApiPropertyOptional({ example: 'Payment received in full.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class PaymentListQueryDto extends OptionalPaginationDto {
  @ApiPropertyOptional({ example: 'invoice-cuid' })
  @IsOptional()
  @IsString()
  invoiceId?: string;
}
