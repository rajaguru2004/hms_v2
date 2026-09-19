/**
 * The patient-facing wording of a question, in the patient's language.
 *
 * ── Why this is data and not a model call
 *
 * `askNext` answers in about fifteen milliseconds because `selectNext` hands it
 * a finished string — `field.prompt` plus an answer hint, both static, neither
 * having been near a model. Translating on the turn path would put gemma3:4b
 * in front of the patient: eight to twenty seconds warm, seventy-four cold,
 * on every single question. That alone disqualifies it.
 *
 * The safety argument is the stronger one. A live translation re-words a
 * clinical question afresh for every patient, with nobody reading the result.
 * "Does the pain spread to your arm?" coming back as "Does the pain hurt your
 * arm?" is a different question, it is a plausible 4B-model slip, and the only
 * evidence it happened is a chart that quietly answers the wrong thing. A
 * translation that is checked in is read once by somebody who speaks the
 * language, and then asks the same question of every patient forever. That is
 * the same reason `safety-rules.ts` is a table and not a prompt.
 *
 * ── The shape, and why it has four parts
 *
 * A spoken question is assembled from four things, and all four reach the
 * patient, so all four need translating:
 *
 *   • the question itself, keyed by field path;
 *   • the answer hint, keyed by field kind — "You can answer yes or no.";
 *   • the spoken form of each choice token, because the state stores
 *     `crushing` and the patient must hear a word;
 *   • the conjunction that joins the choices — English "or".
 *
 * Translating only the first would leave a Tamil question followed by an
 * English instruction about how to answer it, which is how a patient learns to
 * ignore the second half.
 *
 * ── What is deliberately NOT here
 *
 * `field.label` is not translated, and must not be: it is the clinician-facing
 * name in the rendered case, and a doctor reading a Tamil patient's chart reads
 * it in English. `field.choices` are not translated either — the tokens ARE the
 * stored value. `choiceLabels` gives a token a spoken form; it never replaces
 * it. A client must send the token back, never the label, and a label sent as a
 * value fails `validateFieldValue` and leaves the field `not_assessed` rather
 * than recording a word nothing else understands.
 *
 * Nothing in the safety engine or the clinical state reads any of this. Red
 * flags fire on presences and validated values, in every language identically;
 * see the note at the top of `safety-engine.ts`.
 */

import {
  FieldDefinition,
  GROUP_TEMPLATE_FIELD_KEYS,
  STATIC_FIELDS,
  groupTemplateKey,
} from './field-registry';
import { FieldKind } from './tri-state';
import { AsideIntent } from './aside';
import { ConversationPhrases } from './conversation';
import { normaliseLanguage } from '../../../common/constants/language.constants';

/**
 * The answer hint for each field kind, in English.
 *
 * Lifted out of `fallbackPhrasing`'s switch so that the English wording and
 * every translation of it are the same kind of thing in the same shape. While
 * these were string literals inside a switch, "translate the questions" looked
 * like a smaller job than it is: half of what the patient hears was in the
 * control flow rather than in the data.
 *
 * `{choices}` is substituted with the spoken choice list. An empty string means
 * the question stands on its own and no hint is appended — note that this is
 * not the same as a missing entry, which falls back to English.
 */
export const ENGLISH_ANSWER_HINTS: Readonly<Record<FieldKind, string>> = {
  boolean: 'You can answer yes or no.',
  choice: 'You can say: {choices}.',
  scale: 'Please give a number from 0 to 10.',
  number: 'Please give a number.',
  duration: 'For example: three days, or two weeks.',
  text: '',
};

export const ENGLISH_LIST_CONJUNCTION = 'or';

/**
 * What the interview says back when the patient interrupts, in English.
 *
 * ── Why this is data and not a model
 *
 * A patient who interrupts an intake interview asks a small number of things,
 * and two of them are questions this system must never answer: "is it
 * serious?" and "what's wrong with me?". A language model asked to be
 * conversational will answer them — helpfully, fluently, and with nobody in the
 * room who is allowed to say it. So the replies live here, in the same file as
 * the questions, under the same rule: written down, reviewable in a diff, and
 * translated by the same route.
 *
 * Every line is followed by the question being asked again, which is why none
 * of them ends by inviting a reply. They are an acknowledgement, not a turn.
 *
 * ── The register
 *
 * Same as the questions: plain, specific, about the patient. Two lines are
 * load-bearing beyond their wording.
 *
 *   • `is_it_serious` must decline without dismissing. "I can't tell you that"
 *     on its own leaves a frightened person with nothing, so it says who can,
 *     and what to do if waiting stops being safe — which is the same routing
 *     instruction the safety engine gives, in the same words.
 *   • `want_human` must never read as a refusal. A patient asking for a person
 *     gets told how to get one, and the interview offers to continue rather
 *     than insisting on it.
 */
export const ENGLISH_ASIDE_REPLIES: Readonly<Record<AsideIntent, string>> =
  Object.freeze({
    repeat: 'Of course.',
    // Not "let me put that another way": the question that follows is the same
    // question, word for word, because re-wording a clinical question on the
    // fly is the thing the note at the top of this file forbids. A line that
    // promises a rephrasing and then repeats itself reads as a machine that is
    // not listening, which is the impression this whole path exists to avoid.
    not_understood: 'No problem. Let me ask it again.',
    why_ask:
      'It helps the doctor see the whole picture before they see you. You can ' +
      'skip anything you would rather not answer.',
    how_long:
      'Not much longer. There are a few questions left, and you can stop at ' +
      'any point.',
    is_it_serious:
      'I cannot tell you that. I am only writing down what you say, and the ' +
      'doctor will go through it with you. If you feel worse while you are ' +
      'waiting, tell the front desk straight away.',
    want_human:
      'Of course. Tell the front desk and someone will come to you. We can ' +
      'carry on here in the meantime.',
    who_are_you:
      'I am not a person. I take down your answers so the doctor has them ' +
      'before they see you.',
    greeting: 'Hello.',
    thanks: 'You are welcome.',
    wait: 'Take your time.',
    unrelated:
      'I hear you. I can only take down your answers for the doctor, and the ' +
      'front desk can help with anything else.',
  });

/**
 * Who wrote the words in a phrasebook — recorded separately from whether
 * anybody has checked them.
 *
 * `reviewedAt` answers "has a clinician signed this off?" and nothing else. It
 * cannot also answer "where did this text come from?", and the difference
 * matters: a human translator's unreviewed draft and a language model's
 * unreviewed draft are both unreviewed, and they are not the same risk. A
 * machine draft can be fluent, plausible and wrong in a way that reads as
 * correct — which is the failure mode the note at the top of this file is
 * about — so the file records which one it is holding rather than leaving a
 * reader to infer it from the commit history.
 */
export const PHRASEBOOK_SOURCES = ['human_draft', 'machine_draft'] as const;

export type PhrasebookSource = (typeof PHRASEBOOK_SOURCES)[number];

/**
 * The environment variable that permits an unreviewed phrasebook to be spoken.
 *
 * ── What it is for
 *
 * Absent, or anything other than the exact string `true`, `phrasebookFor`
 * refuses every book with a null `reviewedAt` and the interview runs in
 * English. That is the default, it is the behaviour this file shipped with, and
 * it is the correct behaviour anywhere a real patient is sitting.
 *
 * It exists because there is a second, legitimate situation: proving a
 * translation works end to end — that the question comes back in Devanagari,
 * that Piper reads it, that Whisper hears it back — which cannot be done while
 * the gate is shut, and which has to happen BEFORE a clinician is asked to
 * spend an afternoon on 130 sentences. Turning it on is a deployment-level act
 * that shows up in that deployment's configuration and in its startup log, not
 * a boolean somebody flipped in a source file.
 *
 * ── What it is NOT
 *
 * It is not a review, and it cannot become one. It never writes `reviewedAt`,
 * it is not per-language, and `phrasebookCoverage` keeps reporting
 * `reviewedAt: null` and `source: 'machine_draft'` while it is on. The only
 * thing it changes is whether the gate is open; everything that says the
 * wording is unchecked keeps saying so.
 *
 * ── Why this reads `process.env` rather than taking a ConfigService
 *
 * §13 says application code reads configuration through ConfigModule, and it
 * should. This is not application code: `phrasingFor` is a pure function called
 * from `selectNext`, which is called from pure engine code that has no injector
 * and must stay synchronous and total — threading a Nest provider into it would
 * turn the question selector into something that cannot be unit-tested without
 * a module. `load-env.ts` exists for exactly this class of reader (its comment
 * has the story) and guarantees the variable is populated before anything here
 * is imported. The one concession to the convention that matters is that the
 * variable is DECLARED and validated in `validation.schema.ts` like every
 * other, so it is documented in one place and a typo in `.env` is a boot
 * failure rather than a silently-off flag. This is the only place that reads
 * it; `main.ts` and the languages endpoint both call the function below.
 */
export const ALLOW_UNREVIEWED_PHRASEBOOKS_ENV =
  'MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS';

/**
 * Read on every lookup rather than captured at import, so a test can turn it on
 * and off without re-importing the module. The cost is one environment read per
 * question selected, which is nothing next to the database write that follows.
 */
export function allowingUnreviewedPhrasebooks(): boolean {
  return process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] === 'true';
}

/**
 * Every language that is being spoken to patients without anybody having
 * checked the wording, in code order. Empty unless the override is on.
 *
 * The startup warning and the languages endpoint are both built from this, so
 * "why is this interview in Tamil?" is answerable from the log and from the
 * API rather than from the source.
 */
export function unreviewedLanguagesInUse(): readonly string[] {
  if (!allowingUnreviewedPhrasebooks()) return [];
  return Object.values(PHRASEBOOKS)
    .filter((book) => book.reviewedAt === null)
    .map((book) => book.language);
}

