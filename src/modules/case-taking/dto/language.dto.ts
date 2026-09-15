import { ApiProperty } from '@nestjs/swagger';

/**
 * What `GET /case-taking/languages` answers with.
 *
 * Declared as classes rather than returned as a bare object because this
 * endpoint exists to stop the phone keeping its own copy of the list: a typed
 * Swagger response is what the client generates its picker from, and an
 * untyped `Record<string, unknown>` would leave it guessing the field names
 * and writing them out by hand — which is the duplication the endpoint was
 * added to remove.
 */
export class LanguageOptionDto {
  @ApiProperty({
    description:
      'ISO 639-1 primary subtag. Send this back, not the tag you got from the OS.',
    example: 'ta',
  })
  code!: string;

  @ApiProperty({
    description:
      "The language's name in its own script — the only name its speaker " +
      'reads, so this is what the picker shows.',
    example: 'தமிழ்',
  })
  nativeName!: string;

  @ApiProperty({
    description: 'For clinicians and for logs.',
    example: 'Tamil',
  })
  englishName!: string;

  @ApiProperty({
    description:
      'Whether an answer spoken in this language can be transcribed here and ' +
      'now — the flag that decides whether this row may be picked at all. ' +
      'Always false for Odia — no Odia speech model exists anywhere — and ' +
      'false for anything the sidecar has not loaded. A picker should hide the ' +
      'microphone rather than offer one that will refuse.',
  })
  stt!: boolean;

  @ApiProperty({
    description:
      'Whether text IN THIS LANGUAGE can be read aloud here and now. Read it ' +
      'as a coverage fact about the system, NOT as what this patient will ' +
      'hear: the interview answers in `outputLanguage`, so a patient who picks ' +
      'a row with `tts: false` still hears every question. `outputTts` is the ' +
      'flag that decides whether to show a speaker button.',
  })
  tts!: boolean;

  @ApiProperty({
    description:
      'The language a patient who picks this row will READ AND HEAR. `en` on ' +
      'every row today, and deliberately so: their speech is transcribed in ' +
      'the language they chose, and everything put back in front of them is ' +
      'English, because English is the only wording of these clinical ' +
      'questions a clinician here has signed off. The same on every row ' +
      'because it is a product decision rather than a consequence of the ' +
      'choice.',
    example: 'en',
  })
  outputLanguage!: string;

  @ApiProperty({
    description:
      'Whether the interview can be read aloud to a patient who picks this ' +
      'row — that is, whether a voice for `outputLanguage` is available here. ' +
      'This is the flag a speaker button belongs on.',
  })
  outputTts!: boolean;

  @ApiProperty({
    enum: ['none', 'unreviewed', 'reviewed'],
    description:
      'Whether the interview asks its QUESTIONS in this language, and on ' +
      'whose authority. `none` — there is no phrasebook, or there is one and ' +
      'the deployment refuses to speak it, so the questions come out in ' +
      'English; a patient can still answer in their own language, because ' +
      '`stt` is a separate capability. `reviewed` — a clinician who reads the ' +
      'language signed the wording off. `unreviewed` — the wording is a draft ' +
      'nobody has checked and this deployment has explicitly opted in to ' +
      'speaking it, which is for demonstrating the pipeline and not for a ' +
      'waiting room. A client showing `unreviewed` should say so on screen. ' +
      'Like `tts`, this describes what exists for THIS language, not what this ' +
      'patient gets: while `outputLanguage` is `en` the questions arrive in ' +
      'English whatever this says.',
    example: 'none',
  })
  questions!: 'none' | 'unreviewed' | 'reviewed';

  @ApiProperty({
    enum: ['human_draft', 'machine_draft'],
    nullable: true,
    description:
      'Who drafted the wording, when there is a phrasebook at all. ' +
      '`machine_draft` means a language model wrote it in one pass — fluent, ' +
      'plausible, and capable of asking a subtly different clinical question ' +
      'than the English source. Null when no phrasebook exists for this ' +
      'language.',
    example: null,
  })
  questionSource!: 'human_draft' | 'machine_draft' | null;
}

export class LanguageCatalogueDto {
  @ApiProperty({
    description:
      'What an omitted `language` means, and what to preselect when the ' +
      "phone's own locale is not on the list.",
    example: 'en',
  })
  default!: string;

  @ApiProperty({
    enum: ['sidecar', 'catalogue'],
    description:
      'Where the `stt`/`tts` flags came from. `sidecar` means they describe ' +
      'this box right now. `catalogue` means the speech service could not be ' +
      'reached and they describe what this system supports in principle — the ' +
      'list is still correct, but a microphone it offers may refuse.',
  })
  source!: 'sidecar' | 'catalogue';

  @ApiProperty({
    type: [LanguageOptionDto],
    description:
      'In display order, which is decided here so the client does not have to ' +
      'agree with a sort.',
  })
  languages!: LanguageOptionDto[];
}
