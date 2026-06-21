import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsEmail,
  IsNumber,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MachineType, ConnectionType, ConnectionStatus } from '@prisma/client';

// ── DEPARTMENTS DTOs ─────────────────────────────────────────────────────────

export class CreateDepartmentDto {
  @ApiProperty({ example: 'org-demo' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ example: 'Cardiology' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'CARD' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'Cardiology Department' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'head-user-id' })
  @IsOptional()
  @IsString()
  headId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'CARD' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'Cardiology Department' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'head-user-id' })
  @IsOptional()
  @IsString()
  headId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── INTEGRATIONS DTOs ────────────────────────────────────────────────────────

export class CreateSettingsIntegrationDto {
  @ApiProperty({ example: 'org-demo' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ example: 'Sysmex XN-1000' })
  @IsString()
  @IsNotEmpty()
  machineName: string;

  @ApiProperty({ enum: MachineType, example: MachineType.lab_analyzer })
  @IsEnum(MachineType)
  machineType: MachineType;

  @ApiPropertyOptional({ example: 'XN-1000' })
  @IsOptional()
  @IsString()
  machineModel?: string;

  @ApiPropertyOptional({ example: 'Sysmex' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'SN-12345' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiProperty({ enum: ConnectionType, example: ConnectionType.hl7 })
  @IsEnum(ConnectionType)
  connectionType: ConnectionType;

  @ApiPropertyOptional({ example: '192.168.1.100' })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  port?: number;

  @ApiPropertyOptional({ example: 'http://api.sysmex.local' })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;

  @ApiPropertyOptional({ example: 'api-key-sysmex' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'laboratory' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSettingsIntegrationDto {
  @ApiPropertyOptional({ example: 'Sysmex XN-1000' })
  @IsOptional()
  @IsString()
  machineName?: string;

  @ApiPropertyOptional({ enum: MachineType, example: MachineType.lab_analyzer })
  @IsOptional()
  @IsEnum(MachineType)
  machineType?: MachineType;

  @ApiPropertyOptional({ example: 'XN-1000' })
  @IsOptional()
  @IsString()
  machineModel?: string;

  @ApiPropertyOptional({ example: 'Sysmex' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'SN-12345' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ enum: ConnectionType, example: ConnectionType.hl7 })
  @IsOptional()
  @IsEnum(ConnectionType)
  connectionType?: ConnectionType;

  @ApiPropertyOptional({ example: '192.168.1.100' })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  port?: number;

  @ApiPropertyOptional({ example: 'http://api.sysmex.local' })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;

  @ApiPropertyOptional({ example: 'api-key-sysmex' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'laboratory' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: ConnectionStatus,
    example: ConnectionStatus.connected,
  })
  @IsOptional()
  @IsEnum(ConnectionStatus)
  connectionStatus?: ConnectionStatus;
}

// ── MODULES DTO ──────────────────────────────────────────────────────────────

export class UpdateModulesDto {
  @ApiProperty({ example: 'org-demo' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ example: { pharmacy: true, laboratory: true } })
  @IsObject()
  @IsNotEmpty()
  modulesEnabled: Record<string, boolean>;
}

// ── ORGANIZATION DTO ──────────────────────────────────────────────────────────

export class UpdateOrganizationDto {
  @ApiProperty({ example: 'org-demo' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ example: 'General Hospital' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'http://logo.url' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'http://logo-text.url' })
  @IsOptional()
  @IsString()
  logoTextUrl?: string;

  @ApiPropertyOptional({ example: '#ffffff' })
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#000000' })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional({ example: 'org@hospital.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '123 Health Ave' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Health City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Health Region' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Ethiopia' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: { currency: 'ETB', timezone: 'Africa/Addis_Ababa' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;

  @ApiPropertyOptional({ example: { pharmacy: true, laboratory: true } })
  @IsOptional()
  @IsObject()
  modulesEnabled?: Record<string, boolean>;
}

// ── USERS DTOs ───────────────────────────────────────────────────────────────

export class CreateSettingsUserDto {
  @ApiPropertyOptional({ example: 'org-demo' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ example: 'Dr. Alice Smith' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'alice.smith@hospital.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'EMP001' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiProperty({ example: 'DOCTOR' })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiPropertyOptional({ example: 'dept-uuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'LIC12345' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSettingsUserDto {
  @ApiPropertyOptional({ example: 'Dr. Alice Smith' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'EMP001' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'DOCTOR' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 'dept-uuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'LIC12345' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
