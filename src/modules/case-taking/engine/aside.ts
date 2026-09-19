/**
 * The patient said something that was not an answer.
 *
 * Everything else in this engine assumes an utterance is evidence for the field
 * that was just asked about. Most of the time it is. But a person being
 * interviewed by a machine does what a person being interviewed by a nurse
 * does: they interrupt. "Why do you need to know that?" "How much longer?"
 * "Is it serious?" "Sorry — say that again?" Those are not answers, and the
 * cost of reading them as answers is precise and was observed in a real
 * session: "Could he have been out?" was filed against a fever question, the
 * field went pending, `askableFields` skipped it, and the interview moved to
 * the pain scale with a permanent hole in the chart where the fever answer
 * belonged. The patient's actual question was never acknowledged at all.
 *
 * ── What this file does and, more importantly, what it does not
 *
 * It classifies an utterance into one of a **closed set** of asides, or returns
 * null. That is all. It does not write the reply — `asideReplyFor` in the
 * phrasebook does, from checked-in copy a clinician has read — and it does not
 * decide what happens next, which is the service's job. A language model is
 * nowhere in this path, for the same reason it is nowhere in the question
 * selector: this runs on the hot path of a live conversation, and eight to
 * twenty seconds of gemma3:4b is not a conversation.
 *
 * ── Why the patterns are anchored
 *
 * The expensive failure is not a missed aside, it is a **stolen answer**: an
 * utterance that really was evidence, discarded as chatter. So every pattern
 * here must match the *whole* utterance, modulo leading and trailing filler.
 * "Is it serious?" is an aside. "Chest pain since Monday, is it serious?" is an
 * answer with a question attached, and it goes down the normal path where
 * extraction can split it — the aside is lost, which costs an acknowledgement,
 * not a fact.
 *
 * The same reasoning caps the length: an aside is a short interruption, and a
 * long utterance that happens to contain "why" is a narrative.
 */

/**
 * The kinds of interruption this interview knows how to answer.
 *
 * A closed set on purpose, and it is closed in three places at once: here, in
 * the phrasebook's reply table, and in the app's own copy file. The client
 * renders its own sentence for the intent rather than printing the server's,
 * which is what keeps the rule that this screen never shows a patient server
 * free text — see `CaseTakingController._followAgent`.
 *
 * Adding a member means adding a reply in every phrasebook and a line in
 * `PatientText`. That is the cost of the guarantee and it is meant to be felt.
 */
export const ASIDE_INTENTS = [
  /** "Sorry, what?" — heard nothing, or not enough of it. */
  'repeat',
  /** "What do you mean?" — heard it, did not follow it. */
  'not_understood',
  /** "Why do you need to know that?" */
  'why_ask',
  /** "How much longer is this going to take?" */
  'how_long',
  /** "Is it serious?" — the one this must never answer. */
  'is_it_serious',
  /** "Can I talk to a real person?" */
  'want_human',
  /** "Are you a robot?" */
  'who_are_you',
  /** "Hello?" */
  'greeting',
  /** "Thank you." */
  'thanks',
  /** "Hold on a second." */
  'wait',
  /** A question this interview has no answer for. The honest fallback. */
  'unrelated',
] as const;

export type AsideIntent = (typeof ASIDE_INTENTS)[number];

/**
 * Longer than this and it is a narrative, not an interruption.
 *
 * Deliberately shorter than `SHORT_ANSWER_CHARS`: an answer may be a sentence
 * about the patient's body, an aside is almost always under six words.
 */
const ASIDE_MAX_CHARS = 64;

/**
 * Filler that may sit either side of an aside without changing what it is.
 *
 * "Sorry, why do you ask?" and "why do you ask, sorry" are the same
 * interruption. Kept small — every word added here is a word that can no
 * longer disqualify a match, and a permissive list is how an answer gets
 * stolen.
 */
const FILLER =
  "(?:\\b(?:um+|uh+|er+|hmm+|ah+|oh+|ok|okay|so|well|but|and|sorry|please|hey|excuse me|wait|hold on|doctor|sir|madam|ma'?am)\\b[\\s,]*)*";

/**
 * One intent's patterns, each matching a complete utterance.
 *
 * Order matters only where two intents could both match: the array is scanned
 * in the order declared here and the first hit wins. `is_it_serious` is
 * deliberately near the top, because the cost of reading "am I going to be
 * okay?" as an unrelated question is a patient told nothing when they were
 * frightened enough to interrupt.
 */
interface AsideRule {
  readonly intent: AsideIntent;
  readonly patterns: readonly RegExp[];
}

/**
 * Built once, at module load, and frozen. A regex compiled per turn on a path
 * measured in milliseconds is a cost with no payer.
 *
 * Each source is wrapped with the filler prefix/suffix and anchored, so a rule
 * writer below states only the phrase itself.
 */
