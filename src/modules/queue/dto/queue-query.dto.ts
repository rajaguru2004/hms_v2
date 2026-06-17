import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { QueueStatusValue } from './update-queue.dto';

export const QUEUE_SERVICE_AREAS = [
  'opd',
  'emergency',
  'mch',
  'psychiatric',
  'laboratory',
  'pharmacy',
  'radiology',
  'pediatric',
] as const;
export type QueueServiceArea = (typeof QUEUE_SERVICE_AREAS)[number];

export class QueueQueryDto {
  @ApiPropertyOptional({ example: 'opd', enum: QUEUE_SERVICE_AREAS })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  /**
   * Filter by one or more statuses.
   * Single value: ?status=waiting
   * Multiple values: ?status=waiting,called,in_service
   */
  @ApiPropertyOptional({
    description: 'Comma-separated list of statuses to filter by',
    example: 'waiting,called',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      return value.split(',').map((s) => s.trim());
    }
    return value;
  })
  status?: QueueStatusValue | QueueStatusValue[];

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ example: 'joinedQueueAt' })
  @IsOptional()
  @IsString()
  orderBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderDir?: 'asc' | 'desc' = 'asc';
}
