import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The two things printed on a patient card, and nothing else.
 *
 * Both are required. An MRN alone is a sequential number on a piece of paper
 * anyone could be holding; the date of birth is what makes the pair evidence
 * that the card is yours.
 */
export class ClaimPatientRecordDto {
  @ApiProperty({ example: 'MRN202606100001' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  mrn: string;

  @ApiProperty({ example: '1990-05-15' })
  @IsDateString()
  dateOfBirth: string;
}
