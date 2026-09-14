import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ActivatePatientAccountDto {
  @ApiProperty({
    description: 'The token returned by POST /patient-auth/claim',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  claimToken: string;

  @ApiProperty({ example: 'Portal@12345' })
  @IsString()
  @MinLength(8)
  // bcrypt hashes the first 72 bytes and silently ignores the rest, so a longer
  // password is not the password the patient thinks they set.
  @MaxLength(72)
  password: string;

  /**
   * Optional only because the record may already carry one. Sign-in goes
   * through `POST /auth/login`, which looks an account up by email, so an
   * activation that ends with no email is an account nobody can reach.
   */
  @ApiPropertyOptional({ example: 'patient@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
