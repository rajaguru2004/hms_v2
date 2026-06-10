import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { QueueStatus, MachineType, ConnectionStatus } from '@prisma/client';

export class ResultsQueueQueryDto {
  @ApiPropertyOptional({ example: 'org-demo' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ example: 'pending', enum: QueueStatus })
  @IsEnum(QueueStatus)
  @IsOptional()
  status?: QueueStatus;

  @ApiPropertyOptional({ example: 'machine-id-123' })
  @IsString()
  @IsOptional()
  machineId?: string;
}

export class MachineQueryDto {
  @ApiPropertyOptional({ example: 'org-demo' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ example: 'lab_analyzer', enum: MachineType })
  @IsEnum(MachineType)
  @IsOptional()
  machineType?: MachineType;

  @ApiPropertyOptional({ example: 'laboratory' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'connected', enum: ConnectionStatus })
  @IsEnum(ConnectionStatus)
  @IsOptional()
  status?: ConnectionStatus;
}
