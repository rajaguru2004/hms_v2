import { RED_FLAG_RULES } from './safety-rules';
import {
  HELPLINE_DIGITS,
  SAFETY_PHRASEBOOKS,
  assertSafetyPhrasebooks,
  safetyMessageFor,
  safetyPhrasebookFor,
  safetyPhrasebookGaps,
} from './safety-phrasebook';

/**
 * The sentence that tells a patient to stop queueing and find a member of staff.
 *
 * Everything here is about one property: a patient must never be sent to the
 * front desk in a language they cannot read, and must never be *not* sent
 * because a translation was missing. The first is what the books are for; the
 * second is what the English fallback is for.
 */

const FLAG = 'MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS';

describe('safety phrasebooks', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[FLAG];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  describe('the review gate', () => {
    /**
     * The shipped default. Both books are `reviewedAt: null`, so with the gate
     * shut a Hindi session still gets the English instruction — which somebody
     * at the desk can act on — rather than wording nobody has checked.
     */
    it('hides an unreviewed book', () => {
      delete process.env[FLAG];
      expect(safetyPhrasebookFor('hi')).toBeUndefined();
      expect(safetyPhrasebookFor('ta')).toBeUndefined();
    });

    it('shows it when a deployment has opted in', () => {
      process.env[FLAG] = 'true';
      expect(safetyPhrasebookFor('hi')?.language).toBe('hi');
      expect(safetyPhrasebookFor('ta')?.language).toBe('ta');
    });

    /** English is the source, not a translation of itself. */
    it('has no book for English', () => {
      process.env[FLAG] = 'true';
      expect(safetyPhrasebookFor('en')).toBeUndefined();
    });

    it('has no book for a language nobody has translated', () => {
      process.env[FLAG] = 'true';
      expect(safetyPhrasebookFor('ml')).toBeUndefined();
    });

    /** `ta-IN` off a handset is `ta`. */
    it('normalises a BCP-47 tag', () => {
      process.env[FLAG] = 'true';
      expect(safetyPhrasebookFor('ta-IN')?.language).toBe('ta');
    });
  });

  describe('safetyMessageFor', () => {
    const anaphylaxis = RED_FLAG_RULES.find((r) => r.id === 'ANAPHYLAXIS')!;

    it('answers in the language when the gate is open', () => {
      process.env[FLAG] = 'true';
      const hindi = safetyMessageFor('ANAPHYLAXIS', anaphylaxis.message, 'hi');
      expect(hindi).not.toBe(anaphylaxis.message);
      // At least one character outside ASCII: this came out of the book.
      expect(hindi).not.toMatch(/^[ -~]+$/);
    });

    it('falls back to English with the gate shut', () => {
      delete process.env[FLAG];
      expect(safetyMessageFor('ANAPHYLAXIS', anaphylaxis.message, 'hi')).toBe(
        anaphylaxis.message,
      );
    });

    /**
     * The fallback that matters most. A rule added without a translation must
     * still reach the patient — in English, which somebody at the desk reads —
     * rather than as an empty string, which reaches them as silence.
     */
    it('falls back to English for a rule the book has no instruction for', () => {
      process.env[FLAG] = 'true';
      expect(
        safetyMessageFor('RULE_ADDED_YESTERDAY', 'Go to the desk.', 'hi'),
      ).toBe('Go to the desk.');
    });

    it('is English for an English session', () => {
      process.env[FLAG] = 'true';
      expect(safetyMessageFor('ANAPHYLAXIS', anaphylaxis.message, 'en')).toBe(
        anaphylaxis.message,
      );
    });
  });

  describe('the books themselves', () => {
    it('cover every rule in the set', () => {
      for (const book of Object.values(SAFETY_PHRASEBOOKS)) {
        expect(safetyPhrasebookGaps(book)).toEqual([]);
      }
    });

    /**
     * The one piece of content that is not prose. A patient in crisis who is
     * given a number in Devanagari or Tamil digits cannot dial it, and a
     * translation that drops it entirely leaves them with nothing to call.
     */
    it('keep the helpline number dialable in every language', () => {
      for (const book of Object.values(SAFETY_PHRASEBOOKS)) {
        expect(book.messages.SUICIDAL_IDEATION).toContain(HELPLINE_DIGITS);
      }
    });

    it('translate nothing for a rule that does not exist', () => {
      const known = new Set(RED_FLAG_RULES.map((r) => r.id));
      for (const book of Object.values(SAFETY_PHRASEBOOKS)) {
        for (const id of Object.keys(book.messages)) {
          expect(known.has(id)).toBe(true);
        }
      }
    });

    /**
     * Nobody has signed these off. The day somebody does, they set a date here
     * and this test is the reminder to do it in the same commit as the review
     * rather than quietly ahead of it.
     */
    it('are all still unreviewed', () => {
      for (const book of Object.values(SAFETY_PHRASEBOOKS)) {
        expect(book.reviewedAt).toBeNull();
        expect(book.source).toBe('machine_draft');
      }
    });

    it('pass their own load-time assertions', () => {
      expect(() => assertSafetyPhrasebooks()).not.toThrow();
    });
  });
});
