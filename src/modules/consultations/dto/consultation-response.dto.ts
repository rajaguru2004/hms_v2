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

  @ApiPropertyOptional()
  middleName?: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional()
  phonePrimary?: string;

  @ApiPropertyOptional()
  gender?: string;

  @ApiPropertyOptional()
  dateOfBirth?: Date;

  @ApiPropertyOptional()
  bloodGroup?: string;
}

export class PrescriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  consultationId?: string;

  @ApiProperty()
  doctorId: string;

  @ApiProperty()
  prescriptionDate: Date;

  @ApiProperty()
  items: string; // JSON String

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  dispensedById?: string;

  @ApiPropertyOptional()
  dispensedAt?: Date;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  isRefill: boolean;

  @ApiProperty()
  refillsAllowed: number;

  @ApiPropertyOptional()
  refillsRemaining?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class LabResultResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  resultValue: string;

  @ApiPropertyOptional()
  referenceRangeFlag?: string; // normal, high, low

  @ApiPropertyOptional()
  remarks?: string;

  @ApiPropertyOptional()
  test?: Record<string, any>;
}

export class LabOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ type: [LabResultResponseDto] })
  results?: LabResultResponseDto[];
}

export class RadiologyOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  exam?: Record<string, any>;

  @ApiPropertyOptional()
  report?: Record<string, any>;
}

export class ConsultationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  appointmentId?: string;

  @ApiProperty()
  doctorId: string;

  @ApiProperty()
  visitDate: Date;

  @ApiPropertyOptional()
  visitType?: string;

  // Vitals
  @ApiPropertyOptional()
  temperature?: number;

  @ApiPropertyOptional()
  bloodPressureSystolic?: number;

  @ApiPropertyOptional()
  bloodPressureDiastolic?: number;

  @ApiPropertyOptional()
  pulseRate?: number;

  @ApiPropertyOptional()
  respiratoryRate?: number;

  @ApiPropertyOptional()
  weight?: number;

  @ApiPropertyOptional()
  height?: number;

  @ApiPropertyOptional()
  oxygenSaturation?: number;

  // Clinical Notes
  @ApiPropertyOptional()
  chiefComplaint?: string;

  @ApiPropertyOptional()
  historyOfPresentIllness?: string;

  @ApiPropertyOptional()
  physicalExamination?: string;

  @ApiPropertyOptional()
  diagnosis?: string;

  @ApiPropertyOptional()
  icd10Codes?: string; // JSON String

  // Treatment Plan
  @ApiPropertyOptional()
  treatmentPlan?: string;

  @ApiPropertyOptional()
  followUpInstructions?: string;

  @ApiPropertyOptional()
  followUpDate?: Date;

  // Referrals
  @ApiPropertyOptional()
  referredTo?: string;

  @ApiPropertyOptional()
  referralReason?: string;

  // Additional
  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional()
  attachments?: string; // JSON String

  @ApiProperty()
  isDeleted: boolean;

  @ApiPropertyOptional()
  deletedAt?: Date;

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

  @ApiPropertyOptional({ type: [PrescriptionResponseDto] })
  prescriptions?: PrescriptionResponseDto[];

  @ApiPropertyOptional({ type: [LabOrderResponseDto] })
  labOrders?: LabOrderResponseDto[];

  @ApiPropertyOptional({ type: [RadiologyOrderResponseDto] })
  radiologyOrders?: RadiologyOrderResponseDto[];
}
