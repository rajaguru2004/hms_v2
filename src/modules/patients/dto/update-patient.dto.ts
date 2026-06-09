import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdatePatientDto extends PartialType(CreatePatientDto) {
  @ApiPropertyOptional({
    description: 'Is patient active in system',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
