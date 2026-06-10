import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsObject,
} from 'class-validator';
import { MachineType, ConnectionType, ConnectionStatus } from '@prisma/client';

export class CreateMachineDto {
  @ApiPropertyOptional({ example: 'org-demo' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiProperty({ example: 'Sysmex XN-1000' })
  @IsString()
  @IsNotEmpty()
  machineName: string;

  @ApiProperty({ example: 'lab_analyzer', enum: MachineType })
  @IsEnum(MachineType)
  machineType: MachineType;

  @ApiPropertyOptional({ example: 'Sysmex' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'XN-1000' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ example: 'SN-123456' })
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiPropertyOptional({ example: 'laboratory' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiProperty({ example: 'hl7', enum: ConnectionType })
  @IsEnum(ConnectionType)
  connectionType: ConnectionType;

  @ApiPropertyOptional({ example: { ip_address: '192.168.1.50', port: 5000 } })
  @IsObject()
  @IsOptional()
  connectionDetails?: Record<string, any>;

  @ApiPropertyOptional({ example: { WBC: 'test-wbc-id', RBC: 'test-rbc-id' } })
  @IsObject()
  @IsOptional()
  testMapping?: Record<string, any>;
}

export class UpdateMachineDto {
  @ApiPropertyOptional({ example: 'Sysmex XN-1000' })
  @IsString()
  @IsOptional()
  machineName?: string;

  @ApiPropertyOptional({ example: 'Sysmex' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'XN-1000' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ example: 'SN-123456' })
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiPropertyOptional({ example: 'laboratory' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: { ip_address: '192.168.1.50', port: 5000 } })
  @IsObject()
  @IsOptional()
  connectionDetails?: Record<string, any>;

  @ApiPropertyOptional({ example: { WBC: 'test-wbc-id' } })
  @IsObject()
  @IsOptional()
  testMapping?: Record<string, any>;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'connected', enum: ConnectionStatus })
  @IsEnum(ConnectionStatus)
  @IsOptional()
  connectionStatus?: ConnectionStatus;
}
