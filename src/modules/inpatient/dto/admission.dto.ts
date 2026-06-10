import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateAdmissionDto {
  @ApiProperty({ example: 'patient-cuid' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'bed-cuid' })
  @IsString()
  @IsOptional()
  bedId?: string;

  @ApiPropertyOptional({ example: 'emergency' })
  @IsString()
  @IsOptional()
  admissionType?: string;

  @ApiPropertyOptional({ example: 'Severe pneumonia' })
  @IsString()
  @IsOptional()
  admissionReason?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsString()
  @IsOptional()
  admittingDoctorId?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsString()
  @IsOptional()
  attendingDoctorId?: string;
}

export class UpdateAdmissionDto {
  @ApiPropertyOptional({ example: 'patient-cuid' })
  @IsString()
  @IsOptional()
  patientId?: string;

  @ApiPropertyOptional({ example: 'bed-cuid' })
  @IsString()
  @IsOptional()
  bedId?: string;

  @ApiPropertyOptional({ example: 'emergency' })
  @IsString()
  @IsOptional()
  admissionType?: string;

  @ApiPropertyOptional({ example: 'Severe pneumonia' })
  @IsString()
  @IsOptional()
  admissionReason?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsString()
  @IsOptional()
  admittingDoctorId?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsString()
  @IsOptional()
  attendingDoctorId?: string;

  @ApiPropertyOptional({ example: 'discharged' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dischargeDate?: string;

  @ApiPropertyOptional({ example: 'Fully recovered' })
  @IsString()
  @IsOptional()
  dischargeReason?: string;

  @ApiPropertyOptional({ example: 'Discharged after complete recovery.' })
  @IsString()
  @IsOptional()
  dischargeSummary?: string;

  @ApiPropertyOptional({ example: 'doc-cuid' })
  @IsString()
  @IsOptional()
  dischargeDoctorId?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  followUpDate?: string;

  @ApiPropertyOptional({ example: 'Return in 1 week' })
  @IsString()
  @IsOptional()
  followUpNotes?: string;
}

export class AdmissionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  bedId: string | null;

  @ApiProperty()
  admissionDate: Date;

  @ApiPropertyOptional()
  admissionType: string | null;

  @ApiPropertyOptional()
  admissionReason: string | null;

  @ApiPropertyOptional()
  admittingDoctorId: string | null;

  @ApiPropertyOptional()
  attendingDoctorId: string | null;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  dischargeDate: Date | null;

  @ApiPropertyOptional()
  dischargeReason: string | null;

  @ApiPropertyOptional()
  dischargeSummary: string | null;

  @ApiPropertyOptional()
  dischargeDoctorId: string | null;

  @ApiPropertyOptional()
  followUpDate: Date | null;

  @ApiPropertyOptional()
  followUpNotes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
