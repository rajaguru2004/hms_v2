import {
  ASIDE_INTENTS,
  AsideIntent,
  classifyAside,
  looksInterrogative,
} from './aside';
import { ENGLISH_ASIDE_REPLIES, asideReplyFor } from './phrasebook';
import { findDiagnosticLanguage } from './safety-rules';

/**
 * Real utterances, one per intent, of the kind that produced this file.
 *
 * Kept as data rather than inline so the exhaustiveness check below can assert
 * that every member of the closed set has at least one example — a new intent
 * added with no phrasing that reaches it is a dead branch, and it would be a
 * silent one.
 */
const EXAMPLES: Readonly<Record<AsideIntent, readonly string[]>> = {
  repeat: [
    'sorry, what?',
    'can you say that again',
    'What was that?',
    'pardon',
    "I didn't catch that",
    'one more time',
  ],
  not_understood: [
    "I don't understand",
    'what do you mean?',
    'what does that mean',
    "that doesn't make sense",
    "I'm confused",
  ],
  why_ask: [
    'why do you ask?',
    'why do you need to know that',
    'why?',
    'what has that got to do with my chest',
    'how is that relevant',
  ],
  how_long: [
    'how much longer?',
    'how many more questions',
    'are we nearly done',
    'how long will this take',
    'when will this finish',
  ],
  is_it_serious: [
    'is it serious?',
    'is this bad',
    'am I going to be okay?',
    'is it a heart attack',
    "what's wrong with me",
    'should I be worried',
  ],
  want_human: [
    'can I talk to a real person',
    'I want to see a doctor',
    'is there a nurse there?',
    'get me a doctor',
  ],
  who_are_you: [
    'are you a robot?',
    'are you human',
    'who are you',
    "what's your name",
  ],
  greeting: [
    'hello?',
    'hi',
    'good morning',
    'are you there',
    'can you hear me',
  ],
  thanks: ['thank you', 'thanks a lot', 'cheers'],
  wait: [
    'hold on',
    'wait a second',
    'give me a minute',
    'let me think',
    'just a moment',
  ],
  // Reached by `looksInterrogative` in the service rather than by a pattern
  // here, which is why it has no example: it is the fallback for a question
  // nobody wrote a rule for, and a rule that produced it would defeat the
  // point. `submitTurn` is where its one caller lives.
  unrelated: [],
};

/**
 * Answers a real patient gave, or plausibly gives, to the questions in the
 * registry. **Not one of these may be read as an interruption.**
 *
 * This is the test that matters. A missed aside costs an acknowledgement; a
 * stolen answer costs a fact off a chart, and the whole reason the patterns
 * are anchored and length-capped is this list.
 */
const REAL_ANSWERS: readonly string[] = [
  // yes/no and the ways people actually say them
  'no',
  'nope',
  'not at all',
  'yes',
  'yeah',
  'of course',
  'I do',
  "I don't know",
  'not sure',
  'no idea',
  'who knows',
  'maybe',
  'I think so',
  "I'd rather not say",
  // durations and onsets
  'three days',
  'about two weeks',
  'a minute',
  'since Monday',
  'woke up with it',
  'it came on suddenly',
  'on and off for a week',
  'when I walk',
  // severity and character
  'seven',
  'moderate',
  'a burning feeling',
  'it comes and goes, mostly at night',
  // chief complaints, including ones phrased as questions
  'chest pain',
  'my chest hurts when I breathe in',
  'why does my chest hurt so much',
  'headache for three days',
  // an answer with an interruption welded to it: the answer wins
  'chest pain since Monday, is it serious?',
  'three days. how much longer is this?',
  'no. why do you ask',
];

