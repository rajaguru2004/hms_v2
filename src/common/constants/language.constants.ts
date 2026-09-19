/**
 * The languages a patient may be interviewed in — the single source of truth.
 *
 * ── Why this is one table and not eleven decisions
 *
 * Every place that used to decide a language decided it differently. The
 * session accepted any sixteen characters. `/tts` and `/stt` took whatever the
 * phone put in the body. The picker on the phone would have been a second
 * hardcoded list that drifts from this one the first time a voice is added.
 * A language is not a branch; it is a row. Adding Konkani should be adding a
 * row here and nothing else, and removing one should break the build in every
 * place that mattered.
 *
 * This table mirrors the sidecar's `language_config.py`. The two are separate
 * processes, so they cannot share a module, and the only defence against drift
 * is that both are short, both are flat, and both are the only place their side
 * decides anything. If they disagree, the sidecar wins at runtime — it is the
 * process holding the weights — and this side turns the disagreement into a
 * written refusal rather than a wrong-language answer.
 *
 * ── The asymmetry, stated rather than smoothed over
 *
 * The eleven AI4Bharat IndicF5 languages are not eleven equal languages.
 * **Odia cannot be transcribed at all**: `or` is absent from faster-whisper's
 * `_LANGUAGE_CODES`, so there is no model to ask. Its voice exists, so an Odia
 * patient can be *read to* and can type or tap an answer — a complete interview,
 * with the microphone off.
 *
 * That is why `stt` and `tts` are two flags and not one `supported` boolean.
 * A single flag forces a choice between dropping Odia (a language nobody can
 * use) and pretending its microphone works (a patient speaking into a recorder
 * that will refuse, or worse, guess). Two flags let the picker grey out one
 * control and leave the rest of the language working.
 *
 * ── What these flags are, and what they are not
 *
 * They are the *catalogue*: what this system supports in principle, which is a
 * property of the model families and changes when we change models. They are
 * NOT runtime availability — whether a ~60 MB voice file is on the disk of the
 * box serving this request. That is the sidecar's `/health.ttsLanguages`, it
 * changes with the deployment, and a caller that needs to know asks for it.
 * Conflating the two would mean a config edit every time a file was copied.
 */

export interface LanguageDefinition {
  /** ISO 639-1, lowercase. The primary subtag and nothing else: `ta`, never `ta-IN`. */
  readonly code: string;
  /** The language's name in its own script, which is the only name its speaker reads. */
  readonly nativeName: string;
  /** For clinicians, logs and anyone reading this file who cannot read the script. */
  readonly englishName: string;
  /** Whether speech in this language can be transcribed (faster-whisper). */
  readonly stt: boolean;
  /** Whether text in this language can be read aloud (IndicF5 / Piper). */
  readonly tts: boolean;
}

/**
 * Declared in display order, not alphabetical order: `en` first because it is
 * the default and the one this app shipped with, then the eleven by code. The
 * picker renders this array as given, so the order is a decision made here once
 * rather than a sort the client has to agree with.
 */
export const SUPPORTED_LANGUAGES = [
  {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
    stt: true,
    tts: true,
  },
  {
    code: 'as',
    nativeName: 'অসমীয়া',
    englishName: 'Assamese',
    stt: true,
    tts: true,
  },
  {
    code: 'bn',
    nativeName: 'বাংলা',
    englishName: 'Bengali',
    stt: true,
    tts: true,
  },
  {
    code: 'gu',
    nativeName: 'ગુજરાતી',
    englishName: 'Gujarati',
    stt: true,
    tts: true,
  },
  {
    code: 'hi',
    nativeName: 'हिन्दी',
    englishName: 'Hindi',
    stt: true,
    tts: true,
  },
  {
    code: 'kn',
    nativeName: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    stt: true,
    tts: true,
  },
  {
    code: 'ml',
    nativeName: 'മലയാളം',
    englishName: 'Malayalam',
    stt: true,
    tts: true,
  },
  {
    code: 'mr',
    nativeName: 'मराठी',
    englishName: 'Marathi',
    stt: true,
    tts: true,
  },
  {
    // The one asymmetric row. faster-whisper has no Odia model — not a missing
    // file, not a slow model, no model — so `stt` is false and every code path
    // that would send `or` to the recogniser has to say what it does instead.
    code: 'or',
    nativeName: 'ଓଡ଼ିଆ',
    englishName: 'Odia',
    stt: false,
    tts: true,
  },
  {
    code: 'pa',
    nativeName: 'ਪੰਜਾਬੀ',
    englishName: 'Punjabi',
    stt: true,
    tts: true,
  },
  {
    code: 'ta',
    nativeName: 'தமிழ்',
    englishName: 'Tamil',
    stt: true,
    tts: true,
  },
  {
    code: 'te',
    nativeName: 'తెలుగు',
    englishName: 'Telugu',
    stt: true,
    tts: true,
  },
] as const satisfies readonly LanguageDefinition[];

