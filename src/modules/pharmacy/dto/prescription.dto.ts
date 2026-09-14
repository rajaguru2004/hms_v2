import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { OptionalPaginationDto } from '../../../common/dto/optional-pagination.dto';
import { PRESCRIPTION_STATUSES } from '../../../common/enums/clinical-status.enum';

export class PrescriptionItemDto {
  @ApiProperty({ example: 'drug-id' })
  @IsString()
  @IsNotEmpty()
  drugId: string;

  @ApiProperty({ example: 'Paracetamol' })
  @IsString()
  @IsNotEmpty()
  drugName: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ example: '3 times daily' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ example: '5 days' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ example: 'Take after meals' })
  @IsOptional()
  @IsString()
  instructions?: string;
}

export class CreatePrescriptionDto {
  @ApiProperty({ example: 'patient-id' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ example: 'doctor-id' })
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  @ApiPropertyOptional({ example: 'consultation-id' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];

  @ApiPropertyOptional({ example: 'Take with warm water' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePrescriptionDto {
  @ApiPropertyOptional({ example: 'pending', enum: PRESCRIPTION_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(PRESCRIPTION_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [PrescriptionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items?: PrescriptionItemDto[];
}

export class PrescriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  consultationId?: string;

  @ApiProperty()
  doctorId: string;

  @ApiProperty()
  prescriptionDate: Date;

  @ApiProperty({ description: 'JSON stringified items' })
  items: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  dispensedById?: string;

  @ApiPropertyOptional()
  dispensedAt?: Date;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  isRefill: boolean;

  @ApiProperty()
  refillsAllowed: number;

  @ApiPropertyOptional()
  refillsRemaining?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PrescriptionListQueryDto extends OptionalPaginationDto {
  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description:
      'Restrict prescriptions to one patient, for the mobile patient hub.',
    example: 'patient-cuid',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
