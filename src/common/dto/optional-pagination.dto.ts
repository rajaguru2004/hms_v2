import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from '../constants/app.constants';

/**
 * Pagination the caller opts into, for lists that already answer a bare array.
 *
 * These endpoints shipped before the mobile app existed and the web console
 * indexes their responses directly — `invoices.map(...)`, not
 * `invoices.data.map(...)`. Wrapping them in `{data, meta}` unconditionally
 * would blank those screens, so the shape is chosen by the request: send
 * `page` and you get the envelope, omit it and the response is byte-identical
 * to today's.
 *
 * Unlike `PaginationDto` this deliberately has no default `page`, because a
 * default is exactly what would make `isPaged` always true.
 */
export class OptionalPaginationDto {
  @ApiPropertyOptional({
    description:
      'Page number (1-indexed). Sending this switches the response to {data, meta}; omitting it returns a bare array.',
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: `Items per page. Ignored unless "page" is sent. Defaults to ${DEFAULT_LIMIT}.`,
    minimum: 1,
    maximum: MAX_LIMIT,
    example: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Rejected rather than silently clamped: a client that asks for 500 and
  // receives 100 has no way to tell that from a list with only 100 rows.
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      "Case-insensitive match across the patient's first name, last name and MRN.",
    example: 'abebe',
  })
  @IsOptional()
  @IsString()
  search?: string;

  /** An absent `page` means the caller wants the legacy bare array. */
  get isPaged(): boolean {
    return this.page !== undefined;
  }

  get pageNumber(): number {
    return this.page ?? DEFAULT_PAGE;
  }

  get pageSize(): number {
    return this.limit ?? DEFAULT_LIMIT;
  }
}
