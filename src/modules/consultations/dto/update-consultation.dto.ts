import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsDateString,
} from 'class-validator';

export class UpdateConsultationDto {
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
}
