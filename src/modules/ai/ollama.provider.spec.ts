import { ConfigService } from '@nestjs/config';
import { OllamaProvider } from './ollama.provider';
import { STATIC_FIELDS, findField } from '../case-taking/engine/field-registry';
import { createClinicalState } from '../case-taking/engine/clinical-state';

/**
 * The provider, against a stubbed Ollama.
 *
 * What is on trial is not that it can parse JSON. It is the four things that
 * stand between a 4B model and a patient's chart: the registry allow-list, the
 * evidence-span check, the single repair attempt, and the guarantee that
 * nothing here ever throws at a caller who is mid-interview.
 */

const state = createClinicalState({ sessionId: 's1' });
const DURATION = findField(state, 'hpi.duration')!;
const COMPLAINT = findField(state, 'chief_complaint.symptom')!;

function configWith(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    OLLAMA_URL: 'http://ollama.test',
    OLLAMA_MODEL: 'gemma3:4b',
    AI_ENABLED: 'true',
    ...overrides,
  };
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

/** Ollama's chat envelope, with `content` as the string the model produced. */
function chatReply(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ message: { content }, model: 'gemma3:4b' }),
  } as unknown as Response;
}

function tagsReply(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ models: [{ name: 'gemma3:4b' }] }),
  } as unknown as Response;
}

