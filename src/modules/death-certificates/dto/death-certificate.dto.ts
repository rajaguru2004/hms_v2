import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum PlaceOfDeath {
  INPATIENT = 'inpatient',
  EMERGENCY = 'emergency',
  DOA = 'doa',
  HOME = 'home',
  OTHER = 'other',
}

export enum MannerOfDeath {
  NATURAL = 'natural',
  ACCIDENT = 'accident',
  SUICIDE = 'suicide',
  HOMICIDE = 'homicide',
  PENDING = 'pending',
  UNDETERMINED = 'undetermined',
}

export enum PregnancyRelated {
  PREGNANT = 'pregnant',
  WITHIN_42_DAYS = 'within_42_days',
  WITHIN_1_YEAR = 'within_1_year',
  NOT_RELATED = 'not_related',
}

export class DeathCertificateQueryDto {
  @ApiPropertyOptional({
    description: 'Search term for MRN, certificate number, or name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Place of death filter', default: 'all' })
  @IsOptional()
  @IsString()
  place?: string;

  @ApiPropertyOptional({
    description: 'Number of items to return',
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of items to skip', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateDeathCertificateDto {
  @ApiProperty({ description: 'Associated patient ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: 'Date of death in ISO or YYYY-MM-DD format' })
  @IsString()
  @IsNotEmpty()
  dateOfDeath: string;

  @ApiPropertyOptional({ description: 'Time of death (HH:mm)' })
  @IsOptional()
  @IsString()
  timeOfDeath?: string;

  @ApiProperty({ enum: PlaceOfDeath, description: 'Place of death' })
  @IsEnum(PlaceOfDeath)
  placeOfDeath: PlaceOfDeath;

  @ApiPropertyOptional({ description: 'Specific location details' })
  @IsOptional()
  @IsString()
  locationDetails?: string;

  @ApiPropertyOptional({ description: 'Age at death in years' })
  @IsOptional()
  @IsNumber()
  ageAtDeathYears?: number;

  @ApiPropertyOptional({ description: 'Age at death in months' })
  @IsOptional()
  @IsNumber()
  ageAtDeathMonths?: number;

  @ApiPropertyOptional({ description: 'Age at death in days' })
  @IsOptional()
  @IsNumber()
  ageAtDeathDays?: number;

  @ApiProperty({ description: 'Sex/Gender of patient at time of death' })
  @IsString()
  @IsNotEmpty()
  sex: string;

  @ApiPropertyOptional({ description: 'Marital status of patient' })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiPropertyOptional({ description: 'Occupation of patient' })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({ description: 'Residential address' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ description: 'Immediate cause of death' })
  @IsString()
  @IsNotEmpty()
  immediateCause: string;

  @ApiPropertyOptional({ description: 'Antecedent cause B' })
  @IsOptional()
  @IsString()
  antecedentCauseB?: string;

  @ApiPropertyOptional({ description: 'Antecedent cause C' })
  @IsOptional()
  @IsString()
  antecedentCauseC?: string;

  @ApiPropertyOptional({ description: 'Antecedent cause D' })
  @IsOptional()
  @IsString()
  antecedentCauseD?: string;

  @ApiPropertyOptional({ description: 'Other significant conditions' })
  @IsOptional()
  @IsString()
  otherConditions?: string;

  @ApiProperty({ enum: MannerOfDeath, description: 'Manner of death' })
  @IsEnum(MannerOfDeath)
  mannerOfDeath: MannerOfDeath;

  @ApiPropertyOptional({
    description: 'Autopsy performed flag',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autopsyPerformed?: boolean;

  @ApiPropertyOptional({ description: 'Autopsy findings details' })
  @IsOptional()
  @IsString()
  autopsyFindings?: string;

  @ApiPropertyOptional({ description: 'Maternal death flag', default: false })
  @IsOptional()
  @IsBoolean()
  isMaternalDeath?: boolean;

  @ApiPropertyOptional({
    enum: PregnancyRelated,
    description: 'Pregnancy related flag if maternal death',
  })
  @IsOptional()
  @IsEnum(PregnancyRelated)
  pregnancyRelated?: PregnancyRelated;

  @ApiProperty({ description: 'ID of certifying doctor' })
  @IsString()
  @IsNotEmpty()
  certifiedById: string;

  @ApiPropertyOptional({ description: 'Certifier qualification description' })
  @IsOptional()
  @IsString()
  certifierQualification?: string;

  @ApiPropertyOptional({ description: 'License number of certifier' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ description: 'Signature image URL' })
  @IsOptional()
  @IsString()
  signatureUrl?: string;
}

export class UpdateDeathCertificateDto {
  @ApiPropertyOptional({
    description: 'Date of death in ISO or YYYY-MM-DD format',
  })
  @IsOptional()
  @IsString()
  dateOfDeath?: string;

  @ApiPropertyOptional({ description: 'Time of death (HH:mm)' })
  @IsOptional()
  @IsString()
  timeOfDeath?: string;

  @ApiPropertyOptional({ enum: PlaceOfDeath, description: 'Place of death' })
  @IsOptional()
  @IsEnum(PlaceOfDeath)
  placeOfDeath?: PlaceOfDeath;

  @ApiPropertyOptional({ description: 'Specific location details' })
  @IsOptional()
  @IsString()
  locationDetails?: string;

  @ApiPropertyOptional({ description: 'Immediate cause of death' })
  @IsOptional()
  @IsString()
  immediateCause?: string;

  @ApiPropertyOptional({ description: 'Antecedent cause B' })
  @IsOptional()
  @IsString()
  antecedentCauseB?: string;

  @ApiPropertyOptional({ description: 'Antecedent cause C' })
  @IsOptional()
  @IsString()
  antecedentCauseC?: string;

  @ApiPropertyOptional({ description: 'Antecedent cause D' })
  @IsOptional()
  @IsString()
  antecedentCauseD?: string;

  @ApiPropertyOptional({ description: 'Other significant conditions' })
  @IsOptional()
  @IsString()
  otherConditions?: string;

  @ApiPropertyOptional({ enum: MannerOfDeath, description: 'Manner of death' })
  @IsOptional()
  @IsEnum(MannerOfDeath)
  mannerOfDeath?: MannerOfDeath;

  @ApiPropertyOptional({ description: 'Autopsy performed flag' })
  @IsOptional()
  @IsBoolean()
  autopsyPerformed?: boolean;

  @ApiPropertyOptional({ description: 'Autopsy findings details' })
  @IsOptional()
  @IsString()
  autopsyFindings?: string;

  @ApiPropertyOptional({ description: 'Maternal death flag' })
  @IsOptional()
  @IsBoolean()
  isMaternalDeath?: boolean;

  @ApiPropertyOptional({
    enum: PregnancyRelated,
    description: 'Pregnancy related flag if maternal death',
  })
  @IsOptional()
  @IsEnum(PregnancyRelated)
  pregnancyRelated?: PregnancyRelated;

  @ApiPropertyOptional({ description: 'ID of certifying doctor' })
  @IsOptional()
  @IsString()
  certifiedById?: string;

  @ApiPropertyOptional({ description: 'Certifier qualification description' })
  @IsOptional()
  @IsString()
  certifierQualification?: string;

  @ApiPropertyOptional({ description: 'License number of certifier' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ description: 'Signature image URL' })
  @IsOptional()
  @IsString()
  signatureUrl?: string;
}

export class IssueDeathCertificateDto {
  @ApiProperty({
    description: 'Name of person whom the certificate is issued to',
  })
  @IsString()
  @IsNotEmpty()
  issuedTo: string;

  @ApiProperty({ description: 'Relationship to deceased' })
  @IsString()
  @IsNotEmpty()
  issuedToRelationship: string;

  @ApiPropertyOptional({ description: 'National ID of the person issued to' })
  @IsOptional()
  @IsString()
  issuedToNationalId?: string;

  @ApiProperty({
    description: 'Staff user ID of the person issuing the certificate',
  })
  @IsString()
  @IsNotEmpty()
  issuedById: string;
}
