import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ANSWER_MODALITIES } from '../engine/tri-state';

/**
 * The wire shapes for the interview.
 *
 * Two things are conspicuously absent from every body here: `patientId` and
 * `organizationId`. They arrive from the token via `@CurrentUser()` and
 * `@PatientScope()`, never from the caller — and because the global
 * ValidationPipe runs `forbidNonWhitelisted`, sending either is a 400 rather
 * than a field somebody has to remember to ignore.
 *
 * `presence` is absent too, from the answer and from the correction. A client
 * cannot post "this is unknown" any more than the model can: `derivePresence`
 * reads the patient's own words and decides, and it is the only thing that
 * does. A tapped "Not sure" button reaches it as the reserved choice token
 * `not_sure`, which is a thing the patient pressed rather than a state the
 * client asserted.
 */

export class StartCaseSessionDto {
  @ApiPropertyOptional({
    enum: ['new_consultation', 'follow_up'],
    default: 'new_consultation',
  })
  @IsOptional()
  @IsIn(['new_consultation', 'follow_up'])
  kind?: string;

  @ApiPropertyOptional({
    description:
      'BCP-47-ish. Only `en` has phrase lists today; anything else still runs, ' +
      'with every derivation flagged for patient confirmation.',
    default: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @ApiPropertyOptional({
    description: 'The appointment this intake is for, if any.',
  })
  @IsOptional()
  @IsString()
  appointmentId?: string;
}

export class CaseConsentDto {
  @ApiProperty({
    description:
      'Which wording they agreed to. Consent is a moment, not a flag: what they ' +
      'were shown matters as much as that they accepted it.',
    example: '2026.09.1',
  })
  @IsString()
  @MaxLength(32)
  consentVersion!: string;

  @ApiProperty({
    description:
      'False is a real answer and is recorded as one — the session is abandoned ' +
      'rather than left open in a state where questions could still be asked.',
  })
  @IsBoolean()
  accepted!: boolean;
}

export class SubmitTurnDto {
  @ApiPropertyOptional({
    description:
      'The field being answered. Omit for an opening narrative that belongs to ' +
      'no single field.',
    example: 'hpi.duration',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fieldPath?: string;

  @ApiProperty({
    enum: ANSWER_MODALITIES,
    description:
      'How the answer arrived. `choice` is a tapped button — never `touch`; ' +
      "the vocabulary is the engine's ANSWER_MODALITIES and nowhere else.",
  })
  @IsIn(ANSWER_MODALITIES)
  modality!: string;

  @ApiPropertyOptional({
    description: 'What they said or typed, verbatim. Never normalised.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({
    description:
      'A tapped or numeric answer. For `choice` this is the option token, ' +
      'including the reserved `not_sure` / `prefer_not_to_say` / `no` / `yes`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  value?: string;

  @ApiPropertyOptional({
    description:
      'From the speech recogniser, when the answer was spoken. A real ' +
      'measurement, unlike anything a language model reports about itself.',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  transcriptConfidence?: number;

  @ApiPropertyOptional({
    description:
      'Where the recording was stored, when it was. Kept so a doubtful ' +
      'transcription can be checked against what was actually said.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  audioKey?: string;
}

export class CorrectFactDto {
  @ApiPropertyOptional({
    enum: ANSWER_MODALITIES,
    default: 'correction',
    description: 'Defaults to `correction`, which is what a correction is.',
  })
  @IsOptional()
  @IsIn(ANSWER_MODALITIES)
  modality?: string;

  @ApiPropertyOptional({
    description: "The corrected answer in the patient's words.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({
    description: 'The corrected value, for a tapped or numeric field.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  value?: string;
}

export class SpeakDto {
  @ApiProperty({ description: 'What to read aloud.' })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;
}

/**
 * Multipart, so the language arrives as a form field rather than JSON.
 *
 * Declared anyway: `forbidNonWhitelisted` applies to a multipart body too, and
 * an undeclared `language` field would 400 the upload.
 */
export class TranscribeDto {
  @ApiPropertyOptional({
    description:
      'Omit to let the recogniser detect it — the right default for a patient ' +
      'who switches language mid-sentence.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;
}
