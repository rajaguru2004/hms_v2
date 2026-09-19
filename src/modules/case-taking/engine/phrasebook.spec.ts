import {
  ALLOW_UNREVIEWED_PHRASEBOOKS_ENV,
  ENGLISH_ANSWER_HINTS,
  PHRASEBOOKS,
  QuestionPhrasebook,
  allowingUnreviewedPhrasebooks,
  composePhrasing,
  phrasebookCoverage,
  phrasebookFor,
  phrasingFor,
  unreviewedLanguagesInUse,
} from './phrasebook';
import {
  STATIC_FIELDS,
  FieldDefinition,
  GROUP_TEMPLATE_FIELD_KEYS,
  fieldsFor,
  groupTemplateKey,
} from './field-registry';
import {
  ClinicalState,
  applyFact,
  createClinicalState,
} from './clinical-state';
import {
  fallbackPhrasing,
  selectNext,
  spokenPhrasingFor,
} from './question-selector';
import { recorded } from './tri-state';

/**
 * The translation mechanism, and the two properties it exists to guarantee.
 *
 * First: a missing translation produces the ENGLISH question. Not an empty
 * string, not the field path, not a sentence with a hole in it. An interview
 * whose next question is blank has stopped; an interview asking in English is
 * merely inconvenient, and the patient can still answer it.
 *
 * Second: an UNREVIEWED translation is not used at all. A clinical question
 * that has quietly become a different question is the same failure whether a
 * 4B model wrote it or a well-meaning engineer did, and `reviewedAt` is where
 * a human says it is not that.
 *
 * The fallbacks are driven through `composePhrasing`, which takes a book
 * directly. `PHRASEBOOKS` is frozen and stays frozen: a test that unfroze the
 * shipped registry to reach these paths would be testing a codebase nobody
 * runs.
 */

function byKey(key: string): FieldDefinition {
  const field = STATIC_FIELDS.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`no such field: ${key}`);
  return field;
}

/** A reviewed book, built here rather than shipped, because none is shipped. */
function reviewedTamil(
  overrides: Partial<QuestionPhrasebook> = {},
): QuestionPhrasebook {
  return { ...PHRASEBOOKS.ta, reviewedAt: '2026-09-15', ...overrides };
}

describe('the spoken question drops the answer hint', () => {
  /**
   * The clause that made the voice interview sound like a form. It belongs over
   * a row of tiles and nowhere near a conversation — and the agent's Whisper
   * plus `derivePresence` read "not really, only on stairs" without anybody
   * being coached into saying "no".
   */
  it('leaves off "You can answer yes or no."', () => {
    const field = byKey('past_medical.diabetes');
    expect(fallbackPhrasing(field)).toContain('You can answer yes or no.');
    expect(spokenPhrasingFor(field)).not.toContain('You can answer');
  });

  it('leaves off the spoken choice list', () => {
    const field = STATIC_FIELDS.find((f) => f.kind === 'choice');
    if (!field) throw new Error('the registry has no choice field');
    expect(fallbackPhrasing(field)).toContain('You can say');
    expect(spokenPhrasingFor(field)).not.toContain('You can say');
  });

  it('is still the whole question, never a fragment', () => {
    // The failure worth guarding: a "spoken" variant that stripped too much and
    // left the patient with half a sentence would be worse than the hint.
    for (const field of STATIC_FIELDS) {
      const spoken = spokenPhrasingFor(field);
      expect(spoken.length).toBeGreaterThan(0);
      expect(fallbackPhrasing(field).startsWith(spoken)).toBe(true);
    }
  });

  it('follows the same phrasebook as the written question', () => {
    // It must not quietly fall back to English while `fallbackPhrasing`
    // translates — one question, two renderings, never two languages.
    //
    // The gate is opened for the comparison because `composePhrasing` is handed
    // the book directly while `spokenPhrasingFor` resolves it through
    // `phrasebookFor`. Without it the two disagree for a reason that is not the
    // one under test: one read Tamil, the other read the review gate.
    withOverride(true, () => {
      const field = byKey('past_medical.diabetes');
      const written = composePhrasing(field, reviewedTamil());
      const spoken = spokenPhrasingFor(field, 'ta');
      expect(written.startsWith(spoken)).toBe(true);
    });
  });
});

