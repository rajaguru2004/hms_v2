/**
 * The field registry — every question the interview is allowed to ask, as data.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE IS NO `diagnosis` FIELD IN THIS REGISTRY, AND THERE MUST NEVER BE ONE.
 *
 * §29 and §30 draw the line: this feature performs risk and priority
 * detection, not autonomous diagnosis. The usual way to enforce that is to
 * instruct the model not to diagnose — a sentence in a prompt, which the next
 * fine-tune or the next clever paraphrase erodes.
 *
 * Removing the slot is stronger than removing the instruction. The extraction
 * layer writes facts by field path; a path that is not in this registry is
 * rejected by the caller and has nowhere to land. A model that decides to
 * conclude "acute coronary syndrome" can emit that string, but there is no
 * `diagnosis`, `impression`, `assessment` or `icd_code` field for it to occupy,
 * so it cannot become part of the case. `assertNoDiagnosisSlot` below runs at
 * module load, so adding one back fails at import rather than in production.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `appliesWhen` is the whole of "adaptive questioning" (§12). The interview is
 * adaptive because the *filter* narrows as facts arrive — a chest-pain
 * complaint switches on the cardiac and respiratory review and the radiation
 * question, an abdominal complaint switches on the GI review — not because a
 * model improvised a question list. Same state in, same questions out, every
 * run, in a form a clinician can read and argue with.
 */

import { isNonEnglishScript } from '../../../common/constants/language.constants';
import {
  ClinicalState,
  SectionKey,
  isSectionKey,
  readFactAt,
  sectionOf,
  groupIndices,
} from './clinical-state';
import {
  FieldKind,
  FieldValueSpec,
  ValueConstraints,
  ValueValidation,
  booleanAnswer,
  isRecorded,
  readFact,
  validateFieldValue,
} from './tri-state';

/**
 * Re-exported from `tri-state.ts`, where it lives because the shape a value may
 * take is a property of facts, and `derivePresence` has to know it in order to
 * reject a value that does not fit its field.
 */
export type { FieldKind, ValueConstraints, ValueValidation };

export interface FieldDefinition {
  /** Dotted field path; also the key into `ClinicalState.facts`. */
  readonly key: string;
  readonly section: SectionKey;
  /** Clinician-facing label used in the rendered case. */
  readonly label: string;
  /**
   * Plain-English phrasing of the question, used verbatim when the LLM is
   * unavailable (§42 offline). The interview degrades to a flat but working
   * questionnaire rather than stopping.
   */
  readonly prompt: string;
  readonly kind: FieldKind;
  readonly choices?: readonly string[];
  /**
   * Extra shape the value must satisfy beyond its `kind`.
   *
   * This is the defence against eager slot-filling. The local model, asked to
   * extract from "chest pain, worse when I walk", put "when I walk" into
   * `hpi.radiation` — a description of *when*, filed as a description of
   * *where*. A field that declares what a good answer looks like can refuse
   * that, and a refused value leaves the field `not_assessed` rather than
   * carrying a confident mistake into the chart.
   */
  readonly accepts?: ValueConstraints;
  /** 0..100. Higher is asked sooner within a section. */
  readonly priority: number;
  /**
   * 0..100. How much this field feeds the safety engine. Sorted above
   * `priority` so that, within a section, the questions a red-flag rule needs
   * are asked before the ones that only enrich the narrative.
   */
  readonly redFlagWeight: number;
  readonly appliesWhen: (state: ClinicalState) => boolean;
}

/**
 * A recognisable body site, or an explicit statement that the pain stays put.
 *
 * Used as the accepted shape for `hpi.location` and `hpi.radiation`. It admits
 * "it goes down my left arm when I walk" (a location with a temporal qualifier)
 * and refuses "when I walk" (a qualifier with no location), which is exactly
 * the discrimination the model failed to make.
 */
const BODY_SITE_OR_NEGATION =
  /\b(head|skull|temple|forehead|face|jaw|eye|ear|nose|throat|neck|shoulder|scapula|arm|elbow|wrist|hand|finger|chest|breast|sternum|rib|centre|center|middle|back|spine|loin|flank|abdomen|stomach|belly|tummy|epigastr\w*|umbilic\w*|pelvis|groin|hip|buttock|thigh|knee|calf|shin|ankle|foot|feet|toe|leg|side|left|right|upper|lower|all over|everywhere|nowhere|stays? (in|put)|does ?n'?t (spread|move|go|radiate)|doesn'?t go anywhere|no(t)? spread)\b/i;

/* ───────────────────────── complaint classification ───────────────────────── */

export const COMPLAINT_CATEGORIES = [
  'cardiac',
  'respiratory',
  'gastrointestinal',
  'neurological',
  'genitourinary',
  'obstetric',
  'musculoskeletal',
  'dermatological',
  'psychiatric',
  'constitutional',
  'ent',
  'ophthalmic',
  'allergic',
  'trauma',
  'unclassified',
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/**
 * Deterministic keyword matching, deliberately not a model call.
 *
 * The division of labour from §30: the LLM turns "enakku moonu naala nenju
 * vali irukku" into a complaint string, and code decides what that string means
 * for the question flow. If the category came back from the model too, the same
 * sentence could route to the cardiac review on Tuesday and the musculoskeletal
 * review on Wednesday, and nobody could explain why.
 *
 * A complaint may match several categories, and that is intended. "Chest pain"
 * is cardiac *and* respiratory: the point of the review of systems is to ask
 * the questions that rule things in, and narrowing to one category here would
 * be this engine quietly deciding the answer — which is exactly what it must
 * not do.
 *
 * The transliterated Tamil patterns are a safety net for the case where a
 * transcript reaches us un-translated, not a substitute for the translation
 * layer. They cost nothing and they fail safe: an extra category asks a few
 * extra questions.
 */
/**
 * A complaint word in a script `\b` cannot see.
 *
 * Tamil and Devanagari are not word characters as far as JavaScript's `\b` is
 * concerned — it is defined against `[A-Za-z0-9_]` — so `/\bகாய்ச்சல்\b/`
 * never matches anything. The failure is silent and it is the expensive kind:
 * the pattern compiles, a test written with a bare string passes, and a real
 * complaint with a space in front of it classifies as `unclassified`. Which,
 * measured, cut the applicable field set from 64 to 44 and left ACS_TRIAD
 * silent for a patient describing cardiac chest pain.
 *
 * `(?<!\p{L})…(?!\p{L})` is the same intent without the ASCII assumption.
 * Every non-Latin pattern below goes through here.
 */
function native(source: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'u');
}

/**
 * The same, for Tamil, where a closing boundary is the wrong rule.
 *
 * Tamil is agglutinative: case, tense and clitics attach directly to the stem
 * with no space. "சுளுக்கு" (a sprain) is said as "சுளுக்கிக் கொண்டது", and
 * "காய்ச்சல்" takes "காய்ச்சலா" and "காய்ச்சலோட". A pattern closed with
 * `(?!\p{L})` matches the dictionary form and misses every sentence a patient
 * actually says — which is the same silent `unclassified` as the `\b` bug
 * above, arrived at by a different route.
 *
 * So the stem is anchored at its start only, and the suffix is allowed to be
 * whatever Tamil put there. The risk this trades for is a stem that is a prefix
 * of an unrelated word; it is managed by keeping every stem below specific —
 * "நெஞ்சு வலி", not "வலி", which is itself a prefix of "வலிமை" (strength).
 */
