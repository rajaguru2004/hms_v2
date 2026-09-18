/**
 * Red-flag routing instructions, in the patient's language.
 *
 * ── Why this file is separate from `phrasebook.ts`
 *
 * It translates a different *kind* of sentence. `phrasebook.ts` holds questions:
 * a mistranslated question is answered wrongly and a wrong fact reaches the
 * chart, which is bad. This file holds the sentence that tells somebody to stop
 * queueing and find a member of staff **now** — and a mistranslated one of those
 * is a patient who sits back down. They deserve their own file, their own
 * review and their own sign-off, so that approving one is never accidentally
 * approving the other.
 *
 * It shares the review gate deliberately. `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS`
 * is one switch for "this deployment accepts unreviewed clinical wording", and
 * splitting it would let a box run reviewed questions beside unreviewed
 * emergency instructions without anybody choosing that.
 *
 * ── What is translated and what is not
 *
 * Only `message`, the patient-facing routing instruction. `title`,
 * `clinicianSummary` and `recommendedAction` stay English on every rule, for
 * the same reason `field.label` does in `phrasebook.ts`: a clinician reading a
 * Tamil patient's triage list reads it in English, and the safety engine's own
 * output must not change shape with the patient's language.
 *
 * Nothing here can change *whether* a rule fires. `safety-engine.ts` evaluates
 * conditions against presences and validated values, in every language
 * identically, and then looks up the wording. A missing or broken translation
 * degrades to the English message; it can never suppress a red flag.
 *
 * ── The helpline number is load-bearing
 *
 * `SUICIDAL_IDEATION` carries `14416`. A translation that drops it, or that
 * renders it in Devanagari or Tamil digits, is a sentence that tells somebody in
 * crisis to call a number they cannot dial. `assertSafetyPhrasebooks` checks for
 * the ASCII digits at load, in every language, and refuses to start without them.
 */

import { RED_FLAG_RULES } from './safety-rules';
import { allowingUnreviewedPhrasebooks, PhrasebookSource } from './phrasebook';
import { normaliseLanguage } from '../../../common/constants/language.constants';

export interface SafetyPhrasebook {
  /** ISO 639-1 primary subtag. Must be a language `language.constants.ts` knows. */
  readonly language: string;
  /** Who drafted the wording. Says nothing about whether anybody checked it. */
  readonly source: PhrasebookSource;
  /**
   * When a clinician who reads this language signed these instructions off, or
   * `null` while nobody has.
   *
   * **An unreviewed safety phrasebook is never spoken to a patient** unless the
   * deployment has explicitly set `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS`. Both
   * books below are `null`: they are faithful drafts of the English, and no
   * clinician who reads the language has read them.
   */
  readonly reviewedAt: string | null;
  /** Keyed on `RedFlagRule.id`. A missing id falls back to English. */
  readonly messages: Readonly<Record<string, string>>;
}

/**
 * The helpline, as it must appear in every language.
 *
 * `Tele-MANAS` is a proper noun and stays Latin; `14416` stays ASCII because it
 * is dialled. The number is checked at load — see the note at the top.
 */
export const HELPLINE_DIGITS = '14416';