export interface QuestionPhrasebook {
  /** ISO 639-1 primary subtag. Must be a language `language.constants.ts` knows. */
  readonly language: string;
  /** Who drafted the wording. Says nothing about whether anyone checked it. */
  readonly source: PhrasebookSource;
  /**
   * When a clinician who reads this language signed the wording off, or `null`
   * while nobody has.
   *
   * **An unreviewed phrasebook is never spoken to a patient**, unless the
   * deployment has explicitly set `ALLOW_UNREVIEWED_PHRASEBOOKS_ENV`, which is
   * for proving a translation pipeline works and not for a waiting room.
   * Otherwise `phrasingFor` skips it and the interview stays in English, which
   * is legible and correct and merely inconvenient. This is not ceremony: an
   * unreviewed clinical translation is the same failure as a live model one — a
   * question that has quietly become a different question — and the only
   * difference is which machine wrote it. Flipping this to a date is a human
   * act and is meant to look like one in the diff.
   */
  readonly reviewedAt: string | null;
  /**
   * Field path to the question, in this language. Partial; misses fall back.
   *
   * Repeated-group fields are keyed on their template — `medications[].name`,
   * not `medications[0].name` — because the indexed paths only exist once a
   * particular patient has an item at that index.
   */
  readonly questions: Readonly<Record<string, string>>;
  /** Field kind to the answer hint. `{choices}` is substituted as in English. */
  readonly answerHints: Readonly<Partial<Record<FieldKind, string>>>;
  /** Choice token to its spoken form. The token itself is never replaced. */
  readonly choiceLabels: Readonly<Record<string, string>>;
  /** What joins the last two items of a spoken choice list. */
  readonly listConjunction: string;
  /**
   * What the interview says back to an interruption, by intent. Partial;
   * misses fall back to `ENGLISH_ASIDE_REPLIES`.
   *
   * A book may translate the questions and not these, and that is a legitimate
   * intermediate state rather than a bug — a Hindi interview that answers "why
   * do you ask?" in English is worse than one that answers it in Hindi and
   * better than one that does not answer it at all.
   */
  readonly asides: Readonly<Partial<Record<AsideIntent, string>>>;
  /**
   * The words between the questions — what makes this a conversation rather
   * than a form. See `conversation.ts`.
   *
   * Optional, and a language without it simply asks its questions bare, which
   * is what every language did before this existed.
   */
  readonly conversation?: ConversationPhrases;
}

const ENGLISH_CONVERSATION: ConversationPhrases = Object.freeze({
  acknowledgements: Object.freeze({
    // Three of each, rotated by turn index. Two would alternate visibly; four
    // is more wording than anybody has to review for no more variety.
    recorded: Object.freeze(['Alright.', 'Thank you.', 'I have that.']),
    // Never "Good." A "no" to "are you taking any medicines" is not good news
    // and not bad news, and the interview has no business grading it.
    none: Object.freeze(['Alright.', 'Noted.', 'Thank you.']),
    unknown: Object.freeze(["That's alright.", 'No problem.', 'That is fine.']),
    declined: Object.freeze(['Of course.', 'That is fine.', 'Understood.']),
  }),
  sections: Object.freeze({
    hpi: 'Now a little more detail.',
    ros: 'Now a few quick questions about the rest of your body.',
    past_medical: 'Now about your health in the past.',
    surgical: 'Next, about any operations you have had.',
    medications: 'Now about any medicines you take.',
    allergies: 'Next, about allergies.',
    family: 'Now about your family.',
    social: 'A few questions about your daily life.',
    ayush: 'Now a few questions in the Ayurvedic tradition.',
    investigations: 'Lastly, about any tests you have had.',
  }),
});

const TAMIL_CONVERSATION: ConversationPhrases = Object.freeze({
  acknowledgements: Object.freeze({
    recorded: Object.freeze(['சரி.', 'நன்றி.', 'குறித்துக் கொண்டேன்.']),
    none: Object.freeze(['சரி.', 'குறித்துக் கொண்டேன்.', 'நன்றி.']),
    unknown: Object.freeze([
      'பரவாயில்லை.',
      'சரி, பரவாயில்லை.',
      'கவலை வேண்டாம்.',
    ]),
    declined: Object.freeze(['சரி.', 'பரவாயில்லை.', 'புரிகிறது.']),
  }),
  sections: Object.freeze({
    hpi: 'அதைப் பற்றி இன்னும் கொஞ்சம் கேட்கிறேன்.',
    ros: 'இப்போது உடலின் மற்ற பகுதிகளைப் பற்றி சில கேள்விகள்.',
    past_medical: 'இப்போது உங்கள் கடந்தகால உடல்நிலை பற்றி.',
    surgical: 'அடுத்து, நீங்கள் செய்த அறுவை சிகிச்சைகள் பற்றி.',
    medications: 'இப்போது நீங்கள் எடுக்கும் மருந்துகள் பற்றி.',
    allergies: 'அடுத்து, ஒவ்வாமை பற்றி.',
    family: 'இப்போது உங்கள் குடும்பம் பற்றி.',
    social: 'உங்கள் அன்றாட வாழ்க்கை பற்றி சில கேள்விகள்.',
    ayush: 'இப்போது ஆயுர்வேத முறையில் சில கேள்விகள்.',
    investigations: 'கடைசியாக, நீங்கள் செய்த பரிசோதனைகள் பற்றி.',
  }),
});

const HINDI_CONVERSATION: ConversationPhrases = Object.freeze({
  acknowledgements: Object.freeze({
    recorded: Object.freeze(['ठीक है।', 'धन्यवाद।', 'मैंने लिख लिया।']),
    none: Object.freeze(['ठीक है।', 'नोट कर लिया।', 'धन्यवाद।']),
    unknown: Object.freeze([
      'कोई बात नहीं।',
      'ठीक है, कोई बात नहीं।',
      'चिंता मत कीजिए।',
    ]),
    declined: Object.freeze(['ज़रूर।', 'कोई बात नहीं।', 'समझ गया।']),
  }),
  sections: Object.freeze({
    hpi: 'इसके बारे में थोड़ा और पूछता हूँ।',
    ros: 'अब शरीर के बाक़ी हिस्सों के बारे में कुछ छोटे सवाल।',
    past_medical: 'अब आपकी पुरानी सेहत के बारे में।',
    surgical: 'आगे, आपके किसी ऑपरेशन के बारे में।',
    medications: 'अब आपकी दवाइयों के बारे में।',
    allergies: 'आगे, एलर्जी के बारे में।',
    family: 'अब आपके परिवार के बारे में।',
    social: 'आपकी रोज़मर्रा की ज़िंदगी के बारे में कुछ सवाल।',
    ayush: 'अब आयुर्वेद की दृष्टि से कुछ सवाल।',
    investigations: 'आख़िर में, आपकी जाँचों के बारे में।',
  }),
});

/**
 * The conversational wording for a language, or undefined for one with none.
 *
 * English is answered directly rather than through `phrasebookFor`, because
 * English is not a translation — it is the source, and `phrasebookFor` returns
 * undefined for it by design. Every other language goes through the gate, so an
 * unreviewed book's acknowledgements are as unspoken as its questions.
 */
export function conversationFor(
  language?: string,
): ConversationPhrases | undefined {
  const code = normaliseLanguage(language);
  if (code === '' || code === 'en') return ENGLISH_CONVERSATION;
  return phrasebookFor(code)?.conversation;
}

/**
 * Every phrasebook that exists, keyed by language.
 *
 * Checked in, imported, frozen — not read from disk, not fetched, not built at
 * boot. A translation that can fail to load is a question that can fail to be
 * asked, and the interview has to work on a box with no network at all (§42).
 *
 * English is deliberately absent. English is not a translation of the registry,
 * it *is* the registry: `field.prompt` and `ENGLISH_ANSWER_HINTS` are the
 * source text. An `en` phrasebook would be a second copy of it, free to drift,
 * and the first thing to drift would be the question a red-flag rule depends on.
 */
export const PHRASEBOOKS: Readonly<Record<string, QuestionPhrasebook>> =
  Object.freeze({
    // Nine more rows go here, one per language, each added by the same route:
    // a translator drafts it, a clinician who reads the language signs it off,
    // and `reviewedAt` gets a date in the same commit.
    hi: hiPhrasebook(),
    ta: taPhrasebook(),
  });

/**
 * The phrasebook to use for a language, or `undefined` for English, an unknown
 * language, or one whose translation nobody has reviewed yet.
 *
 * The last of those three is conditional on
 * `ALLOW_UNREVIEWED_PHRASEBOOKS_ENV`: unset, an unreviewed book is invisible
 * here and the caller gets English. That is the shipped default.
 */
export function phrasebookFor(
  language: string | undefined,
): QuestionPhrasebook | undefined {
  const code = normaliseLanguage(language);
  if (code === '' || code === 'en') return undefined;
  const book = Object.prototype.hasOwnProperty.call(PHRASEBOOKS, code)
    ? PHRASEBOOKS[code]
    : undefined;
  if (!book) return undefined;
  if (book.reviewedAt !== null) return book;
  return allowingUnreviewedPhrasebooks() ? book : undefined;
}

/**
 * The question as the patient hears it.
 *
 * Every lookup falls back to English independently, and that is a considered
 * choice rather than an accident of writing it with `??`. A translated question
 * followed by an English hint is a worse sentence than two translated halves
 * and a better one than an English question: the question carries the clinical
 * content, and a patient who can read the question can act on it. What must
 * never happen is a wrong-language string or an empty prompt, and neither can:
 * the English source is always present, because it is the registry.
 *
 * A phrasebook with holes in it is therefore usable rather than rejected — but
 * the holes are visible. `phrasebookCoverage` lists them, so "half of Tamil is
 * missing" is something a deployment check reports rather than something a
 * patient discovers.
 */
export function phrasingFor(field: FieldDefinition, language?: string): string {
  return composePhrasing(field, phrasebookFor(language));
}

/**
 * What to say back to an interruption, in the interview's output language.
 *
 * Total: every intent has an English line, so this never returns an empty
 * string and a caller never has to hold a fallback for it. That is deliberate
 * and it is the same guarantee `fallbackPhrasing` gives — a patient who
 * interrupts gets an answer on a box with no network, no model and no
 * translation, because the only thing worse than a stilted acknowledgement is
 * silence where one was expected.
 *
 * The language is the session's OUTPUT language, not the patient's input one.
 * Same rule as the questions and for the same reason: what the patient *reads
 * and hears* is one language, what they *speak* is another, and the two are
 * routed separately in `loadState`.
 */
/**
 * The language this interview will actually be conducted in.
 *
 * ── The decision this encodes
 *
 * A patient picks the language they speak. What they *read and hear* used to be
 * English on every session without exception — `DEFAULT_OUTPUT_LANGUAGE` — and
 * the reason was written down beside that constant and was a good one: ten of
 * the eleven Indian languages had no phrasebook, and answering in a language
 * whose questions nobody had written would have meant answering in English
 * anyway, or worse, in a live machine translation.
 *
 * That is no longer true of every language. Where a usable phrasebook exists,
 * the interview is conducted in the patient's own language — questions, spoken
 * prompts, aside replies, all of it — and where one does not, it is conducted
 * in English exactly as before.
 *
 * ── Why `phrasebookFor` is the authority
 *
 * Because it is the function that actually renders the questions, and it
 * applies the review gate: an unreviewed book is invisible to it unless the
 * deployment has set `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS`. Deciding the
 * output language from `PHRASEBOOKS` directly would set a session to Tamil and
 * then render it in English, and the session row would be the half of that pair
 * that lied. Here the two cannot disagree: if the book will not be spoken, the
 * session is not put into it.
 */