function stem(source: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${source})`, 'u');
}

const CATEGORY_PATTERNS: ReadonlyArray<{
  readonly category: ComplaintCategory;
  readonly patterns: readonly RegExp[];
}> = [
  {
    category: 'cardiac',
    patterns: [
      /\bchest\s+(pain|ache|tightness|discomfort|pressure|heaviness|burning)/i,
      /\bpalpitation/i,
      /\bheart\s+(racing|pounding|beating fast)/i,
      /\bangina\b/i,
      /\bnenju\s*vali/i,
      /\bnenju\s*valikuthu/i,
      stem('நெஞ்சு\\s*(வலி|வலிக்குது|எரிச்சல்|அடைப்பு|பாரம்|இறுக்கம்)'),
      stem('மார்(பு|பக)\\s*வலி'),
      stem('படபடப்பு'),
      stem('இதய(ம்|த்தில்)'),
      native('सीने\\s*में\\s*(दर्द|जलन|भारीपन|जकड़न|दबाव)'),
      native('छाती\\s*में\\s*दर्द'),
      native('दिल\\s*(की\\s*धड़कन|में\\s*दर्द)'),
      native('धड़कन\\s*तेज़?'),
    ],
  },
  {
    category: 'respiratory',
    patterns: [
      /\bbreathless/i,
      /\bshort(ness)?\s+of\s+breath/i,
      /\bdifficulty\s+(in\s+)?breathing/i,
      /\bcan(no|')?t\s+breathe/i,
      /\bcough/i,
      /\bwheez/i,
      /\bchest\s+(pain|tightness|congestion)/i,
      /\bmoochu/i,
      /\basthma/i,
      stem('மூச்சு\\s*(விட|வாங்க|திணற|முட்ட)'),
      stem('மூச்சு\\s*(திணறல்|வாங்குது|முட்டுது|விட\\s*முடியல(ை)?)'),
      stem('இருமல்'),
      stem('ஆஸ்துமா|ஆஸ்த்துமா'),
      native(
        '(साँस|सांस)\\s*(लेने\\s*में\\s*(तकलीफ़|तकलीफ|दिक्कत)|फूलना|फूल\\s*रही)',
      ),
      native('खांसी|खाँसी'),
      native('दमा'),
    ],
  },
  {
    category: 'gastrointestinal',
    patterns: [
      /\b(abdominal|stomach|belly|tummy|epigastric)\s*(pain|ache|cramp|discomfort|burning)/i,
      /\bvomit/i,
      /\bnausea/i,
      /\bdiarrh/i,
      /\bloose\s+motion/i,
      /\bconstipat/i,
      /\bacidity\b/i,
      /\bheartburn\b/i,
      /\bindigest/i,
      /\bjaundice\b/i,
      /\bblood\s+in\s+(stool|motion)/i,
      /\bblack\s+stool/i,
      /\bvayiru\s*vali/i,
      stem('வயி(று|த்து|ற்று)\\s*வலி'),
      stem('வாந்தி'),
      stem('குமட்டல்'),
      stem('பேதி|வயிற்றுப்போக்கு'),
      stem('மலச்சிக்கல்'),
      stem('நெஞ்செரிச்சல்|அஜீரண(ம்)?'),
      stem('மஞ்சள்\\s*காமாலை'),
      native('पेट\\s*(में\\s*)?(दर्द|मरोड़|जलन)'),
      native('उल्टी|उलटी'),
      native('जी\\s*मिचला'),
      native('दस्त|पतले\\s*दस्त'),
      native('कब्ज़?'),
      native('एसिडिटी|अम्लता'),
      native('पीलिया'),
    ],
  },
  {
    category: 'neurological',
    patterns: [
      /\bhead\s*ache/i,
      /\bmigraine\b/i,
      /\bgiddi/i,
      /\bdizz/i,
      /\bfaint/i,
      /\bblack\s*out/i,
      /\bseizure/i,
      /\bfits?\b/i,
      /\bconvulsion/i,
      /\bweakness\s+(in|of|on)\s+(one\s+side|the\s+)?(arm|leg|face|body)/i,
      /\bnumb/i,
      /\bslurred\s+speech/i,
      /\bunconscious/i,
      /\bthalai\s*vali/i,
      stem('தலை\\s*வலி|தலைவலி'),
      stem('மயக்கம்'),
      stem('தலை\\s*சுற்ற(ல்|ுது)'),
      stem('வலிப்பு|கை\\s*கால்\\s*வலிப்பு'),
      stem('மரத்து\\s*(போ|விட்ட)'),
      stem('பக்கவாத(ம்)?'),
      stem('நினைவு\\s*இழ(ந்|ப்)'),
      native('सिर\\s*(में\\s*)?दर्द|सिरदर्द'),
      native('चक्कर'),
      native('बेहोश(ी)?'),
      native('दौरा|मिर्गी'),
      native('लकवा|पक्षाघात'),
      native('सुन्न'),
      native('बोलने\\s*में\\s*(दिक्कत|तकलीफ़)'),
    ],
  },
  {
    category: 'genitourinary',
    patterns: [
      /\burin/i,
      /\bburning\s+(while|when)\s+passing/i,
      /\bkidney\b/i,
      /\bpassing\s+(blood|stone)/i,
      /\bgroin\b/i,
      stem('சிறுநீர்'),
      stem('சிறுநீரக(ம்)?'),
      stem('பெண்குறி|ஆண்குறி'),
      native('पेशाब'),
      native('मूत्र'),
      native('गुर्द(ा|े)|किडनी'),
    ],
  },
  {
    category: 'obstetric',
    patterns: [
      /\bpregnan/i,
      /\bmiscarriage\b/i,
      /\bvaginal\s+bleed/i,
      /\blabou?r\s+pain/i,
      /\bperiods?\s+(are\s+)?(missed|late|stopped)/i,
      /\bmissed\s+period/i,
      stem('கர்ப்ப(ம்|மா|மாக)'),
      stem('கருச்சிதைவு'),
      stem('மாதவிடாய்'),
      stem('பிரசவ\\s*வலி'),
      native('गर्भवती|गर्भ\\s*से|प्रेग्नेंट'),
      native('गर्भपात'),
      native('माहवारी|पीरियड|मासिक'),
      native('प्रसव\\s*(पीड़ा|दर्द)'),
    ],
  },
  {
    category: 'musculoskeletal',
    patterns: [
      /\b(joint|knee|shoulder|back|neck|hip|elbow|ankle|wrist)\s*(pain|ache|stiffness|swelling)/i,
      /\bsprain/i,
      /\bfracture/i,
      /\bbody\s+pain/i,
      stem(
        '(மூட்டு|முதுகு|கழுத்து|முழங்கால்|தோள்|இடுப்பு|கணுக்கால்|மணிக்கட்டு)\\s*வலி',
      ),
      stem('உடல்\\s*வலி|உடம்பு\\s*வலி'),
      stem('சுளுக்க(ு|ி)'),
      stem('எலும்பு\\s*முறிவு'),
      native('(जोड़ों|कमर|पीठ|गर्दन|घुटने|कंधे|कूल्हे|टखने)\\s*(में\\s*)?दर्द'),
      native('बदन\\s*दर्द|शरीर\\s*में\\s*दर्द'),
      native('मोच'),
      native('हड्डी\\s*(टूट|में\\s*दरार)|फ्रैक्चर'),
    ],
  },
  {
    category: 'dermatological',
    patterns: [
      /\brash\b/i,
      /\bitch/i,
      /\bskin\b/i,
      /\bboil\b/i,
      /\bhives\b/i,
      /\bulcer\s+on\b/i,
      stem('தடிப்பு|சொறி'),
      stem('அரிப்பு'),
      stem('தோல்\\s*(நோய்|பிரச்சினை)'),
      stem('கொப்பள(ம்)?'),
      native('दाने|चकत्ते'),
      native('खुजली'),
      native('त्वचा'),
      native('फोड़ा|फुंसी'),
    ],
  },
  {
    category: 'psychiatric',
    patterns: [
      /\bdepress/i,
      /\banxiet|anxious/i,
      /\bpanic\b/i,
      /\bsuicid/i,
      /\bself[\s-]?harm/i,
      /\bcan(no|')?t\s+sleep/i,
      /\binsomnia\b/i,
      /\bstress(ed)?\b/i,
      stem('மன\\s*அழுத்த(ம்)?'),
      stem('பதட்ட(ம்)?|கவலை'),
      stem('தூக்க(ம்)?\\s*வர(ல|லை)'),
      stem('தற்கொலை'),
      stem('தன்னை\\s*காயப்படுத்த'),
      native('तनाव|डिप्रेशन|अवसाद'),
      native('चिंता|घबराहट|बेचैनी'),
      native('नींद\\s*नहीं\\s*आ'),
      native('आत्महत्या'),
      native('खुद\\s*को\\s*नुकसान'),
    ],
  },
  {
    category: 'constitutional',
    patterns: [
      /\bfever\b/i,
      /\btemperature\b/i,
      /\bweight\s+loss/i,
      /\btired(ness)?\b/i,
      /\bfatigue\b/i,
      /\bloss\s+of\s+appetite/i,
      /\bnight\s+sweat/i,
      /\bkaa?y?ch?al\b/i,
      stem('காய்ச்சல்|ஜுர(ம்)?'),
      stem('சோர்வு|களைப்பு'),
      stem('பசி\\s*இல்ல(ை)?|பசியின்மை'),
      stem('எடை\\s*(குறை|இழ)'),
      stem('இரவு\\s*வியர்வை'),
      native('बुखार|ज्वर|बुख़ार'),
      native('थकान|कमज़ोरी|कमजोरी'),
      native('भूख\\s*नहीं'),
      native('वज़न\\s*कम|वजन\\s*कम'),
      native('रात\\s*को\\s*पसीना'),
    ],
  },
  {
    category: 'ent',
    patterns: [
      /\bear\s*(pain|ache|discharge|blocked)/i,
      /\b(sore|painful)\s+throat/i,
      /\bthroat\s+pain/i,
      /\b(runny|blocked|stuffy)\s+nose/i,
      /\bhearing\s+loss/i,
      /\btonsil/i,
      /\bsinus/i,
      stem('காது\\s*(வலி|கேட்கல(ை)?|சீழ்)'),
      stem('தொண்டை\\s*வலி'),
      stem('மூக்கு\\s*(ஒழுகு|அடைப்பு|அடைச்ச)'),
      stem('டான்சில்'),
      native('कान\\s*(में\\s*)?(दर्द|बहना)'),
      native('गले\\s*में\\s*(दर्द|खराश)|गला\\s*(ख़राब|खराब)'),
      native('नाक\\s*(बहना|बह\\s*रही|बंद)'),
      native('सुनाई\\s*नहीं'),
      native('टॉन्सिल'),
    ],
  },
  {
    category: 'ophthalmic',
    patterns: [
      /\beye\s*(pain|ache|redness|discharge)/i,
      /\bred\s+eye/i,
      /\b(blurred|double|loss\s+of)\s+vision/i,
      /\bcan(no|')?t\s+see/i,
      stem('கண்\\s*(வலி|சிவப்பு|எரிச்சல்)'),
      stem('பார்வை\\s*(மங்க|குறை|இழ)'),
      stem('கண்\\s*தெரிய(ல|லை)'),
      native('आँख\\s*(में\\s*)?(दर्द|लाल|जलन)|आंख\\s*में\\s*दर्द'),
      native('धुंधला\\s*(दिख|नज़र)'),
      native('दिखाई\\s*नहीं'),
    ],
  },
  {
    category: 'allergic',
    patterns: [
      /\ballerg/i,
      /\breaction\s+(to|after)\b/i,
      /\bhives\b/i,
      /\bswelling\s+of\s+(the\s+)?(lips?|tongue|throat|face|eyes?)/i,
      stem('ஒவ்வாமை'),
      stem('அலர்ஜி'),
      stem('உதடு\\s*வீக்க(ம்)?|முகம்\\s*வீங்க'),
      native('एलर्जी|एलर्जि'),
      native('प्रतिक्रिया'),
      native('(होंठ|जीभ|गला|चेहरा|चेहरे)\\s*(में\\s*)?(सूजन|सूज)'),
    ],
  },
  {
    category: 'trauma',
    patterns: [
      /\bfell\b|\ba\s+fall\b/i,
      /\binjur/i,
      /\baccident\b/i,
      /\bburn(t|ed)?\b/i,
      /\bdog\s+bite|\bsnake\s+bite|\bbite\b/i,
      /\bcut\s+(my|his|her|the)\b/i,
      stem('விழுந்து|விழுந்த'),
      stem('காய(ம்|ங்கள்)'),
      stem('விபத்து'),
      stem('தீக்காய(ம்)?|சுட்டு\\s*கொண்ட'),
      stem('(நாய்|பாம்பு)\\s*கடி'),
      stem('கடி(த்த|ச்ச)'),
      native('गिर\\s*(गया|गई|गयी|पड़ा)'),
      native('चोट'),
      native('दुर्घटना|एक्सीडेंट'),
      native('जल\\s*(गया|गयी)|जलन\\s*से'),
      native('(कुत्ते|साँप|सांप)\\s*ने\\s*काटा'),
      native('काट\\s*लिया'),
    ],
  },
];

/**
 * Classify free text into zero or more categories. Returns them in registry
 * order so that two equal states always produce the same array, not merely the
 * same set.
 */
export function classifyComplaint(
  text: string | undefined | null,
): readonly ComplaintCategory[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }
  const matched = CATEGORY_PATTERNS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  ).map((entry) => entry.category);

  return matched.length > 0 ? matched : ['unclassified'];
}

/**
 * Whether the complaint is written in a script these patterns cannot read.
 *
 * Separate from [classifyComplaint] on purpose, and the separation is the
 * whole point — it is what lets "we could not read it" widen the **questions**
 * without also firing the **alarms**.
 *
 * `classifyComplaint` briefly returned every category for unreadable text, on
 * the reasoning that a rule firing needlessly costs a clinician a moment while
 * one that never fires is invisible. Measured, that was wrong:
 *
 *   ta "எனக்கு மூணு நாளா நெஞ்சு வலி இருக்கு"  (chest pain)    -> 14 categories
 *   ta "நேற்று என் கணுக்கால் சுளுக்கிக் கொண்டது" (sprained ankle) -> 14 categories
 *
 * Identical. So ACS_TRIAD fired on a sprained ankle, and every red flag
 * carried exactly no information for any non-English interview. That is the
 * failure `safety-engine.spec.ts` opens by calling the single most important
 * property of the engine: if absent data can match, every patient arrives
 * pre-alerted and the one real alert is dismissed with the rest.
 *
 * So the two consumers of a classification are now treated differently:
 *
 *  * `whenCategory` — which decides which review-of-systems questions apply —
 *    widens on this. Asking a patient more questions is safe, and the answers
 *    are what the rules actually key on.
 *  * A red-flag `complaint` condition does NOT. It requires a real
 *    classification, because an alarm raised on evidence nobody could read is
 *    not evidence.
 *
 * By the time a `complaint` rule could fire, the associated symptoms it needs
 * have been asked and answered — several turns later, by which point the
 * background translation has landed and the complaint classifies properly.
 * The widened question set is what carries the patient across that gap.
 */
export function complaintUnreadable(state: ClinicalState): boolean {
  const symptom = readFact(readFactAt(state, 'chief_complaint.symptom'));
  return (
    symptom.kind === 'value' &&
    typeof symptom.value === 'string' &&
    isNonEnglishScript(symptom.value) &&
    classifyComplaint(symptom.value).includes('unclassified')
  );
}

/**
 * Categories implied by the current state.
 *
 * `chief_complaint.category` wins when it is recorded, because the touch
 * interface (§10) lets the patient pick a complaint from a list and that
 * choice is better evidence than pattern-matching their prose. It is not a
 * registry field: it is set by the UI, never asked, and never inferred by the
 * model.
 *
 * Only the complaint drives this, not the whole state. Reclassifying as more
 * text arrives would let the applicable field set grow mid-interview, and the
 * §37 progress bar would run backwards while the patient watched.
 */
/**
 * Memoised per state object.
 *
 * `selectNext` runs on the hot path: the next question is rendered immediately
 * while extraction grinds away in the background for eight to twenty seconds,
 * so the selector's own cost has to be invisible. Every `appliesWhen` that
 * gates on a category would otherwise re-run the whole pattern table, sixty
 * times per selection. The cache is safe because `ClinicalState` is frozen and
 * `complaintCategories` is a pure function of it — the same object can only
 * ever produce the same answer — and a `WeakMap` keeps it from holding sessions
 * alive after the request ends.
 */
const CATEGORY_CACHE = new WeakMap<
  ClinicalState,
  readonly ComplaintCategory[]
>();

export function complaintCategories(
  state: ClinicalState,
): readonly ComplaintCategory[] {
  const cached = CATEGORY_CACHE.get(state);
  if (cached) return cached;
  const computed = computeComplaintCategories(state);
  CATEGORY_CACHE.set(state, computed);
  return computed;
}

function computeComplaintCategories(
  state: ClinicalState,
): readonly ComplaintCategory[] {
  const override = readFact(readFactAt(state, 'chief_complaint.category'));
  if (override.kind === 'value' && typeof override.value === 'string') {
    const declared = override.value
      .split(/[,\s]+/)
      .filter((token): token is ComplaintCategory =>
        (COMPLAINT_CATEGORIES as readonly string[]).includes(token),
      );
    if (declared.length > 0) {
      return COMPLAINT_CATEGORIES.filter((category) =>
        declared.includes(category),
      );
    }
  }

  const symptom = readFact(readFactAt(state, 'chief_complaint.symptom'));
  return symptom.kind === 'value' && typeof symptom.value === 'string'
    ? classifyComplaint(symptom.value)
    : [];
}

/* ─────────────────────────── applicability helpers ─────────────────────────── */

type Predicate = (state: ClinicalState) => boolean;

const ALWAYS: Predicate = () => true;

/**
 * For fields the interview never asks because the answer comes from somewhere
 * else — `social.age_band` is read off the patient record at session start.
 * They stay in the registry so the renderer knows their label and kind, and
 * they stay out of the applicable set so they never count against §37 progress.
 */
const NEVER_ASKED: Predicate = () => false;

function whenComplaintKnown(state: ClinicalState): boolean {
  return isRecorded(readFactAt(state, 'chief_complaint.symptom'));
}

function whenCategory(...categories: ComplaintCategory[]): Predicate {
  return (state) => {
    const active = complaintCategories(state);
    if (categories.some((category) => active.includes(category))) return true;

    // The complaint is in a script the patterns cannot read, so no category
    // matched and none was ruled out either. Ask the questions.
    //
    // This is the one place the widening happens, and keeping it here rather
    // than inside `classifyComplaint` is what stops it reaching the red-flag
    // rules — see the note on [complaintUnreadable]. Asking a patient a few
    // more questions is safe and the answers are what the rules key on; firing
    // an alarm on a complaint nobody could read is not.
    return complaintUnreadable(state);
  };
}

function whenYes(fieldPath: string): Predicate {
  return (state) => booleanAnswer(readFactAt(state, fieldPath)) === 'yes';
}

function whenChoiceIn(fieldPath: string, ...values: string[]): Predicate {
  return (state) => {
    const reading = readFact(readFactAt(state, fieldPath));
    return reading.kind === 'value' && values.includes(String(reading.value));
  };
}

function allOf(...predicates: Predicate[]): Predicate {
  return (state) => predicates.every((predicate) => predicate(state));
}

function anyOf(...predicates: Predicate[]): Predicate {
  return (state) => predicates.some((predicate) => predicate(state));
}

/** Paediatric danger signs only make sense for a child (§29). */
const whenChild: Predicate = whenChoiceIn('social.age_band', 'infant', 'child');

/** AYUSH stream, set from the appointment's department — never asked. */
const whenAyush: Predicate = whenYes('ayush.enabled');

/* ───────────────────────────── the static fields ───────────────────────────── */

const SEVERITY_SCALE = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const CHIEF_COMPLAINT_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'chief_complaint.symptom',
    section: 'chief_complaint',
    label: 'Main concern',
    prompt: 'What is bothering you the most today?',
    kind: 'text',
    priority: 100,
    redFlagWeight: 60,
    appliesWhen: ALWAYS,
  },
];

const HPI_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'hpi.duration',
    section: 'hpi',
    label: 'Duration',
    prompt: 'How long have you had this problem?',
    kind: 'duration',
    priority: 95,
    redFlagWeight: 40,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.onset',
    section: 'hpi',
    label: 'Onset',
    prompt:
      'Did this start suddenly, all at once, or did it build up slowly over time?',
    kind: 'choice',
    choices: ['sudden', 'gradual', 'woke_up_with_it'],
    // Sudden onset is half of the ACS screen in §29, so it outranks the rest of
    // the HPI narrative.
    priority: 90,
    redFlagWeight: 70,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.location',
    section: 'hpi',
    label: 'Location',
    prompt: 'Where exactly do you feel it? You can point or describe it.',
    kind: 'text',
    accepts: {
      pattern: BODY_SITE_OR_NEGATION,
      rejectReason:
        'this does not name a part of the body; it may belong in hpi.timing or hpi.aggravating_factors',
    },
    priority: 85,
    redFlagWeight: 20,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.character',
    section: 'hpi',
    label: 'Character',
    prompt:
      'How would you describe the feeling — burning, pressing, sharp, dull, cramping or throbbing?',
    kind: 'choice',
    choices: [
      'burning',
      'pressing',
      'sharp',
      'dull',
      'cramping',
      'throbbing',
      'other',
    ],
    priority: 80,
    redFlagWeight: 20,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.severity',
    section: 'hpi',
    label: 'Severity (0-10)',
    prompt:
      'On a scale of nothing at all to the worst you can imagine, where would you put it right now? Zero to ten.',
    kind: 'scale',
    choices: SEVERITY_SCALE,
    // 0-10, or one of the named bands in SCALE_BANDS. "Quite bad" is neither,
    // and storing it as a severity invents a measurement nobody made.
    accepts: { min: 0, max: 10 },
    priority: 78,
    redFlagWeight: 50,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.timing',
    section: 'hpi',
    label: 'Timing',
    prompt:
      'Is it there all the time, or does it come and go? Is there a time of day it is worse?',
    kind: 'choice',
    choices: [
      'constant',
      'comes_and_goes',
      'worse_at_night',
      'worse_in_morning',
      'worse_after_food',
    ],
    priority: 70,
    redFlagWeight: 15,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.frequency',
    section: 'hpi',
    label: 'Frequency',
    prompt: 'How often does it happen — how many times a day or a week?',
    kind: 'text',
    priority: 65,
    redFlagWeight: 10,
    appliesWhen: allOf(
      whenComplaintKnown,
      whenChoiceIn('hpi.timing', 'comes_and_goes'),
    ),
  },
  {
    key: 'hpi.progression',
    section: 'hpi',
    label: 'Progression',
    prompt:
      'Since it started, is it getting worse, getting better, or staying about the same?',
    kind: 'choice',
    choices: ['getting_worse', 'getting_better', 'staying_same'],
    priority: 68,
    redFlagWeight: 35,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.radiation',
    section: 'hpi',
    label: 'Radiation',
    prompt:
      'Does the feeling stay in one place, or does it spread anywhere — to your arm, jaw, back or shoulder?',
    kind: 'text',
    // "when I walk" is an aggravating factor wearing a radiation label. The
    // field demands a body site, or an explicit "it stays where it is".
    accepts: {
      pattern: BODY_SITE_OR_NEGATION,
      rejectReason:
        'this describes when the pain happens, not where it spreads; it belongs in hpi.aggravating_factors',
    },
    priority: 75,
    redFlagWeight: 55,
    // The classic adaptive case: worth asking about chest, abdominal, back and
    // limb complaints, pointless for a sore throat.
    appliesWhen: whenCategory(
      'cardiac',
      'gastrointestinal',
      'musculoskeletal',
      'genitourinary',
    ),
  },
  {
    key: 'hpi.aggravating_factors',
    section: 'hpi',
    label: 'Aggravating factors',
    prompt: 'Is there anything that makes it worse?',
    kind: 'text',
    priority: 62,
    redFlagWeight: 25,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.relieving_factors',
    section: 'hpi',
    label: 'Relieving factors',
    prompt:
      'Is there anything that makes it better — rest, a tablet, a position?',
    kind: 'text',
    priority: 60,
    redFlagWeight: 15,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.previous_episodes',
    section: 'hpi',
    label: 'Previous episodes',
    prompt: 'Have you had this same problem before?',
    kind: 'boolean',
    priority: 55,
    redFlagWeight: 20,
    appliesWhen: whenComplaintKnown,
  },
  {
    key: 'hpi.associated.breathlessness',
    section: 'hpi',
    label: 'Associated breathlessness',
    prompt: 'Along with this, are you finding it hard to breathe?',
    kind: 'boolean',
    priority: 88,
    redFlagWeight: 90,
    appliesWhen: whenCategory('cardiac', 'respiratory', 'allergic'),
  },
  {
    key: 'hpi.associated.sweating',
    section: 'hpi',
    label: 'Associated sweating',
    prompt: 'Have you been sweating a lot with it, even without effort?',
    kind: 'boolean',
    priority: 86,
    redFlagWeight: 88,
    appliesWhen: whenCategory('cardiac'),
  },
  {
    key: 'hpi.associated.nausea',
    section: 'hpi',
    label: 'Associated nausea',
    prompt: 'Do you feel sick in the stomach along with it?',
    kind: 'boolean',
    priority: 58,
    redFlagWeight: 30,
    appliesWhen: whenCategory('cardiac', 'gastrointestinal', 'neurological'),
  },
  {
    key: 'hpi.associated.palpitations',
    section: 'hpi',
    label: 'Associated palpitations',
    prompt: 'Does your heart feel like it is racing or pounding with it?',
    kind: 'boolean',
    priority: 57,
    redFlagWeight: 45,
    appliesWhen: whenCategory('cardiac'),
  },
  {
    key: 'hpi.associated.fainting',
    section: 'hpi',
    label: 'Associated fainting or near-fainting',
    prompt: 'Have you blacked out, or felt like you were about to?',
    kind: 'boolean',
    priority: 84,
    redFlagWeight: 80,
    appliesWhen: whenCategory('cardiac', 'neurological', 'obstetric'),
  },
  {
    key: 'hpi.associated.fever',
    section: 'hpi',
    label: 'Associated fever',
    prompt: 'Have you had a fever along with this?',
    kind: 'boolean',
    priority: 72,
    redFlagWeight: 60,
    appliesWhen: whenComplaintKnown,
  },
];

const ROS_FIELDS: readonly FieldDefinition[] = [
  // Constitutional runs for everyone. §15 says avoid unnecessary questioning,
  // and these five are the ones that are never unnecessary.
  ros(
    'constitutional',
    'fever',
    'Fever',
    'Have you had a fever recently?',
    55,
    60,
    ALWAYS,
  ),
  ros(
    'constitutional',
    'rigors',
    'Shaking chills',
    'Have you had shaking chills where you could not stop shivering?',
    45,
    75,
    ALWAYS,
  ),
  ros(
    'constitutional',
    'weight_loss',
    'Unintended weight loss',
    'Have you lost weight without trying to?',
    40,
    45,
    ALWAYS,
  ),
  ros(
    'constitutional',
    'appetite_loss',
    'Loss of appetite',
    'Has your appetite dropped?',
    35,
    20,
    ALWAYS,
  ),
  ros(
    'constitutional',
    'fatigue',
    'Fatigue',
    'Have you been unusually tired?',
    30,
    20,
    ALWAYS,
  ),

  ros(
    'cardiovascular',
    'chest_pain',
    'Chest pain',
    'Do you get any pain or tightness in your chest?',
    60,
    80,
    whenCategory('cardiac', 'respiratory'),
  ),
  ros(
    'cardiovascular',
    'breathlessness_on_exertion',
    'Breathlessness on exertion',
    'Do you get out of breath doing things you used to manage easily?',
    55,
    55,
    whenCategory('cardiac', 'respiratory'),
  ),
  ros(
    'cardiovascular',
    'breathless_lying_flat',
    'Breathlessness lying flat',
    'Do you become breathless when you lie flat, or need extra pillows to sleep?',
    50,
    60,
    whenCategory('cardiac', 'respiratory'),
  ),
  ros(
    'cardiovascular',
    'ankle_swelling',
    'Ankle swelling',
    'Have your feet or ankles been swelling up?',
    45,
    40,
    whenCategory('cardiac', 'respiratory'),
  ),

  ros(
    'respiratory',
    'breathless_at_rest',
    'Breathless at rest',
    'Are you short of breath even while sitting still?',
    65,
    95,
    whenCategory('cardiac', 'respiratory', 'allergic'),
  ),
  // Deliberately phrased so that "yes" is the dangerous answer. "Can you
  // finish a sentence?" would make yes the reassuring answer, and every rule
  // that reads this field would then fire on well patients.
  ros(
    'respiratory',
    'cannot_complete_sentences',
    'Cannot complete a sentence',
    'Do you have to stop for breath in the middle of a sentence?',
    64,
    95,
    whenCategory('respiratory', 'allergic', 'cardiac'),
  ),
  ros(
    'respiratory',
    'fast_breathing',
    'Fast breathing',
    'Is your breathing faster than normal?',
    60,
    70,
    whenCategory('respiratory', 'constitutional', 'cardiac'),
  ),
  ros(
    'respiratory',
    'cough',
    'Cough',
    'Do you have a cough?',
    50,
    25,
    whenCategory('respiratory', 'ent', 'constitutional'),
  ),
  ros(
    'respiratory',
    'blood_in_sputum',
    'Blood in sputum',
    'Have you coughed up any blood?',
    55,
    80,
    whenCategory('respiratory', 'constitutional'),
  ),
  ros(
    'respiratory',
    'wheeze',
    'Wheeze',
    'Does your chest whistle or wheeze when you breathe?',
    45,
    40,
    whenCategory('respiratory', 'allergic'),
  ),

  ros(
    'gastrointestinal',
    'abdominal_pain',
    'Abdominal pain',
    'Do you have any pain in your stomach or belly?',
    60,
    50,
    whenCategory('gastrointestinal', 'genitourinary', 'obstetric'),
  ),
  ros(
    'gastrointestinal',
    'vomiting_blood',
    'Vomiting blood',
    'Have you vomited any blood, or something that looked like coffee grounds?',
    65,
    98,
    whenCategory('gastrointestinal'),
  ),
  ros(
    'gastrointestinal',
    'black_stools',
    'Black tarry stools',
    'Have your stools been black and sticky, like tar?',
    64,
    95,
    whenCategory('gastrointestinal'),
  ),
  ros(
    'gastrointestinal',
    'blood_in_stool',
    'Blood in stool',
    'Have you seen fresh blood when you pass motion?',
    63,
    90,
    whenCategory('gastrointestinal', 'genitourinary'),
  ),
  ros(
    'gastrointestinal',
    'vomiting',
    'Vomiting',
    'Have you been vomiting?',
    55,
    40,
    whenCategory('gastrointestinal', 'neurological'),
  ),
  ros(
    'gastrointestinal',
    'diarrhoea',
    'Diarrhoea',
    'Have you had loose motions?',
    50,
    35,
    whenCategory('gastrointestinal'),
  ),
  ros(
    'gastrointestinal',
    'constipation',
    'Constipation',
    'Have you been constipated?',
    40,
    20,
    whenCategory('gastrointestinal'),
  ),
  ros(
    'gastrointestinal',
    'jaundice',
    'Jaundice',
    'Have your eyes or skin looked yellow?',
    45,
    60,
    whenCategory('gastrointestinal'),
  ),
  ros(
    'gastrointestinal',
    'difficulty_swallowing',
    'Difficulty swallowing',
    'Is it hard to swallow food or liquids?',
    42,
    55,
    whenCategory('gastrointestinal', 'ent'),
  ),

  ros(
    'neurological',
    'sudden_worst_headache',
    'Sudden severe headache',
    'Did you get a headache that came on suddenly and was the worst you have ever had?',
    70,
    98,
    whenCategory('neurological'),
  ),
  ros(
    'neurological',
    'face_droop',
    'Facial droop',
    'Has one side of your face drooped, or does your smile look uneven?',
    69,
    98,
    whenCategory('neurological', 'cardiac'),
  ),
  ros(
    'neurological',
    'arm_weakness',
    'Limb weakness',
    'Has one arm or leg suddenly become weak or heavy?',
    68,
    98,
    whenCategory('neurological', 'cardiac'),
  ),
  ros(
    'neurological',
    'speech_difficulty',
    'Speech difficulty',
    'Has your speech become slurred, or are you struggling to find words?',
    67,
    98,
    whenCategory('neurological', 'cardiac'),
  ),
  ros(
    'neurological',
    'sudden_vision_loss',
    'Sudden vision loss',
    'Have you suddenly lost vision, or started seeing double?',
    66,
    92,
    whenCategory('neurological', 'ophthalmic'),
  ),
  ros(
    'neurological',
    'seizure',
    'Seizure',
    'Have you had a fit or convulsion?',
    65,
    95,
    whenCategory('neurological'),
  ),
  ros(
    'neurological',
    'confusion',
    'New confusion or drowsiness',
    'Have you been confused or unusually drowsy, or have others said so?',
    64,
    90,
    ALWAYS,
  ),
  ros(
    'neurological',
    'headache',
    'Headache',
    'Do you get headaches?',
    45,
    30,
    whenCategory('neurological', 'ent', 'ophthalmic'),
  ),
  ros(
    'neurological',
    'numbness',
    'Numbness or tingling',
    'Do you get numbness or pins and needles anywhere?',
    40,
    35,
    whenCategory('neurological', 'musculoskeletal'),
  ),

  ros(
    'genitourinary',
    'burning_urination',
    'Burning on urination',
    'Does it burn or sting when you pass urine?',
    50,
    30,
    whenCategory('genitourinary', 'gastrointestinal'),
  ),
  ros(
    'genitourinary',
    'blood_in_urine',
    'Blood in urine',
    'Have you seen blood in your urine?',
    55,
    70,
    whenCategory('genitourinary'),
  ),
  ros(
    'genitourinary',
    'reduced_urine_output',
    'Reduced urine output',
    'Have you been passing much less urine than usual?',
    58,
    80,
    whenCategory('genitourinary', 'constitutional', 'gastrointestinal'),
  ),
  {
    key: 'ros.genitourinary.pregnancy_possible',
    section: 'ros',
    label: 'Pregnancy possible',
    prompt: 'Is there any chance that you could be pregnant?',
    kind: 'boolean',
    priority: 62,
    redFlagWeight: 75,
    appliesWhen: whenCategory('obstetric', 'gastrointestinal', 'genitourinary'),
  },
  {
    key: 'ros.genitourinary.vaginal_bleeding',
    section: 'ros',
    label: 'Vaginal bleeding',
    prompt: 'Have you had any bleeding from the vagina?',
    kind: 'boolean',
    priority: 61,
    redFlagWeight: 95,
    // Asked only once pregnancy has actually been answered "yes". An unasked or
    // unsure pregnancy question must not unlock it — that is the difference
    // between an adaptive interview and an intrusive one.
    appliesWhen: anyOf(
      whenYes('ros.genitourinary.pregnancy_possible'),
      whenCategory('obstetric'),
    ),
  },

  ros(
    'musculoskeletal',
    'joint_pain',
    'Joint pain',
    'Do any of your joints hurt?',
    45,
    20,
    whenCategory('musculoskeletal', 'constitutional'),
  ),
  ros(
    'musculoskeletal',
    'joint_swelling',
    'Joint swelling',
    'Are any joints swollen or hot?',
    42,
    35,
    whenCategory('musculoskeletal'),
  ),
  ros(
    'musculoskeletal',
    'back_pain',
    'Back pain',
    'Do you have back pain?',
    40,
    25,
    whenCategory('musculoskeletal', 'genitourinary'),
  ),
  ros(
    'musculoskeletal',
    'recent_injury',
    'Recent injury',
    'Did you have a fall or injury recently?',
    48,
    55,
    whenCategory('musculoskeletal', 'trauma', 'neurological'),
  ),

  ros(
    'dermatological',
    'rash',
    'Rash',
    'Do you have any rash on your skin?',
    40,
    30,
    whenCategory('dermatological', 'allergic', 'constitutional'),
  ),
  ros(
    'dermatological',
    'sudden_widespread_rash',
    'Sudden widespread rash',
    'Did a rash appear suddenly over a large part of your body?',
    55,
    85,
    whenCategory('dermatological', 'allergic'),
  ),
  ros(
    'dermatological',
    'itching',
    'Itching',
    'Is your skin itching?',
    35,
    15,
    whenCategory('dermatological', 'allergic'),
  ),

  ros(
    'psychiatric',
    'low_mood',
    'Low mood',
    'Have you been feeling low or hopeless recently?',
    45,
    40,
    whenCategory('psychiatric', 'constitutional'),
  ),
  {
    key: 'ros.psychiatric.self_harm_thoughts',
    section: 'ros',
    label: 'Thoughts of self-harm',
    prompt:
      'Have you had any thoughts of harming yourself or ending your life?',
    kind: 'boolean',
    priority: 66,
    redFlagWeight: 99,
    // Asked when there is any psychiatric signal, and also when low mood has
    // already been answered "yes" from another route.
    appliesWhen: anyOf(
      whenCategory('psychiatric'),
      whenYes('ros.psychiatric.low_mood'),
    ),
  },

  ros(
    'allergic',
    'reaction_happening_now',
    'Reaction in progress',
    'Is a reaction happening right now?',
    70,
    96,
    anyOf(whenCategory('allergic'), whenYes('allergies.reported')),
  ),
  ros(
    'allergic',
    'throat_or_lip_swelling',
    'Throat or lip swelling',
    'Are your lips, tongue or throat swelling, or does your throat feel tight?',
    69,
    99,
    whenCategory('allergic', 'dermatological'),
  ),

  ros(
    'paediatric',
    'not_feeding',
    'Not feeding',
    'Is the child refusing to feed or drink?',
    70,
    96,
    whenChild,
  ),
  ros(
    'paediatric',
    'unrousable',
    'Abnormally sleepy',
    'Is the child unusually sleepy or hard to wake?',
    69,
    98,
    whenChild,
  ),
  ros(
    'paediatric',
    'convulsions',
    'Convulsions',
    'Has the child had a fit or convulsion?',
    68,
    98,
    whenChild,
  ),
  ros(
    'paediatric',
    'fast_breathing',
    'Fast breathing',
    'Is the child breathing faster than usual, or are the ribs pulling in?',
    67,
    95,
    whenChild,
  ),
  ros(
    'paediatric',
    'sunken_eyes',
    'Signs of dehydration',
    'Do the eyes look sunken, or has the child not passed urine for many hours?',
    66,
    90,
    whenChild,
  ),
];

/** Small constructor for the many uniform yes/no ROS questions. */
function ros(
  system: string,
  name: string,
  label: string,
  prompt: string,
  priority: number,
  redFlagWeight: number,
  appliesWhen: Predicate,
): FieldDefinition {
  return {
    key: `ros.${system}.${name}`,
    section: 'ros',
    label,
    prompt,
    kind: 'boolean',
    priority,
    redFlagWeight,
    appliesWhen,
  };
}

const PAST_MEDICAL_CONDITIONS: ReadonlyArray<[string, string, string]> = [
  [
    'diabetes',
    'Diabetes',
    'Have you ever been told you have diabetes, or sugar?',
  ],
  [
    'hypertension',
    'Hypertension',
    'Have you ever been told you have high blood pressure?',
  ],
  [
    'heart_disease',
    'Heart disease',
    'Have you ever been treated for a heart problem?',
  ],
  [
    'asthma',
    'Asthma or COPD',
    'Do you have asthma or any long-standing breathing problem?',
  ],
  [
    'kidney_disease',
    'Kidney disease',
    'Have you been told you have a kidney problem?',
  ],
  [
    'liver_disease',
    'Liver disease',
    'Have you been told you have a liver problem?',
  ],
  [
    'stroke_or_tia',
    'Previous stroke',
    'Have you ever had a stroke or a mini-stroke?',
  ],
  ['cancer', 'Cancer', 'Have you ever been treated for cancer?'],
  ['tuberculosis', 'Tuberculosis', 'Have you ever been treated for TB?'],
  [
    'thyroid_disorder',
    'Thyroid disorder',
    'Have you been told you have a thyroid problem?',
  ],
  ['epilepsy', 'Epilepsy', 'Have you ever been treated for fits or epilepsy?'],
  [
    'bleeding_disorder',
    'Bleeding disorder',
    'Do you bleed or bruise more easily than most people?',
  ],
];

const PAST_MEDICAL_FIELDS: readonly FieldDefinition[] = [
  ...PAST_MEDICAL_CONDITIONS.map(
    ([name, label, prompt], index): FieldDefinition => ({
      key: `past_medical.${name}`,
      section: 'past_medical',
      label,
      prompt,
      kind: 'boolean',
      priority: 80 - index,
      redFlagWeight: 30,
      appliesWhen: ALWAYS,
    }),
  ),
  {
    key: 'past_medical.previous_hospitalisation',
    section: 'past_medical',
    label: 'Previous hospitalisation',
    prompt: 'Have you been admitted to a hospital before?',
    kind: 'boolean',
    priority: 50,
    redFlagWeight: 25,
    appliesWhen: ALWAYS,
  },
  {
    key: 'past_medical.other_conditions',
    section: 'past_medical',
    label: 'Other conditions',
    prompt: 'Is there any other long-term illness we have not covered?',
    kind: 'text',
    priority: 40,
    redFlagWeight: 20,
    appliesWhen: ALWAYS,
  },
];

const SURGICAL_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'surgical.any_previous',
    section: 'surgical',
    label: 'Previous surgery',
    prompt: 'Have you had any operations or procedures in the past?',
    kind: 'boolean',
    priority: 80,
    redFlagWeight: 25,
    appliesWhen: ALWAYS,
  },
];

const MEDICATION_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'medications.any_current',
    section: 'medications',
    label: 'Current medications',
    prompt:
      'Are you taking any medicines at the moment, including anything you buy yourself?',
    kind: 'boolean',
    priority: 90,
    redFlagWeight: 55,
    appliesWhen: ALWAYS,
  },
];

const ALLERGY_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'allergies.reported',
    section: 'allergies',
    label: 'Allergies',
    prompt:
      'Do you have any allergies — to a medicine, a food, or anything else?',
    kind: 'boolean',
    priority: 95,
    redFlagWeight: 85,
    // Asked of every patient, in every interview, regardless of complaint.
    // There is no complaint for which "we did not get round to allergies" is
    // acceptable; see the rendering rule in case-renderer.ts.
    appliesWhen: ALWAYS,
  },
];

const FAMILY_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'family.any_relevant',
    section: 'family',
    label: 'Family history',
    prompt:
      'Does anyone in your close family have a long-term illness — like diabetes, blood pressure, heart trouble or cancer?',
    kind: 'boolean',
    priority: 70,
    redFlagWeight: 20,
    appliesWhen: ALWAYS,
  },
];

const SOCIAL_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'social.age_band',
    section: 'social',
    label: 'Age band',
    prompt: '',
    kind: 'choice',
    choices: ['infant', 'child', 'adolescent', 'adult', 'older_adult'],
    priority: 0,
    redFlagWeight: 70,
    appliesWhen: NEVER_ASKED,
  },
  {
    key: 'social.smoking',
    section: 'social',
    label: 'Smoking',
    prompt: 'Do you smoke, or have you smoked in the past?',
    kind: 'choice',
    choices: ['never', 'former', 'current'],
    priority: 70,
    redFlagWeight: 35,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.tobacco_chewing',
    section: 'social',
    label: 'Chewing tobacco',
    prompt: 'Do you chew tobacco, paan or gutkha?',
    kind: 'boolean',
    priority: 65,
    redFlagWeight: 30,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.alcohol',
    section: 'social',
    label: 'Alcohol',
    prompt: 'Do you drink alcohol? If so, roughly how often?',
    kind: 'choice',
    choices: ['never', 'occasional', 'weekly', 'daily', 'former'],
    priority: 60,
    redFlagWeight: 30,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.occupation',
    section: 'social',
    label: 'Occupation',
    prompt: 'What work do you do?',
    kind: 'text',
    priority: 45,
    redFlagWeight: 10,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.diet',
    section: 'social',
    label: 'Diet',
    prompt: 'What is your usual diet — vegetarian, mixed, or something else?',
    kind: 'choice',
    choices: ['vegetarian', 'mixed', 'vegan', 'other'],
    priority: 35,
    redFlagWeight: 5,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.exercise',
    section: 'social',
    label: 'Physical activity',
    prompt: 'How much physical activity do you get in a usual week?',
    kind: 'choice',
    choices: ['none', 'light', 'moderate', 'heavy'],
    priority: 30,
    redFlagWeight: 5,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.sleep',
    section: 'social',
    label: 'Sleep',
    prompt: 'How are you sleeping?',
    kind: 'choice',
    choices: ['well', 'disturbed', 'poor'],
    priority: 28,
    redFlagWeight: 15,
    appliesWhen: ALWAYS,
  },
  {
    key: 'social.exposure',
    section: 'social',
    label: 'Relevant exposure',
    prompt:
      'Is there anything at work or at home you are regularly exposed to — dust, chemicals, smoke, animals?',
    kind: 'text',
    priority: 25,
    redFlagWeight: 20,
    appliesWhen: anyOf(
      whenCategory('respiratory', 'dermatological', 'allergic'),
      whenYes('ros.respiratory.cough'),
    ),
  },
];

/**
 * AYUSH (§22), in the patient's words rather than in Sanskrit.
 *
 * The spec is explicit that the patient-facing experience should translate the
 * terminology. A patient asked "what is your prakriti?" cannot answer; a
 * patient asked "how would you describe your usual build?" can. The Sanskrit
 * concept stays in the `label`, where the practitioner reads it, and never in
 * the `prompt`, which is what the patient hears.
 */
const AYUSH_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'ayush.prakriti_build',
    section: 'ayush',
    label: 'Prakriti — body build',
    prompt:
      'How would you describe your usual build — on the thin side, medium, or heavier?',
    kind: 'choice',
    choices: ['thin', 'medium', 'heavy'],
    priority: 70,
    redFlagWeight: 0,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.prakriti_climate_preference',
    section: 'ayush',
    label: 'Prakriti — climate tolerance',
    prompt: 'Do you feel more comfortable in cool weather or in warm weather?',
    kind: 'choice',
    choices: ['prefers_cool', 'prefers_warm', 'no_preference'],
    priority: 68,
    redFlagWeight: 0,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.agni_appetite',
    section: 'ayush',
    label: 'Agni — appetite',
    prompt:
      'How is your appetite usually — strong, normal, changes from day to day, or poor?',
    kind: 'choice',
    choices: ['strong', 'normal', 'variable', 'poor'],
    priority: 66,
    redFlagWeight: 10,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.agni_digestion',
    section: 'ayush',
    label: 'Agni — digestion',
    prompt:
      'After a meal, do you usually feel comfortable, heavy, or a burning feeling?',
    kind: 'choice',
    choices: ['comfortable', 'heaviness', 'burning', 'bloating'],
    priority: 64,
    redFlagWeight: 10,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.koshtha_bowel',
    section: 'ayush',
    label: 'Koshtha — bowel tendency',
    prompt:
      'How are your bowels usually — regular every day, on the harder side, or on the looser side?',
    kind: 'choice',
    choices: ['regular', 'tends_hard', 'tends_loose'],
    priority: 62,
    redFlagWeight: 10,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.nidana_triggers',
    section: 'ayush',
    label: 'Nidana — triggers',
    prompt:
      'Have you noticed anything that usually brings this problem on — a particular food, activity, season, or time of day?',
    kind: 'text',
    priority: 60,
    redFlagWeight: 15,
    appliesWhen: whenAyush,
  },
  {
    key: 'ayush.ahara_vihara_routine',
    section: 'ayush',
    label: 'Ahara-Vihara — daily routine',
    prompt:
      'Please describe a usual day for you — when you eat, when you work, and when you sleep.',
    kind: 'text',
    priority: 58,
    redFlagWeight: 0,
    appliesWhen: whenAyush,
  },
];

const INVESTIGATION_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'investigations.any_previous',
    section: 'investigations',
    label: 'Previous investigations',
    prompt:
      'Have you had any tests or scans done for this, or do you have reports with you?',
    kind: 'boolean',
    priority: 60,
    redFlagWeight: 15,
    appliesWhen: ALWAYS,
  },
];

/* ─────────────────────────── repeated-group templates ─────────────────────────── */

interface GroupItemTemplate {
  readonly suffix: string;
  readonly label: string;
  readonly prompt: string;
  readonly kind: FieldKind;
  readonly choices?: readonly string[];
  readonly priority: number;
  readonly redFlagWeight: number;
}

interface GroupTemplate {
  readonly prefix: string;
  readonly section: SectionKey;
  /** The summary question whose "yes" means there is at least one item. */
  readonly gate: Predicate;
  readonly items: readonly GroupItemTemplate[];
}

/**
 * Repeated sections — medications, allergies, surgeries, family conditions,
 * investigations — are templates rather than fixed fields because we do not
 * know in advance how many there are. `fieldsFor` instantiates index 0 as soon
 * as the section's summary question is answered "yes", and one instance for
 * every index the state already contains, so a patient who mentions a second
 * medicine gets asked about the second medicine.
 */
const GROUP_TEMPLATES: readonly GroupTemplate[] = [
  {
    prefix: 'medications',
    section: 'medications',
    gate: whenYes('medications.any_current'),
    items: [
      {
        suffix: 'name',
        label: 'Medicine',
        // §18: if the patient cannot name it, the field stays `unknown` and the
        // item is flagged for verification. Nothing in this engine guesses a
        // drug name from a description.
        prompt: 'What is the name of the medicine?',
        kind: 'text',
        priority: 90,
        redFlagWeight: 50,
      },
      {
        suffix: 'strength',
        label: 'Strength',
        prompt: 'What strength is it — how many milligrams?',
        kind: 'text',
        priority: 80,
        redFlagWeight: 30,
      },
      {
        suffix: 'dose',
        label: 'Dose',
        prompt: 'How much do you take each time?',
        kind: 'text',
        priority: 78,
        redFlagWeight: 30,
      },
      {
        suffix: 'frequency',
        label: 'Frequency',
        prompt: 'How many times a day do you take it?',
        kind: 'text',
        priority: 76,
        redFlagWeight: 25,
      },
      {
        suffix: 'route',
        label: 'Route',
        prompt: 'Is it a tablet, a syrup, an inhaler, or an injection?',
        kind: 'choice',
        choices: ['oral', 'topical', 'inhaled', 'injection', 'other'],
        priority: 60,
        redFlagWeight: 15,
      },
      {
        suffix: 'timing',
        label: 'Timing',
        prompt:
          'When in the day do you take it — morning, night, before or after food?',
        kind: 'text',
        priority: 55,
        redFlagWeight: 10,
      },
      {
        suffix: 'duration',
        label: 'Duration',
        prompt: 'How long have you been taking it?',
        kind: 'duration',
        priority: 50,
        redFlagWeight: 10,
      },
      {
        suffix: 'status',
        label: 'Status',
        prompt: 'Are you still taking it, or have you stopped?',
        kind: 'choice',
        choices: ['current', 'stopped'],
        priority: 70,
        redFlagWeight: 20,
      },
    ],
  },
  {
    prefix: 'allergies',
    section: 'allergies',
    gate: whenYes('allergies.reported'),
    items: [
      {
        suffix: 'substance',
        label: 'Allergen',
        prompt: 'What are you allergic to?',
        kind: 'text',
        priority: 95,
        redFlagWeight: 85,
      },
      {
        suffix: 'type',
        label: 'Type',
        prompt: 'Is that a medicine, a food, or something else?',
        kind: 'choice',
        choices: ['drug', 'food', 'environmental', 'other'],
        priority: 85,
        redFlagWeight: 60,
      },
      {
        suffix: 'reaction',
        label: 'Reaction',
        prompt: 'What happens to you when you have it?',
        kind: 'text',
        priority: 90,
        redFlagWeight: 80,
      },
      {
        suffix: 'severity',
        label: 'Severity',
        prompt:
          'How bad was the reaction — mild, moderate, or severe enough to need treatment?',
        kind: 'choice',
        choices: ['mild', 'moderate', 'severe'],
        priority: 88,
        redFlagWeight: 90,
      },
    ],
  },
  {
    prefix: 'surgical',
    section: 'surgical',
    gate: whenYes('surgical.any_previous'),
    items: [
      {
        suffix: 'procedure',
        label: 'Procedure',
        prompt: 'What operation did you have?',
        kind: 'text',
        priority: 80,
        redFlagWeight: 25,
      },
      {
        suffix: 'reason',
        label: 'Reason',
        prompt: 'What was it done for?',
        kind: 'text',
        priority: 70,
        redFlagWeight: 20,
      },
      {
        suffix: 'approximate_date',
        label: 'Date',
        prompt: 'Roughly when was it — which year?',
        kind: 'text',
        priority: 65,
        redFlagWeight: 10,
      },
      {
        suffix: 'hospital',
        label: 'Hospital',
        prompt: 'Which hospital was it done at?',
        kind: 'text',
        priority: 50,
        redFlagWeight: 5,
      },
      {
        suffix: 'complications',
        label: 'Complications',
        prompt: 'Were there any problems during or after the operation?',
        kind: 'text',
        priority: 60,
        redFlagWeight: 35,
      },
    ],
  },
  {
    prefix: 'family',
    section: 'family',
    gate: whenYes('family.any_relevant'),
    items: [
      {
        suffix: 'condition',
        label: 'Condition',
        prompt: 'What illness does your relative have?',
        kind: 'text',
        priority: 70,
        redFlagWeight: 20,
      },
      {
        suffix: 'relation',
        label: 'Relation',
        prompt: 'Which relative is that — mother, father, brother, sister?',
        kind: 'text',
        priority: 65,
        redFlagWeight: 15,
      },
    ],
  },
  {
    prefix: 'investigations',
    section: 'investigations',
    gate: whenYes('investigations.any_previous'),
    items: [
      {
        suffix: 'name',
        label: 'Test',
        prompt: 'Which test was it?',
        kind: 'text',
        priority: 60,
        redFlagWeight: 15,
      },
      {
        suffix: 'value',
        label: 'Result',
        prompt: 'Do you know the result?',
        kind: 'text',
        priority: 55,
        redFlagWeight: 15,
      },
      {
        suffix: 'date',
        label: 'Date',
        prompt: 'Roughly when was the test done?',
        kind: 'text',
        priority: 50,
        redFlagWeight: 5,
      },
    ],
  },
];

/**
 * The repeated-group fields as *templates*, with the index written `[]`.
 *
 * `fieldsFor` instantiates `medications[0].name`, `medications[1].name` and so
 * on, which means those keys do not exist until a patient has said they take a
 * medicine — and a translation cannot be keyed on a path that only exists at
 * runtime for one particular patient. One instance of a phrasebook entry per
 * index would also be absurd: the question is the same question whether it is
 * the first medicine or the fourth.
 *
 * So a phrasebook keys these on the template, `medications[].name`, and
 * `phrasebook.ts` strips the index before looking a question up. This export is
 * what makes a typo in such a key fail at import rather than silently ask the
 * English question forever — the same argument as
 * `assertRulesReferenceRealFields`.
 */
export const GROUP_TEMPLATE_FIELD_KEYS: readonly string[] =
  GROUP_TEMPLATES.flatMap((template) =>
    template.items.map((item) => `${template.prefix}[].${item.suffix}`),
  );

/** `medications[2].name` → `medications[].name`. Any other key is unchanged. */
export function groupTemplateKey(fieldKey: string): string {
  return fieldKey.replace(/\[\d+\]/, '[]');
}

/** Every non-repeating field, in declaration order. */
export const STATIC_FIELDS: readonly FieldDefinition[] = [
  ...CHIEF_COMPLAINT_FIELDS,
  ...HPI_FIELDS,
  ...ROS_FIELDS,
  ...PAST_MEDICAL_FIELDS,
  ...SURGICAL_FIELDS,
  ...MEDICATION_FIELDS,
  ...ALLERGY_FIELDS,
  ...FAMILY_FIELDS,
  ...SOCIAL_FIELDS,
  ...AYUSH_FIELDS,
  ...INVESTIGATION_FIELDS,
];

/**
 * The registry as the interview sees it for a given state: static fields plus
 * one instance of each repeated group per index in play.
 */
export function fieldsFor(state: ClinicalState): readonly FieldDefinition[] {
  const expanded: FieldDefinition[] = [];
  for (const template of GROUP_TEMPLATES) {
    const gateOpen = template.gate(state);
    const indices = new Set<number>(groupIndices(state, template.prefix));
    // Index 0 exists as soon as the patient says there is something to record,
    // even before any of its own fields have been answered.
    if (gateOpen) indices.add(0);
    for (const index of [...indices].sort((a, b) => a - b)) {
      for (const item of template.items) {
        expanded.push({
          key: `${template.prefix}[${index}].${item.suffix}`,
          section: template.section,
          label: index === 0 ? item.label : `${item.label} (${index + 1})`,
          prompt: item.prompt,
          kind: item.kind,
          choices: item.choices,
          // Later items in a list are less urgent than the first.
          priority: Math.max(0, item.priority - index),
          redFlagWeight: item.redFlagWeight,
          // The gate is re-checked per state rather than captured, so a patient
          // who corrects "yes" back to "no" stops being asked.
          appliesWhen: template.gate,
        });
      }
    }
  }
  return [...STATIC_FIELDS, ...expanded];
}

export function findField(
  state: ClinicalState,
  key: string,
): FieldDefinition | undefined {
  return fieldsFor(state).find((field) => field.key === key);
}

export function applicableFields(
  state: ClinicalState,
): readonly FieldDefinition[] {
  return fieldsFor(state).filter((field) => field.appliesWhen(state));
}

/* ─────────────────────── value validation for a field ─────────────────────── */

/** The shape `derivePresence` and `validateFieldValue` need for one field. */
export function valueSpecFor(field: FieldDefinition): FieldValueSpec {
  return {
    kind: field.kind,
    choices: field.choices,
    accepts: field.accepts,
  };
}

/**
 * Validate a candidate value against the field it claims to answer.
 *
 * The extraction layer should call this before anything else: a value that
 * fails here must be discarded, leaving the field `not_assessed` so the
 * interview asks again. It must never be stored with a lower confidence and a
 * hope, because nothing downstream gates on confidence.
 */
export function validateAnswerFor(
  field: FieldDefinition,
  raw: unknown,
): ValueValidation {
  return validateFieldValue(valueSpecFor(field), raw);
}

/* ─────────────────────────── load-time invariants ─────────────────────────── */

/**
 * Forbidden substrings in a field key. This is the enforcement half of the
 * comment at the top of the file: adding a diagnosis slot back to the registry
 * fails at import, in every environment, including the one where somebody
 * added it "just for the doctor's notes".
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'diagnos',
  'impression',
  'assessment',
  'icd',
  'differential',
  'provisional',
];

function assertNoDiagnosisSlot(fields: readonly FieldDefinition[]): void {
  for (const field of fields) {
    const lowered = field.key.toLowerCase();
    const offending = FORBIDDEN_KEY_FRAGMENTS.find((fragment) =>
      lowered.includes(fragment),
    );
    if (offending) {
      throw new Error(
        `field-registry: "${field.key}" looks like a diagnosis slot ("${offending}"). ` +
          'This feature performs risk detection, not diagnosis (§29, §30). ' +
          'Remove the field rather than relaxing this check.',
      );
    }
  }
}

function assertRegistryIsWellFormed(fields: readonly FieldDefinition[]): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) {
      throw new Error(`field-registry: duplicate key ${field.key}`);
    }
    seen.add(field.key);

    if (!isSectionKey(field.section)) {
      throw new Error(`field-registry: unknown section on ${field.key}`);
    }
    if (sectionOf(field.key) !== field.section) {
      // A key filed under the wrong section silently disappears from that
      // section's completion maths and from the rendered case.
      throw new Error(
        `field-registry: ${field.key} is declared in section "${field.section}" but its path says "${sectionOf(field.key)}"`,
      );
    }
    if (field.kind === 'choice' && (field.choices?.length ?? 0) === 0) {
      throw new Error(
        `field-registry: ${field.key} is a choice with no choices`,
      );
    }
    if (field.priority < 0 || field.priority > 100) {
      throw new Error(`field-registry: ${field.key} priority out of range`);
    }
    if (field.redFlagWeight < 0 || field.redFlagWeight > 100) {
      throw new Error(
        `field-registry: ${field.key} redFlagWeight out of range`,
      );
    }
    if (field.appliesWhen !== NEVER_ASKED && field.prompt.trim().length === 0) {
      throw new Error(`field-registry: ${field.key} has no fallback prompt`);
    }
  }
}

assertNoDiagnosisSlot(STATIC_FIELDS);
assertRegistryIsWellFormed(STATIC_FIELDS);
