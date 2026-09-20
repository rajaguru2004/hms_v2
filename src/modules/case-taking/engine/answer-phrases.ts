/**
 * How a patient says yes, no, I don't know and three days — in each language
 * the interview is actually conducted in.
 *
 * ── What this replaced
 *
 * A language model. Until this file existed, `derivePresence` ran English
 * regexes and nothing else: `PHRASE_MATCHED_LANGUAGES` was `['en']`, so a Tamil
 * "இல்லை" matched no negation, fell through to `no_value_extracted`, and the
 * field stayed `not_assessed`. The interview papered over that by sending the
 * utterance to gemma3:4b for translation and extraction — eight to twenty
 * seconds of a 4 GB card, in the background, minutes after the patient had
 * moved on, and only when Ollama happened to be up.
 *
 * The model was never reading meaning. It was doing a dictionary lookup that a
 * dictionary does better: "இல்லை" is no, in every session, forever. So the
 * dictionary is written down here, where a Tamil speaker can read it in a diff
 * and correct it, and where it costs microseconds instead of seconds.
 *
 * ── Why the patient's language AND English, always
 *
 * `phrasesFor` returns a list, not one entry, and English is always in it.
 * Code-switching is not an edge case in this product — it is the normal
 * register: "chest pain மூணு நாளா", "तीन दिन से pain है". A Tamil patient says
 * "no" as often as "இல்லை", and a matcher that ran only the Tamil lists on a
 * Tamil session would miss the half of the sentence that was already readable.
 * `isNonEnglishScript` in `language.constants.ts` says the same thing about
 * mixed script, and this is the answer side of it.
 *
 * ── The one regex trap in this file, stated once
 *
 * **`\b` does not work on Tamil or Devanagari.** It is defined against
 * `[A-Za-z0-9_]`, so in `/\bनहीं\b/` both boundaries sit between two non-word
 * characters and never match. The bug is silent: the pattern compiles, the test
 * that used a bare string passes, and a real answer with a space in front of it
 * does not match. Every native-script pattern here therefore goes through
 * [script] or [word], which use Unicode-aware lookarounds instead. Nothing in
 * this file may use `\b` around a non-Latin pattern.
 *
 * ── Romanised forms, and the ones deliberately absent
 *
 * Whisper transcribes Indian languages in their own script most of the time and
 * in Latin letters some of the time, so the common romanisations are listed
 * too. Only the unambiguous ones: `illai`, `theriyala`, `nahi` are not English
 * words and cannot collide. `na` (Hindi "no") and `ji` (Hindi "yes") are absent
 * on purpose — they are two letters long, they appear inside ordinary English,
 * and a false negation is a fact on a chart that the patient never asserted.
 */

/** The languages whose answers this file can read. */
export const ANSWER_LANGUAGES = ['en', 'ta', 'hi'];

export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number];

/**
 * A Unicode-aware word boundary, for patterns in any script.
 *
 * `(?<!\p{L})x(?!\p{L})` is `\b`'s intent without `\b`'s ASCII assumption: the
 * match may not be preceded or followed by a letter *in any alphabet*. Digits
 * and punctuation are fine on either side, which is what makes "3நாள்" and
 * "நாள்," both work.
 */
function script(source: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'u');
}

/** The same, for Latin-script patterns, where `\b` would also have done. */
function word(source: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'iu');
}

/**
 * Anchored at the start only — the right rule for Tamil.
 *
 * Tamil is agglutinative: case, tense and clitics attach straight onto the stem
 * with no space, so "எரிச்சல்" is said as "எரிச்சலா" and "வந்து போ" as "வந்து
 * போகுது". A closing boundary matches the dictionary form and misses every
 * sentence a patient actually speaks. The stems below are kept long and
 * specific so that an open end cannot swallow an unrelated word.
 */
