import {
  DEFAULT_LANGUAGE,
  STT_LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  TTS_LANGUAGE_CODES,
  findLanguage,
  isSupportedLanguage,
  normaliseLanguage,
  sttLanguageFor,
  supportsStt,
  supportsTts,
} from './language.constants';

/**
 * The table, and the two things about it that are easy to get wrong.
 *
 * A native name in the wrong script is invisible in review — ಕನ್ನಡ and ಕನ್ನಡ
 * look the same to a reader who does not read either — and the patient it fails
 * is the one who cannot find their language in the picker. So the script is
 * asserted by Unicode block rather than trusted.
 *
 * The other is the Odia asymmetry. It is the only row where the flags differ,
 * it is load-bearing in three places, and a well-meaning edit making all twelve
 * rows identical would leave an Odia patient recording an answer into a model
 * that does not exist.
 */

/** One character from the language's own script must appear in its native name. */
const SCRIPT_OF: Readonly<Record<string, RegExp>> = {
  en: /^[A-Za-z ]+$/,
  as: /[ঀ-৿]/, // Bengali-Assamese
  bn: /[ঀ-৿]/, // Bengali-Assamese
  gu: /[઀-૿]/, // Gujarati
  hi: /[ऀ-ॿ]/, // Devanagari
  kn: /[ಀ-೿]/, // Kannada
  ml: /[ഀ-ൿ]/, // Malayalam
  mr: /[ऀ-ॿ]/, // Devanagari
  or: /[଀-୿]/, // Odia
  pa: /[਀-੿]/, // Gurmukhi
  ta: /[஀-௿]/, // Tamil
  te: /[ఀ-౿]/, // Telugu
};

describe('the language table', () => {
  it('carries English plus the eleven IndicF5 languages and nothing else', () => {
    expect([...SUPPORTED_LANGUAGE_CODES].sort()).toEqual([
      'as',
      'bn',
      'en',
      'gu',
      'hi',
      'kn',
      'ml',
      'mr',
      'or',
      'pa',
      'ta',
      'te',
    ]);
  });

  it('lists English first, because it is the default and the preselection', () => {
    expect(SUPPORTED_LANGUAGES[0].code).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('has no duplicate codes', () => {
    expect(new Set(SUPPORTED_LANGUAGE_CODES).size).toBe(
      SUPPORTED_LANGUAGE_CODES.length,
    );
  });

  it.each(SUPPORTED_LANGUAGES.map((language) => [language.code, language]))(
    'writes %s in its own script with an English name beside it',
    (code, language) => {
      expect(language.nativeName.trim().length).toBeGreaterThan(0);
      expect(language.englishName.trim().length).toBeGreaterThan(0);
      expect(language.nativeName).toMatch(SCRIPT_OF[code as string]);
    },
  );

  it('uses bare primary subtags, never region tags', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });
});

describe('the Odia asymmetry', () => {
  /**
   * `or` is absent from faster-whisper's `_LANGUAGE_CODES`. There is no model,
   * so there is no transcription — not a slow one, not a bad one, none.
   */
  it('is the only language that cannot be transcribed', () => {
    const withoutStt = SUPPORTED_LANGUAGES.filter(
      (language) => !language.stt,
    ).map((language) => language.code);
    expect(withoutStt).toEqual(['or']);
  });

  it('can still be read aloud, so the interview is typed rather than absent', () => {
    expect(supportsTts('or')).toBe(true);
    expect(supportsStt('or')).toBe(false);
  });

  it('keeps Odia in the interview set but out of the speech set', () => {
    expect(SUPPORTED_LANGUAGE_CODES).toContain('or');
    expect(STT_LANGUAGE_CODES).not.toContain('or');
    expect(TTS_LANGUAGE_CODES).toContain('or');
  });

  /**
   * `undefined` means "send nothing, let it detect". Naming `or` to the sidecar
   * would have it refuse a recording the patient has already made.
   */
  it('tells the recogniser nothing for Odia and the code for everything else', () => {
    expect(sttLanguageFor('or')).toBeUndefined();
    expect(sttLanguageFor('or-IN')).toBeUndefined();
    expect(sttLanguageFor('ta')).toBe('ta');
    expect(sttLanguageFor('ta-IN')).toBe('ta');
    expect(sttLanguageFor('en')).toBe('en');
  });

  it('tells the recogniser nothing for a language it has never heard of', () => {
    expect(sttLanguageFor('klingon')).toBeUndefined();
  });
});

describe('normalising a BCP-47 tag', () => {
  /** A phone sends `Locale.toLanguageTag()`, which is `ta-IN` and not `ta`. */
  it.each([
    ['ta-IN', 'ta'],
    ['ta_IN', 'ta'],
    ['TA', 'ta'],
    ['Ta-in', 'ta'],
    ['ta', 'ta'],
    ['  hi-IN  ', 'hi'],
    ['zh-Hans-CN', 'zh'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normaliseLanguage(input)).toBe(expected);
  });

  /**
   * The empty string, not the default. `''` fails validation and produces a
   * written 400; silently becoming `en` is the behaviour this module exists to
   * remove.
   */
  it.each([[undefined], [null], [42], [{}], ['']])(
    'reads %p as no language rather than as English',
    (input) => {
      expect(normaliseLanguage(input)).toBe('');
      expect(isSupportedLanguage(input)).toBe(false);
    },
  );
});

describe('looking a language up', () => {
  it('finds a row through a region tag', () => {
    expect(findLanguage('ta-IN')?.englishName).toBe('Tamil');
    expect(findLanguage('TA')?.nativeName).toBe('தமிழ்');
  });

  it('refuses a language we do not have rather than guessing a neighbour', () => {
    expect(findLanguage('fr')).toBeUndefined();
    expect(findLanguage('sa')).toBeUndefined();
    expect(isSupportedLanguage('fr')).toBe(false);
  });

  /** `__proto__` reaches this from a request body; a Map read cannot be fooled. */
  it('is not fooled by a prototype key', () => {
    expect(findLanguage('__proto__')).toBeUndefined();
    expect(findLanguage('constructor')).toBeUndefined();
    expect(isSupportedLanguage('toString')).toBe(false);
  });
});
