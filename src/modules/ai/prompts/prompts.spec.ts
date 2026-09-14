import {
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  DOCUMENT_EXTRACTION_SCHEMA,
  DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
  DOCUMENT_VISION_PROMPT_VERSION,
  DOCUMENT_VISION_SCHEMA,
  EVIDENCE_SPAN_INSTRUCTION,
  FACT_EXTRACTION_PROMPT_VERSION,
  FACT_EXTRACTION_SCHEMA,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  QUESTION_PHRASING_PROMPT_VERSION,
  QUESTION_PHRASING_SCHEMA,
  REVIEW_SUMMARY_PROMPT_VERSION,
  REVIEW_SUMMARY_SCHEMA,
  REVIEW_SUMMARY_SYSTEM_PROMPT,
  buildFactExtractionUserPrompt,
  buildReviewSummaryUserPrompt,
  renderFieldMenu,
} from './index';

/**
 * The prompts are pinned here because a prompt is the one kind of code that
 * looks harmless to edit and can change clinical behaviour with no type error
 * and no failing assertion anywhere else.
 *
 * The assertions that matter are not about wording. They are about two fields
 * that must never appear in a schema, and about the one instruction the local
 * model has already been observed to ignore.
 */

const EVERY_SCHEMA: ReadonlyArray<[string, object]> = [
  ['fact extraction', FACT_EXTRACTION_SCHEMA],
  ['document extraction', DOCUMENT_EXTRACTION_SCHEMA],
  ['question phrasing', QUESTION_PHRASING_SCHEMA],
  ['review summary', REVIEW_SUMMARY_SCHEMA],
  ['document vision', DOCUMENT_VISION_SCHEMA],
];

describe('prompt schemas', () => {
  /**
   * The regression this whole module exists to prevent.
   *
   * Given a schema with a `presence` field, gemma3:4b answered "I don't know if
   * I'm allergic to anything" with `presence: recorded, value: "unknown"` — an
   * "I don't know" encoded as something the patient told us, which is the exact
   * path to a fabricated "no known allergies". A schema with nowhere to put
   * that claim cannot make it.
   */
  it.each(EVERY_SCHEMA)(
    '%s has no presence field anywhere',
    (_name, schema) => {
      expect(JSON.stringify(schema)).not.toMatch(/presence/i);
    },
  );

  /**
   * Self-reported confidence was a constant 0.95 across a whole benchmark run,
   * including on the fact the model got flatly wrong. A field that invites a
   * threshold over a constant is worse than no field at all.
   */
  it.each(EVERY_SCHEMA)(
    '%s has no confidence field anywhere',
    (_name, schema) => {
      expect(JSON.stringify(schema)).not.toMatch(/confidence/i);
    },
  );

  it.each(EVERY_SCHEMA)('%s is frozen', (_name, schema) => {
    expect(Object.isFrozen(schema)).toBe(true);
  });

  it('both extraction schemas require a field path, a value and an evidence span', () => {
    for (const schema of [FACT_EXTRACTION_SCHEMA, DOCUMENT_EXTRACTION_SCHEMA]) {
      const item = schema.properties.facts.items;
      expect(item.required).toEqual(['fieldPath', 'value', 'evidenceSpan']);
      expect(Object.keys(item.properties).sort()).toEqual([
        'evidenceSpan',
        'fieldPath',
        'value',
      ]);
    }
  });
});

describe('prompt versions', () => {
  /**
   * Pinned so that editing a prompt without bumping its version fails here.
   * Facts are stored with the version that produced them; a changed prompt
   * under an unchanged version makes that record a lie.
   */
  it('are the versions this build ships', () => {
    expect(FACT_EXTRACTION_PROMPT_VERSION).toBe('2026.09.1');
    expect(QUESTION_PHRASING_PROMPT_VERSION).toBe('2026.09.1');
    expect(REVIEW_SUMMARY_PROMPT_VERSION).toBe('2026.09.1');
    expect(DOCUMENT_EXTRACTION_PROMPT_VERSION).toBe('2026.09.1');
    expect(DOCUMENT_VISION_PROMPT_VERSION).toBe('2026.09.1');
  });
});

describe('the extraction system prompt', () => {
  it('forbids reporting a value for "do not know", "no" and a refusal', () => {
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toMatch(/do not know/i);
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toMatch(/rather not say/i);
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toMatch(/Omit the field entirely/i);
  });

  it('forbids inference', () => {
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toMatch(/Never infer/i);
  });

  /**
   * Asked for an evidence span without this instruction, the local model
   * returned `"[3, 9]"` — character offsets, and wrong ones. The engine reads
   * the span as text.
   */
  it('says the evidence span is copied text and never a position', () => {
    expect(EVIDENCE_SPAN_INSTRUCTION).toMatch(/character for character/i);
    expect(EVIDENCE_SPAN_INSTRUCTION).toMatch(/never character positions/i);
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain(EVIDENCE_SPAN_INSTRUCTION);
  });
});

describe('the document prompts', () => {
  it('forbid turning an unmentioned field into a negative', () => {
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toMatch(
      /not a\s+document saying there is nothing to mention/i,
    );
  });

  /**
   * A normalised medicine name cannot be told from a read one once it is
   * stored, which is the whole argument in `medication-matcher.service.ts`
   * restated for the page instead of the patient.
   */
  it('forbid standardising a medicine name', () => {
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toMatch(
      /Never correct, expand or standardise a medicine name/i,
    );
  });
});

describe('the review summary prompt', () => {
  it('forbids naming a condition and forbids dropping an unknown', () => {
    expect(REVIEW_SUMMARY_SYSTEM_PROMPT).toMatch(/Never name a condition/i);
    expect(REVIEW_SUMMARY_SYSTEM_PROMPT).toMatch(/Never write it as a no/i);
    expect(REVIEW_SUMMARY_SYSTEM_PROMPT).toMatch(
      /never\s+quietly leave it out/i,
    );
  });

  it('renders rendered lines, not values', () => {
    const prompt = buildReviewSummaryUserPrompt({
      sections: [{ title: 'Allergies', lines: ['Allergies: Patient unsure'] }],
    });
    expect(prompt).toContain('Allergies: Patient unsure');
  });
});

describe('the field menu', () => {
  it('lists the choices a choice field will accept', () => {
    const menu = renderFieldMenu([
      {
        key: 'hpi.onset',
        label: 'Onset',
        kind: 'choice',
        choices: ['sudden', 'gradual'],
      },
    ]);
    expect(menu).toContain('hpi.onset');
    expect(menu).toContain('sudden, gradual');
  });

  it('names the field that was asked without excluding the others', () => {
    const prompt = buildFactExtractionUserPrompt({
      utterance: 'three days, and I am short of breath',
      fields: [{ key: 'hpi.duration', label: 'Duration', kind: 'duration' }],
      askedAbout: 'hpi.duration',
    });
    expect(prompt).toContain('hpi.duration');
    expect(prompt).toMatch(/may also have mentioned other things/i);
  });

  it("tells a non-English speaker's transcript not to be translated", () => {
    const prompt = buildFactExtractionUserPrompt({
      utterance: 'moonu naal',
      fields: [{ key: 'hpi.duration', label: 'Duration', kind: 'duration' }],
      language: 'ta',
    });
    // A translated value cannot be matched back to the span it came from, and
    // the span is what keeps one turn's several answers apart.
    expect(prompt).toMatch(/do not translate/i);
  });
});
