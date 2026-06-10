import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty({
    example: 'cuid-patient-123',
    description: 'ID of the patient',
  })
  @IsString()
  patientId: string;

  @ApiPropertyOptional({
    example: 'cuid-doctor-456',
    description: 'ID of the doctor user',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({
    example: '2026-06-10',
    description: 'Date of the appointment',
  })
  @IsDateString()
  appointmentDate: string;

  @ApiProperty({
    example: '09:30',
    description: 'Time of the appointment (HH:mm)',
  })
  @IsString()
  appointmentTime: string;

  @ApiPropertyOptional({
    default: 30,
    example: 30,
    description: 'Duration of the appointment in minutes',
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationMinutes?: number = 30;

  @ApiPropertyOptional({
    example: 'follow_up',
    description: 'Type of appointment',
  })
  @IsOptional()
  @IsString()
  appointmentType?: string;

  @ApiPropertyOptional({
    example: 'Routine checkup for hypertension',
    description: 'Chief complaint',
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({
    example: 'Patient needs to bring blood work results.',
    description: 'General notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'cuid-department-789',
    description: 'ID of the department',
  })
  @IsOptional()
  @IsString()
  departmentId?: string;
}
