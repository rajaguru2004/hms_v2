import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
} from 'class-validator';
import { OptionalPaginationDto } from '../../../common/dto/optional-pagination.dto';
import {
  ADMISSION_STATUSES,
  ADMISSION_TYPES,
} from '../../../common/enums/clinical-status.enum';

export class CreateAdmissionDto {
  @ApiProperty({ example: 'patient-cuid' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ example: 'bed-cuid' })
  @IsString()
  @IsOptional()
  bedId?: string;

  @ApiPropertyOptional({ example: 'emergency', enum: ADMISSION_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(ADMISSION_TYPES)
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

  @ApiPropertyOptional({ example: 'emergency', enum: ADMISSION_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(ADMISSION_TYPES)
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

  @ApiPropertyOptional({ example: 'discharged', enum: ADMISSION_STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(ADMISSION_STATUSES)
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

export class AdmissionListQueryDto extends OptionalPaginationDto {
  @ApiPropertyOptional({
    description:
      'Filter by admission status. "all" is accepted as "no filter".',
    example: 'admitted',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
