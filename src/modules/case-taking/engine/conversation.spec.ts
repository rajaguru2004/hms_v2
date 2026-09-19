import { leadFor } from './conversation';
import { conversationFor } from './phrasebook';
import { ALLOW_UNREVIEWED_PHRASEBOOKS_ENV } from './phrasebook';

const TAMIL_SCRIPT = /[஀-௿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

function withGateOpen<T>(body: () => T): T {
  const before = process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
  process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = 'true';
  try {
    return body();
  } finally {
    if (before === undefined)
      delete process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
    else process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = before;
  }
}

const base = {
  previousSection: 'hpi' as const,
  nextSection: 'hpi' as const,
  language: 'en',
  turnIndex: 0,
  safetyFired: false,
};

describe('the words between the questions', () => {
  it('acknowledges an answer it understood', () => {
    expect(leadFor({ ...base, presence: 'recorded' })).toBe('Alright.');
  });

  it('never congratulates a denial', () => {
    // "Good." after "no, I am not taking any medicines" grades an answer the
    // interview has no business grading.
    for (let turn = 0; turn < 6; turn++) {
      const said = leadFor({ ...base, presence: 'none', turnIndex: turn });
      expect(said).not.toMatch(/good|great|excellent/i);
      expect(said.length).toBeGreaterThan(0);
    }
  });

  it('does not correct a patient who does not know', () => {
    const said = leadFor({ ...base, presence: 'unknown' });
    expect(said).toMatch(/alright|no problem|fine/i);
  });

  it('says nothing about an answer it could not read', () => {
    // `not_assessed` means the question is about to be asked again. "Alright."
    // in front of a repeat is the interview claiming to have understood
    // something it did not.
    expect(leadFor({ ...base, presence: 'not_assessed' })).toBe('');
  });

  it('says nothing at all on the first question', () => {
    expect(
      leadFor({
        ...base,
        presence: null,
        previousSection: null,
        nextSection: 'chief_complaint',
      }),
    ).toBe('');
  });

  /**
   * The rule with a clinical reason behind it. `patientMessage` from the most
   * severe triggered rule is spoken before the next question — "tell the front
   * desk now, do not wait in the queue" — and an acknowledgement in front of
   * that is the interview sounding pleased about the answer that fired it.
   */
  it('goes quiet when a red flag has just fired', () => {
    expect(leadFor({ ...base, presence: 'recorded', safetyFired: true })).toBe(
      '',
    );
  });

  it('introduces a new section, and only when it changes', () => {
    const moved = leadFor({
      ...base,
      presence: 'recorded',
      previousSection: 'hpi',
      nextSection: 'past_medical',
    });
    expect(moved).toContain('Alright.');
    expect(moved).toContain('past');

    const stayed = leadFor({ ...base, presence: 'recorded' });
    expect(stayed).toBe('Alright.');
  });

  it('never leads into the section the interview opens with', () => {
    // There is no conversation yet to change the subject of.
    expect(
      leadFor({
        ...base,
        presence: null,
        previousSection: null,
        nextSection: 'chief_complaint',
      }),
    ).toBe('');
  });

  it('varies the wording without becoming unrepeatable', () => {
    const said = [0, 1, 2].map((turnIndex) =>
      leadFor({ ...base, presence: 'recorded', turnIndex }),
    );
    expect(new Set(said).size).toBeGreaterThan(1);
    // The same interview replays identically — every other output of this
    // engine is a pure function of the state and this one is no exception.
    expect(leadFor({ ...base, presence: 'recorded', turnIndex: 1 })).toBe(
      said[1],
    );
  });

  it("speaks the patient's language, or stays quiet", () => {
    withGateOpen(() => {
      expect(
        leadFor({ ...base, presence: 'recorded', language: 'ta' }),
      ).toMatch(TAMIL_SCRIPT);
      expect(
        leadFor({ ...base, presence: 'recorded', language: 'hi' }),
      ).toMatch(DEVANAGARI);
    });

    // A language with no conversational wording asks its questions bare, which
    // is what every language did before this existed.
    expect(leadFor({ ...base, presence: 'recorded', language: 'bn' })).toBe('');
  });

  it('is behind the review gate, like every other translated line', () => {
    // Shut, Tamil has nothing to say — the same gate that keeps an unreviewed
    // clinical question out of a patient's ear.
    expect(conversationFor('ta')).toBeUndefined();
    withGateOpen(() => expect(conversationFor('ta')).toBeDefined());
    // English is the source rather than a translation, so it is never gated.
    expect(conversationFor('en')).toBeDefined();
  });
});
