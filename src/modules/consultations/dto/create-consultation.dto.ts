import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePrescriptionItemDto {
  @ApiProperty({ example: 'cuid-drug-123', description: 'ID of the drug' })
  @IsString()
  drugId: string;

  @ApiProperty({
    example: 'Amoxicillin 500mg',
    description: 'Name of the drug',
  })
  @IsString()
  drugName: string;

  @ApiPropertyOptional({
    example: 'Amoxicillin',
    description: 'Generic name of the drug',
  })
  @IsOptional()
  @IsString()
  genericName?: string;

  @ApiProperty({ example: '500mg', description: 'Dosage details' })
  @IsString()
  dosage: string;

  @ApiProperty({
    example: 'Three times daily',
    description: 'Frequency description',
  })
  @IsString()
  frequency: string;

  @ApiProperty({ example: '7 days', description: 'Duration of treatment' })
  @IsString()
  duration: string;

  @ApiProperty({ example: 21, description: 'Total quantity to dispense' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    example: 'Take after meals',
    description: 'Special instructions',
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}

export class CreateConsultationDto {
  @ApiProperty({ example: 'cuid-patient-123', description: 'Patient ID' })
  @IsString()
  patientId: string;

  @ApiProperty({ example: 'cuid-doctor-456', description: 'Doctor ID' })
  @IsString()
  doctorId: string;

  @ApiPropertyOptional({
    example: 'cuid-appointment-789',
    description: 'Optional linked appointment ID',
  })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiPropertyOptional({
    example: 'outpatient',
    description: 'Type of visit (e.g., outpatient, emergency, follow_up)',
  })
  @IsOptional()
  @IsString()
  visitType?: string;

  // Vitals
  @ApiPropertyOptional({ example: 36.8, description: 'Temperature in Celsius' })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ example: 120, description: 'Systolic blood pressure' })
  @IsOptional()
  @IsNumber()
  bloodPressureSystolic?: number;

  @ApiPropertyOptional({ example: 80, description: 'Diastolic blood pressure' })
  @IsOptional()
  @IsNumber()
  bloodPressureDiastolic?: number;

  @ApiPropertyOptional({
    example: 72,
    description: 'Pulse rate (beats per minute)',
  })
  @IsOptional()
  @IsNumber()
  pulseRate?: number;

  @ApiPropertyOptional({
    example: 16,
    description: 'Respiratory rate (breaths per minute)',
  })
  @IsOptional()
  @IsNumber()
  respiratoryRate?: number;

  @ApiPropertyOptional({ example: 70.5, description: 'Weight in kg' })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ example: 175, description: 'Height in cm' })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiPropertyOptional({
    example: 98,
    description: 'Oxygen saturation percentage',
  })
  @IsOptional()
  @IsNumber()
  oxygenSaturation?: number;

  // Clinical Notes
  @ApiPropertyOptional({
    example: 'Persistent cough and fever for 3 days',
    description: 'Chief complaint',
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({
    example:
      'Patient reports cough started mild, grew severe, accompanied by chills.',
    description: 'History of present illness',
  })
  @IsOptional()
  @IsString()
  historyOfPresentIllness?: string;

  @ApiPropertyOptional({
    example: 'Chest clear on auscultation, throat congested.',
    description: 'Physical examination details',
  })
  @IsOptional()
  @IsString()
  physicalExamination?: string;

  @ApiPropertyOptional({
    example: 'Acute bronchitis',
    description: 'Diagnosis text',
  })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({
    example: ['J20.9'],
    description: 'List of ICD-10 codes',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  icd10Codes?: string[];

  // Treatment Plan
  @ApiPropertyOptional({
    example: 'Rest, hydrate, and take amoxicillin.',
    description: 'Treatment plan description',
  })
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @ApiPropertyOptional({
    example: 'Return if fever persists after 48 hours of antibiotic.',
    description: 'Follow-up instructions',
  })
  @IsOptional()
  @IsString()
  followUpInstructions?: string;

  @ApiPropertyOptional({
    example: '2026-06-17T00:00:00.000Z',
    description: 'Follow-up date',
  })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  // Referrals
  @ApiPropertyOptional({
    example: 'Pulmonologist',
    description: 'Referred to doctor or specialty',
  })
  @IsOptional()
  @IsString()
  referredTo?: string;

  @ApiPropertyOptional({
    example: 'For advanced lung function test.',
    description: 'Reason for referral',
  })
  @IsOptional()
  @IsString()
  referralReason?: string;

  // Additional
  @ApiPropertyOptional({
    example: 'Patient advised to stop smoking.',
    description: 'Additional clinical notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  // Prescription Items
  @ApiPropertyOptional({
    type: [CreatePrescriptionItemDto],
    description: 'Optional list of prescription items to create',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  prescriptionItems?: CreatePrescriptionItemDto[];
}