/**
 * The union of every code. Derived from the table rather than written twice,
 * so a row added below is a code the type system already knows about.
 */
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** What the interview shipped with, and what an omitted language means. */
export const DEFAULT_LANGUAGE = 'en';

/**
 * The language a patient reads and hears when their own is not one this
 * interview can be conducted in.
 *
 * ── What this used to mean, and why it changed
 *
 * It used to mean English on **every** session without exception, and the
 * reasoning was written here at length: the questions are clinical, a
 * phrasebook nobody who reads the language has signed off asks something subtly
 * different from the English it was drafted from, and ten of the eleven Indian
 * languages had no phrasebook at all. Answering in English was the honest
 * version of what the system could promise.
 *
 * Three of the twelve are no longer in that state. English, Tamil and Hindi
 * have complete phrasebooks, answer phrase lists that read a patient's own
 * words with no model in the path, and a voice on disk — see
 * `INTERVIEW_LANGUAGE_CODES`. For those, the interview is conducted in the
 * patient's own language, and `interviewLanguageFor` in `engine/phrasebook.ts`
 * is the one function that decides it.
 *
 * ── What is unchanged, and is the point
 *
 * The review gate. `interviewLanguageFor` asks `phrasebookFor`, which refuses
 * an unreviewed book unless `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS` is set — so
 * a language whose translation no clinician has signed off still answers in
 * English on a default deployment, and the session row says so rather than
 * claiming a language it is not really speaking.
 *
 * So this constant is now the *fallback* rather than the rule: what a Bengali
 * or Telugu session reads and hears, and what any session gets when the gate is
 * shut.
 */
export const DEFAULT_OUTPUT_LANGUAGE = 'en';

/** Every code, for `@IsIn` and for anything that needs the whole set. */
export const SUPPORTED_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_LANGUAGES.map((language) => language.code);

/**
 * The languages a patient is actually **offered** for an interview.
 *
 * ── Why this is narrower than the table above
 *
 * The table is the catalogue: what the model families support, what the sidecar
 * can hear and speak. This is a product decision on top of it — which of those
 * a patient sees in the picker — and the two are different questions with
 * different answers.
 *
 * A language belongs here when the whole interview exists in it: the questions
 * translated, the answers readable by `answer-phrases.ts` without a model, and
 * a voice on disk to read them aloud. Bengali has a recogniser and a voice and
 * neither of the other two. Offering it would give a patient Bengali speech
 * recognition and an English interview, which is a worse experience than not
 * offering it — and it was the state Tamil and Hindi were in until the
 * phrasebooks and the phrase lists were written.
 *
 * ── What this is not
 *
 * It is not a narrowing of what the system accepts. `SUPPORTED_LANGUAGE_CODES`
 * still validates every DTO, `/stt` and `/tts` still answer for all twelve, and
 * a session already recorded in Telugu still reads back as Telugu. This governs
 * one thing: the rows `GET /case-taking/languages` returns.
 *
 * Adding a language back is adding its code here, once the three things above
 * are true of it.
 */
export const INTERVIEW_LANGUAGE_CODES: readonly string[] = ['en', 'ta', 'hi'];

/** The rows the picker renders, in the table's own display order. */
export const INTERVIEW_LANGUAGES: readonly LanguageDefinition[] =
  SUPPORTED_LANGUAGES.filter((language) =>
    INTERVIEW_LANGUAGE_CODES.includes(language.code),
  );

/** The codes speech can be transcribed in. Excludes `or`; see the row above. */
export const STT_LANGUAGE_CODES: readonly string[] = SUPPORTED_LANGUAGES.filter(
  (language) => language.stt,
).map((language) => language.code);

/** The codes text can be read aloud in. */
export const TTS_LANGUAGE_CODES: readonly string[] = SUPPORTED_LANGUAGES.filter(
  (language) => language.tts,
).map((language) => language.code);

