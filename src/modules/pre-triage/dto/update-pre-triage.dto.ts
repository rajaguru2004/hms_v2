import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreatePreTriageDto } from './create-pre-triage.dto';

export class UpdatePreTriageDto extends PartialType(CreatePreTriageDto) {
  @ApiPropertyOptional({ example: 'screening' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'cuid-patient-id' })
  @IsOptional()
  @IsString()
  patientId?: string;
}