export function interviewLanguageFor(inputLanguage?: string): string {
  const code = normaliseLanguage(inputLanguage);
  return phrasebookFor(code) ? code : 'en';
}

export function asideReplyFor(intent: AsideIntent, language?: string): string {
  const book = phrasebookFor(language);
  const translated = book?.asides[intent]?.trim();
  return translated || ENGLISH_ASIDE_REPLIES[intent];
}

/**
 * The question with no answer hint — what a person would actually say.
 *
 * [phrasingFor] appends the shape of the expected answer: "You can answer yes
 * or no.", "You can say: mild, moderate, severe." That hint earns its place on
 * a screen with tiles under it, and it is the whole of §42's offline mode, but
 * it is written for an eye that can see the options.
 *
 * Spoken aloud, sixty times, it is not a conversation. Every question arrives
 * with the same clause welded to the end, and a patient who has just said "it
 * comes and goes, mostly at night" is told they can answer yes or no. The hint
 * is also the least necessary part of the spoken interview: the agent's Whisper
 * hears a sentence and the engine's `derivePresence` reads it, so "not really,
 * only when I climb stairs" is understood without anyone being coached into
 * saying "no".
 *
 * So the voice path speaks this and the touch path keeps [phrasingFor]. Same
 * registry, same translations, same question — one of them just stops telling
 * the patient how to talk.
 */
export function spokenPhrasingFor(
  field: FieldDefinition,
  language?: string,
): string {
  const book = phrasebookFor(language);
  const bare = (questionFor(book, field.key) ?? field.prompt).trim();
  // Never empty, and `social.age_band` is why: it carries no prompt of its own
  // because the interview never asks it — it is read off the patient record —
  // so the bare question is the empty string and its written form is the hint
  // alone, " You can say: infant, child, …". Returning that empty string would
  // hand a speaking client silence where a question should be. Nothing asks
  // this field today, which is exactly what makes it worth pinning: the rule is
  // that a spoken question is a question, and a field that acquires a prompt
  // later must not be the thing that discovers this.
  return bare || composePhrasing(field, book).trim();
}

/**
 * The composition, separated from the lookup.
 *
 * Two different jobs: `phrasebookFor` decides *which* book applies — language
 * normalisation, the English case, the unreviewed case — and this decides what
 * a question sounds like given one. All the fallback behaviour is here, which
 * is why this is the exported seam a test drives with a book it built itself.
 * `PHRASEBOOKS` is frozen and stays frozen; a test that had to unfreeze the
 * shipped registry to exercise the fallbacks would be testing a codebase
 * nobody runs.
 *
 * `undefined` means English, which is the registry's own text.
 */
export function composePhrasing(
  field: FieldDefinition,
  book: QuestionPhrasebook | undefined,
): string {
  const base = (questionFor(book, field.key) ?? field.prompt).trim();

  const template = hintTemplate(book, field.kind);
  if (template === '') return base;

  const hint = template.includes(CHOICES_PLACEHOLDER)
    ? substituteChoices(template, field, book)
    : template;

  if (hint === '') return base;
  // `base` is empty for a field that carries no prompt of its own — today only
  // `social.age_band`, which the interview never asks because it is read off
  // the patient record. Joining regardless produced a leading space: the
  // rendered question was " You can say: infant, child, …", a sentence starting
  // with a hole where the question should be. Never surfaced, because nothing
  // asks that field; still wrong, and it is the kind of wrong that shows up on
  // a projector the first time somebody gives the field a prompt.
  return base === '' ? hint : `${base} ${hint}`;
}

const CHOICES_PLACEHOLDER = '{choices}';

/**
 * The translated question for a field path, exact match first and the
 * repeated-group template second.
 *
 * `medications[2].name` is the third medicine and asks the same question as the
 * first, so a book keyed on `medications[].name` answers for every index. The
 * exact key still wins if a book ever needs to say something different about
 * one index, which nothing does today and which costs one lookup to allow.
 *
 * Without this, a Hindi interview asked its first nine questions in Hindi and
 * then switched to English the moment the patient said they take a medicine —
 * and `phrasebookCoverage`, which measures the static registry, reported full
 * coverage while it happened.
 */
function questionFor(
  book: QuestionPhrasebook | undefined,
  fieldKey: string,
): string | undefined {
  if (!book) return undefined;
  const exact = book.questions[fieldKey];
  if (typeof exact === 'string') return exact;
  const template = book.questions[groupTemplateKey(fieldKey)];
  return typeof template === 'string' ? template : undefined;
}

/**
 * A hint the phrasebook does not carry falls back to English, and a hint the
 * ENGLISH table does not carry falls back to no hint at all.
 *
 * The second case is reachable: `kind` comes from data a deployment may extend
 * with a new input widget, and an unknown widget should still ask its question
 * rather than crash the interview. `fallbackPhrasing`'s switch made the same
 * choice in its `default` branch and for the same reason.
 */
function hintTemplate(
  book: QuestionPhrasebook | undefined,
  kind: FieldKind,
): string {
  const translated = book?.answerHints[kind];
  if (typeof translated === 'string') return translated;
  return ENGLISH_ANSWER_HINTS[kind] ?? '';
}

function substituteChoices(
  template: string,
  field: FieldDefinition,
  book: QuestionPhrasebook | undefined,
): string {
  const choices = field.choices ?? [];
  // A choice field with no choices gets no hint rather than "You can say: ." —
  // the same outcome the old switch produced by returning the bare base.
  if (choices.length === 0) return '';

  const spoken = choices.map((token) => spokenChoice(token, book));
  const conjunction = book?.listConjunction ?? ENGLISH_LIST_CONJUNCTION;
  return template.replace(
    CHOICES_PLACEHOLDER,
    joinWithList(spoken, conjunction),
  );
}

/**
 * The word a patient hears for a choice token.
 *
 * The token is stored in snake_case for the state, so English speaks it by
 * replacing the underscores. A phrasebook that has no word for a token falls
 * back to that — a Tamil question offering `crushing` is poor, and it is still
 * better than offering nothing, and `phrasebookCoverage` says it is happening.
 */
function spokenChoice(
  token: string,
  book: QuestionPhrasebook | undefined,
): string {
  const translated = book?.choiceLabels[token];
  return typeof translated === 'string' && translated.length > 0
    ? translated
    : token.replace(/_/g, ' ');
}

function joinWithList(items: readonly string[], conjunction: string): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

export interface PhrasebookCoverage {
  readonly language: string;
  readonly source: PhrasebookSource;
  readonly reviewedAt: string | null;
  /** Whether this book is actually being spoken right now, gate and all. */
  readonly spoken: boolean;
  readonly translatedQuestions: number;
  readonly totalQuestions: number;
  /** Field paths with no translation, sorted. These are asked in English. */
  readonly missingQuestions: readonly string[];
  /** Field kinds with no translated answer hint, sorted. */
  readonly missingAnswerHints: readonly string[];
}

/**
 * What a phrasebook does and does not cover.
 *
 * Exists so that an incomplete translation is an operational fact rather than
 * something a patient runs into. A deployment check can refuse to mark a
 * language reviewed while `missingQuestions` is non-empty; a test can assert
 * that the worked example really is partial, which is the only way the fallback
 * path gets exercised.
 */
export function phrasebookCoverage(
  language: string,
  fields: readonly FieldDefinition[] = STATIC_FIELDS,
): PhrasebookCoverage | null {
  const code = normaliseLanguage(language);
  const book = Object.prototype.hasOwnProperty.call(PHRASEBOOKS, code)
    ? PHRASEBOOKS[code]
    : undefined;
  if (!book) return null;

  const missingQuestions = fields
    .filter((field) => questionFor(book, field.key) === undefined)
    .map((field) => field.key)
    .sort();

  const kinds = [...new Set(fields.map((field) => field.kind))].sort();
  const missingAnswerHints = kinds.filter(
    (kind) => typeof book.answerHints[kind] !== 'string',
  );

  return {
    language: book.language,
    source: book.source,
    reviewedAt: book.reviewedAt,
    spoken: phrasebookFor(book.language) !== undefined,
    translatedQuestions: fields.length - missingQuestions.length,
    totalQuestions: fields.length,
    missingQuestions,
    missingAnswerHints,
  };
}

/* ─────────────────────────── the worked example ─────────────────────────── */

/**
 * Tamil — the shape, proven, and NOT a translation anybody may ship.
 *
 * `reviewedAt` is null, so `phrasingFor` will not use a word of it: a Tamil
 * interview asks its questions in English today. That is the correct state of
 * the world. This file's job was to build the mechanism, and writing eleven
 * languages' worth of clinical questions is not a job for whoever happens to be
 * editing the backend — a mistranslated "Does the pain spread to your arm?"
 * changes what the chart says, and the only person who can catch that is a
 * clinician who reads Tamil.
 *
 * It is deliberately partial: four questions out of the registry's many, and
 * only three of the five answer hints. The holes are the point. They are what
 * `phrasebook.spec.ts` uses to prove that a missing translation produces the
 * English question rather than an empty one, and what `phrasebookCoverage`
 * reports.
 *
 * TO FINISH A LANGUAGE: fill `questions` for every field in `STATIC_FIELDS`,
 * fill all five `answerHints` and every choice token, have a clinician who
 * reads the language check that each question asks what the English asks, and
 * set `reviewedAt` to the date they did it — in the same commit, by them.
 */