describe('English is the source, not a translation of it', () => {
  it('asks in English when no language is given', () => {
    expect(phrasingFor(byKey('hpi.previous_episodes'))).toBe(
      fallbackPhrasing(byKey('hpi.previous_episodes')),
    );
  });

  it('has no `en` phrasebook, because that would be a second copy to drift', () => {
    expect(PHRASEBOOKS.en).toBeUndefined();
    expect(phrasebookFor('en')).toBeUndefined();
    expect(phrasebookFor('en-GB')).toBeUndefined();
  });

  it('keeps the exact English wording the interview shipped with', () => {
    expect(phrasingFor(byKey('hpi.severity'))).toContain(
      ENGLISH_ANSWER_HINTS.scale,
    );
    expect(phrasingFor(byKey('hpi.duration'))).toContain(
      ENGLISH_ANSWER_HINTS.duration,
    );
  });
});

describe('an unreviewed translation', () => {
  /**
   * The shipped Tamil book is a worked example. It proves the shape and it is
   * not a translation anybody may put in front of a patient.
   */
  it('exists in the registry but is never spoken', () => {
    expect(PHRASEBOOKS.ta).toBeDefined();
    expect(PHRASEBOOKS.ta.reviewedAt).toBeNull();
    expect(phrasebookFor('ta')).toBeUndefined();
  });

  it('leaves a Tamil session asking its questions in English', () => {
    const english = phrasingFor(byKey('hpi.duration'));
    expect(phrasingFor(byKey('hpi.duration'), 'ta')).toBe(english);
    expect(phrasingFor(byKey('hpi.duration'), 'ta-IN')).toBe(english);
  });

  it('is skipped for a language with no book at all', () => {
    expect(phrasebookFor('bn')).toBeUndefined();
    expect(phrasebookFor('klingon')).toBeUndefined();
    expect(phrasingFor(byKey('hpi.duration'), 'bn')).toBe(
      phrasingFor(byKey('hpi.duration')),
    );
  });
});

describe('a reviewed translation', () => {
  it('asks the translated question with its translated hint', () => {
    const asked = composePhrasing(byKey('hpi.duration'), reviewedTamil());
    expect(asked).toContain('எவ்வளவு காலமாக');
    expect(asked).toContain('மூன்று நாட்கள்');
    expect(asked).not.toContain('For example');
  });

  /**
   * The load-bearing fallback. The worked example translates four questions out
   * of many, so most of the registry takes this path.
   *
   * Note what comes back: the English question with the TRANSLATED hint,
   * because the two fall back independently. That mixed sentence is the
   * deliberate choice — each half is in the best language available for it, and
   * neither half can be empty or in a language nobody asked for.
   */
  it('falls back to the English question where it has none, never to nothing', () => {
    // Tamil is complete now, so the fallback needs a book with a hole in it
    // rather than a field nobody translated — and a hole is the ordinary state
    // of a translation in progress, which is what makes this worth pinning.
    const field = byKey('past_medical.diabetes');
    const holed = reviewedTamil({
      questions: Object.fromEntries(
        Object.entries(PHRASEBOOKS.ta.questions).filter(
          ([key]) => key !== 'past_medical.diabetes',
        ),
      ),
    });

    const asked = composePhrasing(field, holed);

    expect(asked.startsWith(field.prompt.trim())).toBe(true);
    expect(asked.trim().length).toBeGreaterThan(0);
    // The hint is still Tamil: the two halves fall back apart, on purpose.
    expect(asked).toContain('ஆம் அல்லது இல்லை');
  });

  it('is entirely English when the book has nothing for the field at all', () => {
    const untranslated = byKey('hpi.previous_episodes');
    const bare = reviewedTamil({ questions: {}, answerHints: {} });
    expect(composePhrasing(untranslated, bare)).toBe(phrasingFor(untranslated));
  });

  it('falls back to the English hint where it has none', () => {
    // `duration` has no translated hint in this book, so the English one is
    // appended to whichever question came out — a mixed sentence, and a better
    // one than an English question.
    const book = reviewedTamil({
      answerHints: { boolean: 'ஆம் அல்லது இல்லை.' },
    });
    expect(composePhrasing(byKey('hpi.duration'), book)).toContain(
      ENGLISH_ANSWER_HINTS.duration,
    );
  });

  it('never produces an empty prompt, whatever is missing', () => {
    const empty = reviewedTamil({
      questions: {},
      answerHints: {},
      choiceLabels: {},
    });
    const blank = STATIC_FIELDS.filter(
      (field) => composePhrasing(field, empty).trim().length === 0,
    ).map((field) => field.key);
    expect(blank).toEqual([]);
  });

  it('is reached through a region tag, because that is what a phone sends', () => {
    // The lookup, not the composition: `ta-IN` and `TA` must find the same row.
    expect(phrasingFor(byKey('hpi.duration'), 'ta-IN')).toBe(
      phrasingFor(byKey('hpi.duration'), 'ta'),
    );
    expect(phrasingFor(byKey('hpi.duration'), 'TA')).toBe(
      phrasingFor(byKey('hpi.duration'), 'ta'),
    );
  });
});