function anchored(...sources: readonly string[]): readonly RegExp[] {
  return Object.freeze(
    sources.map(
      (source) =>
        new RegExp(`^${FILLER}(?:${source})[\\s,.!?]*${FILLER}$`, 'i'),
    ),
  );
}

const ASIDE_RULES: readonly AsideRule[] = Object.freeze([
  {
    // First, and the only rule here with a clinical consequence. A patient who
    // asks this has usually just told us something that frightened them.
    intent: 'is_it_serious',
    patterns: anchored(
      'is (?:it|this|that) (?:serious|bad|dangerous|something serious|anything serious)',
      '(?:is (?:it|this)|could (?:it|this) be|do i have|have i got) (?:a )?(?:heart attack|stroke|cancer|tumou?r|covid|infection)',
      'am i (?:going to be )?(?:ok|okay|alright|all right|fine|dying)',
      '(?:am i|is it) (?:going to be )?(?:ok|okay|alright)',
      "what(?:'s| is) wrong with me",
      'what do (?:you|i) (?:think|have)',
      'should i be (?:worried|scared|concerned)',
      'is (?:it|this) (?:an )?emergency',
    ),
  },
  {
    intent: 'want_human',
    patterns: anchored(
      '(?:can|could|may) i (?:please )?(?:talk|speak) to (?:a|the|someone|somebody|an actual|a real)[\\w\\s]{0,20}',
      'i (?:want|need|would like) (?:to see |to talk to |to speak to )?(?:a |the )?(?:doctor|nurse|person|human|someone|somebody|real person)',
      '(?:get|call|send) (?:me )?(?:a|the) (?:doctor|nurse|human|person)',
      'is (?:there|anyone|anybody|somebody) (?:a )?(?:real )?(?:person|human|nurse|doctor)(?: there| here| available)?',
      'i want to (?:stop|quit|do this later)',
    ),
  },
  {
    intent: 'who_are_you',
    patterns: anchored(
      'are you (?:a )?(?:robot|bot|machine|computer|human|real|a real person|a person|ai|an ai)',
      'who (?:are|is) (?:you|this)',
      "what(?:'s| is) your name",
      'am i (?:talking|speaking) to (?:a )?(?:robot|bot|machine|computer|human|person|real person)',
    ),
  },
  {
    intent: 'why_ask',
    patterns: anchored(
      'why(?:\\s+(?:do|are|would|does))?(?:\\s+(?:you|u|that|this|it))?(?:\\s+(?:need|ask|asking|want|matter))?(?:\\s+to know)?(?:\\s+(?:that|this|it))?',
      'why does (?:that|this|it) matter',
      "what(?:'s| is| has) (?:that|this) got to do with[\\w\\s]{0,24}",
      'how is (?:that|this) relevant',
      'what (?:has|does) (?:that|this) (?:got to do|have to do) with[\\w\\s]{0,24}',
      '(?:that|this) (?:is|seems) (?:a )?(?:strange|weird|odd|personal) question',
    ),
  },
  {
    intent: 'how_long',
    patterns: anchored(
      'how (?:much )?(?:long|longer|many more|many questions)(?: (?:is|will|does) (?:this|it|that))?(?: (?:take|go on|last|left))?',
      'how many (?:more )?(?:questions|are left|left)(?: (?:are there|is there))?',
      'are we (?:nearly |almost )?(?:done|finished|there)',
      'is (?:this|it) (?:nearly |almost )?(?:done|over|finished)',
      'when (?:will|does) (?:this|it) (?:end|finish|be over|be done)',
      'how many more',
    ),
  },
  {
    intent: 'repeat',
    patterns: anchored(
      '(?:can|could) you (?:please )?(?:say|repeat) (?:that|it|the question)(?: again| one more time)?',
      '(?:say|repeat) (?:that|it|the question)(?: again| one more time)?',
      'what (?:was|is) (?:that|the question)(?: again)?',
      'pardon(?: me)?',
      'come again',
      'what',
      '(?:i )?(?:did ?n.?t|could ?n.?t|can ?no?t) (?:quite )?(?:hear|catch|make out)(?: that| you| it)?',
      '(?:i )?(?:can ?no?t|could ?n.?t) hear you',
      'one more time',
      'again(?: please)?',
    ),
  },
  {
    intent: 'not_understood',
    patterns: anchored(
      "(?:i )?(?:do ?n.?t|did ?n.?t) (?:quite )?(?:understand|follow|get)(?:\\s+(?:that|it|this|the question|what you mean|what you're asking))?",
      'what do you mean(?: by that)?',
      'what does (?:that|this) mean',
      "(?:i(?:'m| am) )?(?:not sure )?what you(?:'re| are) asking",
      '(?:that|this|the question) (?:does ?n.?t|did ?n.?t) make (?:any )?sense',
      "i(?:'m| am) confused",
    ),
  },
  {
    intent: 'wait',
    patterns: anchored(
      '(?:hang on|hold on|hold up|wait)(?: a (?:second|sec|minute|moment))?',
      // "just a minute" and "give me a minute" are asides; a bare "a minute"
      // is not, because it is also an answer — `hpi.duration` asks how long
      // something has been going on and takes exactly that shape. The bare
      // form is allowed only for the units nobody answers a duration question
      // with, which is why `minute` is absent from it and present above.
      '(?:just )?(?:a|one) (?:second|sec|moment)',
      'give me (?:a|one) (?:second|sec|minute|moment|min)',
      'let me think(?: about (?:that|it))?',
      "(?:i(?:'m| am) )?thinking",
    ),
  },
  {
    intent: 'greeting',
    patterns: anchored(
      '(?:hello|hi|hey|hiya|namaste|namaskar|vanakkam|salaam|assalamu alaikum)(?: there)?',
      'good (?:morning|afternoon|evening)',
      'are you there',
      'can you hear me',
    ),
  },
  {
    intent: 'thanks',
    patterns: anchored(
      '(?:thanks|thank you|thankyou|cheers|much appreciated)(?: (?:very much|a lot|so much))?',
      "that(?:'s| is) (?:very )?(?:kind|helpful|nice)(?: of you)?",
    ),
  },
]);

