import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRESCRIPTION_STATUSES,
} from '../../../common/enums/clinical-status.enum';
import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsNotEmpty,
  Min,
  IsBoolean,
  IsArray,
} from 'class-validator';

export class PharmacyQueryDto {
  @ApiPropertyOptional({
    enum: ['drugs', 'prescriptions', 'sales', 'stats'],
    default: 'drugs',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'antibiotic' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'Amoxicillin' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: '2026-06-10' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({
    description:
      'Restrict prescriptions to one patient, for the mobile patient hub.',
    example: 'patient-cuid',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class PharmacyPostCompatDto {
  @ApiPropertyOptional({
    enum: ['drug', 'prescription', 'sale'],
    default: 'drug',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  // Drug fields
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

  // Prescription fields
  @ApiPropertyOptional({ example: 'patient-id' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'doctor-id' })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({ example: 'consultation-id' })
  @IsOptional()
  @IsString()
  consultationId?: string;

  @ApiPropertyOptional({
    example: [
      {
        drugId: 'drug-id',
        drugName: 'Paracetamol',
        dosage: '500mg',
        frequency: '3 times daily',
        duration: '5 days',
        quantity: 15,
        instructions: 'After meals',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  items?: unknown[];

  @ApiPropertyOptional({ example: 'Take after food' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Sale fields
  @ApiPropertyOptional({ example: 'prescription-id' })
  @IsOptional()
  @IsString()
  prescriptionId?: string;

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

export class PharmacyPatchCompatDto {
  @ApiProperty({ enum: ['drug', 'prescription'] })
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiProperty({ example: 'record-id' })
  @IsString()
  @IsNotEmpty()
  id: string;

  // Update properties (flattened, updates everything that changes)
  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsOptional()
  @IsString()
  drugName?: string;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  quantityInStock?: number;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  sellingPrice?: number;

  @ApiPropertyOptional({
    example: 'fully_dispensed',
    enum: PRESCRIPTION_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(PRESCRIPTION_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Some prescription updates' })
  @IsOptional()
  @IsString()
  notes?: string;
}
