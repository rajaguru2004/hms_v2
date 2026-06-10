import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ConsultationQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter consultations by patient ID',
    example: 'cuid-patient-123',
  })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({
    description: 'Filter consultations by doctor ID',
    example: 'cuid-doctor-456',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'Filter consultations by date (YYYY-MM-DD)',
    example: '2026-06-10',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
