import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  mrn: string;

  @ApiPropertyOptional()
  externalId?: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  middleName?: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  dateOfBirth: Date;

  @ApiProperty()
  gender: string;

  @ApiPropertyOptional()
  bloodGroup?: string;

  @ApiPropertyOptional()
  phonePrimary?: string;

  @ApiPropertyOptional()
  phoneSecondary?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  region?: string;

  @ApiPropertyOptional()
  zone?: string;

  @ApiPropertyOptional()
  woreda?: string;

  @ApiPropertyOptional()
  kebele?: string;

  @ApiPropertyOptional()
  houseNumber?: string;

  @ApiPropertyOptional()
  addressDescription?: string;

  @ApiPropertyOptional()
  emergencyContactName?: string;

  @ApiPropertyOptional()
  emergencyContactPhone?: string;

  @ApiPropertyOptional()
  emergencyContactRelationship?: string;

  @ApiPropertyOptional({ type: [String] })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String] })
  chronicConditions?: string[];

  @ApiPropertyOptional({ type: [String] })
  currentMedications?: string[];

  @ApiProperty()
  hasInsurance: boolean;

  @ApiPropertyOptional()
  insuranceProvider?: string;

  @ApiPropertyOptional()
  insuranceId?: string;

  @ApiPropertyOptional()
  insuranceExpiryDate?: Date;

  @ApiPropertyOptional()
  insuranceCoverageDetails?: string;

  @ApiPropertyOptional()
  photoUrl?: string;

  @ApiPropertyOptional()
  maritalStatus?: string;

  @ApiPropertyOptional()
  occupation?: string;

  @ApiPropertyOptional()
  educationLevel?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  isVip: boolean;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  createdById?: string;

  @ApiPropertyOptional()
  updatedById?: string;
}
