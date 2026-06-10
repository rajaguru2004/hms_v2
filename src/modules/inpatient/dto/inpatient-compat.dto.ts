import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  Min,
  IsBoolean,
} from 'class-validator';

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

  @ApiPropertyOptional({ example: 'available' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ example: 'emergency' })
  @IsOptional()
  @IsString()
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
  @ApiPropertyOptional({ example: 'discharged' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ example: 'emergency' })
  @IsOptional()
  @IsString()
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
