import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Queue priorities, in urgency order.
 *
 * `p1`..`p5` are the triage codes the mobile app and the pre-triage screens
 * speak — every add-to-queue from the phone was a 400 because only the four
 * words below them were accepted. Both vocabularies are valid; `QUEUE_PRIORITY_RANK`
 * is what orders a board containing a mix of them.
 */
export const QUEUE_PRIORITIES = [
  'p1',
  'p2',
  'p3',
  'p4',
  'p5',
  'emergency',
  'urgent',
  'high',
  'normal',
  'low',
  'routine',
] as const;

/**
 * Lower sorts first. Two vocabularies for the same ladder, so a board that
 * mixes them still reads top-to-bottom by how sick somebody is.
 *
 * Deliberately not derived from the array index: the two sets interleave
 * (`p2` is more urgent than `urgent`, `p4` is `normal`), and an order derived
 * from declaration would silently tie them.
 */
export const QUEUE_PRIORITY_RANK: Record<string, number> = {
  p1: 0,
  emergency: 0,
  p2: 1,
  urgent: 2,
  p3: 3,
  high: 3,
  p4: 4,
  normal: 4,
  p5: 5,
  low: 6,
  routine: 6,
};

/** Anything unrecognised sorts after everything known, never before it. */
export function queuePriorityRank(priority: string | null | undefined): number {
  if (!priority) return 99;
  return QUEUE_PRIORITY_RANK[priority.toLowerCase()] ?? 99;
}
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
