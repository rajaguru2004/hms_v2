import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import {
  STT_LANGUAGE_CODES,
  SUPPORTED_LANGUAGE_CODES,
  TTS_LANGUAGE_CODES,
  normaliseLanguage,
  unsupportedLanguageMessage,
} from '../constants/language.constants';

/**
 * `@IsLanguageCode()` — the only way a language enters this system.
 *
 * Two things happen here and they happen in this order, which is the whole
 * point of composing them into one decorator rather than writing them out on
 * each DTO:
 *
 *   1. `@Transform` normalises BCP-47 to the primary subtag. A phone sends
 *      `Locale.toLanguageTag()`, so `ta-IN` and `ta_IN` and `TA` all arrive and
 *      all mean Tamil. `ValidationPipe` runs transforms before validators, so
 *      by the time rule 2 looks at the value it is a bare `ta`.
 *   2. `@IsIn` checks it against the capability's set, and fails with a written
 *      sentence. Not a silent default to English: a patient who asked for Tamil
 *      and got confident English has no way to tell that from their own
 *      misunderstanding, which is the failure the sidecar stopped making and
 *      which this stops us making one layer up.
 *
 * Writing the pair out on each DTO would work until somebody added the third
 * one and forgot the `@Transform`, at which point `ta-IN` would 400 and the
 * bug would look like a broken phone.
 *
 * The three capabilities are three different sets because the languages are not
 * equally capable — Odia has a voice and no recogniser. See
 * `language.constants.ts`.
 */
export type LanguageCapability = 'interview' | 'stt' | 'tts';

interface CapabilityRule {
  readonly codes: readonly string[];
  readonly message: string;
}

const CAPABILITY_RULES: Readonly<Record<LanguageCapability, CapabilityRule>> = {
  interview: {
    codes: SUPPORTED_LANGUAGE_CODES,
    message: unsupportedLanguageMessage(
      SUPPORTED_LANGUAGE_CODES,
      'the interview',
    ),
  },
  stt: {
    codes: STT_LANGUAGE_CODES,
    message:
      unsupportedLanguageMessage(STT_LANGUAGE_CODES, 'transcribing speech') +
      ' Odia (or) is not among them, because no Odia speech model exists — an ' +
      'Odia interview is read aloud and typed rather than spoken.',
  },
  tts: {
    codes: TTS_LANGUAGE_CODES,
    message: unsupportedLanguageMessage(TTS_LANGUAGE_CODES, 'reading aloud'),
  },
};

/**
 * `undefined` and `null` pass through untouched so that `@IsOptional()` still
 * sees an absent field as absent. An explicitly sent empty string does NOT: it
 * normalises to `''`, fails `@IsIn`, and is refused. A client that sent the
 * field named a language, and the empty string is not one.
 */
export function IsLanguageCode(
  capability: LanguageCapability = 'interview',
): PropertyDecorator {
  const rule = CAPABILITY_RULES[capability];
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      value === undefined || value === null ? value : normaliseLanguage(value),
    ),
    IsIn(rule.codes, { message: rule.message }),
  );
}

/** Exposed so a test can assert the sentence a refusal actually produces. */
export function languageRefusalMessage(capability: LanguageCapability): string {
  return CAPABILITY_RULES[capability].message;
}
