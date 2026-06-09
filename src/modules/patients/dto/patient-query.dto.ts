import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PatientQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search term (matches first/last name, MRN, phone)',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['all', 'active', 'inactive'],
    default: 'all',
    description: 'Filter by patient status',
  })
  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status?: 'all' | 'active' | 'inactive' = 'all';
}