function taPhrasebook(): QuestionPhrasebook {
  return Object.freeze({
    language: 'ta',
    source: 'human_draft' as const,
    reviewedAt: null,
    questions: Object.freeze({
      'chief_complaint.symptom': 'இன்று உங்களை மிகவும் சிரமப்படுத்துவது என்ன?',
      'hpi.duration': 'இந்தப் பிரச்சினை உங்களுக்கு எவ்வளவு காலமாக இருக்கிறது?',
      'hpi.onset':
        'இது திடீரென ஒரே நேரத்தில் ஆரம்பித்ததா, அல்லது கொஞ்சம் கொஞ்சமாக அதிகரித்ததா?',
      'hpi.location':
        'இது சரியாக எங்கே இருக்கிறது? கையால் காட்டலாம், அல்லது சொல்லலாம்.',
      'hpi.character':
        'இந்த உணர்வு எப்படி இருக்கிறது — எரிச்சலா, அழுத்தமா, கூர்மையா, மந்தமா, பிடிப்பா, அல்லது துடிப்பா?',
      'hpi.severity':
        'ஒன்றுமே இல்லை என்பதில் இருந்து நீங்கள் நினைக்கக்கூடிய மிக மோசமான நிலை வரை, இப்போது இது எந்த அளவில் இருக்கிறது? பூஜ்ஜியம் முதல் பத்து வரை.',
      'hpi.timing':
        'இது எப்போதும் இருக்கிறதா, அல்லது வந்து போகிறதா? நாளின் ஏதேனும் ஒரு நேரத்தில் அதிகமாக இருக்கிறதா?',
      'hpi.frequency':
        'இது எத்தனை முறை வருகிறது — ஒரு நாளைக்கு அல்லது ஒரு வாரத்திற்கு எத்தனை முறை?',
      'hpi.progression':
        'ஆரம்பித்ததில் இருந்து இது அதிகமாகிறதா, குறைகிறதா, அல்லது அப்படியே இருக்கிறதா?',
      'hpi.radiation':
        'இந்த உணர்வு ஒரே இடத்தில் இருக்கிறதா, அல்லது எங்காவது பரவுகிறதா — கை, தாடை, முதுகு அல்லது தோள்பட்டைக்கு?',
      'hpi.aggravating_factors': 'இதை அதிகமாக்கும் ஏதாவது இருக்கிறதா?',
      'hpi.relieving_factors':
        'இதைக் குறைக்கும் ஏதாவது இருக்கிறதா — ஓய்வு, மாத்திரை, அல்லது ஒரு நிலை?',
      'hpi.previous_episodes':
        'இதே பிரச்சினை உங்களுக்கு முன்பு வந்திருக்கிறதா?',
      'hpi.associated.breathlessness':
        'இதனுடன் சேர்ந்து மூச்சு விட சிரமமாக இருக்கிறதா?',
      'hpi.associated.sweating':
        'உழைப்பு இல்லாமலேயே இதனுடன் அதிகமாக வியர்க்கிறதா?',
      'hpi.associated.nausea': 'இதனுடன் சேர்ந்து குமட்டல் இருக்கிறதா?',
      'hpi.associated.palpitations':
        'இதனுடன் உங்கள் இதயம் வேகமாக அடிப்பது போல் தோன்றுகிறதா?',
      'hpi.associated.fainting':
        'நீங்கள் மயங்கி விழுந்தீர்களா, அல்லது விழுவது போல் உணர்ந்தீர்களா?',
      'hpi.associated.fever': 'இதனுடன் சேர்ந்து காய்ச்சல் இருந்ததா?',
      'ros.constitutional.fever': 'சமீபத்தில் உங்களுக்கு காய்ச்சல் இருந்ததா?',
      'ros.constitutional.rigors':
        'நிறுத்த முடியாத அளவுக்கு நடுக்கத்துடன் கூடிய குளிர் இருந்ததா?',
      'ros.constitutional.weight_loss':
        'முயற்சி எதுவும் இல்லாமல் உங்கள் எடை குறைந்திருக்கிறதா?',
      'ros.constitutional.appetite_loss': 'உங்கள் பசி குறைந்திருக்கிறதா?',
      'ros.constitutional.fatigue':
        'வழக்கத்திற்கு மாறாக சோர்வாக இருக்கிறீர்களா?',
      'ros.cardiovascular.chest_pain':
        'உங்கள் நெஞ்சில் வலி அல்லது இறுக்கம் இருக்கிறதா?',
      'ros.cardiovascular.breathlessness_on_exertion':
        'முன்பு எளிதாகச் செய்த வேலைகளைச் செய்யும்போது இப்போது மூச்சு வாங்குகிறதா?',
      'ros.cardiovascular.breathless_lying_flat':
        'நேராகப் படுக்கும்போது மூச்சு வாங்குகிறதா, அல்லது தூங்க கூடுதல் தலையணை தேவைப்படுகிறதா?',
      'ros.cardiovascular.ankle_swelling':
        'உங்கள் கால்கள் அல்லது கணுக்கால்கள் வீங்கியிருக்கிறதா?',
      'ros.respiratory.breathless_at_rest':
        'சும்மா உட்கார்ந்திருக்கும்போதே மூச்சு வாங்குகிறதா?',
      'ros.respiratory.cannot_complete_sentences':
        'ஒரு வாக்கியத்தை முடிக்கும் முன்பே மூச்சுக்காக நிற்க வேண்டியிருக்கிறதா?',
      'ros.respiratory.fast_breathing':
        'உங்கள் மூச்சு வழக்கத்தை விட வேகமாக இருக்கிறதா?',
      'ros.respiratory.cough': 'உங்களுக்கு இருமல் இருக்கிறதா?',
      'ros.respiratory.blood_in_sputum': 'இருமும்போது ரத்தம் ஏதேனும் வந்ததா?',
      'ros.respiratory.wheeze':
        'மூச்சு விடும்போது நெஞ்சில் விசில் போன்ற சத்தம் வருகிறதா?',
      'ros.gastrointestinal.abdominal_pain':
        'உங்கள் வயிற்றில் ஏதேனும் வலி இருக்கிறதா?',
      'ros.gastrointestinal.vomiting_blood':
        'வாந்தியில் ரத்தம் வந்ததா, அல்லது காபித் தூள் போன்ற ஏதாவது வந்ததா?',
      'ros.gastrointestinal.black_stools':
        'உங்கள் மலம் தார் போல கருப்பாகவும் ஒட்டும் தன்மையுடனும் இருந்ததா?',
      'ros.gastrointestinal.blood_in_stool':
        'மலம் கழிக்கும்போது புதிய ரத்தம் தெரிந்ததா?',
      'ros.gastrointestinal.vomiting': 'உங்களுக்கு வாந்தி இருக்கிறதா?',
      'ros.gastrointestinal.diarrhoea': 'உங்களுக்கு பேதி இருக்கிறதா?',
      'ros.gastrointestinal.constipation': 'உங்களுக்கு மலச்சிக்கல் இருக்கிறதா?',
      'ros.gastrointestinal.jaundice':
        'உங்கள் கண்கள் அல்லது தோல் மஞ்சளாகத் தெரிந்ததா?',
      'ros.gastrointestinal.difficulty_swallowing':
        'உணவு அல்லது தண்ணீர் விழுங்குவது கடினமாக இருக்கிறதா?',
      'ros.neurological.sudden_worst_headache':
        'திடீரென ஆரம்பித்து, இதுவரை இல்லாத அளவுக்கு மோசமான தலைவலி வந்ததா?',
      'ros.neurological.face_droop':
        'உங்கள் முகத்தின் ஒரு பக்கம் தொங்கியதா, அல்லது சிரிப்பு சமமாக இல்லாமல் இருக்கிறதா?',
      'ros.neurological.arm_weakness':
        'ஒரு கை அல்லது ஒரு கால் திடீரென பலவீனமாகவோ கனமாகவோ ஆனதா?',
      'ros.neurological.speech_difficulty':
        'உங்கள் பேச்சு குழறுகிறதா, அல்லது வார்த்தைகள் வர சிரமமாக இருக்கிறதா?',
      'ros.neurological.sudden_vision_loss':
        'திடீரென பார்வை போனதா, அல்லது இரட்டையாகத் தெரிந்ததா?',
      'ros.neurological.seizure': 'உங்களுக்கு வலிப்பு ஏதேனும் வந்ததா?',
      'ros.neurological.confusion':
        'நீங்கள் குழப்பமாகவோ வழக்கத்திற்கு மாறாக தூக்கமாகவோ இருந்தீர்களா, அல்லது மற்றவர்கள் அப்படிச் சொன்னார்களா?',
      'ros.neurological.headache': 'உங்களுக்கு தலைவலி வருகிறதா?',
      'ros.neurological.numbness':
        'உங்களுக்கு எங்காவது மரத்துப்போதல் அல்லது ஊசி குத்துவது போன்ற உணர்வு வருகிறதா?',
      'ros.genitourinary.burning_urination':
        'சிறுநீர் கழிக்கும்போது எரிச்சல் இருக்கிறதா?',
      'ros.genitourinary.blood_in_urine': 'சிறுநீரில் ரத்தம் தெரிந்ததா?',
      'ros.genitourinary.reduced_urine_output':
        'வழக்கத்தை விட மிகக் குறைவாக சிறுநீர் கழிக்கிறீர்களா?',
      'ros.genitourinary.pregnancy_possible':
        'நீங்கள் கர்ப்பமாக இருக்க ஏதேனும் வாய்ப்பு உள்ளதா?',
      'ros.genitourinary.vaginal_bleeding':
        'பெண் உறுப்பில் இருந்து ரத்தப்போக்கு ஏதேனும் இருந்ததா?',
      'ros.musculoskeletal.joint_pain':
        'உங்கள் மூட்டுகளில் ஏதேனும் வலி இருக்கிறதா?',
      'ros.musculoskeletal.joint_swelling':
        'ஏதேனும் மூட்டு வீங்கியோ சூடாகவோ இருக்கிறதா?',
      'ros.musculoskeletal.back_pain': 'உங்களுக்கு முதுகு வலி இருக்கிறதா?',
      'ros.musculoskeletal.recent_injury':
        'சமீபத்தில் நீங்கள் விழுந்தீர்களா, அல்லது ஏதேனும் காயம் ஏற்பட்டதா?',
      'ros.dermatological.rash': 'உங்கள் தோலில் ஏதேனும் தடிப்பு இருக்கிறதா?',
      'ros.dermatological.sudden_widespread_rash':
        'உடலின் பெரும் பகுதியில் திடீரென தடிப்பு வந்ததா?',
      'ros.dermatological.itching': 'உங்கள் தோலில் அரிப்பு இருக்கிறதா?',
      'ros.psychiatric.low_mood':
        'சமீபத்தில் மனச்சோர்வாகவோ நம்பிக்கை இழந்தவராகவோ உணர்கிறீர்களா?',
      'ros.psychiatric.self_harm_thoughts':
        'உங்களை நீங்களே காயப்படுத்திக் கொள்ளவோ, உயிரை மாய்த்துக் கொள்ளவோ ஏதேனும் எண்ணம் வந்ததா?',
      'ros.allergic.reaction_happening_now':
        'இப்போது ஒவ்வாமை எதிர்வினை நடந்து கொண்டிருக்கிறதா?',
      'ros.allergic.throat_or_lip_swelling':
        'உங்கள் உதடு, நாக்கு அல்லது தொண்டை வீங்குகிறதா, அல்லது தொண்டை இறுகுவது போல் இருக்கிறதா?',
      'ros.paediatric.not_feeding':
        'குழந்தை பால் குடிக்கவோ சாப்பிடவோ மறுக்கிறதா?',
      'ros.paediatric.unrousable':
        'குழந்தை வழக்கத்திற்கு மாறாக தூங்குகிறதா, அல்லது எழுப்ப கடினமாக இருக்கிறதா?',
      'ros.paediatric.convulsions': 'குழந்தைக்கு வலிப்பு ஏதேனும் வந்ததா?',
      'ros.paediatric.fast_breathing':
        'குழந்தை வழக்கத்தை விட வேகமாக மூச்சு விடுகிறதா, அல்லது விலா எலும்புகள் உள்ளே இழுக்கின்றனவா?',
      'ros.paediatric.sunken_eyes':
        'குழந்தையின் கண்கள் உள்வாங்கியிருக்கின்றனவா, அல்லது பல மணி நேரமாக சிறுநீர் கழிக்கவில்லையா?',
      'past_medical.diabetes':
        'உங்களுக்கு சர்க்கரை நோய் இருப்பதாக எப்போதாவது சொல்லப்பட்டதா?',
      'past_medical.hypertension':
        'உங்களுக்கு ரத்த அழுத்தம் இருப்பதாக எப்போதாவது சொல்லப்பட்டதா?',
      'past_medical.heart_disease':
        'இதயப் பிரச்சினைக்கு எப்போதாவது சிகிச்சை எடுத்திருக்கிறீர்களா?',
      'past_medical.asthma':
        'உங்களுக்கு ஆஸ்துமா அல்லது நீண்டகால சுவாசப் பிரச்சினை இருக்கிறதா?',
      'past_medical.kidney_disease':
        'உங்களுக்கு சிறுநீரகப் பிரச்சினை இருப்பதாகச் சொல்லப்பட்டதா?',
      'past_medical.liver_disease':
        'உங்களுக்கு கல்லீரல் பிரச்சினை இருப்பதாகச் சொல்லப்பட்டதா?',
      'past_medical.stroke_or_tia':
        'உங்களுக்கு எப்போதாவது பக்கவாதம் அல்லது சிறு பக்கவாதம் ஏற்பட்டதா?',
      'past_medical.cancer':
        'புற்றுநோய்க்கு எப்போதாவது சிகிச்சை எடுத்திருக்கிறீர்களா?',
      'past_medical.tuberculosis':
        'காசநோய்க்கு எப்போதாவது சிகிச்சை எடுத்திருக்கிறீர்களா?',
      'past_medical.thyroid_disorder':
        'உங்களுக்கு தைராய்டு பிரச்சினை இருப்பதாகச் சொல்லப்பட்டதா?',
      'past_medical.epilepsy':
        'வலிப்பு நோய்க்கு எப்போதாவது சிகிச்சை எடுத்திருக்கிறீர்களா?',
      'past_medical.bleeding_disorder':
        'மற்றவர்களை விட உங்களுக்கு எளிதாக ரத்தம் வருகிறதா, அல்லது தழும்பு ஏற்படுகிறதா?',
      'past_medical.previous_hospitalisation':
        'முன்பு எப்போதாவது மருத்துவமனையில் அனுமதிக்கப்பட்டிருக்கிறீர்களா?',
      'past_medical.other_conditions':
        'நாங்கள் கேட்காத வேறு ஏதேனும் நீண்டகால நோய் இருக்கிறதா?',
      'surgical.any_previous':
        'முன்பு எப்போதாவது அறுவை சிகிச்சை ஏதேனும் செய்யப்பட்டிருக்கிறதா?',
      'medications.any_current':
        'நீங்கள் இப்போது ஏதேனும் மருந்து எடுத்துக் கொள்கிறீர்களா — நீங்களே கடையில் வாங்கிக் கொள்பவை உட்பட?',
      'allergies.reported':
        'உங்களுக்கு ஏதேனும் ஒவ்வாமை உள்ளதா — மருந்து, உணவு, அல்லது வேறு எதுவும்?',
      'family.any_relevant':
        'உங்கள் நெருங்கிய குடும்பத்தில் யாருக்காவது நீண்டகால நோய் இருக்கிறதா — சர்க்கரை, ரத்த அழுத்தம், இதயப் பிரச்சினை அல்லது புற்றுநோய் போன்றவை?',
      'social.smoking':
        'நீங்கள் புகைபிடிக்கிறீர்களா, அல்லது முன்பு புகைபிடித்திருக்கிறீர்களா?',
      'social.tobacco_chewing':
        'நீங்கள் புகையிலை, வெற்றிலை பாக்கு அல்லது குட்கா மெல்கிறீர்களா?',
      'social.alcohol':
        'நீங்கள் மது அருந்துகிறீர்களா? அப்படியானால், சுமாராக எவ்வளவு அடிக்கடி?',
      'social.occupation': 'நீங்கள் என்ன வேலை செய்கிறீர்கள்?',
      'social.diet':
        'உங்கள் வழக்கமான உணவு என்ன — சைவமா, அசைவம் கலந்ததா, அல்லது வேறு ஏதாவதா?',
      'social.exercise':
        'ஒரு சாதாரண வாரத்தில் எவ்வளவு உடற்பயிற்சி செய்கிறீர்கள்?',
      'social.sleep': 'உங்கள் தூக்கம் எப்படி இருக்கிறது?',
      'social.exposure':
        'வேலையிலோ வீட்டிலோ நீங்கள் வழக்கமாக எதிர்கொள்ளும் ஏதாவது இருக்கிறதா — தூசி, ரசாயனங்கள், புகை, விலங்குகள்?',
      'ayush.prakriti_build':
        'உங்கள் வழக்கமான உடல் அமைப்பை எப்படிச் சொல்வீர்கள் — மெலிந்ததா, நடுத்தரமா, அல்லது கனமானதா?',
      'ayush.prakriti_climate_preference':
        'குளிரான காலநிலையா அல்லது வெப்பமான காலநிலையா — எதில் உங்களுக்கு வசதியாக இருக்கும்?',
      'ayush.agni_appetite':
        'உங்கள் பசி வழக்கமாக எப்படி இருக்கும் — நல்லதா, சாதாரணமா, நாளுக்கு நாள் மாறுமா, அல்லது குறைவாகவா?',
      'ayush.agni_digestion':
        'சாப்பிட்ட பிறகு வழக்கமாக வசதியாக இருக்கிறதா, கனமாக இருக்கிறதா, அல்லது எரிச்சலாக இருக்கிறதா?',
      'ayush.koshtha_bowel':
        'உங்கள் மலம் கழித்தல் வழக்கமாக எப்படி இருக்கும் — தினமும் சீராகவா, கெட்டியாகவா, அல்லது தளர்வாகவா?',
      'ayush.nidana_triggers':
        'இந்தப் பிரச்சினையை வழக்கமாக வரவழைக்கும் ஏதாவது கவனித்திருக்கிறீர்களா — ஒரு குறிப்பிட்ட உணவு, வேலை, பருவம், அல்லது நேரம்?',
      'ayush.ahara_vihara_routine':
        'உங்கள் ஒரு சாதாரண நாளைப் பற்றிச் சொல்லுங்கள் — எப்போது சாப்பிடுவீர்கள், எப்போது வேலை செய்வீர்கள், எப்போது தூங்குவீர்கள்.',
      'investigations.any_previous':
        'இதற்காக ஏதேனும் பரிசோதனை அல்லது ஸ்கேன் செய்திருக்கிறீர்களா, அல்லது உங்களிடம் அறிக்கைகள் இருக்கிறதா?',
      'medications[].name': 'அது எந்த மருந்து?',
      'medications[].strength': 'அதன் அளவு எவ்வளவு — உதாரணமாக 500 மி.கி?',
      'medications[].dose': 'ஒவ்வொரு முறையும் எத்தனை எடுத்துக் கொள்கிறீர்கள்?',
      'medications[].frequency':
        'ஒரு நாளைக்கு எத்தனை முறை எடுத்துக் கொள்கிறீர்கள்?',
      'medications[].route':
        'இதை எப்படி எடுத்துக் கொள்கிறீர்கள் — வாய்வழியாகவா, தடவுவதற்கா, உள்ளிழுப்பதற்கா, அல்லது ஊசியாகவா?',
      'medications[].timing': 'நாளின் எந்த நேரத்தில் எடுத்துக் கொள்கிறீர்கள்?',
      'medications[].duration': 'எவ்வளவு காலமாக இதை எடுத்துக் கொள்கிறீர்கள்?',
      'medications[].status':
        'இதை இப்போதும் எடுத்துக் கொள்கிறீர்களா, அல்லது நிறுத்திவிட்டீர்களா?',
      'allergies[].substance': 'எதனால் உங்களுக்கு ஒவ்வாமை?',
      'allergies[].type':
        'இது எந்த வகை — மருந்தா, உணவா, அல்லது சுற்றுச்சூழல் சார்ந்ததா?',
      'allergies[].reaction': 'அப்போது உங்களுக்கு என்ன ஆனது?',
      'allergies[].severity': 'அந்த எதிர்வினை எவ்வளவு கடுமையாக இருந்தது?',
      'surgical[].procedure': 'என்ன அறுவை சிகிச்சை செய்யப்பட்டது?',
      'surgical[].reason': 'அது எதற்காகச் செய்யப்பட்டது?',
      'surgical[].approximate_date': 'அது சுமாராக எப்போது நடந்தது?',
      'surgical[].hospital': 'எந்த மருத்துவமனையில் செய்யப்பட்டது?',
      'surgical[].complications': 'அதற்குப் பிறகு ஏதேனும் பிரச்சினை ஏற்பட்டதா?',
      'family[].condition': 'அவர்களுக்கு என்ன நோய்?',
      'family[].relation': 'அவர் உங்களுக்கு என்ன உறவு?',
      'investigations[].name': 'என்ன பரிசோதனை செய்யப்பட்டது?',
      'investigations[].value': 'அதன் முடிவு என்ன?',
      'investigations[].date': 'அந்தப் பரிசோதனை சுமாராக எப்போது செய்யப்பட்டது?',
    }),
    answerHints: Object.freeze({
      boolean: 'ஆம் அல்லது இல்லை என்று பதிலளிக்கலாம்.',
      choice: 'நீங்கள் சொல்லலாம்: {choices}.',
      scale: '0 முதல் 10 வரை ஒரு எண்ணைச் சொல்லுங்கள்.',
      number: 'ஒரு எண்ணைச் சொல்லுங்கள்.',
      duration: 'உதாரணமாக: மூன்று நாட்கள், அல்லது இரண்டு வாரங்கள்.',
      text: '',
    }),
    choiceLabels: Object.freeze({
      sudden: 'திடீரென',
      gradual: 'கொஞ்சம் கொஞ்சமாக',
      woke_up_with_it: 'தூங்கி எழுந்தபோது இருந்தது',
      burning: 'எரிச்சல்',
      pressing: 'அழுத்தம்',
      sharp: 'கூர்மையான',
      dull: 'மந்தமான',
      cramping: 'பிடிப்பு',
      throbbing: 'துடிப்பு',
      constant: 'எப்போதும்',
      comes_and_goes: 'வந்து போகிறது',
      worse_at_night: 'இரவில் அதிகம்',
      worse_in_morning: 'காலையில் அதிகம்',
      worse_after_food: 'சாப்பிட்ட பிறகு அதிகம்',
      getting_worse: 'அதிகமாகிறது',
      getting_better: 'குறைகிறது',
      staying_same: 'அப்படியே இருக்கிறது',
      infant: 'கைக்குழந்தை',
      child: 'சிறுவர்',
      adolescent: 'பதின்ம வயது',
      adult: 'பெரியவர்',
      older_adult: 'முதியவர்',
      never: 'ஒருபோதும் இல்லை',
      former: 'முன்பு',
      current: 'இப்போது',
      occasional: 'எப்போதாவது',
      weekly: 'வாரம் ஒருமுறை',
      daily: 'தினமும்',
      vegetarian: 'சைவம்',
      mixed: 'கலப்பு',
      vegan: 'முழு சைவம்',
      none: 'எதுவும் இல்லை',
      light: 'குறைவு',
      moderate: 'மிதமான',
      heavy: 'அதிகம்',
      well: 'நன்றாக',
      disturbed: 'இடையூறாக',
      poor: 'சரியில்லை',
      thin: 'மெலிந்த',
      medium: 'நடுத்தரம்',
      prefers_cool: 'குளிர்ச்சி',
      prefers_warm: 'வெப்பம்',
      no_preference: 'வித்தியாசம் இல்லை',
      strong: 'நல்ல',
      normal: 'சாதாரணம்',
      variable: 'மாறுபடும்',
      comfortable: 'வசதியாக',
      heaviness: 'கனமாக',
      bloating: 'வாயு',
      regular: 'சீராக',
      tends_hard: 'கெட்டியாக',
      tends_loose: 'தளர்வாக',
      oral: 'வாய்வழி',
      topical: 'தடவுவது',
      inhaled: 'உள்ளிழுப்பது',
      injection: 'ஊசி',
      stopped: 'நிறுத்திவிட்டேன்',
      drug: 'மருந்து',
      food: 'உணவு',
      environmental: 'சுற்றுச்சூழல்',
      mild: 'லேசான',
      severe: 'கடுமையான',
      other: 'வேறு',
    }),
    asides: Object.freeze({
      repeat: 'கண்டிப்பாக.',
      not_understood: 'பரவாயில்லை. மீண்டும் ஒருமுறை கேட்கிறேன்.',
      why_ask:
        'உங்களைப் பார்ப்பதற்கு முன் மருத்துவருக்கு முழுமையான படம் கிடைக்க ' +
        'இது உதவும். சொல்ல விரும்பாத எதையும் விட்டுவிடலாம்.',
      how_long:
        'இன்னும் சில கேள்விகள் மட்டுமே. நீங்கள் எப்போது வேண்டுமானாலும் ' +
        'நிறுத்தலாம்.',
      is_it_serious:
        'அதை என்னால் சொல்ல முடியாது. நீங்கள் சொல்வதை நான் எழுதி வைக்கிறேன், ' +
        'மருத்துவர் உங்களுடன் பேசுவார். காத்திருக்கும்போது இன்னும் மோசமாக ' +
        'உணர்ந்தால், உடனே வரவேற்பு மேசையில் சொல்லுங்கள்.',
      want_human:
        'கண்டிப்பாக. வரவேற்பு மேசையில் சொன்னால் ஒருவர் உங்களிடம் வருவார். ' +
        'அதுவரை நாம் இங்கே தொடரலாம்.',
      who_are_you:
        'நான் ஒரு நபர் அல்ல. மருத்துவர் உங்களைப் பார்ப்பதற்கு முன் உங்கள் ' +
        'பதில்களை எழுதி வைக்கிறேன்.',
      greeting: 'வணக்கம்.',
      thanks: 'பரவாயில்லை.',
      wait: 'நிதானமாகச் சொல்லுங்கள்.',
      unrelated:
        'புரிகிறது. மருத்துவருக்காக உங்கள் பதில்களை எழுதுவது மட்டுமே என் ' +
        'வேலை. மற்ற எதற்கும் வரவேற்பு மேசை உதவும்.',
    }),
    conversation: TAMIL_CONVERSATION,
    listConjunction: 'அல்லது',
  });
}

