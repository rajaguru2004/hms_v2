import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';

export class CreateWardDto {
  @ApiProperty({ example: 'General Ward A' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'GWA' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 'general' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ example: 20, default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ example: 'dept-cuid' })
  @IsString()
  @IsOptional()
  departmentId?: string;
}

export class UpdateWardDto {
  @ApiPropertyOptional({ example: 'General Ward A' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'GWA' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 'general' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ example: 'dept-cuid' })
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class WardResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiPropertyOptional()
  departmentId: string | null;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  code: string | null;

  @ApiPropertyOptional()
  type: string | null;

  @ApiProperty()
  capacity: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ example: 5 })
  occupiedBeds?: number;

  @ApiPropertyOptional({ example: 15 })
  availableBeds?: number;

  @ApiPropertyOptional({ example: 25.0 })
  occupancyRate?: number;
}
