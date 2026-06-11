import { ApiProperty } from '@nestjs/swagger';

export class DashboardStatsDto {
  @ApiProperty({
    description: 'Total active patients in the system',
    example: 1250,
  })
  totalPatients!: number;

  @ApiProperty({ description: 'Appointments scheduled for today', example: 45 })
  todayAppointments!: number;

  @ApiProperty({ description: 'Lab orders awaiting completion', example: 12 })
  pendingLabOrders!: number;

  @ApiProperty({ description: 'Prescriptions awaiting dispensing', example: 8 })
  pendingPrescriptions!: number;

  @ApiProperty({
    description: 'Total revenue collected today in ETB',
    example: 125000,
  })
  todayRevenue!: number;

  @ApiProperty({ description: 'Currently occupied beds count', example: 85 })
  occupiedBeds!: number;

  @ApiProperty({
    description: 'Available beds for admission count',
    example: 15,
  })
  availableBeds!: number;

  @ApiProperty({
    description: 'Patients currently waiting in queue',
    example: 23,
  })
  queueWaiting!: number;

  @ApiProperty({
    description: 'Unverified critical lab results alert count',
    example: 2,
  })
  criticalAlerts!: number;
}

export class DashboardRecentPatientDto {
  @ApiProperty({ example: 'clx123...' })
  id!: string;

  @ApiProperty({ example: 'MRN202501150001' })
  mrn!: string;

  @ApiProperty({ example: 'Abebe' })
  firstName!: string;

  @ApiProperty({ example: 'Kebede' })
  lastName!: string;

  @ApiProperty({ example: 'male' })
  gender!: string;

  @ApiProperty({ example: '1990-05-15T00:00:00.000Z' })
  dateOfBirth!: Date;

  @ApiProperty({ example: '2025-01-15T10:00:00.000Z' })
  createdAt!: Date;
}

export class DashboardUpcomingAppointmentPatientDto {
  @ApiProperty({ example: 'clx123...' })
  id!: string;

  @ApiProperty({ example: 'MRN202501150001' })
  mrn!: string;

  @ApiProperty({ example: 'Abebe' })
  firstName!: string;

  @ApiProperty({ example: 'Kebede' })
  lastName!: string;
}

export class DashboardUpcomingAppointmentDto {
  @ApiProperty({ example: 'clx456...' })
  id!: string;

  @ApiProperty({ example: '2025-01-15T00:00:00.000Z' })
  appointmentDate!: Date;

  @ApiProperty({ example: '10:30' })
  appointmentTime!: string;

  @ApiProperty({ example: 'confirmed' })
  status!: string;

  @ApiProperty({ type: DashboardUpcomingAppointmentPatientDto })
  patient!: DashboardUpcomingAppointmentPatientDto;
}

export class DashboardResponseDto {
  @ApiProperty({ type: DashboardStatsDto })
  stats!: DashboardStatsDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { scheduled: 20, confirmed: 15, completed: 8, cancelled: 2 },
  })
  appointmentStatuses!: Record<string, number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { opd: 15, emergency: 5, mch: 3 },
  })
  queueByService!: Record<string, number>;

  @ApiProperty({ type: [DashboardRecentPatientDto] })
  recentPatients!: DashboardRecentPatientDto[];

  @ApiProperty({ type: [DashboardUpcomingAppointmentDto] })
  upcomingAppointments!: DashboardUpcomingAppointmentDto[];
}