describe('OllamaProvider', () => {
  // Typed rather than a bare `jest.Mock` so that reading a recorded call's
  // `RequestInit` back out is a typed access instead of an `any` the lint gate
  // refuses. The tests here assert on the request body, so this matters.
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let provider: OllamaProvider;

  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
    // Cast only at the assignment. `fetch`'s real signature accepts a `Request`
    // or a `URL`, which the narrow mock type above does not — but narrowing is
    // the whole point here, so the cast goes where it is needed rather than
    // widening the mock and losing the typed reads.
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new OllamaProvider(configWith());
  });

  /** Every call checks availability first, so every test needs the tags reply. */
  function respondWith(...chats: Response[]): void {
    fetchMock.mockResolvedValueOnce(tagsReply());
    for (const chat of chats) fetchMock.mockResolvedValueOnce(chat);
  }

  describe('extractFacts', () => {
    it('sends the schema as the format parameter, not as a hopeful instruction', async () => {
      respondWith(chatReply('{"facts":[]}'));

      await provider.extractFacts({
        utterance: 'three days',
        candidateFields: [DURATION],
      });

      // `body` is a `BodyInit`, which stringifies to '[object Object]' for most
      // of its members. Every call this provider makes sends a JSON string, so
      // the narrowing is honest rather than hopeful.
      const body = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
        format?: { properties?: Record<string, unknown> };
        options?: { temperature?: number };
      };

      expect(body.format?.properties).toHaveProperty('facts');
      // Greedy: two runs over one turn must produce the same facts, or a case
      // cannot be replayed and an extraction cannot be explained.
      expect(body.options?.temperature).toBe(0);
    });

    /**
     * The allow-list. A path the registry does not declare is not an unused
     * field — it is a slot in the chart the model made up.
     */
    it('discards a field path the registry does not know', async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            facts: [
              {
                fieldPath: 'hpi.duration',
                value: 'three days',
                evidenceSpan: 'three days',
              },
              {
                fieldPath: 'hpi.likely_cause',
                value: 'angina',
                evidenceSpan: 'three days',
              },
            ],
          }),
        ),
      );

      const result = await provider.extractFacts({
        utterance: 'I have had it three days',
        candidateFields: [DURATION],
      });

      expect(result.facts.map((f) => f.fieldPath)).toEqual(['hpi.duration']);
      expect(result.discardedPaths).toEqual(['hpi.likely_cause']);
    });

    /**
     * The observed failure: asked for the patient's own words, the local model
     * returned character offsets. A span that is not in the utterance did not
     * come from the patient, so it is dropped — and the engine then treats the
     * derivation conservatively and flags it for confirmation.
     */
    it('drops an evidence span that is not in the utterance', async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            facts: [
              {
                fieldPath: 'hpi.duration',
                value: 'three days',
                evidenceSpan: '[3, 9]',
              },
            ],
          }),
        ),
      );

      const result = await provider.extractFacts({
        utterance: 'I have had chest pain for three days',
        candidateFields: [DURATION],
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].evidenceSpan).toBeUndefined();
    });

    it("returns the source spelling of a span, not the model's", async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            facts: [
              {
                fieldPath: 'hpi.duration',
                value: 'three days',
                evidenceSpan: 'THREE DAYS',
              },
            ],
          }),
        ),
      );

      const result = await provider.extractFacts({
        utterance: 'I have had it for three days now',
        candidateFields: [DURATION],
      });

      // What the engine matches phrases against has to be what the patient
      // actually said, not what the model re-cased it to.
      expect(result.facts[0].evidenceSpan).toBe('three days');
    });

    it('repairs unparseable JSON exactly once, then gives up', async () => {
      respondWith(
        chatReply('{"facts": ['),
        chatReply(
          '{"facts":[{"fieldPath":"hpi.duration","value":"three days","evidenceSpan":"three days"}]}',
        ),
      );

      const result = await provider.extractFacts({
        utterance: 'three days',
        candidateFields: [DURATION],
      });

      expect(result.degraded).toBe(false);
      expect(result.facts).toHaveLength(1);
      // tags + first chat + repair chat. Not a loop.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('gives up after one failed repair rather than looping', async () => {
      respondWith(chatReply('{"facts": ['), chatReply('still not json'));

      const result = await provider.extractFacts({
        utterance: 'three days',
        candidateFields: [DURATION],
      });

      expect(result.degraded).toBe(true);
      expect(result.facts).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    /**
     * The interview must survive a model that is down. Every degradation here
     * is a value the caller can act on, never an exception it has to catch.
     */
    it('degrades rather than throwing when the transport fails', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await provider.extractFacts({
        utterance: 'three days',
        candidateFields: [DURATION],
      });

      expect(result.degraded).toBe(true);
      expect(result.facts).toEqual([]);
    });

    it('does not call the model at all when AI_ENABLED is false', async () => {
      const disabled = new OllamaProvider(configWith({ AI_ENABLED: 'false' }));

      const result = await disabled.extractFacts({
        utterance: 'three days',
        candidateFields: [DURATION],
      });

      expect(result.degraded).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never returns a presence, whatever the model volunteers', async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            facts: [
              {
                fieldPath: 'chief_complaint.symptom',
                value: 'chest pain',
                evidenceSpan: 'chest pain',
                presence: 'recorded',
                confidence: 0.95,
              },
            ],
          }),
        ),
      );

      const result = await provider.extractFacts({
        utterance: 'chest pain',
        candidateFields: [COMPLAINT],
      });

      // The extra keys are not merely ignored downstream — they do not survive
      // this file, so nothing below it could read them by accident.
      expect(Object.keys(result.facts[0]).sort()).toEqual([
        'evidenceSpan',
        'fieldPath',
        'value',
      ]);
    });
  });

  describe('phraseQuestion', () => {
    it("falls back to the engine's phrasing when the model is unreachable", async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await provider.phraseQuestion({
        field: DURATION,
        fallbackPrompt: 'How long have you had this problem?',
      });

      expect(result.question).toBe('How long have you had this problem?');
      expect(result.degraded).toBe(true);
    });

    /**
     * A reworded question is still text this system puts in front of a patient,
     * and §29 forbids the feature from stating a diagnosis anywhere. The check
     * is the safety engine's own, so questions and red-flag messages are held
     * to one standard rather than two.
     */
    it('refuses a rewording that names a condition', async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            question: 'This sounds like angina — how long have you had it?',
          }),
        ),
      );

      const result = await provider.phraseQuestion({
        field: DURATION,
        fallbackPrompt: 'How long have you had this problem?',
      });

      expect(result.question).toBe('How long have you had this problem?');
      expect(result.degradedReason).toMatch(/diagnostic language/);
    });

    it('uses a clean rewording', async () => {
      respondWith(
        chatReply(
          JSON.stringify({ question: 'And how long has that been going on?' }),
        ),
      );

      const result = await provider.phraseQuestion({
        field: DURATION,
        fallbackPrompt: 'How long have you had this problem?',
      });

      expect(result.question).toBe('And how long has that been going on?');
      expect(result.degraded).toBe(false);
    });
  });

  describe('draftReviewSummary', () => {
    it('discards a summary that names a condition, keeping nothing rather than editing', async () => {
      respondWith(
        chatReply(
          JSON.stringify({
            summary: 'You probably a heart attack. Please check.',
          }),
        ),
      );

      const result = await provider.draftReviewSummary({
        sections: [
          { title: 'Allergies', lines: ['Allergies: Patient unsure'] },
        ],
      });

      expect(result.summary).toBeNull();
      expect(result.degraded).toBe(true);
    });
  });

  describe('the registry allow-list', () => {
    it('is the registry, not a hand-kept list', () => {
      // If this ever drifts, the allow-list tests above are testing a fiction.
      expect(STATIC_FIELDS.some((field) => field.key === DURATION.key)).toBe(
        true,
      );
      expect(
        STATIC_FIELDS.some((field) => field.key === 'hpi.likely_cause'),
      ).toBe(false);
    });
  });
});