describe('spoken choices', () => {
  const choiceField = STATIC_FIELDS.find(
    (field) => field.kind === 'choice' && (field.choices?.length ?? 0) > 1,
  );

  it('speaks the snake_case token as words when untranslated', () => {
    if (!choiceField) throw new Error('the registry has no choice field');
    const asked = composePhrasing(choiceField, undefined);
    expect(asked).not.toContain('_');
    expect(asked).toContain(' or ');
  });

  it('uses the translated word and the translated conjunction when it has them', () => {
    if (!choiceField) throw new Error('the registry has no choice field');
    const tokens = choiceField.choices ?? [];
    const last = tokens[tokens.length - 1].replace(/_/g, ' ');

    const asked = composePhrasing(
      choiceField,
      reviewedTamil({
        answerHints: { choice: 'நீங்கள் சொல்லலாம்: {choices}.' },
        choiceLabels: { [tokens[0]]: 'முதல்' },
        listConjunction: 'அல்லது',
      }),
    );

    // The translated word for the token it has one for, the bare token spoken
    // as words for the ones it does not, and the translated conjunction joining
    // the last two. (The English question itself contains " or ", which is why
    // the conjunction is asserted against what it joins rather than on its own.)
    expect(asked).toContain('முதல்');
    expect(asked).toContain(`அல்லது ${last}`);
  });

  /**
   * The spoken label is never the stored value. The state holds the token, the
   * safety rules key on the token, and the client must send the token back —
   * translating a question must not translate what a red flag reads.
   */
  it('does not change the tokens the registry stores', () => {
    if (!choiceField) throw new Error('the registry has no choice field');
    const before = [...(choiceField.choices ?? [])];
    composePhrasing(
      choiceField,
      reviewedTamil({ choiceLabels: { [before[0]]: 'முதல்' } }),
    );
    expect(byKey(choiceField.key).choices).toEqual(before);
  });
});

describe('coverage, so a hole is an operational fact and not a surprise', () => {
  it('reports the worked example as partial and unreviewed', () => {
    const coverage = phrasebookCoverage('ta');
    expect(coverage).not.toBeNull();
    expect(coverage?.reviewedAt).toBeNull();
    expect(coverage?.translatedQuestions).toBeGreaterThan(0);
    expect(coverage?.missingQuestions.length).toBeGreaterThan(0);
    expect(coverage?.translatedQuestions).toBeLessThan(
      coverage?.totalQuestions ?? 0,
    );
  });

  it('reports nothing for a language with no phrasebook at all', () => {
    expect(phrasebookCoverage('bn')).toBeNull();
    expect(phrasebookCoverage('en')).toBeNull();
  });
});

