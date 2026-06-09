import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsEmail,
  IsBoolean,
  IsDateString,
  IsArray,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreatePatientDto {
  @ApiProperty({ example: 'Abebe' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName: string;

  @ApiPropertyOptional({ example: 'Kebede' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ApiProperty({ example: 'Assefa' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '1990-05-15' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: ['male', 'female', 'other'], example: 'male' })
  @IsEnum(['male', 'female', 'other'])
  gender: string;

  @ApiPropertyOptional({ example: 'A+' })
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiPropertyOptional({ example: '+251911123456' })
  @IsOptional()
  @IsString()
  phonePrimary?: string;

  @ApiPropertyOptional({ example: '+251911654321' })
  @IsOptional()
  @IsString()
  phoneSecondary?: string;

  @ApiPropertyOptional({ example: 'patient@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Addis Ababa' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Bole' })
  @IsOptional()
  @IsString()
  zone?: string;

  @ApiPropertyOptional({ example: 'Woreda 03' })
  @IsOptional()
  @IsString()
  woreda?: string;

  @ApiPropertyOptional({ example: 'Kebele 10' })
  @IsOptional()
  @IsString()
  kebele?: string;

  @ApiPropertyOptional({ example: '1024' })
  @IsOptional()
  @IsString()
  houseNumber?: string;

  @ApiPropertyOptional({ example: 'Near Bole Medhanialem' })
  @IsOptional()
  @IsString()
  addressDescription?: string;

  @ApiPropertyOptional({ example: 'Aster Kebede' })
  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @ApiPropertyOptional({ example: '+251911987654' })
  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @ApiPropertyOptional({ example: 'Spouse' })
  @IsOptional()
  @IsString()
  emergencyContactRelationship?: string;

  @ApiPropertyOptional({ type: [String], example: ['Penicillin'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Hypertension'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronicConditions?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Lisinopril 10mg'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currentMedications?: string[];

  @ApiPropertyOptional({ default: false, example: true })
  @IsOptional()
  @IsBoolean()
  hasInsurance?: boolean;

  @ApiPropertyOptional({ example: 'CBHI' })
  @IsOptional()
  @IsString()
  insuranceProvider?: string;

  @ApiPropertyOptional({ example: 'POL-998877' })
  @IsOptional()
  @IsString()
  insuranceId?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  insuranceExpiryDate?: string;

  @ApiPropertyOptional({ example: 'https://example.com/photo.jpg' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'married' })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiPropertyOptional({ example: 'Teacher' })
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional({ example: 'Degree' })
  @IsOptional()
  @IsString()
  educationLevel?: string;

  @ApiPropertyOptional({ default: false, example: false })
  @IsOptional()
  @IsBoolean()
  isVip?: boolean;

  @ApiPropertyOptional({ example: 'Patient requires wheelchair assistance.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'EXT-12345' })
  @IsOptional()
  @IsString()
  externalId?: string;
}
