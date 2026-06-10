import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PreTriageQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Filter by screening status (e.g. screening, routed, registered_as_patient, all)',
    default: 'all',
  })
  @IsOptional()
  @IsString()
  status?: string = 'all';

  @ApiPropertyOptional({
    description: 'Search term for first/last name or screening number',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Field to order by',
    default: 'screenedAt',
  })
  @IsOptional()
  @IsString()
  orderBy?: string = 'screenedAt';
}