const BY_CODE: ReadonlyMap<string, LanguageDefinition> = new Map(
  SUPPORTED_LANGUAGES.map((language) => [language.code, language]),
);

/**
 * BCP-47 down to the primary subtag, lowercased.
 *
 * A phone sends `Locale.toLanguageTag()`, which is `ta-IN` and not `ta`. An
 * Android build with a legacy locale sends `ta_IN`. A hand-written client sends
 * `TA`. Matching any of those against a table keyed on bare two-letter codes
 * misses, and the miss is the dangerous kind: it looks like an unsupported
 * language, so the caller falls back to English and reads a Tamil question
 * aloud in English at HTTP 200.
 *
 * So normalisation happens once, at the edge, before validation — which is why
 * this is called from a `@Transform` and not from each service. Everything past
 * the DTO sees a bare primary subtag.
 *
 * Anything that is not a string normalises to the empty string rather than to
 * the default. `''` fails validation and produces a written 400; silently
 * becoming `en` is the behaviour this whole module exists to remove.
 */
export function normaliseLanguage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const tag = value.trim().toLowerCase().replace(/_/g, '-');
  const primary = tag.split('-', 1)[0];
  return primary;
}

/** The row for a language tag, or undefined when there is not one. */
export function findLanguage(value: unknown): LanguageDefinition | undefined {
  return BY_CODE.get(normaliseLanguage(value));
}

export function isSupportedLanguage(value: unknown): boolean {
  return findLanguage(value) !== undefined;
}

export function supportsStt(value: unknown): boolean {
  return findLanguage(value)?.stt === true;
}

export function supportsTts(value: unknown): boolean {
  return findLanguage(value)?.tts === true;
}

/**
 * What to send the recogniser as its `language` parameter — and the single
 * place the Odia asymmetry is allowed to exist.
 *
 * `undefined` means "send nothing, let it detect". That is the honest answer
 * for Odia: there is no `or` model, so naming it would have the sidecar refuse
 * a recording the patient has already made. Detection will return some
 * neighbouring language and a transcript nobody should trust, which is why the
 * Odia interview is typed — but a refused upload and a poor transcript are
 * different failures, and the patient can act on the second one.
 *
 * Every other supported language returns its own code, because naming it is
 * both faster and more accurate. See the note on `transcribe` in
 * `sidecar.client.ts` for the measurement and the argument.
 */
export function sttLanguageFor(value: unknown): string | undefined {
  const language = findLanguage(value);
  return language?.stt === true ? language.code : undefined;
}

/**
 * The sentence a caller reads when they name a language we do not have.
 *
 * Built from the table so it cannot drift from what is actually accepted, and
 * written as prose because it reaches a screen — §7's rule about error messages
 * and the sidecar's rule about its own refusals are the same rule.
 */
export function unsupportedLanguageMessage(
  codes: readonly string[],
  what: string,
): string {
  return `We do not support that language for ${what}. Choose one of: ${codes.join(', ')}.`;
}

/**
 * Whether this text is written in a script the engine's English patterns
 * cannot reach.
 *
 * True when there is not a single Latin letter in it. That is the honest test
 * for "our regexes cannot match this": every pattern in
 * `engine/field-registry.ts` is anchored on Latin words, so Devanagari,
 * Bengali, Tamil or Odia text matches nothing — not because it says nothing,
 * but because nothing here can read it.
 *
 * Two callers depend on this and they must agree, which is why it lives here
 * with the rest of the language truth rather than privately in either:
 *
 *  * `classifyComplaint` uses it to fail toward *more* assessment instead of
 *    treating "no pattern matched" as "nothing applies". Measured: a Hindi
 *    chest-pain complaint classified `unclassified`, applied 44 fields instead
 *    of 64, and never fired ACS_TRIAD.
 *  * `extractionDecision` uses it to queue the model for a short answer the
 *    engine only appeared to read. A chief complaint is a `text` field, so the
 *    engine "reads" Tamil by storing it verbatim and the turn took the "no
 *    model needed" exit — which meant no translation, which meant the
 *    classifier went on reading Tamil.
 *
 * Mixed script counts as readable, and deliberately:
 * `"எனக்கு three days-ஆ chest pain இருக்கு"` is the normal case in this
 * product, and the English inside it is exactly what the patterns match.
 */
export function isNonEnglishScript(text: string | undefined | null): boolean {
  if (!text) return false;
  return text.trim().length > 0 && !/[A-Za-z]/.test(text);
}