describe('classifying an interruption', () => {
  it.each(
    ASIDE_INTENTS.flatMap((intent) =>
      EXAMPLES[intent].map((text) => [intent, text] as const),
    ),
  )('reads %s from "%s"', (intent, text) => {
    expect(classifyAside(text)).toBe(intent);
  });

  it.each(REAL_ANSWERS)('does not steal the answer "%s"', (text) => {
    expect(classifyAside(text)).toBeNull();
  });

  it('every intent but the fallback is reachable from some phrasing', () => {
    const unreachable = ASIDE_INTENTS.filter(
      (intent) => intent !== 'unrelated' && EXAMPLES[intent].length === 0,
    );
    expect(unreachable).toEqual([]);
  });

  it('ignores anything long enough to be a narrative', () => {
    // Contains "why do you ask" verbatim and is still not an aside, because a
    // patient who says this much is telling us something.
    expect(
      classifyAside(
        'why do you ask, I have had this pain in my chest since Monday and it ' +
          'gets worse when I climb the stairs',
      ),
    ).toBeNull();
  });

  it('is not fooled by filler around the interruption', () => {
    expect(classifyAside('um, sorry, why do you ask?')).toBe('why_ask');
    expect(classifyAside('ok but how much longer')).toBe('how_long');
  });

  it('reads nothing out of silence', () => {
    expect(classifyAside('')).toBeNull();
    expect(classifyAside('   ')).toBeNull();
  });
});

describe('the second-stage interrogative test', () => {
  it.each([
    'could he have been out?',
    'what about my tablets?',
    'do I need to fast?',
    'is that everything?',
  ])('reads "%s" as a question put to the interview', (text) => {
    expect(looksInterrogative(text)).toBe(true);
  });

  it.each(['no', 'yes', 'three days', 'seven', 'when I walk', 'what'])(
    'does not read the one-word or plain answer "%s" as a question',
    (text) => {
      expect(looksInterrogative(text)).toBe(false);
    },
  );

  it('a second sentence disqualifies it, the same as a short answer', () => {
    expect(looksInterrogative('three days. is it serious?')).toBe(false);
  });

  it('takes a question mark on its own when no opener is there', () => {
    expect(looksInterrogative('my tablets?')).toBe(true);
    expect(looksInterrogative('my tablets')).toBe(false);
  });

  it('lets an unpunctuated third-person question through as an answer', () => {
    // The honest limit of this stage, pinned rather than papered over. "Could
    // he have been out" says nothing about the interview and nothing about the
    // speaker, so with no question mark there is nothing left to read it by —
    // and the alternative, trusting the opener alone, is what would re-ask
    // the question every time a patient answered "when I walk".
    //
    // The recogniser does punctuate most questions, which is why the observed
    // case arrived as "Could he have been out?" and is caught above. When it
    // does not, the turn costs an acknowledgement, not a fact: the field
    // derives `not_assessed`, no row is written, and it stays askable.
    expect(looksInterrogative('could he have been out')).toBe(false);
  });
});

describe('what the interview says back', () => {
  it.each(ASIDE_INTENTS)('has a reply for %s', (intent) => {
    expect(ENGLISH_ASIDE_REPLIES[intent].trim().length).toBeGreaterThan(0);
  });

  it.each(ASIDE_INTENTS)(
    'never tells the patient what is wrong (%s)',
    (intent) => {
      // The same check §29 puts on every red-flag message. An aside reply is
      // read out to a patient by a machine with nobody in the room, so it is
      // held to the rule the rest of this surface is held to.
      expect(findDiagnosticLanguage(ENGLISH_ASIDE_REPLIES[intent])).toBeNull();
    },
  );

  it('declines the one question it must never answer, and says who can', () => {
    const reply = ENGLISH_ASIDE_REPLIES.is_it_serious;
    expect(reply).toMatch(/cannot tell you/i);
    expect(reply).toMatch(/doctor/i);
    // And it does not leave a frightened patient with only a refusal.
    expect(reply).toMatch(/front desk/i);
  });

  it('falls back to English for a language with no aside drafted', () => {
    // `hi` ships translated questions and an empty aside table, which is a
    // legitimate intermediate state — see the note on `QuestionPhrasebook`.
    expect(asideReplyFor('greeting', 'hi')).toBe(
      ENGLISH_ASIDE_REPLIES.greeting,
    );
    expect(asideReplyFor('greeting', undefined)).toBe(
      ENGLISH_ASIDE_REPLIES.greeting,
    );
    expect(asideReplyFor('greeting', 'klingon')).toBe(
      ENGLISH_ASIDE_REPLIES.greeting,
    );
  });
});
