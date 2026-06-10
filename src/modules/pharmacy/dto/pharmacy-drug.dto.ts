import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  Min,
  IsBoolean,
} from 'class-validator';

export class CreatePharmacyDrugDto {
  @ApiProperty({ example: 'Paracetamol' })
  @IsString()
  @IsNotEmpty()
  drugName: string;

  @ApiPropertyOptional({ example: 'Acetaminophen' })
  @IsOptional()
  @IsString()
  genericName?: string;

  @ApiPropertyOptional({ example: 'Panadol' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ example: 'DRG001' })
  @IsOptional()
  @IsString()
  drugCode?: string;

  @ApiPropertyOptional({ example: 'analgesic' })
  @IsOptional()
  @IsString()
  drugCategory?: string;

  @ApiPropertyOptional({ example: 'tablet' })
  @IsOptional()
  @IsString()
  dosageForm?: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  strength?: string;

  @ApiPropertyOptional({ example: 100, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityInStock?: number;

  @ApiPropertyOptional({ example: 'tablet' })
  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({ example: 5.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @ApiPropertyOptional({ example: 3.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  requiresPrescription?: boolean;

  @ApiPropertyOptional({ example: 'Shelf A1' })
  @IsOptional()
  @IsString()
  storageLocation?: string;

  @ApiPropertyOptional({ example: 'Pain reliever' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdatePharmacyDrugDto {
  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsOptional()
  @IsString()
  drugName?: string;

  @ApiPropertyOptional({ example: 'Acetaminophen' })
  @IsOptional()
  @IsString()
  genericName?: string;

  @ApiPropertyOptional({ example: 'Panadol' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ example: 'DRG001' })
  @IsOptional()
  @IsString()
  drugCode?: string;

  @ApiPropertyOptional({ example: 'analgesic' })
  @IsOptional()
  @IsString()
  drugCategory?: string;

  @ApiPropertyOptional({ example: 'tablet' })
  @IsOptional()
  @IsString()
  dosageForm?: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  strength?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityInStock?: number;

  @ApiPropertyOptional({ example: 'tablet' })
  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({ example: 5.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @ApiPropertyOptional({ example: 3.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requiresPrescription?: boolean;

  @ApiPropertyOptional({ example: 'Shelf A1' })
  @IsOptional()
  @IsString()
  storageLocation?: string;

  @ApiPropertyOptional({ example: 'Pain reliever' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PharmacyDrugResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  drugName: string;

  @ApiPropertyOptional()
  genericName?: string;

  @ApiPropertyOptional()
  brandName?: string;

  @ApiPropertyOptional()
  drugCode?: string;

  @ApiPropertyOptional()
  drugCategory?: string;

  @ApiPropertyOptional()
  dosageForm?: string;

  @ApiPropertyOptional()
  strength?: string;

  @ApiProperty()
  quantityInStock: number;

  @ApiPropertyOptional()
  unitOfMeasure?: string;

  @ApiProperty()
  reorderLevel: number;

  @ApiPropertyOptional()
  sellingPrice?: number;

  @ApiPropertyOptional()
  costPrice?: number;

  @ApiProperty()
  requiresPrescription: boolean;

  @ApiPropertyOptional()
  storageLocation?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
