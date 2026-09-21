import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Which intakes to list.
 *
 * `patientId` is a filter and never an authorisation: a patient caller has
 * their own id forced onto it by the controller, whatever they send here.
 */
export class CaseSubmissionQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Read one chart. Omit for everything this site was sent.',
    example: 'cuid-patient-123',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
