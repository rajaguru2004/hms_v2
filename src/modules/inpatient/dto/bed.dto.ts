import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateBedDto {
  @ApiProperty({ example: 'ward-cuid' })
  @IsString()
  @IsNotEmpty()
  wardId: string;

  @ApiProperty({ example: 'B-101' })
  @IsString()
  @IsNotEmpty()
  bedNumber: string;

  @ApiPropertyOptional({ example: 'standard' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ example: 'available', default: 'available' })
  @IsString()
  @IsOptional()
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

  @ApiPropertyOptional({ example: 'standard' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ example: 'occupied' })
  @IsString()
  @IsOptional()
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
