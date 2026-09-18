import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The nested shapes a consultation carries are prefixed `Consultation*`.
 *
 * Swagger keys `components.schemas` by class name alone, so the unprefixed
 * names collided with the full DTOs in laboratory/, pharmacy/ and radiology/ —
 * which are different schemas, not copies: what is embedded in a consultation
 * is the summary a clinician reads in context (a lab order is a number, a
 * status and its results), not the whole record. On a collision Swagger keeps
 * one definition and logs `Duplicate DTO detected`, so half the documented
 * shapes were the wrong ones, and the warning says it will be a hard error in
 * the next major.
 *
 * Only the OpenAPI schema names change. No response body does: class names
 * are never serialized.
 */

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

export class ConsultationPrescriptionResponseDto {
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

export class ConsultationLabResultResponseDto {
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

export class ConsultationLabOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ type: [ConsultationLabResultResponseDto] })
  results?: ConsultationLabResultResponseDto[];
}

export class ConsultationRadiologyOrderResponseDto {
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

  @ApiPropertyOptional({ type: [ConsultationPrescriptionResponseDto] })
  prescriptions?: ConsultationPrescriptionResponseDto[];

  @ApiPropertyOptional({ type: [ConsultationLabOrderResponseDto] })
  labOrders?: ConsultationLabOrderResponseDto[];

  @ApiPropertyOptional({ type: [ConsultationRadiologyOrderResponseDto] })
  radiologyOrders?: ConsultationRadiologyOrderResponseDto[];
}
