import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  CORRECTION_KINDS,
  CORRECTION_MAX_LENGTH,
} from '../document-corrections';

/**
 * The body of `PATCH /patient-documents/:documentId/extraction`. §18.
 *
 * Four declared keys and no more, because the global pipe runs `whitelist` with
 * `forbidNonWhitelisted`: an undeclared key is a 400 for the whole request, not
 * a field that gets quietly dropped. That is the right trade here — a client
 * that sends `presence` or `patientId` is a client that believes it can set
 * something it must not, and failing loudly is how it finds out.
 *
 * ── What is deliberately absent
 *
 * `presence`. The same omission `case-taking.dto.ts` makes and for the same
 * reason: a client cannot post "this is unknown" any more than the model can.
 * `deriveCorrection` reads the patient's own words, or the button they pressed,
 * and it is the only thing that decides. A tapped "Not sure" arrives as
 * `kind: 'unsure'`, which is a thing the patient did rather than a state the
 * client asserted.
 *
 * `originalValue`. The value the extraction holds is read off the row at the
 * moment the correction lands. Accepting it from the client would let a caller
 * decide what the document "said" it read, which is precisely the link in §22's
 * evidence chain that has to be beyond a caller's reach.
 *
 * `patientId`, `documentId`. From the token and the URL. Never the body.
 */
export class CorrectExtractionDto {
  @ApiProperty({
    description:
      'Which value this is about: a path into the extraction, in the spelling ' +
      'the `sources` list already uses — `medications[0].name`, ' +
      '`investigations[2].result`, `allergies[0]`, `document.date`. It must ' +
      'resolve to a value the document actually holds.',
    example: 'medications[0].strength',
  })
  @IsString()
  @MaxLength(200)
  path!: string;

  @ApiProperty({
    enum: CORRECTION_KINDS,
    description:
      "§18's three buttons. `correct` needs `value`; `confirm` and `unsure` " +
      'must not carry one — confirming means agreeing with what is already ' +
      'there, and "not sure" is not a value.',
  })
  @IsIn(CORRECTION_KINDS)
  kind!: (typeof CORRECTION_KINDS)[number];

  @ApiPropertyOptional({
    description:
      'What the patient says it should say. Required for `correct`. To say the ' +
      'document is wrong and there is nothing there, send "none" — the case ' +
      'engine reads that as an asserted absence, which is a different state ' +
      'from nobody having looked.',
    maxLength: CORRECTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CORRECTION_MAX_LENGTH)
  value?: string;

  @ApiPropertyOptional({
    description:
      'Anything the patient wants to add about why. Kept with the correction; ' +
      'never parsed for clinical meaning.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