/* ───────────────────────────────── Hindi ───────────────────────────────── */

/**
 * Hindi — complete, machine-drafted, and NOT yet reviewed by a clinician.
 *
 * ── What this is
 *
 * Every question the static registry can ask, every answer hint, every choice
 * token, and every repeated-group question, in Devanagari. It is the first
 * phrasebook that covers a language rather than demonstrating a shape, and it
 * exists because Hindi is the one language where both halves of the promise can
 * be tested today: the text is here, and the sidecar has a Hindi Piper voice on
 * disk, so a question can be written, read aloud, recorded back and transcribed
 * without anything being stubbed.
 *
 * ── What this is not
 *
 * `source` is `machine_draft` and `reviewedAt` is `null`, and both of those are
 * the literal truth. A language model drafted these 130 sentences in one pass.
 * Nobody who speaks Hindi has read them. They are plausible, which is exactly
 * what makes them dangerous: the failure this file's opening note describes —
 * "Does the pain spread to your arm?" quietly becoming "Does the pain hurt your
 * arm?" — is invisible to everyone except a clinician who reads the language,
 * and it reaches the chart as an answer to a question nobody asked.
 *
 * So the gate holds. With `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS` unset —
 * which is every deployment until somebody sets it — a Hindi session asks its
 * questions in English, exactly as a Tamil one does. Setting it is how the
 * pipeline gets proved before a clinician is asked for an afternoon; it is not
 * how this ships.
 *
 * TO FINISH THIS LANGUAGE: have a clinician who reads Hindi check that each
 * question asks what the English asks — not that it reads well, that it asks
 * the same thing — then set `reviewedAt` to the date they did it and change
 * `source` if they rewrote enough of it to own the words. In the same commit,
 * by them.
 *
 * ── Known wrinkles a reviewer should look at first
 *
 *   • `poor` is one token shared by `social.sleep` and `ayush.agni_appetite`,
 *     and `choiceLabels` is keyed on the token alone, so one Hindi word has to
 *     serve "poor sleep" and "poor appetite". "ठीक नहीं" was chosen because it
 *     is the only phrase that is not wrong in either. Same for `former`
 *     (smoking and alcohol) and `current` (smoking and a medicine still being
 *     taken).
 *   • `ros.genitourinary.vaginal_bleeding` and
 *     `ros.psychiatric.self_harm_thoughts` are asked in the clinical register
 *     rather than a softened one, because softening a red-flag question is how
 *     it stops being answered.
 *   • `social.age_band` is absent on purpose: its English prompt is empty and
 *     the field is never asked — it is read off the patient record — so there
 *     is nothing to translate. It is the one entry `phrasebookCoverage` reports
 *     as missing for `hi`, and `phrasebook.spec.ts` asserts that it is the only
 *     one.
 */