function stem(source: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${source})`, 'u');
}

/** A unit of time and what it is worth in days. */
export interface DurationUnit {
  readonly pattern: RegExp;
  readonly days: number;
}

/** A severity word and the canonical band it means. `SCALE_BANDS` holds the tokens. */
export interface ScaleBand {
  readonly pattern: RegExp;
  readonly band: 'mild' | 'moderate' | 'severe';
}

export interface AnswerPhrases {
  readonly language: AnswerLanguage;

  /**
   * "I'd rather not say." Checked first of all, because a refusal that is read
   * as a negation records an answer the patient explicitly withheld.
   */
  readonly declined: readonly RegExp[];

  /**
   * "I don't know." Checked before negation, and the order is load-bearing in
   * every language here for the same structural reason: almost every way of
   * saying it contains the word for no. Hindi "पता नहीं" contains "नहीं".
   * Tamil "ஞாபகம் இல்ல" contains "இல்ல". Negation-first turns every one of
   * them into an asserted no — the tri-state collapse this whole module exists
   * to prevent.
   */
  readonly uncertainty: readonly RegExp[];

  readonly negation: readonly RegExp[];
  readonly affirmation: readonly RegExp[];

  /** Counting words, for "three days" and "மூணு நாள்" and "तीन दिन". */
  readonly numberWords: Readonly<Record<string, number>>;

  /** Units of time, with their worth in days. */
  readonly durationUnits: readonly DurationUnit[];

  /**
   * Time expressions that are a complete answer on their own — "yesterday",
   * "நேத்து", "कल" — with no number in front of them.
   */
  readonly relativeDuration: readonly RegExp[];

  /** Words for how bad it is, where the patient gives no number. */
  readonly scaleBands: readonly ScaleBand[];

  /**
   * Ways of saying each **choice token the registry actually stores**, keyed by
   * that token.
   *
   * Keyed on the token rather than on the field, and that is the whole design:
   * `hpi.onset` offers `sudden`, `gradual` and `woke_up_with_it`, and a caller
   * with a field in hand looks up only the tokens that field offers. A new
   * field reusing `constant` needs no entry here, and a token nobody has words
   * for simply never matches — it is asked as a question instead, which is the
   * correct degradation.
   *
   * The tokens are the stored value and are never translated: `severe` is what
   * goes on the chart whether the patient said "ரொம்ப" or "बहुत तेज़". Their
   * own words stay verbatim in `CaseTurn.answerRaw`.
   */
  readonly choiceWords: Readonly<Record<string, readonly RegExp[]>>;
}

/* ───────────────────────────────── English ───────────────────────────────── */

const ENGLISH: AnswerPhrases = Object.freeze({
  language: 'en',

  declined: [
    /\b(i('| a)?m )?(would |'?d )?(rather|prefer) not\b/i,
    /\bdo ?n'?t want to (say|answer|talk|discuss)\b/i,
    /\bskip (this|that|it|the question)\b/i,
    /\bnext question\b/i,
    /\bnot answering\b/i,
    /\bno comment\b/i,
    /\bi'?ll pass\b/i,
    /^\s*pass\s*[.!]?\s*$/i,
    /\bprivate\b.*\bnot\b|\bthat'?s private\b/i,
  ],

  uncertainty: [
    /\bi (do not|don'?t|dont) know\b/i,
    /\b(do not|don'?t|dont) know\b/i,
    /\bnot sure\b/i,
    /\bunsure\b/i,
    /\bno idea\b/i,
    /\b(can'?t|cannot|could ?n'?t) remember\b/i,
    /\b(do not|don'?t|dont) remember\b/i,
    /\b(can'?t|cannot) say\b/i,
    /\bnot certain\b/i,
    /\bhard to say\b/i,
    /\bwho knows\b/i,
    /\bmay ?be\b/i,
    /\bpossibly\b/i,
    /\bi think so\b/i,
    /\bi guess\b/i,
    /\bnever (been )?(checked|tested|told)\b/i,
    /\bthe doctor (would|will|might) know\b/i,
  ],

  negation: [
    /^\s*(no|nope|nah|negative)\b/i,
    /\bno,?\s/i,
    /\bnever\b/i,
    /\bnothing\b/i,
    /\bnone\b/i,
    /\bnot at all\b/i,
    /\bno known\b/i,
    /\bi (do not|don'?t|dont) have\b/i,
    /\bi (have|had) (not|n'?t|never)\b/i,
    /\bhaven'?t (had|got)\b/i,
    /\bthere (is|are|was|were) (no|none)\b/i,
    // ── Contracted auxiliaries ────────────────────────────────────────────
    //
    // The gap that sent real answers to the floor. Until this line the only
    // contraction in the list was `haven't`, so a patient who said
    //
    //   "No, I hadn't had a fever along with this"
    //
    // matched nothing. `clausesOf` in harvest.ts splits on the comma, the span
    // handed to this function is "I hadn't had a fever along with this", the
    // leading "No" is in a different clause, and `hadn't` was a word this
    // engine could not read. Measured live on 2026-09-20: the field came back
    // `not_assessed` / `value_failed_field_shape` and the interview asked about
    // fever again forty seconds later. Whisper transcribes natural speech, and
    // natural speech contracts.
    //
    // Safe below the uncertainty list rather than above it, which is where the
    // whole tri-state ordering matters: "I can't remember" and "I don't know"
    // are matched as uncertainty before this line is ever reached, so a general
    // `n't` cannot collapse doubt into an asserted no.
    //
    // The apostrophe is optional throughout because a recogniser sometimes
    // drops it, and "didnt" has to read the same as "didn't".
    /\b(is|are|was|were|has|have|had|do|does|did|would|should|could|must|need)n'?t\b/i,
    /\b(can'?t|cannot|won'?t|ain'?t)\b/i,
    /\b(i'?m|you'?re|he'?s|she'?s|it'?s|we'?re|they'?re|that'?s|there'?s)\s+not\b/i,
    /\bnot (had|having|got|getting|been|taking|on|really)\b/i,
  ],

  affirmation: [
    /^\s*(yes|yeah|yep|yup|aye|correct|right|true)\b/i,
    /\byes,?\s/i,
    /\bi do\b/i,
    /\bi have\b/i,
    /\bi did\b/i,
    /\bthat'?s right\b/i,
    /\bof course\b/i,
    // The same contraction gap on the other side. "I've been unusually drowsy
    // for two hours" is an affirmed neurological symptom and it read as nothing
    // at all, because `\bi have\b` does not match `I've`. Measured in the same
    // session as the negation case above.
    //
    // Each of these requires a following verb rather than matching `I've` or
    // `I'm` alone: a bare pronoun contraction opens a sentence of any kind, and
    // this list only means anything for a boolean field.
    /\bi'?ve (had|got|been|noticed|felt)\b/i,
    /\bi'?m (having|feeling|getting)\b/i,
    /^\s*(sure|absolutely|definitely|certainly|indeed)\b/i,
  ],

  numberWords: {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    couple: 2,
    few: 3,
    several: 3,
  },

  durationUnits: [
    { pattern: word('seconds?|secs?'), days: 1 / 86400 },
    { pattern: word('minutes?|mins?'), days: 1 / 1440 },
    { pattern: word('hours?|hrs?'), days: 1 / 24 },
    { pattern: word('days?'), days: 1 },
    { pattern: word('weeks?|wks?'), days: 7 },
    { pattern: word('months?|mos?'), days: 30 },
    { pattern: word('years?|yrs?'), days: 365 },
  ],

  relativeDuration: [
    /\b(yesterday|this morning|last night|overnight|just now|a while|long time|many years|all my life|birth|childhood)\b/i,
    /\b(since|from)\s+(yesterday|today|this morning|last night|last week|last month|last year|birth|childhood|\d{4}|\w+day)\b/i,
  ],

  scaleBands: [
    {
      pattern: word('mild|slight|a ?bit|not bad|manageable'),
      band: 'mild' as const,
    },
    {
      pattern: word('moderate|medium|middling|so ?so'),
      band: 'moderate' as const,
    },
    {
      pattern: word(
        'severe|terrible|unbearable|worst|awful|very bad|really bad|excruciating',
      ),
      band: 'severe' as const,
    },
  ],

  choiceWords: {
    /* hpi.onset */
    sudden: [
      /\bsudden(ly)?\b/i,
      /\ball (at once|of a sudden)\b/i,
      /\bout of (the )?blue\b/i,
      /\bstraight away\b/i,
      /\bin an instant\b/i,
    ],
    gradual: [
      /\bgradual(ly)?\b/i,
      /\bslowly\b/i,
      /\blittle by little\b/i,
      /\bbuilt? up\b/i,
      /\bover (time|days|weeks|months)\b/i,
    ],
    woke_up_with_it: [
      /\bwoke up with it\b/i,
      /\bwas there when i woke\b/i,
      /\bin the morning when i (got up|woke)\b/i,
    ],

    /* hpi.timing */
    constant: [
      /\ball the time\b/i,
      /\bconstant(ly)?\b/i,
      /\bcontinuous(ly)?\b/i,
      /\bnon.?stop\b/i,
      /\bnever (stops|goes away|eases)\b/i,
      /\balways there\b/i,
    ],
    comes_and_goes: [
      /\bcomes? and goes?\b/i,
      /\bon and off\b/i,
      /\bnow and (then|again)\b/i,
      /\bintermittent\b/i,
      /\bsometimes\b/i,
      /\bin waves\b/i,
    ],
    worse_at_night: [/\bworse at night\b/i, /\bat night it('?s| is) worse\b/i],
    worse_in_morning: [/\bworse in the morning\b/i, /\bmornings? are worse\b/i],
    worse_after_food: [
      /\bafter (i )?eat(ing)?\b/i,
      /\bafter (food|meals?)\b/i,
      /\bworse after eating\b/i,
    ],

    /* hpi.progression */
    getting_worse: [
      /\b(getting|got) worse\b/i,
      /\bworsening\b/i,
      /\bworse than\b/i,
    ],
    getting_better: [
      /\b(getting|got) better\b/i,
      /\bimproving\b/i,
      /\beasing\b/i,
    ],
    staying_same: [/\b(staying|stayed) (the )?same\b/i, /\bno change\b/i],

    /* hpi.character */
    burning: [/\bburn(ing|s)\b/i, /\bstinging\b/i],
    pressing: [
      /\bpress(ing|ure)\b/i,
      /\bheav(y|iness)\b/i,
      /\btight(ness)?\b/i,
      /\bsqueez/i,
    ],
    sharp: [/\bsharp\b/i, /\bstabbing\b/i, /\bshooting\b/i, /\bpricking\b/i],
    dull: [/\bdull\b/i, /\bach(e|ing|y)\b/i, /\bsore\b/i],
    cramping: [/\bcramp(ing|s)?\b/i, /\bgriping\b/i, /\btwisting\b/i],
    throbbing: [/\bthrobbing\b/i, /\bpulsating\b/i, /\bpounding\b/i],
  },
});

/* ────────────────────────────────── Tamil ────────────────────────────────── */

/**
 * Tamil, as it is spoken to a nurse rather than as it is written in a textbook.
 *
 * Spoken Tamil and written Tamil differ enough that a list drawn from the
 * written register would miss most real answers: a patient says "இல்ல", not
 * "இல்லை"; "மூணு", not "மூன்று"; "நாளா", not "நாட்களாக". Both registers are
 * listed, spoken form first, because the recogniser returns what was said.
 */
const TAMIL: AnswerPhrases = Object.freeze({
  language: 'ta',

  declined: [
    script('சொல்ல\\s*விரும்பல(ை)?'),
    script('சொல்ல\\s*மாட்டேன்'),
    script('வேண்டா(ம்|ங்க)'),
    script('அடுத்த\\s*கேள்வி'),
    script('பரவால்ல(ை)?\\s*விடுங்க'),
    word('solla\\s*virumbala|adutha\\s*kelvi'),
  ],

  uncertainty: [
    // "தெரியல" / "தெரியாது" — I don't know. First, and before negation: the
    // next list's "இல்ல" is a substring of several ways of saying this.
    script('தெரியல(ை|ே)?'),
    script('தெரியாது'),
    script('ஞாபகம்\\s*இல்ல(ை)?'),
    script('நினைவில்ல(ை)?'),
    script('சரியா\\s*தெரியல(ை)?'),
    script('உறுதியா\\s*தெரியல(ை)?'),
    script('இருக்கலாம்'),
    script('ஒருவேள(ை)?'),
    script('சொல்ல\\s*முடியல(ை)?'),
    script('பரிசோதிச்சதில்ல(ை)?'),
    word('theriyala|theriyathu|gnabagam\\s*illa|nyabagam\\s*illa'),
  ],

  negation: [
    script('இல்ல(ை|ீங்க|ங்க)?'),
    script('கிடையாது'),
    script('ஒண்ணும்\\s*இல்ல(ை)?'),
    script('எதுவும்\\s*இல்ல(ை)?'),
    script('அப்படி\\s*இல்ல(ை)?'),
    script('ஒரு\\s*போதும்\\s*இல்ல(ை)?'),
    word('illai|illa|illainga|kidaiyathu|onnum\\s*illa'),
  ],

  affirmation: [
    script('ஆமா(ம்|ங்க)?'),
    script('ஆம்'),
    script('ஆமாம்'),
    script('இருக்கு(ங்க)?'),
    script('உண்டு'),
    script('சரி(ங்க)?'),
    script('ஆகும்'),
    word('aamaa|aama|aamam|irukku|sari|undu'),
  ],

  numberWords: {
    ஒரு: 1,
    ஒண்ணு: 1,
    ஒன்று: 1,
    ரெண்டு: 2,
    இரண்டு: 2,
    மூணு: 3,
    மூன்று: 3,
    நாலு: 4,
    நான்கு: 4,
    அஞ்சு: 5,
    ஐந்து: 5,
    ஆறு: 6,
    ஏழு: 7,
    எட்டு: 8,
    ஒன்பது: 9,
    பத்து: 10,
    onnu: 1,
    oru: 1,
    rendu: 2,
    moonu: 3,
    naalu: 4,
    anju: 5,
  },

  durationUnits: [
    { pattern: script('நிமிஷ(ம்|ங்கள்)?|நிமிட(ம்|ங்கள்)?'), days: 1 / 1440 },
    { pattern: script('மணி\\s*நேர(ம்|ம்மா)?|மணிநேர(ம்)?'), days: 1 / 24 },
    { pattern: script('நாள்|நாளா|நாட்க(ள்|ளா)|நாளாச்சு'), days: 1 },
    { pattern: script('வார(ம்|மா|ங்கள்|ங்களா)'), days: 7 },
    { pattern: script('மாச(ம்|மா|ங்கள்|ங்களா)|மாத(ம்|மா|ங்கள்)'), days: 30 },
    {
      pattern: script('வருஷ(ம்|மா|ங்கள்|ங்களா)|வருட(ம்|மா)|ஆண்டு(கள்)?'),
      days: 365,
    },
    {
      pattern: word('naal|naala|naatkal|vaaram|maasam|maatham|varusham'),
      days: 1,
    },
  ],

  relativeDuration: [
    script('நேத்து|நேற்று'),
    script('இன்னிக்கு|இன்று'),
    script('இன்னிக்கு\\s*காலையில'),
    script('காலையில(ிருந்து)?'),
    script('ராத்திரி|இரவு'),
    script('சின்ன\\s*வயசுல(ிருந்து)?'),
    script('பிறந்ததில\\s*இருந்து'),
    script('ரொம்ப\\s*நாளா'),
    script('கொஞ்ச\\s*நாளா'),
  ],

  scaleBands: [
    { pattern: script('கொஞ்சம்|லேசா(ன)?|சாதாரணமா'), band: 'mild' as const },
    { pattern: script('மிதமா(ன|னது)?|நடுத்தரமா'), band: 'moderate' as const },
    {
      pattern: script('ரொம்ப|கடுமையா(ன)?|தாங்க\\s*முடியல(ை)?|மிக\\s*அதிகம்'),
      band: 'severe' as const,
    },
  ],

  choiceWords: {
    sudden: [
      stem('திடீர்'),
      stem('சட்டுன்னு'),
      stem('ஒரே\\s*அடியா'),
      stem('உடனே'),
    ],
    gradual: [
      stem('கொஞ்ச\\s*கொஞ்சமா'),
      stem('மெதுவா'),
      stem('படிப்படியா'),
      stem('நாளடைவில'),
    ],
    woke_up_with_it: [
      stem('தூங்கி\\s*எழுந்த'),
      stem('காலையில\\s*எழுந்த'),
      stem('எழுந்தபோது'),
    ],

    constant: [
      stem('எப்பவும்|எப்போதும்'),
      stem('எல்லா\\s*நேரமும்'),
      stem('தொடர்ந்து'),
      stem('விடாம'),
    ],
    comes_and_goes: [
      stem('வந்து\\s*போ'),
      stem('அப்பப்போ|அவ்வப்போது'),
      stem('சில\\s*நேரம்'),
      stem('எப்பவாச்சும்'),
    ],
    worse_at_night: [stem('ராத்திரில\\s*அதிகம்'), stem('இரவில்\\s*அதிகம்')],
    worse_in_morning: [stem('காலையில\\s*அதிகம்')],
    worse_after_food: [
      stem('சாப்பிட்ட\\s*பிறகு'),
      stem('சாப்பாட்டுக்கு\\s*அப்புற'),
    ],

    getting_worse: [
      stem('அதிகமா\\s*இருக்கு'),
      stem('மோசமா'),
      stem('கூடிக்கிட்டே'),
    ],
    getting_better: [
      stem('குறைஞ்சு'),
      stem('பரவாயில்ல'),
      stem('நல்லா\\s*இருக்கு'),
    ],
    staying_same: [stem('அப்படியே\\s*இருக்கு'), stem('மாற்றம்\\s*இல்ல')],

    burning: [stem('எரிச்சல்'), stem('எரியுது')],
    pressing: [stem('அழுத்த'), stem('பாரமா'), stem('இறுக்க')],
    sharp: [stem('கூர்மையா'), stem('குத்துற'), stem('குத்தல்')],
    dull: [stem('மந்தமா'), stem('லேசான\\s*வலி')],
    cramping: [stem('பிடிப்பு'), stem('முறுக்க')],
    throbbing: [stem('படபடப்பா'), stem('துடிக்கிற')],
  },
});

/* ────────────────────────────────── Hindi ────────────────────────────────── */

const HINDI: AnswerPhrases = Object.freeze({
  language: 'hi',

  declined: [
    script('नहीं\\s*बताना'),
    script('नहीं\\s*बताऊ(ँ|ं)गा|नहीं\\s*बताऊ(ँ|ं)गी'),
    script('अगला\\s*सवाल'),
    script('छोड़\\s*(दीजिए|दो|दीजिये)'),
    script('निजी\\s*बात'),
    word('nahi\\s*bataana|agla\\s*sawaal'),
  ],

  uncertainty: [
    // Before negation. "पता नहीं" contains "नहीं": read the other way round it
    // becomes an asserted no, which is a fact the patient never gave.
    script('पता\\s*नहीं|पता\\s*नही'),
    script('मालूम\\s*नहीं|मालूम\\s*नही'),
    script('याद\\s*नहीं|याद\\s*नही'),
    script('पक्का\\s*नहीं|पक्का\\s*पता\\s*नहीं'),
    script('कह\\s*नहीं\\s*सकता|कह\\s*नहीं\\s*सकती'),
    script('शायद'),
    script('हो\\s*सकता\\s*है'),
    script('कभी\\s*(जाँच|जांच|टेस्ट)\\s*नहीं'),
    script('डॉक्टर\\s*को\\s*पता\\s*होगा'),
    word('pata\\s*nahi(n)?|maloom\\s*nahi(n)?|yaad\\s*nahi(n)?|shayad'),
  ],

  negation: [
    script('नहीं|नही'),
    script('बिल्कुल\\s*नहीं'),
    script('कुछ\\s*नहीं'),
    script('कभी\\s*नहीं'),
    script('ना'),
    word('nahin|nahi'),
  ],

  affirmation: [
    script('हाँ|हां'),
    script('जी\\s*हाँ|जी\\s*हां'),
    script('जी'),
    script('है'),
    script('बिल्कुल'),
    script('सही'),
    word('haan|haa'),
  ],

  numberWords: {
    एक: 1,
    दो: 2,
    तीन: 3,
    चार: 4,
    पांच: 5,
    पाँच: 5,
    छह: 6,
    छः: 6,
    सात: 7,
    आठ: 8,
    नौ: 9,
    दस: 10,
    ek: 1,
    do: 2,
    teen: 3,
    chaar: 4,
    paanch: 5,
  },

  durationUnits: [
    { pattern: script('मिनट'), days: 1 / 1440 },
    { pattern: script('घंट(ा|े|ों)'), days: 1 / 24 },
    { pattern: script('दिन|दिनों'), days: 1 },
    { pattern: script('हफ़्त(ा|े|ों)|हफ्त(ा|े|ों)|सप्ताह'), days: 7 },
    { pattern: script('महीन(ा|े|ों)|माह'), days: 30 },
    { pattern: script('साल|वर्ष|बरस'), days: 365 },
    { pattern: word('din|hafta|hafte|mahina|mahine|saal'), days: 1 },
  ],

  relativeDuration: [
    script('कल'),
    script('आज'),
    script('आज\\s*सुबह|सुबह\\s*से'),
    script('रात\\s*(को|से)|कल\\s*रात'),
    script('बचपन\\s*से'),
    script('जन्म\\s*से'),
    script('बहुत\\s*दिनों\\s*से'),
    script('कुछ\\s*दिनों\\s*से'),
  ],

  scaleBands: [
    { pattern: script('हल्का|हल्की|थोड़ा|थोड़ी|कम'), band: 'mild' as const },
    { pattern: script('मध्यम|ठीक\\s*ठाक'), band: 'moderate' as const },
    {
      pattern: script(
        'बहुत\\s*(तेज़|तेज|ज़्यादा|ज्यादा)|असहनीय|बर्दाश्त\\s*नहीं',
      ),
      band: 'severe' as const,
    },
  ],

  choiceWords: {
    sudden: [script('अचानक'), script('एकदम\\s*से|एकदम'), script('झटके\\s*से')],
    gradual: [
      script('धीरे\\s*धीरे'),
      script('थोड़ा\\s*थोड़ा\\s*करके'),
      script('समय\\s*के\\s*साथ'),
    ],
    woke_up_with_it: [
      script('सो\\s*कर\\s*उठा|सो\\s*कर\\s*उठी'),
      script('सुबह\\s*उठा|सुबह\\s*उठी'),
      script('नींद\\s*से\\s*उठ'),
    ],

    constant: [
      script('हमेशा'),
      script('हर\\s*(समय|वक़्त|वक्त)'),
      script('लगातार'),
      script('कभी\\s*नहीं\\s*रुकता'),
    ],
    comes_and_goes: [
      script('आता\\s*जाता\\s*(है|रहता)'),
      script('कभी\\s*कभी'),
      script('रुक\\s*रुक\\s*कर'),
      script('थोड़ी\\s*देर\\s*के\\s*लिए'),
    ],
    worse_at_night: [script('रात\\s*(को|में)\\s*(ज़्यादा|ज्यादा|बढ़)')],
    worse_in_morning: [script('सुबह\\s*(ज़्यादा|ज्यादा|बढ़)')],
    worse_after_food: [
      script('खाने\\s*के\\s*बाद'),
      script('खाना\\s*खाने\\s*पर'),
    ],

    getting_worse: [
      script('बढ़\\s*रहा|बढ़ता\\s*जा'),
      script('और\\s*ख़राब|और\\s*खराब'),
    ],
    getting_better: [
      script('कम\\s*हो\\s*रहा'),
      script('ठीक\\s*हो\\s*रहा'),
      script('आराम\\s*है'),
    ],
    staying_same: [
      script('वैसा\\s*ही'),
      script('कोई\\s*(फ़र्क|फर्क|बदलाव)\\s*नहीं'),
    ],

    burning: [script('जलन'), script('जल\\s*रहा')],
    pressing: [script('दबाव'), script('भारीपन'), script('जकड़न')],
    sharp: [
      script('तेज़\\s*चुभ|तेज\\s*चुभ'),
      script('चुभने\\s*वाला'),
      script('चीरने'),
    ],
    dull: [script('हल्का\\s*दर्द'), script('मंद\\s*दर्द')],
    cramping: [script('मरोड़'), script('ऐंठन')],
    throbbing: [script('टीस'), script('धड़कने\\s*वाला')],
  },
});

const BY_LANGUAGE: Readonly<Record<AnswerLanguage, AnswerPhrases>> =
  Object.freeze({
    en: ENGLISH,
    ta: TAMIL,
    hi: HINDI,
  });

/**
 * The phrase lists to run over one patient's answer: theirs, then English.
 *
 * Always at least English, and English is always last so that a native-script
 * match is the one that decides when both hit. The order matters for exactly
 * one situation and it is worth naming: a Hindi answer containing the English
 * word "no" as filler should be read by the Hindi lists first.
 *
 * An unknown or unsupported language gets English alone — the same answer the
 * old `PHRASE_MATCHED_LANGUAGES` check gave, and `derivePresence` still reports
 * it through `languageCovered` so the derivation is flagged for confirmation.
 */
export function phrasesFor(language?: string): readonly AnswerPhrases[] {
  const code = (language ?? '').toLowerCase().split(/[-_]/, 1)[0];
  const own = (ANSWER_LANGUAGES as readonly string[]).includes(code)
    ? BY_LANGUAGE[code]
    : undefined;
  return own && own.language !== 'en' ? [own, ENGLISH] : [ENGLISH];
}

/** Whether this language has phrase lists of its own. */
export function isAnswerLanguage(language?: string): boolean {
  const code = (language ?? '').toLowerCase().split(/[-_]/, 1)[0];
  return (ANSWER_LANGUAGES as readonly string[]).includes(code);
}

/** Every number word across every language, for one combined lookup. */
export function numberWordsFor(
  language?: string,
): Readonly<Record<string, number>> {
  return phrasesFor(language).reduce<Record<string, number>>(
    (all, phrases) => Object.assign(all, phrases.numberWords),
    {},
  );
}

export { ENGLISH as ENGLISH_ANSWER_PHRASES };
