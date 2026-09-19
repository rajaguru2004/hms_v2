import { derivePresence, durationInDays } from './tri-state';
import { ANSWER_LANGUAGES, phrasesFor } from './answer-phrases';

const BOOLEAN = { kind: 'boolean' as const };
const DURATION = { kind: 'duration' as const };
const SCALE = { kind: 'scale' as const };
const ONSET = {
  kind: 'choice' as const,
  choices: ['sudden', 'gradual', 'woke_up_with_it'],
};

function read(text: string, field: object, language: string) {
  return derivePresence({
    modality: 'voice',
    field: field as never,
    language,
    utterance: text,
    evidenceSpan: text,
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the language model was actually doing, and what replaced it
 *
 * Until these lists existed, `PHRASE_MATCHED_LANGUAGES` was `['en']`. A Tamil
 * "இல்லை" matched no negation, the field stayed `not_assessed`, and the gap was
 * covered by sending the utterance to gemma3:4b to be translated and extracted
 * — eight to twenty seconds of a 4 GB card, in the background, landing minutes
 * after the patient had moved on.
 *
 * Every case below is a dictionary lookup. That is all it ever was.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('reading an answer in the language it was given in', () => {
  describe.each([
    ['ta', 'இல்லை', 'ஆமா', 'தெரியல'],
    ['hi', 'नहीं', 'हाँ', 'पता नहीं'],
    ['en', 'no', 'yes', "I don't know"],
  ])('%s', (language, no, yes, dunno) => {
    it(`reads "${no}" as an asserted no`, () => {
      expect(read(no, BOOLEAN, language).presence).toBe('none');
    });

    it(`reads "${yes}" as an asserted yes`, () => {
      const derived = read(yes, BOOLEAN, language);
      expect(derived.presence).toBe('recorded');
      expect(derived.value).toBe(true);
    });

    /**
     * The tri-state collapse this whole module exists to prevent, in three
     * languages. Every way of saying "I don't know" here contains the word for
     * "no" — Hindi "पता नहीं", Tamil "ஞாபகம் இல்ல", English "don't know" — so
     * a negation-first rule order turns all of them into a fact the patient
     * never asserted.
     */
    it(`reads "${dunno}" as not knowing, not as no`, () => {
      expect(read(dunno, BOOLEAN, language).presence).toBe('unknown');
    });
  });

  it('reads a Tamil duration, and counts its days', () => {
    expect(read('மூணு நாளா', DURATION, 'ta').presence).toBe('recorded');
    expect(durationInDays('மூணு நாளா', 'ta')).toBe(3);
    expect(durationInDays('ரெண்டு வாரம்', 'ta')).toBe(14);
    // A digit is as common as a counting word in real speech.
    expect(durationInDays('3 நாள்', 'ta')).toBe(3);
  });

  it('reads a Hindi duration, and counts its days', () => {
    expect(read('तीन दिन से', DURATION, 'hi').presence).toBe('recorded');
    expect(durationInDays('तीन दिन से', 'hi')).toBe(3);
    expect(durationInDays('दो हफ़्ते', 'hi')).toBe(14);
  });

  it("stores the patient's own words as the duration, not a number", () => {
    // A clinician reading the chart should see what was said. `durationInDays`
    // is what anything needing a number asks, separately.
    expect(read('மூணு நாளா', DURATION, 'ta').value).toBe('மூணு நாளா');
  });

  it('reads a severity given in words as the canonical band', () => {
    // The band is the stored value in every language — "severe" goes on the
    // chart whether the patient said "ரொம்ப" or "बहुत तेज़".
    expect(read('ரொம்ப வலிக்குது', SCALE, 'ta').value).toBe('severe');
    expect(read('கொஞ்சம்', SCALE, 'ta').value).toBe('mild');
    expect(read('बहुत तेज़ दर्द', SCALE, 'hi').value).toBe('severe');
    expect(read('हल्का', SCALE, 'hi').value).toBe('mild');
  });

  it('reads a severity given as a number word', () => {
    expect(read('எட்டு', SCALE, 'ta').value).toBe(8);
    expect(read('आठ', SCALE, 'hi').value).toBe(8);
  });

  it('reads a choice token out of the words for it', () => {
    expect(read('திடீர்ன்னு ஆரம்பிச்சது', ONSET, 'ta').value).toBe('sudden');
    expect(read('अचानक शुरू हुआ', ONSET, 'hi').value).toBe('sudden');
    expect(read('धीरे धीरे बढ़ा', ONSET, 'hi').value).toBe('gradual');
  });

  /**
   * Code-switching is the normal register in this product, not an edge case:
   * "chest pain மூணு நாளா" is what a Tamil patient in a city hospital says.
   * `phrasesFor` returns the patient's lists AND English for exactly this.
   */
  it('reads a sentence that switches language halfway through', () => {
    expect(read('chest pain மூணு நாளா', DURATION, 'ta').presence).toBe(
      'recorded',
    );
    expect(read('no', BOOLEAN, 'ta').presence).toBe('none');
    expect(read('इल्लै नहीं', BOOLEAN, 'hi').presence).toBe('none');
  });

  it('marks every one of these as a language it can read', () => {
    for (const language of ANSWER_LANGUAGES) {
      expect(read('no', BOOLEAN, language).languageCovered).toBe(true);
    }
    // And is honest about one it cannot.
    expect(read('na', BOOLEAN, 'bn').languageCovered).toBe(false);
  });

  it('gives an unknown language English alone, rather than nothing', () => {
    const lists = phrasesFor('bn');
    expect(lists).toHaveLength(1);
    expect(lists[0].language).toBe('en');
  });

  it("puts the patient's own language first, English second", () => {
    expect(phrasesFor('ta').map((p) => p.language)).toEqual(['ta', 'en']);
    expect(phrasesFor('hi-IN').map((p) => p.language)).toEqual(['hi', 'en']);
  });
});

/**
 * `\b` is defined against `[A-Za-z0-9_]`, so `/\bनहीं\b/` never matches: both
 * boundaries sit between two non-word characters. The bug is silent — the
 * pattern compiles and a test written with a bare string passes — which is why
 * it is pinned here rather than trusted to a comment.
 */
describe('word boundaries that work on a non-Latin script', () => {
  it('matches a word with spaces around it', () => {
    expect(read('मुझे नहीं है', BOOLEAN, 'hi').presence).toBe('none');
    expect(read('எனக்கு இல்லை', BOOLEAN, 'ta').presence).toBe('none');
  });

  it('matches a word followed by punctuation', () => {
    expect(read('इल्लै, नहीं।', BOOLEAN, 'hi').presence).toBe('none');
    expect(read('இல்லை.', BOOLEAN, 'ta').presence).toBe('none');
  });

  it('would fail with a plain \\b, which is the point', () => {
    expect(/\bनहीं\b/.test('मुझे नहीं है')).toBe(false);
    expect(/(?<!\p{L})नहीं(?!\p{L})/u.test('मुझे नहीं है')).toBe(true);
  });
});