/**
 * Openings that address the *interview* rather than describe the patient.
 *
 * The distinction is the whole of this list, and getting it wrong is how a real
 * answer gets stolen. English opens questions and answers with the same words:
 * "when I walk" answers what makes the pain worse, "where it hurts" answers
 * where it hurts, and a list of every interrogative opener would read both as
 * interruptions and re-ask the question the patient had just answered — a loop,
 * with the patient on the wrong end of it.
 *
 * So what is listed here is the second person and the meta: questions about
 * this conversation, this machine, or how much of it is left. A question about
 * the patient's own body is an answer until proved otherwise, and the proof
 * this accepts is a question mark.
 */
const META_OPENERS =
  /^(?:why|who|what(?:'?s| is| do you| does (?:that|this))?|how (?:long|many|much)|are you|am i|can (?:you|i)|could you|will you|would you|do you|does (?:this|that|it)|is (?:this|that|it)|should i|when (?:will|does|do we))\b/i;

/** Punctuation and spacing off, case folded. What every matcher here reads. */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'");
}

/**
 * Is this an interruption, and which one?
 *
 * Returns null for anything that is not unambiguously an aside — which is most
 * things, deliberately. A null here means "treat it as an answer", and treating
 * an aside as an answer costs one acknowledgement while the reverse costs a
 * fact off a patient's chart.
 */
export function classifyAside(text: string): AsideIntent | null {
  const utterance = normalise(text);
  if (utterance.length === 0 || utterance.length > ASIDE_MAX_CHARS) return null;

  for (const rule of ASIDE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(utterance)) return rule.intent;
    }
  }
  return null;
}

/**
 * Does this read as a question put *to* the interview, rather than an answer?
 *
 * The weaker, second-stage test, and it is only safe because of where it is
 * called from: after `derivePresence` has already declined to read the
 * utterance as an answer to the field that was asked. On its own it would be
 * far too eager — "Are you there" and "Was it Monday" open identically — so it
 * is not exported as a judgement about the text, only as the last condition of
 * one.
 *
 * A trailing question mark is not required and not sufficient. Speech-to-text
 * punctuates a question as often as it does not, which is the whole reason the
 * openers list exists.
 */
export function looksInterrogative(text: string): boolean {
  const utterance = normalise(text);
  if (utterance.length === 0 || utterance.length > ASIDE_MAX_CHARS)
    return false;

  // Two sentences are not an interruption; the first of them is usually the
  // answer. `isShortAnswer` draws the same line for the same reason.
  if (/[.!?]\s+\S/.test(utterance)) return false;

  // One word is never an interruption this stage needs to catch. The one-word
  // interruptions that exist — "what?", "pardon?", "again?" — are all in the
  // pattern list above, which runs first and does not need a question mark to
  // recognise them.
  if (utterance.split(' ').length < 2) return false;

  // The recogniser punctuated it as a question. That is a direct measurement of
  // how the patient's voice ended, and it is the only evidence strong enough to
  // read a first-person sentence — the shape of nearly every real answer — as
  // something addressed to the interview instead.
  if (utterance.replace(/[\s.!]+$/, '').endsWith('?')) return true;

  return META_OPENERS.test(utterance);
}