function hiPhrasebook(): QuestionPhrasebook {
  return Object.freeze({
    language: 'hi',
    source: 'machine_draft' as const,
    reviewedAt: null,
    questions: Object.freeze({
      /* chief complaint */
      'chief_complaint.symptom':
        'आज आपको सबसे ज़्यादा किस चीज़ से परेशानी हो रही है?',

      /* history of the presenting illness */
      'hpi.duration': 'यह तकलीफ़ आपको कब से है?',
      'hpi.onset':
        'क्या यह अचानक, एकदम से शुरू हुआ, या धीरे-धीरे समय के साथ बढ़ा?',
      'hpi.location':
        'आपको यह ठीक किस जगह महसूस होता है? आप उँगली से दिखा सकते हैं या बता सकते हैं।',
      'hpi.character':
        'यह एहसास कैसा है — जलन, दबाव, तेज़ चुभन, हल्का-सा दर्द, मरोड़ या टीस?',
      'hpi.severity':
        'बिल्कुल कुछ नहीं से लेकर सबसे बुरी हालत तक जो आप सोच सकते हैं, अभी आप इसे कहाँ रखेंगे? शून्य से दस तक।',
      'hpi.timing':
        'क्या यह हर समय रहता है, या आता-जाता रहता है? क्या दिन के किसी समय यह ज़्यादा बढ़ जाता है?',
      'hpi.frequency':
        'यह कितनी बार होता है — दिन में या हफ़्ते में कितनी बार?',
      'hpi.progression':
        'जब से यह शुरू हुआ है, क्या यह बढ़ रहा है, कम हो रहा है, या लगभग वैसा ही है?',
      'hpi.radiation':
        'क्या यह एहसास एक ही जगह रहता है, या कहीं फैलता है — आपकी बाँह, जबड़े, पीठ या कंधे तक?',
      'hpi.aggravating_factors':
        'क्या कोई ऐसी चीज़ है जिससे यह और बढ़ जाता है?',
      'hpi.relieving_factors':
        'क्या कोई ऐसी चीज़ है जिससे इसमें आराम मिलता है — आराम करना, कोई गोली, या किसी ख़ास तरह से बैठना या लेटना?',
      'hpi.previous_episodes': 'क्या आपको पहले भी यही तकलीफ़ हुई है?',
      'hpi.associated.breathlessness':
        'क्या इसके साथ आपको साँस लेने में कठिनाई हो रही है?',
      'hpi.associated.sweating':
        'क्या इसके साथ आपको बहुत पसीना आ रहा है, बिना कोई मेहनत किए भी?',
      'hpi.associated.nausea': 'क्या इसके साथ आपका जी मिचलाता है?',
      'hpi.associated.palpitations':
        'क्या इसके साथ आपको लगता है कि आपका दिल तेज़ी से या ज़ोर-ज़ोर से धड़क रहा है?',
      'hpi.associated.fainting':
        'क्या आप बेहोश हुए हैं, या ऐसा लगा कि आप बेहोश होने वाले हैं?',
      'hpi.associated.fever': 'क्या इसके साथ आपको बुख़ार भी आया है?',

      /* review of systems — constitutional */
      'ros.constitutional.fever': 'क्या हाल ही में आपको बुख़ार आया है?',
      'ros.constitutional.rigors':
        'क्या आपको ऐसी ठंड लगी है कि कँपकँपी रुक ही नहीं रही थी?',
      'ros.constitutional.weight_loss':
        'क्या बिना कोशिश किए आपका वज़न कम हुआ है?',
      'ros.constitutional.appetite_loss': 'क्या आपकी भूख कम हो गई है?',
      'ros.constitutional.fatigue':
        'क्या आपको सामान्य से कहीं ज़्यादा थकान महसूस हो रही है?',

      /* review of systems — cardiovascular */
      'ros.cardiovascular.chest_pain':
        'क्या आपको सीने में कोई दर्द या जकड़न होती है?',
      'ros.cardiovascular.breathlessness_on_exertion':
        'जो काम आप पहले आसानी से कर लेते थे, क्या अब उन्हें करते समय आपकी साँस फूल जाती है?',
      'ros.cardiovascular.breathless_lying_flat':
        'क्या सीधा लेटने पर आपकी साँस फूलती है, या सोने के लिए आपको ज़्यादा तकिए लगाने पड़ते हैं?',
      'ros.cardiovascular.ankle_swelling':
        'क्या आपके पैरों या टख़नों में सूजन आ रही है?',

      /* review of systems — respiratory */
      'ros.respiratory.breathless_at_rest':
        'क्या चुपचाप बैठे रहने पर भी आपकी साँस फूलती है?',
      'ros.respiratory.cannot_complete_sentences':
        'क्या बात करते समय आपको वाक्य के बीच में साँस लेने के लिए रुकना पड़ता है?',
      'ros.respiratory.fast_breathing':
        'क्या आपकी साँस सामान्य से तेज़ चल रही है?',
      'ros.respiratory.cough': 'क्या आपको खाँसी है?',
      'ros.respiratory.blood_in_sputum':
        'क्या खाँसी के साथ आपके मुँह से ख़ून आया है?',
      'ros.respiratory.wheeze':
        'क्या साँस लेते समय आपके सीने से सीटी जैसी या घरघराहट की आवाज़ आती है?',

      /* review of systems — gastrointestinal */
      'ros.gastrointestinal.abdominal_pain': 'क्या आपके पेट में कोई दर्द है?',
      'ros.gastrointestinal.vomiting_blood':
        'क्या उल्टी में ख़ून आया है, या ऐसा कुछ जो कॉफ़ी के भूरे कणों जैसा दिखता हो?',
      'ros.gastrointestinal.black_stools':
        'क्या आपका मल काला और चिपचिपा रहा है, तारकोल जैसा?',
      'ros.gastrointestinal.blood_in_stool':
        'क्या शौच के समय आपको ताज़ा ख़ून दिखा है?',
      'ros.gastrointestinal.vomiting': 'क्या आपको उल्टियाँ हो रही हैं?',
      'ros.gastrointestinal.diarrhoea': 'क्या आपको दस्त लगे हैं?',
      'ros.gastrointestinal.constipation': 'क्या आपको क़ब्ज़ रही है?',
      'ros.gastrointestinal.jaundice':
        'क्या आपकी आँखें या त्वचा पीली दिखी हैं?',
      'ros.gastrointestinal.difficulty_swallowing':
        'क्या खाना या तरल चीज़ें निगलने में आपको कठिनाई होती है?',

      /* review of systems — neurological */
      'ros.neurological.sudden_worst_headache':
        'क्या आपको ऐसा सिरदर्द हुआ जो अचानक शुरू हुआ और अब तक का सबसे तेज़ था?',
      'ros.neurological.face_droop':
        'क्या आपके चेहरे का एक तरफ़ का हिस्सा लटक गया है, या आपकी मुस्कान टेढ़ी दिखती है?',
      'ros.neurological.arm_weakness':
        'क्या अचानक आपका एक हाथ या एक पैर कमज़ोर या भारी हो गया है?',
      'ros.neurological.speech_difficulty':
        'क्या आपकी बोली लड़खड़ाने लगी है, या आपको शब्द ढूँढ़ने में दिक़्क़त हो रही है?',
      'ros.neurological.sudden_vision_loss':
        'क्या अचानक आपकी नज़र चली गई है, या आपको दो-दो दिखने लगा है?',
      'ros.neurological.seizure': 'क्या आपको दौरा या मिर्गी जैसा झटका आया है?',
      'ros.neurological.confusion':
        'क्या आप उलझन में रहे हैं या सामान्य से ज़्यादा सुस्त रहे हैं, या किसी और ने ऐसा कहा है?',
      'ros.neurological.headache': 'क्या आपको सिरदर्द होता है?',
      'ros.neurological.numbness': 'क्या आपको कहीं सुन्नपन या झनझनाहट होती है?',

      /* review of systems — genitourinary and obstetric */
      'ros.genitourinary.burning_urination':
        'क्या पेशाब करते समय जलन या चुभन होती है?',
      'ros.genitourinary.blood_in_urine': 'क्या आपको पेशाब में ख़ून दिखा है?',
      'ros.genitourinary.reduced_urine_output':
        'क्या आपको सामान्य से बहुत कम पेशाब आ रहा है?',
      'ros.genitourinary.pregnancy_possible':
        'क्या इस बात की कोई संभावना है कि आप गर्भवती हों?',
      'ros.genitourinary.vaginal_bleeding':
        'क्या आपको योनि से कोई रक्तस्राव हुआ है?',

      /* review of systems — musculoskeletal */
      'ros.musculoskeletal.joint_pain': 'क्या आपके किसी जोड़ में दर्द है?',
      'ros.musculoskeletal.joint_swelling':
        'क्या कोई जोड़ सूजा हुआ है या छूने पर गर्म लगता है?',
      'ros.musculoskeletal.back_pain': 'क्या आपको कमर या पीठ में दर्द है?',
      'ros.musculoskeletal.recent_injury':
        'क्या हाल ही में आप गिरे हैं या आपको कोई चोट लगी है?',

      /* review of systems — dermatological */
      'ros.dermatological.rash': 'क्या आपकी त्वचा पर कोई चकत्ते या दाने हैं?',
      'ros.dermatological.sudden_widespread_rash':
        'क्या आपके शरीर के बड़े हिस्से पर अचानक चकत्ते निकल आए?',
      'ros.dermatological.itching': 'क्या आपकी त्वचा में खुजली हो रही है?',

      /* review of systems — psychiatric */
      'ros.psychiatric.low_mood':
        'क्या हाल ही में आप उदास या निराश महसूस कर रहे हैं?',
      'ros.psychiatric.self_harm_thoughts':
        'क्या आपके मन में ख़ुद को नुक़सान पहुँचाने या अपनी जान लेने के विचार आए हैं?',

      /* review of systems — allergic */
      'ros.allergic.reaction_happening_now':
        'क्या अभी इसी समय कोई एलर्जी की प्रतिक्रिया हो रही है?',
      'ros.allergic.throat_or_lip_swelling':
        'क्या आपके होंठ, जीभ या गला सूज रहा है, या गले में कसाव महसूस हो रहा है?',

      /* review of systems — paediatric */
      'ros.paediatric.not_feeding':
        'क्या बच्चा दूध पीने या कुछ भी खाने-पीने से मना कर रहा है?',
      'ros.paediatric.unrousable':
        'क्या बच्चा सामान्य से ज़्यादा सुस्त है या उसे जगाना मुश्किल हो रहा है?',
      'ros.paediatric.convulsions': 'क्या बच्चे को दौरा या झटके आए हैं?',
      'ros.paediatric.fast_breathing':
        'क्या बच्चे की साँस सामान्य से तेज़ चल रही है, या साँस लेते समय उसकी पसलियाँ अंदर धँसती हैं?',
      'ros.paediatric.sunken_eyes':
        'क्या बच्चे की आँखें धँसी हुई दिखती हैं, या उसने कई घंटों से पेशाब नहीं किया है?',

      /* past medical history */
      'past_medical.diabetes':
        'क्या आपको कभी बताया गया है कि आपको मधुमेह यानी शुगर है?',
      'past_medical.hypertension':
        'क्या आपको कभी बताया गया है कि आपका रक्तचाप यानी बी॰पी॰ ज़्यादा है?',
      'past_medical.heart_disease':
        'क्या आपका कभी दिल की किसी बीमारी का इलाज हुआ है?',
      'past_medical.asthma':
        'क्या आपको दमा है, या साँस की कोई पुरानी तकलीफ़ है?',
      'past_medical.kidney_disease':
        'क्या आपको बताया गया है कि आपको गुर्दे यानी किडनी की कोई तकलीफ़ है?',
      'past_medical.liver_disease':
        'क्या आपको बताया गया है कि आपको जिगर यानी लिवर की कोई तकलीफ़ है?',
      'past_medical.stroke_or_tia':
        'क्या आपको कभी लकवा यानी स्ट्रोक, या छोटा स्ट्रोक हुआ है?',
      'past_medical.cancer': 'क्या आपका कभी कैंसर का इलाज हुआ है?',
      'past_medical.tuberculosis': 'क्या आपका कभी टी॰बी॰ का इलाज हुआ है?',
      'past_medical.thyroid_disorder':
        'क्या आपको बताया गया है कि आपको थायरॉइड की कोई तकलीफ़ है?',
      'past_medical.epilepsy': 'क्या आपका कभी दौरों या मिर्गी का इलाज हुआ है?',
      'past_medical.bleeding_disorder':
        'क्या आपको ज़्यादातर लोगों की तुलना में आसानी से ख़ून बहने लगता है या नील पड़ जाते हैं?',
      'past_medical.previous_hospitalisation':
        'क्या आप पहले कभी अस्पताल में भर्ती हुए हैं?',
      'past_medical.other_conditions':
        'क्या कोई और पुरानी बीमारी है जिसके बारे में हमने बात नहीं की?',

      /* the summary questions that open the repeated sections */
      'surgical.any_previous':
        'क्या पहले कभी आपका कोई ऑपरेशन या कोई प्रक्रिया हुई है?',
      'medications.any_current':
        'क्या इस समय आप कोई दवा ले रहे हैं, उनमें वे भी जो आप ख़ुद ख़रीदकर लेते हैं?',
      'allergies.reported':
        'क्या आपको किसी चीज़ से एलर्जी है — किसी दवा, किसी खाने की चीज़, या किसी और चीज़ से?',
      'family.any_relevant':
        'क्या आपके नज़दीकी परिवार में किसी को कोई पुरानी बीमारी है — जैसे मधुमेह, रक्तचाप, दिल की तकलीफ़ या कैंसर?',
      'investigations.any_previous':
        'क्या इसके लिए आपकी कोई जाँच या स्कैन हुआ है, या आपके पास कोई रिपोर्ट है?',

      /* social history */
      'social.smoking': 'क्या आप धूम्रपान करते हैं, या पहले कभी करते थे?',
      'social.tobacco_chewing': 'क्या आप तंबाकू, पान या गुटखा खाते हैं?',
      'social.alcohol': 'क्या आप शराब पीते हैं? अगर हाँ, तो लगभग कितनी बार?',
      'social.occupation': 'आप क्या काम करते हैं?',
      'social.diet':
        'आपका सामान्य खानपान कैसा है — शाकाहारी, मिला-जुला, या कुछ और?',
      'social.exercise':
        'एक सामान्य हफ़्ते में आप कितनी शारीरिक गतिविधि करते हैं?',
      'social.sleep': 'आपकी नींद कैसी चल रही है?',
      'social.exposure':
        'क्या काम की जगह या घर पर आप नियमित रूप से किसी चीज़ के संपर्क में रहते हैं — धूल, रसायन, धुआँ, जानवर?',

      /* AYUSH */
      'ayush.prakriti_build':
        'आपका सामान्य शरीर कैसा है — दुबला, मध्यम, या भारी?',
      'ayush.prakriti_climate_preference':
        'आपको ठंडे मौसम में ज़्यादा आराम महसूस होता है या गरम मौसम में?',
      'ayush.agni_appetite':
        'आपकी भूख आमतौर पर कैसी रहती है — तेज़, सामान्य, दिन-प्रतिदिन बदलती रहती है, या कम?',
      'ayush.agni_digestion':
        'खाना खाने के बाद आपको आमतौर पर कैसा लगता है — ठीक, भारीपन, या जलन?',
      'ayush.koshtha_bowel':
        'आपका पेट आमतौर पर कैसा साफ़ होता है — रोज़ नियमित, कुछ सख़्त, या कुछ ढीला?',
      'ayush.nidana_triggers':
        'क्या आपने कुछ ऐसा देखा है जिससे यह तकलीफ़ आमतौर पर शुरू होती है — कोई ख़ास खाना, कोई काम, कोई मौसम, या दिन का कोई समय?',
      'ayush.ahara_vihara_routine':
        'अपने एक सामान्य दिन के बारे में बताइए — आप कब खाते हैं, कब काम करते हैं, और कब सोते हैं।',

      /* repeated groups, keyed on the template rather than on an index */
      'medications[].name': 'दवा का नाम क्या है?',
      'medications[].strength': 'उसकी ताक़त कितनी है — कितने मिलीग्राम?',
      'medications[].dose': 'हर बार आप कितनी मात्रा लेते हैं?',
      'medications[].frequency': 'दिन में कितनी बार आप इसे लेते हैं?',
      'medications[].route': 'यह गोली है, सिरप है, इनहेलर है, या इंजेक्शन?',
      'medications[].timing':
        'आप इसे दिन में कब लेते हैं — सुबह, रात, खाने से पहले, या खाने के बाद?',
      'medications[].duration': 'आप इसे कब से ले रहे हैं?',
      'medications[].status':
        'क्या आप अब भी इसे ले रहे हैं, या आपने बंद कर दिया है?',

      'allergies[].substance': 'आपको किस चीज़ से एलर्जी है?',
      'allergies[].type': 'वह कोई दवा है, कोई खाने की चीज़ है, या कुछ और?',
      'allergies[].reaction':
        'जब आप उसके संपर्क में आते हैं तो आपको क्या होता है?',
      'allergies[].severity':
        'प्रतिक्रिया कितनी तेज़ थी — हल्की, मध्यम, या इतनी गंभीर कि इलाज की ज़रूरत पड़ी?',

      'surgical[].procedure': 'आपका कौन-सा ऑपरेशन हुआ था?',
      'surgical[].reason': 'वह किस वजह से किया गया था?',
      'surgical[].approximate_date': 'वह लगभग कब हुआ था — किस साल?',
      'surgical[].hospital': 'वह किस अस्पताल में हुआ था?',
      'surgical[].complications':
        'ऑपरेशन के दौरान या उसके बाद कोई दिक़्क़त हुई थी?',

      'family[].condition': 'आपके उस रिश्तेदार को कौन-सी बीमारी है?',
      'family[].relation': 'वह कौन-से रिश्तेदार हैं — माँ, पिता, भाई, बहन?',

      'investigations[].name': 'वह कौन-सी जाँच थी?',
      'investigations[].value': 'क्या आपको उसका नतीजा पता है?',
      'investigations[].date': 'वह जाँच लगभग कब हुई थी?',
    }),
    answerHints: Object.freeze({
      boolean: 'आप हाँ या नहीं में जवाब दे सकते हैं।',
      choice: 'आप कह सकते हैं: {choices}।',
      scale: 'कृपया 0 से 10 के बीच कोई संख्या बताइए।',
      number: 'कृपया कोई संख्या बताइए।',
      duration: 'जैसे: तीन दिन, या दो हफ़्ते।',
      text: '',
    }),
    choiceLabels: Object.freeze({
      /* hpi.onset */
      sudden: 'अचानक',
      gradual: 'धीरे-धीरे',
      woke_up_with_it: 'नींद से उठा तो यह था',

      /* hpi.character — `burning` is shared with ayush.agni_digestion */
      burning: 'जलन',
      pressing: 'दबाव',
      sharp: 'तेज़ चुभन',
      dull: 'हल्का-सा दर्द',
      cramping: 'मरोड़',
      throbbing: 'टीस',

      /* hpi.timing */
      constant: 'हर समय',
      comes_and_goes: 'आता-जाता रहता है',
      worse_at_night: 'रात में ज़्यादा',
      worse_in_morning: 'सुबह ज़्यादा',
      worse_after_food: 'खाने के बाद ज़्यादा',

      /* hpi.progression */
      getting_worse: 'बढ़ रहा है',
      getting_better: 'कम हो रहा है',
      staying_same: 'वैसा ही है',

      /* social.age_band — never asked, kept so the token is never spoken raw */
      infant: 'शिशु',
      child: 'बच्चा',
      adolescent: 'किशोर',
      adult: 'वयस्क',
      older_adult: 'बुज़ुर्ग',

      /* social.smoking and social.alcohol share `never`, `former`, `current` */
      never: 'कभी नहीं',
      former: 'पहले, अब नहीं',
      current: 'अभी भी',
      occasional: 'कभी-कभार',
      weekly: 'हफ़्ते में',
      daily: 'रोज़',

      /* social.diet */
      vegetarian: 'शाकाहारी',
      mixed: 'मिला-जुला',
      vegan: 'वीगन, दूध और अंडा भी नहीं',

      /* social.exercise — `moderate` is shared with allergies[].severity */
      none: 'बिल्कुल नहीं',
      light: 'हल्की',
      moderate: 'मध्यम',
      heavy: 'भारी',

      /* social.sleep — `poor` is shared with ayush.agni_appetite */
      well: 'अच्छी',
      disturbed: 'बीच-बीच में टूटती है',
      poor: 'ठीक नहीं',

      /* ayush.prakriti_build — `heavy` above serves this too */
      thin: 'दुबला',
      medium: 'मध्यम',

      /* ayush.prakriti_climate_preference */
      prefers_cool: 'ठंडा मौसम',
      prefers_warm: 'गरम मौसम',
      no_preference: 'कोई ख़ास फ़र्क़ नहीं',

      /* ayush.agni_appetite */
      strong: 'तेज़',
      normal: 'सामान्य',
      variable: 'बदलती रहती है',

      /* ayush.agni_digestion */
      comfortable: 'ठीक',
      heaviness: 'भारीपन',
      bloating: 'पेट फूलना',

      /* ayush.koshtha_bowel */
      regular: 'रोज़ नियमित',
      tends_hard: 'कुछ सख़्त',
      tends_loose: 'कुछ ढीला',

      /* medications[].route and medications[].status */
      oral: 'मुँह से ली जाने वाली',
      topical: 'त्वचा पर लगाने वाली',
      inhaled: 'साँस से ली जाने वाली',
      injection: 'इंजेक्शन',
      stopped: 'बंद कर दी',

      /* allergies[].type and allergies[].severity */
      drug: 'कोई दवा',
      food: 'खाने की कोई चीज़',
      environmental: 'आसपास की कोई चीज़',
      mild: 'हल्की',
      severe: 'गंभीर',

      /* shared by hpi.character, social.diet, medications[].route and
         allergies[].type — all four mean the same thing here */
      other: 'कुछ और',
    }),
    asides: Object.freeze({
      repeat: 'ज़रूर।',
      not_understood: 'कोई बात नहीं। मैं फिर से पूछता हूँ।',
      why_ask:
        'इससे डॉक्टर को आपको देखने से पहले पूरी तस्वीर मिल जाती है। जो आप ' +
        'नहीं बताना चाहते, उसे छोड़ सकते हैं।',
      how_long: 'बस कुछ ही सवाल बाक़ी हैं। आप जब चाहें रोक सकते हैं।',
      is_it_serious:
        'यह मैं आपको नहीं बता सकता। मैं सिर्फ़ आपकी बात लिख रहा हूँ, और ' +
        'डॉक्टर आपके साथ इस पर बात करेंगे। इंतज़ार के दौरान अगर आपको और ' +
        'ख़राब लगे, तो तुरंत रिसेप्शन पर बताइए।',
      want_human:
        'ज़रूर। रिसेप्शन पर बता दीजिए, कोई आपके पास आ जाएगा। तब तक हम यहाँ ' +
        'जारी रख सकते हैं।',
      who_are_you:
        'मैं कोई व्यक्ति नहीं हूँ। मैं आपके जवाब लिखता हूँ ताकि डॉक्टर के ' +
        'पास वे पहले से हों।',
      greeting: 'नमस्ते।',
      thanks: 'कोई बात नहीं।',
      wait: 'आराम से बताइए।',
      unrelated:
        'मैं समझ रहा हूँ। मैं सिर्फ़ डॉक्टर के लिए आपके जवाब लिख सकता हूँ — ' +
        'बाक़ी किसी भी चीज़ में रिसेप्शन मदद करेगा।',
    }),
    conversation: HINDI_CONVERSATION,
    listConjunction: 'या',
  });
}

