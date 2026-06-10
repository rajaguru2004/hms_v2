import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { QUEUE_STATUSES, QueueStatusValue } from './update-queue.dto';

export class QueueQueryDto {
  @ApiPropertyOptional({ example: 'opd' })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({ enum: QUEUE_STATUSES, example: 'waiting' })
  @IsOptional()
  @IsIn(QUEUE_STATUSES)
  status?: QueueStatusValue;
}
