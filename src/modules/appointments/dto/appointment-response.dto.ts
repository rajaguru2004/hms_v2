import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorMinimalResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiPropertyOptional()
  specialization?: string;
}

export class PatientMinimalResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  mrn: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional()
  phonePrimary?: string;

  @ApiPropertyOptional()
  gender?: string;

  @ApiPropertyOptional()
  dateOfBirth?: Date;
}

export class AppointmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  doctorId?: string;

  @ApiProperty()
  appointmentDate: Date;

  @ApiProperty()
  appointmentTime: string;

  @ApiProperty()
  durationMinutes: number;

  @ApiPropertyOptional()
  appointmentType?: string;

  @ApiPropertyOptional()
  departmentId?: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  chiefComplaint?: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional()
  consultationNotes?: string;

  @ApiPropertyOptional()
  checkedInAt?: Date;

  @ApiPropertyOptional()
  checkedInById?: string;

  @ApiPropertyOptional()
  startedAt?: Date;

  @ApiPropertyOptional()
  completedAt?: Date;

  @ApiPropertyOptional()
  cancelledAt?: Date;

  @ApiPropertyOptional()
  cancelledById?: string;

  @ApiPropertyOptional()
  cancellationReason?: string;

  @ApiPropertyOptional()
  rescheduledFromId?: string;

  @ApiPropertyOptional()
  rescheduledToId?: string;

  @ApiProperty()
  reminderSent: boolean;

  @ApiPropertyOptional()
  reminderSentAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  createdById?: string;

  @ApiPropertyOptional({ type: PatientMinimalResponseDto })
  patient?: PatientMinimalResponseDto;

  @ApiPropertyOptional({ type: DoctorMinimalResponseDto })
  doctor?: DoctorMinimalResponseDto;
}