const HINDI: SafetyPhrasebook = {
  language: 'hi',
  source: 'machine_draft',
  reviewedAt: null,
  messages: {
    ACS_TRIAD:
      'आपने जो बताया है उसमें से कुछ की जाँच जल्दी होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं, और वहीं रहें जहाँ स्टाफ़ आपको देख सके।',
    STROKE_SIGNS:
      'आपने जो बताया है उसे तुरंत देखा जाना चाहिए। कृपया अभी रिसेप्शन पर बताएं — कतार में प्रतीक्षा न करें।',
    THUNDERCLAP_HEADACHE:
      'आपने जो बताया है उसे तुरंत देखा जाना चाहिए। कृपया अभी रिसेप्शन पर बताएं।',
    ACTIVE_SEIZURE:
      'आपने जो बताया है उसकी जाँच तुरंत होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं।',
    SEVERE_BREATHLESSNESS:
      'आपकी साँस की जाँच तुरंत होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं और बैठे रहें।',
    ANAPHYLAXIS:
      'इस पर तुरंत ध्यान देने की ज़रूरत है। कृपया अभी पास के स्टाफ़ सदस्य को बताएं — अपनी बारी का इंतज़ार न करें।',
    UPPER_GI_BLEED:
      'आपने जो बताया है उसकी जाँच जल्दी होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं और बैठे रहें।',
    LOWER_GI_BLEED:
      'कृपया चेक-इन करते समय रिसेप्शन पर इसका ज़िक्र करें, ताकि आज ही इसे देखा जा सके।',
    SEPSIS_SIGNS:
      'आपने जो बताया है उसमें से कुछ पर तत्काल ध्यान देने की ज़रूरत है। कृपया अभी रिसेप्शन पर बताएं और वहीं रहें जहाँ स्टाफ़ आपको देख सके।',
    SUICIDAL_IDEATION:
      'हमें बताने के लिए धन्यवाद — यह कहना आसान नहीं होता, और आपको इसे अकेले संभालना नहीं चाहिए। कृपया अभी रिसेप्शन पर बताएं ताकि आज ही कोई आपसे बात कर सके। अगर उससे पहले कभी असुरक्षित लगे, तो आप किसी भी समय Tele-MANAS को 14416 पर कॉल कर सकते हैं।',
    PREGNANCY_BLEEDING:
      'आपने जो बताया है उसकी जाँच जल्दी होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं और बैठे रहें।',
    BLEEDING_PREGNANCY_STATUS_UNKNOWN:
      'कृपया चेक-इन करते समय रिसेप्शन पर इसका ज़िक्र करें, ताकि आज ही इसे देखा जा सके।',
    PAEDIATRIC_DANGER_SIGNS:
      'आपने अपने बच्चे के बारे में जो बताया है उसकी जाँच तुरंत होनी चाहिए। कृपया अभी रिसेप्शन पर बताएं — कतार में प्रतीक्षा न करें।',
  },
};

const TAMIL: SafetyPhrasebook = {
  language: 'ta',
  source: 'machine_draft',
  reviewedAt: null,
  messages: {
    ACS_TRIAD:
      'நீங்கள் சொன்னவற்றில் சிலவற்றை விரைவாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள், மேலும் ஊழியர்கள் உங்களைப் பார்க்கக்கூடிய இடத்திலேயே இருங்கள்.',
    STROKE_SIGNS:
      'நீங்கள் சொன்னதை உடனடியாகப் பார்க்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள் — வரிசையில் காத்திருக்க வேண்டாம்.',
    THUNDERCLAP_HEADACHE:
      'நீங்கள் சொன்னதை உடனடியாகப் பார்க்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள்.',
    ACTIVE_SEIZURE:
      'நீங்கள் சொன்னதை உடனடியாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள்.',
    SEVERE_BREATHLESSNESS:
      'உங்கள் மூச்சை உடனடியாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவித்து, அமர்ந்தே இருங்கள்.',
    ANAPHYLAXIS:
      'இதற்கு உடனடியாகக் கவனம் தேவை. தயவுசெய்து இப்போதே அருகில் உள்ள ஊழியரிடம் தெரிவியுங்கள் — உங்கள் முறைக்காகக் காத்திருக்க வேண்டாம்.',
    UPPER_GI_BLEED:
      'நீங்கள் சொன்னதை விரைவாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவித்து, அமர்ந்தே இருங்கள்.',
    LOWER_GI_BLEED:
      'தயவுசெய்து நீங்கள் பதிவு செய்யும்போது இதை வரவேற்பறையில் குறிப்பிடுங்கள், அதனால் இன்றே இதைப் பார்க்க முடியும்.',
    SEPSIS_SIGNS:
      'நீங்கள் சொன்னவற்றில் சிலவற்றுக்கு அவசர கவனம் தேவை. தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவித்து, ஊழியர்கள் உங்களைப் பார்க்கக்கூடிய இடத்திலேயே இருங்கள்.',
    SUICIDAL_IDEATION:
      'எங்களிடம் சொன்னதற்கு நன்றி — இதைச் சொல்வது எளிதல்ல, இதை நீங்கள் தனியாகச் சமாளிக்க வேண்டியதில்லை. தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள், இன்றே யாராவது உங்களுடன் பேசுவார்கள். அதற்கு முன் ஏதேனும் பாதுகாப்பற்றதாக உணர்ந்தால், எந்த நேரத்திலும் Tele-MANAS 14416 என்ற எண்ணில் அழைக்கலாம்.',
    PREGNANCY_BLEEDING:
      'நீங்கள் சொன்னதை விரைவாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவித்து, அமர்ந்தே இருங்கள்.',
    BLEEDING_PREGNANCY_STATUS_UNKNOWN:
      'தயவுசெய்து நீங்கள் பதிவு செய்யும்போது இதை வரவேற்பறையில் குறிப்பிடுங்கள், அதனால் இன்றே இதைப் பார்க்க முடியும்.',
    PAEDIATRIC_DANGER_SIGNS:
      'உங்கள் குழந்தையைப் பற்றி நீங்கள் சொன்னதை உடனடியாகப் பரிசோதிக்க வேண்டும். தயவுசெய்து இப்போதே வரவேற்பறையில் தெரிவியுங்கள் — வரிசையில் காத்திருக்க வேண்டாம்.',
  },
};

