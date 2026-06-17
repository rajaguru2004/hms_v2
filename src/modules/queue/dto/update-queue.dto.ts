import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { QUEUE_PRIORITIES, QueuePriority } from './create-queue.dto';

export const QUEUE_STATUSES = [
  'waiting',
  'called',
  'in_service',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type QueueStatusValue = (typeof QUEUE_STATUSES)[number];

export class UpdateQueueDto {
  @ApiPropertyOptional({ enum: QUEUE_STATUSES, example: 'called' })
  @IsOptional()
  @IsIn(QUEUE_STATUSES)
  status?: QueueStatusValue;

  @ApiPropertyOptional({ example: 'opd' })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({ enum: QUEUE_PRIORITIES, example: 'urgent' })
  @IsOptional()
  @IsIn(QUEUE_PRIORITIES)
  priority?: QueuePriority;

  @ApiPropertyOptional({ example: 'consultation' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({ example: 'clx-staff-123' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ example: 'Room 3' })
  @IsOptional()
  @IsString()
  assignedRoom?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedWaitMinutes?: number;

  @ApiPropertyOptional({ example: 'Please proceed to Room 3' })
  @IsOptional()
  @IsString()
  displayMessage?: string;
}
