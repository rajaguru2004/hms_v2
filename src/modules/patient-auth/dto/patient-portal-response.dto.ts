import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What `POST /patient-auth/claim` answers — always, whatever was typed.
 *
 * There is no "not found" variant of this class on purpose. See
 * `PatientAuthService.claim`: an MRN that matched nothing gets a token with the
 * same shape, the same length and the same lifetime as one that matched, so the
 * response carries no evidence either way.
 */
export class PatientClaimResponseDto {
  @ApiProperty({ description: 'Present this to POST /patient-auth/activate.' })
  claimToken: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: 600 })
  expiresInSeconds: number;
}

/** The record as its own patient sees it. */
export class PortalPatientDto {
  @ApiProperty() id: string;
  @ApiProperty() mrn: string;
  @ApiProperty() firstName: string;
  @ApiPropertyOptional() middleName?: string | null;
  @ApiProperty() lastName: string;
  @ApiProperty() dateOfBirth: Date;
  @ApiProperty() gender: string;
  @ApiPropertyOptional() bloodGroup?: string | null;
  @ApiPropertyOptional() phonePrimary?: string | null;
  @ApiPropertyOptional() email?: string | null;
}

/** Whether this record has a portal login, and which one. */
export class PortalAccountDto {
  @ApiProperty() isLinked: boolean;

  @ApiPropertyOptional({
    description: 'The User this record signs in as, once claimed.',
  })
  userId?: string | null;

  @ApiPropertyOptional() email?: string | null;

  @ApiPropertyOptional({ description: 'When the claim was spent.' })
  activatedAt?: Date | null;
}

export class PatientPortalStateResponseDto {
  @ApiProperty({ type: PortalPatientDto })
  patient: PortalPatientDto;

  @ApiProperty({ type: PortalAccountDto })
  portal: PortalAccountDto;
}
