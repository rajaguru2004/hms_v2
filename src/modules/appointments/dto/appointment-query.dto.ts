import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AppointmentQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Target date to filter appointments (YYYY-MM-DD)',
    example: '2026-06-10',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Filter by appointment status',
    example: 'scheduled',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by doctor ID',
    example: 'cuid-doctor-123',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by patient ID',
    example: 'cuid-patient-456',
  })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({
    description:
      "Case-insensitive match across the patient's first name, last name and MRN.",
    example: 'abebe',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
