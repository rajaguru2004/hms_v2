import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  IsIn,
} from 'class-validator';

export class UpdateAppointmentDto {
  @ApiPropertyOptional({
    example: 'cuid-doctor-456',
    description: 'ID of the doctor user',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({
    example: '2026-06-11',
    description: 'Rescheduled date',
  })
  @IsOptional()
  @IsDateString()
  appointmentDate?: string;

  @ApiPropertyOptional({
    example: '10:00',
    description: 'Rescheduled time (HH:mm)',
  })
  @IsOptional()
  @IsString()
  appointmentTime?: string;

  @ApiPropertyOptional({ example: 45, description: 'Duration in minutes' })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @ApiPropertyOptional({
    example: 'emergency',
    description: 'Type of appointment',
  })
  @IsOptional()
  @IsString()
  appointmentType?: string;

  @ApiPropertyOptional({
    example: 'Severe headache',
    description: 'Chief complaint',
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({
    example: 'Update patient room info.',
    description: 'Notes',
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

  @ApiPropertyOptional({
    enum: [
      'scheduled',
      'confirmed',
      'checked_in',
      'in_progress',
      'completed',
      'cancelled',
      'no_show',
      'rescheduled',
    ],
    example: 'checked_in',
    description: 'Status of the appointment',
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'scheduled',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
  ])
  status?: string;

  @ApiPropertyOptional({
    example: 'Patient canceled due to personal reasons.',
    description: 'Cancellation reason',
  })
  @IsOptional()
  @IsString()
  cancellationReason?: string;

  @ApiPropertyOptional({
    example: 'Completed prescription details.',
    description: 'Consultation notes',
  })
  @IsOptional()
  @IsString()
  consultationNotes?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the reminder has been sent',
  })
  @IsOptional()
  @IsBoolean()
  reminderSent?: boolean;
}
