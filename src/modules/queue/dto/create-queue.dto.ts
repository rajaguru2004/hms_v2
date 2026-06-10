import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const QUEUE_PRIORITIES = ['urgent', 'normal', 'low', 'routine'] as const;
export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

export class CreateQueueDto {
  @ApiProperty({ example: 'clx123abc456' })
  @IsString()
  patientId!: string;

  @ApiProperty({ example: 'opd' })
  @IsString()
  serviceArea!: string;

  @ApiPropertyOptional({ example: 'consultation' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({ enum: QUEUE_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(QUEUE_PRIORITIES)
  priority?: QueuePriority = 'normal';

  @ApiPropertyOptional({ example: 'clx-staff-123' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ example: 'Room 3' })
  @IsOptional()
  @IsString()
  assignedRoom?: string;
}
