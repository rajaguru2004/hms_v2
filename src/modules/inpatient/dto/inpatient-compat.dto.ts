import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  Min,
  IsBoolean,
  IsIn,
} from 'class-validator';
import {
  ADMISSION_STATUSES,
  ADMISSION_TYPES,
  BED_STATUSES,
} from '../../../common/enums/clinical-status.enum';

/**
 * One flat `status` field serves two resources on this multiplexed route: a bed
 * on `resource: 'bed'` and an admission on `resource: 'admission'`. Narrowing it
 * to either vocabulary alone would reject every legitimate call to the other,
 * so the union is the tightest list this shape can carry. The per-resource DTOs
 * (`CreateBedDto`, `UpdateAdmissionDto`, ...) enforce the real vocabularies.
 */
const BED_OR_ADMISSION_STATUSES = [
  ...BED_STATUSES,
  ...ADMISSION_STATUSES,
] as const;

export class InpatientQueryDto {
  @ApiPropertyOptional({
    enum: ['wards', 'beds', 'admissions', 'stats'],
    default: 'wards',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ example: 'ward-cuid' })
  @IsOptional()
  @IsString()
  wardId?: string;

  @ApiPropertyOptional({ example: 'available' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class InpatientPostCompatDto {
  @ApiPropertyOptional({
    enum: ['ward', 'bed', 'admission'],
    default: 'ward',
  })
  @IsOptional()
  @IsString()
  resource?: string;

  // Ward fields
  @ApiPropertyOptional({ example: 'General Ward A' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'GWA' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'general' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: 'dept-cuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  // Bed fields
  @ApiPropertyOptional({ example: 'ward-cuid' })
  @IsOptional()
  @IsString()
  wardId?: string;

  @ApiPropertyOptional({ example: 'B-101' })
  @IsOptional()
  @IsString()
  bedNumber?: string;

  @ApiPropertyOptional({
    example: 'available',
    enum: BED_OR_ADMISSION_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(BED_OR_ADMISSION_STATUSES)
  status?: string;

  // Admission fields
  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'bed-cuid' })
  @IsOptional()
  @IsString()
  bedId?: string;

  @ApiPropertyOptional({ example: 'emergency', enum: ADMISSION_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(ADMISSION_TYPES)
  admissionType?: string;

  @ApiPropertyOptional({ example: 'Severe pneumonia' })
  @IsOptional()
  @IsString()
  admissionReason?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsOptional()
  @IsString()
  admittingDoctorId?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsOptional()
  @IsString()
  attendingDoctorId?: string;
}

export class InpatientPatchCompatDto {
  @ApiProperty({ enum: ['ward', 'bed', 'admission'] })
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiProperty({ example: 'record-cuid' })
  @IsString()
  @IsNotEmpty()
  id: string;

  // Admission & Bed & Ward updates (flat object payload)
  @ApiPropertyOptional({
    example: 'discharged',
    enum: BED_OR_ADMISSION_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(BED_OR_ADMISSION_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Fully recovered' })
  @IsOptional()
  @IsString()
  dischargeReason?: string;

  @ApiPropertyOptional({ example: 'Discharged after complete recovery.' })
  @IsOptional()
  @IsString()
  dischargeSummary?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsOptional()
  @IsString()
  dischargeDoctorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dischargeDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  followUpDate?: string;

  @ApiPropertyOptional({ example: 'Return in 1 week' })
  @IsOptional()
  @IsString()
  followUpNotes?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: 'bed-cuid' })
  @IsOptional()
  @IsString()
  bedId?: string;

  @ApiPropertyOptional({ example: 'emergency', enum: ADMISSION_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(ADMISSION_TYPES)
  admissionType?: string;

  @ApiPropertyOptional({ example: 'Severe pneumonia' })
  @IsOptional()
  @IsString()
  admissionReason?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsOptional()
  @IsString()
  admittingDoctorId?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsOptional()
  @IsString()
  attendingDoctorId?: string;

  // Bed & Ward updates
  @ApiPropertyOptional({ example: 'General Ward A' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'GWA' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'general' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: 'dept-cuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'ward-cuid' })
  @IsOptional()
  @IsString()
  wardId?: string;

  @ApiPropertyOptional({ example: 'B-101' })
  @IsOptional()
  @IsString()
  bedNumber?: string;

  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsOptional()
  @IsString()
  currentPatientId?: string;
}
