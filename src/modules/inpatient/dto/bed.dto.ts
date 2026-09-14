import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import {
  BED_STATUSES,
  BED_TYPES,
} from '../../../common/enums/clinical-status.enum';

export class CreateBedDto {
  @ApiProperty({ example: 'ward-cuid' })
  @IsString()
  @IsNotEmpty()
  wardId: string;

  @ApiProperty({ example: 'B-101' })
  @IsString()
  @IsNotEmpty()
  bedNumber: string;

  @ApiPropertyOptional({ example: 'standard', enum: BED_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(BED_TYPES)
  type?: string;

  @ApiPropertyOptional({
    example: 'available',
    default: 'available',
    enum: BED_STATUSES,
  })
  @IsString()
  @IsOptional()
  @IsIn(BED_STATUSES)
  status?: string;
}

export class UpdateBedDto {
  @ApiPropertyOptional({ example: 'ward-cuid' })
  @IsString()
  @IsOptional()
  wardId?: string;

  @ApiPropertyOptional({ example: 'B-101' })
  @IsString()
  @IsOptional()
  bedNumber?: string;

  @ApiPropertyOptional({ example: 'standard', enum: BED_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(BED_TYPES)
  type?: string;

  @ApiPropertyOptional({ example: 'occupied', enum: BED_STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(BED_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsString()
  @IsOptional()
  currentPatientId?: string;
}

export class BedResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  wardId: string;

  @ApiProperty()
  bedNumber: string;

  @ApiPropertyOptional()
  type: string | null;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  currentPatientId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
