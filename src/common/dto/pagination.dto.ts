import {
  IsOptional,
  IsPositive,
  IsInt,
  IsString,
  IsIn,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from '../constants/app.constants';

/**
 * PaginationDto — base DTO for all list endpoints.
 * Extend this in module-specific list DTOs to add filters.
 *
 * Usage:
 *   class ListUsersDto extends PaginationDto {
 *     @IsOptional() @IsString() search?: string;
 *   }
 */
export class PaginationDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    description: 'Page number (1-indexed)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    description: 'Items per page (max 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ description: 'Field to order by' })
  @IsOptional()
  @IsString()
  orderBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderDir?: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return ((this.page ?? DEFAULT_PAGE) - 1) * (this.limit ?? DEFAULT_LIMIT);
  }

  get take(): number {
    const limit = this.limit ?? DEFAULT_LIMIT;
    return Math.min(limit, MAX_LIMIT);
  }
}