describe('the selector carries the session language through', () => {
  it('resolves the prompt for the session language, not for the caller', () => {
    const tamil = createClinicalState({ sessionId: 's1', language: 'ta-IN' });
    const selected = selectNext(tamil);
    expect(selected).not.toBeNull();
    expect(selected?.fallbackPrompt).toBe(
      phrasingFor(selected!.field, 'ta-IN'),
    );
  });

  it('asks in English when the session has no language', () => {
    const none = createClinicalState({ sessionId: 's1' });
    const selected = selectNext(none);
    expect(selected?.fallbackPrompt).toBe(phrasingFor(selected!.field));
  });

  /**
   * Today every language resolves to English, because none is reviewed and the
   * demonstration override is off — which is the state a deployment is in
   * unless somebody set `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS` on purpose.
   */
  it('is English everywhere until somebody signs a translation off', () => {
    for (const code of ['ta', 'hi', 'bn', 'or']) {
      const state = createClinicalState({ sessionId: 's1', language: code });
      expect(selectNext(state)?.fallbackPrompt).toBe(
        selectNext(createClinicalState({ sessionId: 's1' }))?.fallbackPrompt,
      );
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  The review gate, and the one deliberate way round it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Run a block with the override in a known state, and put the environment back
 * however the block ends.
 *
 * The flag is read on every lookup rather than captured at import precisely so
 * that this is possible: a test that had to re-require the module to change it
 * would be testing a second copy of `PHRASEBOOKS`, and the load-time invariant
 * would run twice.
 */
function withOverride<T>(on: boolean, body: () => T): T {
  const before = process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
  if (on) {
    process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = 'true';
  } else {
    delete process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
  }
  try {
    return body();
  } finally {
    if (before === undefined) {
      delete process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
    } else {
      process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = before;
    }
  }
}

const DEVANAGARI = /[ऀ-ॿ]/;
const TAMIL_SCRIPT = /[஀-௿]/;

describe('the review gate', () => {
  /**
   * This is the assertion that stops somebody "fixing" a Tamil session that
   * asks in English by deleting the `reviewedAt` check. The English is not the
   * bug — it is the gate working. Deleting it would put a clinical question
   * nobody has read in front of a patient, which is the failure this whole
   * module is built around.
   */
  it('is shut by default, for every language and every question', () => {
    withOverride(false, () => {
      expect(allowingUnreviewedPhrasebooks()).toBe(false);
      expect(unreviewedLanguagesInUse()).toEqual([]);
      for (const code of Object.keys(PHRASEBOOKS)) {
        expect(PHRASEBOOKS[code].reviewedAt).toBeNull();
        expect(phrasebookFor(code)).toBeUndefined();
      }
      for (const field of STATIC_FIELDS) {
        expect(phrasingFor(field, 'hi')).toBe(phrasingFor(field));
        expect(phrasingFor(field, 'ta')).toBe(phrasingFor(field));
      }
    });
  });

  it('opens only for the exact string "true", not for anything truthy', () => {
    const before = process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
    try {
      for (const value of ['1', 'yes', 'TRUE', 'true ', '']) {
        process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = value;
        expect(allowingUnreviewedPhrasebooks()).toBe(false);
        expect(phrasebookFor('hi')).toBeUndefined();
      }
    } finally {
      if (before === undefined) {
        delete process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
      } else {
        process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = before;
      }
    }
  });

  it('opens the books when it is on, and names them for the startup warning', () => {
    withOverride(true, () => {
      expect(phrasebookFor('hi')).toBeDefined();
      expect(phrasebookFor('ta')).toBeDefined();
      expect([...unreviewedLanguagesInUse()].sort()).toEqual(['hi', 'ta']);
    });
  });

  /**
   * The override is not a review and must never be mistakable for one. Nothing
   * it touches writes a date, changes a provenance, or makes coverage look
   * better than it is — the only field that moves is `spoken`.
   */
  it('never writes a review, whichever way it is set', () => {
    const shut = withOverride(false, () => phrasebookCoverage('hi'));
    const open = withOverride(true, () => phrasebookCoverage('hi'));

    expect(shut?.reviewedAt).toBeNull();
    expect(open?.reviewedAt).toBeNull();
    expect(shut?.source).toBe('machine_draft');
    expect(open?.source).toBe('machine_draft');
    expect(shut?.translatedQuestions).toBe(open?.translatedQuestions);
    expect(shut?.spoken).toBe(false);
    expect(open?.spoken).toBe(true);
  });

  it('does not reach English, which has no book to gate', () => {
    withOverride(true, () => {
      expect(phrasebookFor('en')).toBeUndefined();
      expect(phrasebookFor('en-GB')).toBeUndefined();
      expect(phrasebookFor('bn')).toBeUndefined();
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Hindi — the first phrasebook that covers a language
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Hindi', () => {
  it('is registered, machine-drafted, and unreviewed', () => {
    expect(PHRASEBOOKS.hi).toBeDefined();
    expect(PHRASEBOOKS.hi.language).toBe('hi');
    expect(PHRASEBOOKS.hi.source).toBe('machine_draft');
    // If this ever becomes a date, a clinician put it there, and they should
    // have changed this line in the same commit.
    expect(PHRASEBOOKS.hi.reviewedAt).toBeNull();
  });

  /**
   * The gap check: a phrasebook with holes in it fails here rather than being
   * discovered by a patient reading an English question in the middle of a
   * Hindi interview.
   *
   * `social.age_band` is the single permitted exception and it is barely an
   * exception: its English prompt is the empty string because the field is
   * never asked — the age band is read off the patient record — so there is
   * nothing to translate. The assertion is written as "every field that has a
   * prompt", so giving that field a prompt one day makes this fail, which is
   * the correct outcome.
   */
  it('translates every static question the interview can actually ask', () => {
    const coverage = phrasebookCoverage('hi');
    expect(coverage).not.toBeNull();

    const missingWithAPrompt = (coverage?.missingQuestions ?? []).filter(
      (key) =>
        (STATIC_FIELDS.find((field) => field.key === key)?.prompt ?? '').trim()
          .length > 0,
    );
    expect(missingWithAPrompt).toEqual([]);
    expect(coverage?.missingQuestions).toEqual(['social.age_band']);
    expect(coverage?.translatedQuestions).toBe(STATIC_FIELDS.length - 1);
  });

  it('translates every answer hint, so no Hindi question ends in English', () => {
    expect(phrasebookCoverage('hi')?.missingAnswerHints).toEqual([]);
  });

  /**
   * The repeated groups. Before these were keyed on their template, a Hindi
   * interview switched to English the moment the patient said they take a
   * medicine — and `phrasebookCoverage`, which walks the static registry,
   * reported full coverage while it happened.
   */
  it('translates the repeated-group questions too, keyed on the template', () => {
    for (const key of GROUP_TEMPLATE_FIELD_KEYS) {
      expect(typeof PHRASEBOOKS.hi.questions[key]).toBe('string');
    }

    const patient = ['medications.any_current', 'allergies.reported'].reduce(
      (state: ClinicalState, path) =>
        applyFact(
          state,
          path,
          recorded(true, {
            source: 'patient_text',
            verification: 'unverified',
            recordedAt: '2026-09-15T00:00:00.000Z',
          }),
        ),
      createClinicalState({ sessionId: 's1', language: 'hi' }),
    );

    const items = fieldsFor(patient).filter((field) => field.key.includes('['));
    expect(items.length).toBeGreaterThan(0);

    withOverride(true, () => {
      for (const field of items) {
        expect(phrasingFor(field, 'hi')).toMatch(DEVANAGARI);
      }
    });
  });

  it('answers an indexed path from the template key', () => {
    expect(groupTemplateKey('medications[3].name')).toBe('medications[].name');
    expect(groupTemplateKey('hpi.duration')).toBe('hpi.duration');
  });

  it('asks in Devanagari, hint and choices included, when the gate is open', () => {
    withOverride(true, () => {
      const sleep = STATIC_FIELDS.find((field) => field.key === 'social.sleep');
      if (!sleep) throw new Error('social.sleep left the registry');

      const asked = phrasingFor(sleep, 'hi');
      expect(asked).toMatch(DEVANAGARI);
      // Every part: the question, the hint, a spoken choice, the conjunction.
      expect(asked).toContain('आपकी नींद कैसी चल रही है?');
      expect(asked).toContain('आप कह सकते हैं');
      expect(asked).toContain('अच्छी');
      expect(asked).toContain(' या ');
      // And nothing left in English or in raw tokens.
      expect(asked).not.toContain('You can say');
      expect(asked).not.toContain('disturbed');
      expect(asked).not.toContain('_');
    });
  });

  it('reaches Hindi through the region tag a phone actually sends', () => {
    withOverride(true, () => {
      const field = STATIC_FIELDS[0];
      expect(phrasingFor(field, 'hi-IN')).toBe(phrasingFor(field, 'hi'));
      expect(phrasingFor(field, 'HI')).toBe(phrasingFor(field, 'hi'));
      expect(phrasingFor(field, 'hi_IN')).toBe(phrasingFor(field, 'hi'));
    });
  });

  it('never produces an empty prompt for any field, gate open or shut', () => {
    for (const on of [false, true]) {
      withOverride(on, () => {
        for (const field of STATIC_FIELDS) {
          expect(phrasingFor(field, 'hi').trim().length).toBeGreaterThan(0);
        }
      });
    }
  });

  /**
   * The choice tokens are the stored value and the thing the safety rules read.
   * A translated label must never become one.
   */
  it('speaks the choices without changing what the state stores', () => {
    const before = STATIC_FIELDS.filter((field) => field.kind === 'choice').map(
      (field) => [field.key, [...(field.choices ?? [])]] as const,
    );

    withOverride(true, () => {
      for (const field of STATIC_FIELDS) phrasingFor(field, 'hi');
    });

    for (const [key, choices] of before) {
      expect(STATIC_FIELDS.find((field) => field.key === key)?.choices).toEqual(
        choices,
      );
    }
  });

  it('carries the session language through the selector', () => {
    withOverride(true, () => {
      const hindi = createClinicalState({ sessionId: 's1', language: 'hi-IN' });
      const selected = selectNext(hindi);
      expect(selected).not.toBeNull();
      expect(selected?.fallbackPrompt).toMatch(DEVANAGARI);
      expect(selected?.fallbackPrompt).toBe(
        phrasingFor(selected!.field, 'hi-IN'),
      );
    });
  });
});

describe('Tamil, with the gate open', () => {
  /**
   * This test used to be called "asks its four translated questions in Tamil
   * and the rest in English", and it described a real problem: a Tamil demo
   * looked complete for one question and reverted to English a few in. The book
   * is complete now — every field the interview can ask, and every repeated-group
   * template — so the property worth pinning is the opposite one.
   */
  it('asks the whole interview in Tamil, not the first question of it', () => {
    withOverride(true, () => {
      const tamil = createClinicalState({ sessionId: 's1', language: 'ta' });
      expect(selectNext(tamil)?.fallbackPrompt).toMatch(TAMIL_SCRIPT);

      for (const field of STATIC_FIELDS) {
        // `social.age_band` carries no prompt in any language: it is read off
        // the patient record and never asked. See `phrasebookCoverage`.
        if (field.key === 'social.age_band') continue;
        expect(phrasingFor(field, 'ta')).toMatch(TAMIL_SCRIPT);
        expect(phrasingFor(field, 'ta')).not.toContain(field.prompt);
      }
    });
  });
});
