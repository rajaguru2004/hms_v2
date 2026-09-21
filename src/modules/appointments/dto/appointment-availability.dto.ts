import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString } from 'class-validator';

/**
 * Which clinician, and which day.
 *
 * Both required. A day with no clinician would be every appointment the
 * hospital holds that morning, which is the listing route with the scoping
 * taken off — and this one is readable by a patient.
 */
export class AppointmentAvailabilityQueryDto {
  @ApiProperty({
    example: 'cuid-doctor-456',
    description: 'The clinician whose day is being asked about',
  })
  @IsString()
  doctorId: string;

  @ApiProperty({
    example: '2026-06-10',
    description: 'The day, as YYYY-MM-DD',
  })
  @IsDateString()
  date: string;
}

/** One slot that is already spoken for. */
export class TakenSlotDto {
  @ApiProperty({ example: '09:30' })
  appointmentTime: string;

  @ApiProperty({ example: 30 })
  durationMinutes: number;
}

/** What `GET /appointments/availability` answers with. */
export class AppointmentAvailabilityResponseDto {
  @ApiProperty({ example: 'cuid-doctor-456' })
  doctorId: string;

  @ApiProperty({ example: '2026-06-10' })
  date: string;

  @ApiProperty({ type: [TakenSlotDto] })
  taken: TakenSlotDto[];
}
