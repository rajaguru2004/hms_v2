import { ConfigService } from '@nestjs/config';
import { OllamaTranslationProvider } from './ollama-translation.provider';
import {
  CODE_SWITCHING_INSTRUCTION,
  TRANSLATION_SCHEMA,
} from './prompts/translation.prompt';

/**
 * The translator, against a stubbed Ollama.
 *
 * Four things are on trial, and none of them is translation quality — nothing
 * in a unit test can measure that. What can be measured is the whole reason
 * this seam is allowed to exist at all:
 *
 *   1. The patient's words come back out identical to how they went in, on
 *      every path including the failing ones.
 *   2. A model that is down, slow, or talking prose produces a result, not an
 *      exception — the caller is inside a fire-and-forget promise.
 *   3. English costs nothing. Not one HTTP call, never mind eight seconds.
 *   4. The English already inside a code-switched sentence survives.
 */

/** A real Hindi utterance from the bug report this module exists to fix. */
const HINDI = 'तीन दिन से सीने में दर्द हो रहा है';

/** The normal case in this clinic, not the exotic one. */
const CODE_SWITCHED = 'எனக்கு three days-ஆ chest pain இருக்கு';

function configWith(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = { ...overrides };
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

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

describe('OllamaTranslationProvider', () => {
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let provider: OllamaTranslationProvider;

  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new OllamaTranslationProvider(configWith());
  });

  /** Every call checks availability first, so every test needs the tags reply. */
  function respondWith(...chats: Response[]): void {
    fetchMock.mockResolvedValueOnce(tagsReply());
    for (const chat of chats) fetchMock.mockResolvedValueOnce(chat);
  }

  function bodyOf(callIndex: number): {
    model?: string;
    stream?: boolean;
    format?: object;
    options?: { temperature?: number };
    messages?: { role: string; content: string }[];
  } {
    return JSON.parse(fetchMock.mock.calls[callIndex][1].body as string) as {
      model?: string;
      stream?: boolean;
      format?: object;
      options?: { temperature?: number };
      messages?: { role: string; content: string }[];
    };
  }

  describe('the box it actually runs on', () => {
    it('talks to 8080, not to Ollama’s default port', async () => {
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8080/api/tags');
      expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8080/api/chat');
    });

    it('runs gemma3:4b by default', async () => {
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      await provider.translateToEnglish({ text: HINDI, sourceLanguage: 'hi' });

      expect(bodyOf(1).model).toBe('gemma3:4b');
    });

    it('refuses gemma3:12b even when it is configured, because loading it kills the server', async () => {
      const configured = new OllamaTranslationProvider(
        configWith({ OLLAMA_TRANSLATION_MODEL: 'gemma3:12b' }),
      );
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      const result = await configured.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(bodyOf(1).model).toBe('gemma3:4b');
      expect(result.model).toBe('gemma3:4b');
    });

    it('constrains the sampler with the schema instead of asking nicely, and stays greedy', async () => {
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      await provider.translateToEnglish({ text: HINDI, sourceLanguage: 'hi' });

      const body = bodyOf(1);
      expect(body.format).toEqual(TRANSLATION_SCHEMA);
      expect(body.stream).toBe(false);
      expect(body.options?.temperature).toBe(0);
    });
  });

  describe('English is free', () => {
    it('passes an English session through without a model call at all', async () => {
      const result = await provider.translateToEnglish({
        text: 'chest pain for three days',
        sourceLanguage: 'en',
      });

      // The assertion that matters: not one HTTP call. Not even the
      // availability probe. Translating English into English is eight to
      // twenty seconds of this box for no change whatsoever.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.passthrough).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.englishText).toBe('chest pain for three days');
      expect(result.latencyMs).toBe(0);
    });

    it('treats a regional English tag as English', async () => {
      const result = await provider.translateToEnglish({
        text: 'chest pain',
        sourceLanguage: 'en-IN',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.passthrough).toBe(true);
    });

    it('treats a missing language tag as English rather than guessing', async () => {
      const result = await provider.translateToEnglish({
        text: 'chest pain',
        sourceLanguage: '',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.passthrough).toBe(true);
      expect(result.englishText).toBe('chest pain');
    });

    it('does not call a model for an empty utterance', async () => {
      const result = await provider.translateToEnglish({
        text: '   ',
        sourceLanguage: 'hi',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.englishText).toBeNull();
      expect(result.degraded).toBe(false);
    });
  });

  describe('degradation', () => {
    it('returns a degraded result rather than throwing when Ollama is down', async () => {
      fetchMock.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:8080'),
      );

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toBe('model unavailable');
      expect(result.englishText).toBeNull();
      // And the patient's words are still here, which is the whole fallback.
      expect(result.originalText).toBe(HINDI);
    });

    it('does not throw when the chat call itself fails', async () => {
      fetchMock.mockResolvedValueOnce(tagsReply());
      fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.degraded).toBe(true);
      expect(result.englishText).toBeNull();
    });

    it('does not throw on an HTTP error from the server', async () => {
      respondWith({ ok: false, status: 500 } as unknown as Response);

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain('500');
      expect(result.englishText).toBeNull();
    });

    it('tries one repair on prose, then degrades', async () => {
      respondWith(
        chatReply('Sure! Here is the translation: chest pain for three days'),
        chatReply('Still not JSON, sorry'),
      );

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      // tags + first attempt + one repair. One, not a loop: a model that
      // ignored a schema constraint is not having a bad roll of the dice.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.degraded).toBe(true);
      expect(result.englishText).toBeNull();
    });

    it('recovers when the repair attempt produces valid JSON', async () => {
      respondWith(
        chatReply('Here you go: {"english":"chest pain"}'),
        chatReply('{"english":"chest pain for three days"}'),
      );

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.degraded).toBe(false);
      expect(result.englishText).toBe('chest pain for three days');
    });

    it('rejects a reply that came back still in the patient’s script', async () => {
      respondWith(chatReply(`{"english":"${HINDI}"}`));

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      // Handing that to an English keyword table is the exact bug this module
      // exists to fix, so it is dropped rather than passed on as English.
      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toBe('reply was not in English');
      expect(result.englishText).toBeNull();
    });

    it('degrades without a single request when translation is switched off', async () => {
      const off = new OllamaTranslationProvider(
        configWith({ AI_TRANSLATION_ENABLED: 'false' }),
      );

      const result = await off.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.degraded).toBe(true);
      expect(result.originalText).toBe(HINDI);
    });

    it('degrades when AI is switched off globally', async () => {
      const off = new OllamaTranslationProvider(
        configWith({ AI_ENABLED: 'false' }),
      );

      const result = await off.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.degraded).toBe(true);
    });
  });

  describe('the patient’s own words', () => {
    it('hands the original back unchanged on the happy path', async () => {
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.originalText).toBe(HINDI);
      expect(result.englishText).toBe('chest pain for three days');
      // Two fields, never one. A caller that wanted to overwrite the patient
      // would have to go out of its way to do it.
      expect(result.originalText).not.toBe(result.englishText);
    });

    it.each([
      [
        'unavailable',
        (): void => void fetchMock.mockRejectedValue(new Error('down')),
      ],
      [
        'unparseable',
        (): void => respondWith(chatReply('nope'), chatReply('still nope')),
      ],
      ['empty', (): void => respondWith(chatReply('{"english":"  "}'))],
    ])('keeps the original when the model is %s', async (_label, arrange) => {
      arrange();

      const result = await provider.translateToEnglish({
        text: HINDI,
        sourceLanguage: 'hi',
      });

      expect(result.originalText).toBe(HINDI);
      expect(result.englishText).toBeNull();
    });

    it('sends the patient’s text to the model verbatim', async () => {
      respondWith(chatReply('{"english":"chest pain for three days"}'));

      await provider.translateToEnglish({ text: HINDI, sourceLanguage: 'hi' });

      const user = bodyOf(1).messages?.find((m) => m.role === 'user');
      expect(user?.content).toContain(HINDI);
      // The language is named in English so the model has something to read,
      // not passed as a bare two-letter code.
      expect(user?.content).toContain('Hindi');
    });
  });

  describe('code-switching', () => {
    it('keeps the English fragments the patient already used', async () => {
      respondWith(chatReply('{"english":"I have chest pain for three days"}'));

      const result = await provider.translateToEnglish({
        text: CODE_SWITCHED,
        sourceLanguage: 'ta',
      });

      expect(result.englishText).toBe('I have chest pain for three days');
      // The fragments that were already English are still those words, not a
      // medical term the model preferred.
      expect(result.englishText).toContain('chest pain');
      expect(result.englishText).toContain('three days');
      expect(result.originalText).toBe(CODE_SWITCHED);
    });

    it('tells the model to copy existing English through unchanged', async () => {
      respondWith(chatReply('{"english":"I have chest pain for three days"}'));

      await provider.translateToEnglish({
        text: CODE_SWITCHED,
        sourceLanguage: 'ta',
      });

      const system = bodyOf(1).messages?.find((m) => m.role === 'system');
      // Asserted against the exported constant rather than a quoted phrase, so
      // a reworded prompt cannot quietly drop the rule and still pass.
      expect(system?.content).toContain(CODE_SWITCHING_INSTRUCTION);
    });

    it('a code-switched reply that still carries the source script is refused', async () => {
      respondWith(chatReply(`{"english":"${CODE_SWITCHED}"}`));

      const result = await provider.translateToEnglish({
        text: CODE_SWITCHED,
        sourceLanguage: 'ta',
      });

      expect(result.englishText).toBeNull();
      expect(result.degraded).toBe(true);
    });
  });

  describe('the prompt', () => {
    it('forbids adding, softening, interpreting and diagnosing', async () => {
      respondWith(chatReply('{"english":"chest pain"}'));

      await provider.translateToEnglish({ text: HINDI, sourceLanguage: 'hi' });

      const system = bodyOf(1).messages?.find(
        (m) => m.role === 'system',
      )?.content;
      expect(system).toContain('Do NOT add anything');
      expect(system).toContain('Do NOT soften');
      expect(system).toContain('no diagnosis');
      expect(system).toContain('Keep every number');
    });

    it('has no confidence field to fill in', () => {
      expect(JSON.stringify(TRANSLATION_SCHEMA)).not.toContain('confidence');
      expect(JSON.stringify(TRANSLATION_SCHEMA)).not.toContain('presence');
    });
  });
});
