import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueuePreTriageSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  chiefComplaint?: string | null;

  @ApiPropertyOptional()
  briefHistory?: string | null;

  @ApiPropertyOptional()
  temperature?: number | null;

  @ApiPropertyOptional()
  bloodPressureSystolic?: number | null;

  @ApiPropertyOptional()
  bloodPressureDiastolic?: number | null;

  @ApiPropertyOptional()
  pulseRate?: number | null;
}

export class QueuePatientSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  mrn!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiPropertyOptional()
  phonePrimary?: string | null;

  @ApiPropertyOptional()
  gender?: string | null;

  @ApiPropertyOptional({ type: QueuePreTriageSummaryDto })
  preTriage?: QueuePreTriageSummaryDto | null;
}

export class QueueResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiPropertyOptional()
  patientId?: string | null;

  @ApiProperty()
  serviceArea!: string;

  @ApiPropertyOptional()
  serviceType?: string | null;

  @ApiProperty()
  queueNumber!: string;

  @ApiProperty()
  priority!: string;

  @ApiPropertyOptional()
  assignedToId?: string | null;

  @ApiPropertyOptional()
  assignedRoom?: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  joinedQueueAt!: Date;

  @ApiPropertyOptional()
  calledAt?: Date | null;

  @ApiPropertyOptional()
  serviceStartedAt?: Date | null;

  @ApiPropertyOptional()
  serviceCompletedAt?: Date | null;

  @ApiPropertyOptional()
  estimatedWaitMinutes?: number | null;

  @ApiPropertyOptional()
  displayMessage?: string | null;

  @ApiProperty()
  waitTime!: number;

  @ApiPropertyOptional({ type: QueuePatientSummaryDto })
  patient?: QueuePatientSummaryDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class QueuePaginationMeta {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  lastPage!: number;

  @ApiProperty()
  currentPage!: number;

  @ApiProperty()
  perPage!: number;

  @ApiPropertyOptional({ nullable: true })
  prev!: number | null;

  @ApiPropertyOptional({ nullable: true })
  next!: number | null;
}

export class PaginatedQueueResponseDto {
  @ApiProperty({ type: [QueueResponseDto] })
  data!: QueueResponseDto[];

  @ApiProperty({ type: QueuePaginationMeta })
  meta!: QueuePaginationMeta;
}