export const SAFETY_PHRASEBOOKS: Readonly<Record<string, SafetyPhrasebook>> =
  Object.freeze({ hi: HINDI, ta: TAMIL });

/**
 * The book for this language, or `undefined` for English, an unknown language,
 * or one whose instructions nobody has reviewed yet.
 *
 * Same three outcomes and the same gate as `phrasebookFor`. English returns
 * `undefined` because English is the source, not a translation of it.
 */
export function safetyPhrasebookFor(
  language: string | undefined,
): SafetyPhrasebook | undefined {
  const code = normaliseLanguage(language);
  if (code === '' || code === 'en') return undefined;
  const book = Object.prototype.hasOwnProperty.call(SAFETY_PHRASEBOOKS, code)
    ? SAFETY_PHRASEBOOKS[code]
    : undefined;
  if (!book) return undefined;
  if (book.reviewedAt !== null) return book;
  return allowingUnreviewedPhrasebooks() ? book : undefined;
}

/**
 * What the patient is told when this rule fires, in their language or English.
 *
 * `english` is passed in rather than looked up so that this cannot disagree
 * with the rule the engine actually matched — the caller has the rule in hand,
 * and a second lookup by id is a second chance to get the wrong one.
 */
export function safetyMessageFor(
  ruleId: string,
  english: string,
  language?: string,
): string {
  const book = safetyPhrasebookFor(language);
  if (!book) return english;
  const translated = book.messages[ruleId];
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated
    : english;
}

/** Rule ids a book has no instruction for. Empty is what a complete book looks like. */
export function safetyPhrasebookGaps(book: SafetyPhrasebook): string[] {
  return RED_FLAG_RULES.filter(
    (rule) => (book.messages[rule.id] ?? '').trim() === '',
  ).map((rule) => rule.id);
}

/**
 * Load-time invariants. Throws rather than degrading, and each one is a thing
 * that would otherwise reach a patient in an emergency.
 *
 * Called from `safety-rules.ts`'s own assertion pass so that a bad book fails
 * the same startup that a bad rule fails.
 */
export function assertSafetyPhrasebooks(): void {
  for (const [code, book] of Object.entries(SAFETY_PHRASEBOOKS)) {
    if (book.language !== code) {
      throw new Error(
        `safety phrasebook ${code} declares language "${book.language}"`,
      );
    }

    // A gap is survivable — that rule falls back to English — but it must be
    // visible, because a half-translated book reads as a complete one.
    const gaps = safetyPhrasebookGaps(book);
    if (gaps.length > 0) {
      throw new Error(
        `safety phrasebook ${code} has no instruction for: ${gaps.join(', ')}`,
      );
    }

    // An id that is not a rule is a translation nobody will ever see, and the
    // commonest cause is a rule being renamed with the book left behind.
    const known = new Set(RED_FLAG_RULES.map((rule) => rule.id));
    for (const id of Object.keys(book.messages)) {
      if (!known.has(id)) {
        throw new Error(
          `safety phrasebook ${code} has an instruction for unknown rule "${id}"`,
        );
      }
    }

    // The helpline, in digits somebody can dial. See the note at the top.
    const crisis = book.messages.SUICIDAL_IDEATION ?? '';
    if (!crisis.includes(HELPLINE_DIGITS)) {
      throw new Error(
        `safety phrasebook ${code} drops the ${HELPLINE_DIGITS} helpline number`,
      );
    }
  }
}
