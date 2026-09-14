import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { OrganizationSettings } from '../../settings/organization-settings';

/**
 * Everything a client needs to render itself, in one round trip.
 *
 * Without this a phone needs three calls to draw its first screen — the access
 * map, the user, and the organisation — and the third is permission-gated, so
 * a nurse got a 403 and silently fell back to a theme that was not their
 * hospital's. One call, no gate, because none of it is administrative: it is
 * the answer to "who am I and where do I work".
 */

export class MeDepartmentDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class MeUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;

  /** Alias of `fullName`. The mobile `AuthUser` model reads `name`. */
  @ApiProperty() name: string;

  @ApiPropertyOptional({ nullable: true }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;

  /** The primary role's name, for display only. Never for authorisation. */
  @ApiPropertyOptional({ nullable: true }) role: string | null;

  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty({ type: [String] }) permissions: string[];

  @ApiPropertyOptional({ nullable: true }) departmentId: string | null;
  @ApiPropertyOptional({ type: MeDepartmentDto, nullable: true })
  department: MeDepartmentDto | null;
  @ApiPropertyOptional({ nullable: true }) departmentName: string | null;

  @ApiPropertyOptional({ nullable: true }) specialization: string | null;
  @ApiPropertyOptional({ nullable: true }) licenseNumber: string | null;
  @ApiPropertyOptional({ nullable: true }) employeeId: string | null;
  @ApiPropertyOptional({ nullable: true }) avatar: string | null;
  @ApiPropertyOptional({ nullable: true }) lastLoginAt: Date | null;
}

export class ModuleAccessDto {
  @ApiProperty() canCreate: boolean;
  @ApiProperty() canRead: boolean;
  @ApiProperty() canUpdate: boolean;
  @ApiProperty() canDelete: boolean;
}

export class MeAccessDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ModuleAccessDto' },
    description: 'Keyed by module: patients, queue, pre-triage, billing, …',
  })
  modules: Record<string, ModuleAccessDto>;
}

export class MeOrganizationDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) logoTextUrl: string | null;
  @ApiProperty() primaryColor: string;
  @ApiProperty() secondaryColor: string;

  @ApiProperty({ description: 'Complete: defaults merged with stored values' })
  settings: OrganizationSettings;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  modulesEnabled: Record<string, unknown>;
}

export class MeResponseDto {
  @ApiProperty({ type: MeUserDto }) user: MeUserDto;
  @ApiProperty({ type: MeAccessDto }) access: MeAccessDto;
  @ApiProperty({ type: MeOrganizationDto }) organization: MeOrganizationDto;
}

export class ChangePasswordResultDto {
  @ApiProperty() success: boolean;
}
