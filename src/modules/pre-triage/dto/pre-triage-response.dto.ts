import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScreenedByResponseDto {
  @ApiProperty()
  fullName: string;
}

export class PatientMinimalPreTriageResponseDto {
  @ApiProperty()
  mrn: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;
}

export class PreTriageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  screeningNumber: string;

  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  age?: number;

  @ApiPropertyOptional()
  gender?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  chiefComplaint?: string;

  @ApiPropertyOptional()
  briefHistory?: string;

  @ApiPropertyOptional()
  temperature?: number;

  @ApiPropertyOptional()
  bloodPressureSystolic?: number;

  @ApiPropertyOptional()
  bloodPressureDiastolic?: number;

  @ApiPropertyOptional()
  pulseRate?: number;

  @ApiPropertyOptional()
  routedTo?: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  patientId?: string;

  @ApiProperty()
  screenedAt: Date;

  @ApiPropertyOptional()
  screenedById?: string;

  @ApiPropertyOptional()
  routedAt?: Date;

  @ApiPropertyOptional()
  routedById?: string;

  @ApiProperty()
  isDeleted: boolean;

  @ApiPropertyOptional()
  deletedAt?: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: ScreenedByResponseDto })
  screenedBy?: ScreenedByResponseDto;

  @ApiPropertyOptional({ type: ScreenedByResponseDto })
  routedBy?: ScreenedByResponseDto;

  @ApiPropertyOptional({ type: PatientMinimalPreTriageResponseDto })
  patient?: PatientMinimalPreTriageResponseDto;
}
