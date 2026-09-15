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
import { IsLanguageCode } from '../../../common/decorators/language.decorator';
import {
  DEFAULT_LANGUAGE,
  STT_LANGUAGE_CODES,
  SUPPORTED_LANGUAGE_CODES,
  TTS_LANGUAGE_CODES,
} from '../../../common/constants/language.constants';

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

  /**
   * ── The interview's two languages, and why the request carries one
   *
   * The session stores an `inputLanguage` and an `outputLanguage`. This request
   * names neither, and that is deliberate on both counts.
   *
   * `language` already IS the input language: the picker chooses one thing —
   * the language the patient speaks — and it governs the recogniser. A second
   * field meaning the same fact would be two sources of truth for it and the
   * first thing to drift, so the request shape is unchanged and the server maps
   * `language` onto `inputLanguage`.
   *
   * `outputLanguage` is absent because it is a product decision the server
   * makes — `DEFAULT_OUTPUT_LANGUAGE`, with the reasoning written down beside
   * it — and not something the handset gets a vote on. A phone that could set
   * it would be a phone that can put an unreviewed clinical translation in
   * front of a patient, which is what the review gate exists to stop.
   *
   * The session VIEW reports both, so a client can label the microphone with
   * one and the script of the questions with the other.
   */
  @ApiPropertyOptional({
    enum: [...SUPPORTED_LANGUAGE_CODES],
    default: DEFAULT_LANGUAGE,
    description:
      'The language the patient SPEAKS — what their speech is transcribed as. ' +
      'It does not change what they read or hear: the questions and the voice ' +
      'are English on every session. BCP-47 is accepted and reduced to its ' +
      'primary subtag — send `Locale.toLanguageTag()` and `ta-IN` becomes ' +
      '`ta`. A code outside the set is a 400 with a written sentence, never a ' +
      'quiet fall back to English. `or` is offered here even though its ' +
      'microphone is not, because an Odia interview that is read aloud and ' +
      'typed is a complete interview.',
  })
  @IsOptional()
  @IsLanguageCode('interview')
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

/**
 * ── `sessionId` on the two voice routes
 *
 * These two routes carry no session id today, so `session.language` — the
 * language the patient actually chose — was never consulted and the body
 * decided. That is the wrong authority: the body is whatever the phone
 * remembered, and a phone that has been handed to a relative, or resumed after
 * an app update, remembers the wrong thing.
 *
 * `sessionId` is **optional and additive**: an existing client that sends only
 * `text` and `language` behaves exactly as it did. Send it and the session's
 * language wins over the body's, which is the point. It is not made required
 * because both routes are legitimately used before a session exists — reading
 * the consent text aloud, and reading the language picker itself.
 *
 * Supplying it also scopes the call: the session is loaded through the same
 * patient-and-organisation check every other route uses, so a session id that
 * is not yours reads as not found rather than as a language hint.
 */
export class SpeakDto {
  @ApiProperty({ description: 'What to read aloud.' })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({
    enum: [...TTS_LANGUAGE_CODES],
    default: DEFAULT_LANGUAGE,
    description:
      "Ignored when `sessionId` names a session: that session's OUTPUT " +
      'language decides, and the output language is English on every session ' +
      'today. This field still decides for the calls made before a session ' +
      'exists — the consent text, the language picker. BCP-47 accepted; a ' +
      'code outside the set is a 400.',
  })
  @IsOptional()
  @IsLanguageCode('tts')
  language?: string;

  @ApiPropertyOptional({
    description:
      'The interview this line belongs to. When given, its OUTPUT language ' +
      'wins over `language` above.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}

/**
 * Multipart, so the fields arrive as form fields rather than JSON.
 *
 * Declared anyway: `forbidNonWhitelisted` applies to a multipart body too, and
 * an undeclared field would 400 the upload.
 */
export class TranscribeDto {
  @ApiPropertyOptional({
    enum: [...STT_LANGUAGE_CODES],
    description:
      "Ignored when `sessionId` names a session: that session's INPUT " +
      'language — the one the patient chose — decides. Omit both and the ' +
      'recogniser detects the language itself. `or` is refused here: there is ' +
      'no Odia speech model, so an Odia answer is typed.',
  })
  @IsOptional()
  @IsLanguageCode('stt')
  language?: string;

  @ApiPropertyOptional({
    description:
      'The interview this recording answers. When given, its INPUT language ' +
      'wins over `language` above.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}