/* ─────────────────────────── load-time invariants ─────────────────────────── */

/**
 * A phrasebook key that is not a real field path is a silent no-op.
 *
 * `hpi.sevrity` translates nothing, breaks nothing, and asks the patient the
 * English question forever. Nothing in the test suite would notice unless it
 * happened to test that field, which is exactly the argument
 * `assertRulesReferenceRealFields` makes at the bottom of `safety-engine.ts`.
 * Same failure, same check, same place to put it.
 */
function assertPhrasebooksReferenceRealFields(): void {
  const known = new Set([
    ...STATIC_FIELDS.map((field) => field.key),
    // `medications[].name` and friends: real questions whose indexed paths only
    // come into existence once a patient has an item at that index.
    ...GROUP_TEMPLATE_FIELD_KEYS,
  ]);
  const problems: string[] = [];

  for (const [code, book] of Object.entries(PHRASEBOOKS)) {
    if (code !== book.language) {
      problems.push(
        `phrasebook registered under "${code}" declares language "${book.language}"`,
      );
    }
    for (const fieldPath of Object.keys(book.questions)) {
      if (!known.has(fieldPath)) {
        problems.push(`${code}: "${fieldPath}" is not a field in the registry`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `phrasebook: ${problems.join('; ')}. A translation keyed on a field the ` +
        'interview never asks can never be spoken.',
    );
  }
}

assertPhrasebooksReferenceRealFields();
