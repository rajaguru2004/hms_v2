import { ConfigService } from '@nestjs/config';
import { SidecarClient, SidecarUnavailableError } from './sidecar.client';

/**
 * The breaker, and the distinction it turns on.
 *
 * The sidecar runs one uvicorn worker with synchronous transcription, so a
 * single slow request occupies it. Without a breaker, ten patients tapping the
 * microphone queue ten sixty-second waits behind each other. With one, they get
 * ten immediate written refusals and a keyboard.
 *
 * The distinction that makes it usable rather than trigger-happy: a 4xx is the
 * sidecar working correctly and refusing *this* request — an empty file, a file
 * type it will not read — and must not count towards the breaker, or one bad
 * upload cuts off the next three patients.
 */

function configWith(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    AI_SIDECAR_URL: 'http://sidecar.test',
    AI_ENABLED: 'true',
    ...overrides,
  };
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

function jsonReply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

async function refusal(
  fn: () => Promise<unknown>,
): Promise<SidecarUnavailableError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof SidecarUnavailableError) return error;
    throw error;
  }
  throw new Error('expected a SidecarUnavailableError');
}

/** The multipart body of the first request the client sent. */
function sentForm(
  mock: jest.Mock<Promise<Response>, [string, RequestInit]>,
): FormData {
  return mock.mock.calls[0][1].body as FormData;
}

describe('SidecarClient', () => {
  // Typed so that reading a recorded call's `RequestInit` back out — which two
  // tests below do, to check the multipart form — is a typed access rather
  // than an `any` the lint gate refuses.
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let client: SidecarClient;

  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
    // Cast only at the assignment — see the note above: the narrow mock type is
    // deliberate, so the widening happens here and nowhere else.
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new SidecarClient(configWith());
  });

  describe('health', () => {
    it('reports each capability separately', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          ollama: true,
          ollamaModels: ['gemma3:4b'],
          stt: true,
          tts: false,
          ocr: true,
          ttsLanguages: [],
        }),
      );

      const health = await client.health();

      // Per capability rather than one boolean, because the degradations are
      // different: no TTS means the question is read on screen; no OCR means a
      // document waits. Only one of those is worth telling the patient about.
      expect(health).toEqual({
        ollama: true,
        ollamaModels: ['gemma3:4b'],
        stt: true,
        tts: false,
        ocr: true,
        sttLanguages: [],
        ttsLanguages: [],
        languages: {},
        ttsProviders: [],
      });
    });

    /**
     * The bare `tts` boolean is true when *any* voice loads, so it answered
     * "can we speak?" with yes while Tamil was missing. Which languages can
     * actually be spoken is a separate list and a separate question.
     */
    it('reports which languages have a voice, not just that some voice exists', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          stt: true,
          tts: true,
          ocr: true,
          ttsLanguages: ['en', 'hi'],
        }),
      );

      const health = await client.health();

      expect(health?.tts).toBe(true);
      expect(health?.ttsLanguages).toEqual(['en', 'hi']);
    });

    /**
     * An older sidecar does not send the field. Empty is the honest reading of
     * that — we do not know what it can speak — and it must NOT be filled in
     * from the supported set, because assuming a voice exists is how a Tamil
     * question gets read aloud in English.
     */
    it('reads a missing language list as unknown rather than as everything', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({ stt: true, tts: true, ocr: true }),
      );

      expect((await client.health())?.ttsLanguages).toEqual([]);
    });

    /**
     * Null, not an all-false object. "We could not ask" and "it answered that
     * nothing works" are different facts — the same distinction the tri-state
     * makes one layer up.
     */
    it('returns null when the sidecar cannot be reached', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await client.health()).toBeNull();
    });
  });

  describe('transcribe', () => {
    it('passes the language through as a form field when one is given', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          text: 'three days',
          confidence: 0.8,
          language: 'en',
          segments: [],
          durationMs: 900,
        }),
      );

      const transcript = await client.transcribe(Buffer.from('wav'), {
        language: 'en',
      });

      expect(transcript.text).toBe('three days');
      expect(sentForm(fetchMock).get('language')).toBe('en');
    });

    it('omits the language so the recogniser can detect it', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          text: '',
          confidence: 0,
          language: 'ta',
          segments: [],
          durationMs: 0,
        }),
      );

      await client.transcribe(Buffer.from('wav'));

      expect(sentForm(fetchMock).get('language')).toBeNull();
    });

    it('fills in for a reply missing fields rather than trusting it', async () => {
      fetchMock.mockResolvedValue(jsonReply({ text: 'hello' }));

      const transcript = await client.transcribe(Buffer.from('wav'));

      expect(transcript.confidence).toBe(0);
      expect(transcript.segments).toEqual([]);
    });
  });

  describe('the circuit breaker', () => {
    it('opens after three consecutive failures and refuses the fourth without asking', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let attempt = 0; attempt < 3; attempt++) {
        await refusal(() => client.transcribe(Buffer.from('wav')));
      }
      expect(client.circuitState().open).toBe(true);

      const callsBefore = fetchMock.mock.calls.length;
      await refusal(() => client.transcribe(Buffer.from('wav')));

      // The fourth patient is refused immediately rather than queued behind
      // three timeouts.
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    /**
     * The distinction that keeps the breaker honest: a refused upload is the
     * service working, not the service failing.
     */
    it('does not count a 4xx towards the breaker', async () => {
      fetchMock.mockResolvedValue(
        jsonReply(
          { detail: 'That file type cannot be read. Upload a photo or a PDF.' },
          415,
        ),
      );

      for (let attempt = 0; attempt < 5; attempt++) {
        await refusal(() => client.readDocument(Buffer.from('x')));
      }

      expect(client.circuitState().open).toBe(false);
      expect(client.circuitState().consecutiveFailures).toBe(0);
    });

    it("passes the sidecar's own written refusal through", async () => {
      fetchMock.mockResolvedValue(
        jsonReply({ detail: 'The uploaded file was empty.' }, 400),
      );

      const error = await refusal(() => client.readDocument(Buffer.from('')));

      // The sidecar writes its errors as sentences because they are shown to a
      // patient. Replacing one with our own would lose the specific thing that
      // went wrong.
      expect(error.patientMessage).toBe('The uploaded file was empty.');
    });

    it('closes again after a success', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await refusal(() => client.transcribe(Buffer.from('wav')));
      expect(client.circuitState().consecutiveFailures).toBe(1);

      fetchMock.mockResolvedValueOnce(
        jsonReply({
          text: 'ok',
          confidence: 1,
          language: 'en',
          segments: [],
          durationMs: 1,
        }),
      );
      await client.transcribe(Buffer.from('wav'));

      expect(client.circuitState().consecutiveFailures).toBe(0);
    });
  });

  /**
   * One breaker per capability, and the outage that forced it.
   *
   * Nine of the eleven languages have no voice on a given box, and a language
   * with no voice answers 503. With one shared counter, a patient whose phone
   * is set to Tamil tapping "read aloud" three times switched off speech
   * recognition and document reading for everybody for thirty seconds. A
   * missing reference recording is configuration, not sickness.
   */
  describe('the breakers are per capability', () => {
    async function failTts(times: number): Promise<void> {
      for (let attempt = 0; attempt < times; attempt++) {
        await refusal(() => client.speak('hello', 'ta'));
      }
    }

    it('does not let a failing capability disable an unrelated one', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let attempt = 0; attempt < 3; attempt++) {
        await refusal(() => client.speak('hello'));
      }

      expect(client.circuitStates().tts.open).toBe(true);
      expect(client.circuitStates().stt.open).toBe(false);
      expect(client.circuitStates().ocr.open).toBe(false);

      // OCR is still asked, rather than refused on TTS's evidence.
      const callsBefore = fetchMock.mock.calls.length;
      await refusal(() => client.readDocument(Buffer.from('x')));
      expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
    });

    it('still reports the service as troubled when any one capability is open', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      for (let attempt = 0; attempt < 3; attempt++) {
        await refusal(() => client.readDocument(Buffer.from('x')));
      }

      expect(client.circuitState().open).toBe(true);
      expect(client.circuitState('ocr').open).toBe(true);
      expect(client.circuitState('stt').open).toBe(false);
    });

    /**
     * A 503 from `/tts` means "no provider can speak that language" — a
     * permanent, correct, cheap answer about configuration. Counting it would
     * cost an English patient their read-aloud because somebody else asked for
     * Tamil.
     */
    it('treats a missing voice as a refusal, not as the service being unwell', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({ detail: 'We cannot read this aloud in Tamil yet.' }, 503),
      );

      await failTts(5);

      expect(client.circuitStates().tts.open).toBe(false);
      expect(client.circuitStates().tts.consecutiveFailures).toBe(0);
    });

    it("passes the sidecar's sentence through when it refuses a language", async () => {
      fetchMock.mockResolvedValue(
        jsonReply({ detail: 'We cannot read this aloud in Tamil yet.' }, 503),
      );

      const error = await refusal(() => client.speak('hello', 'ta'));
      expect(error.patientMessage).toBe(
        'We cannot read this aloud in Tamil yet.',
      );
    });

    /**
     * Deliberately narrow. The recogniser refuses Odia with a 400 by name, so a
     * 503 from `/stt` is a model that will not load — which is exactly what the
     * breaker is for.
     */
    it('still counts a 503 from speech recognition and from document reading', async () => {
      fetchMock.mockResolvedValue(jsonReply({ detail: 'model loading' }, 503));

      for (let attempt = 0; attempt < 3; attempt++) {
        await refusal(() => client.transcribe(Buffer.from('wav')));
      }

      expect(client.circuitStates().stt.open).toBe(true);
      expect(client.circuitStates().tts.open).toBe(false);
    });

    it('lets a health probe fail without touching the models', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await client.health()).toBeNull();
      }

      // The language picker calls `/health`. Before the split, opening it a few
      // times against a down sidecar pushed the one counter towards cutting off
      // document reading.
      expect(client.circuitStates().health.open).toBe(true);
      expect(client.circuitStates().stt.open).toBe(false);
      expect(client.circuitStates().ocr.open).toBe(false);
    });
  });

  /**
   * The per-language capability table. `available` is the sidecar's word for
   * "a provider can speak this now"; `preferred` names the provider that
   * *should* and is true for eleven languages that mostly cannot be spoken yet.
   * Reading the preference would put a speaker button in front of a patient who
   * would then hear nothing.
   */
  describe('the language capability table', () => {
    it('reads availability rather than preference', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          stt: true,
          tts: true,
          ocr: true,
          sttLanguages: ['en', 'ta'],
          ttsLanguages: ['en'],
          languages: {
            en: {
              available: true,
              preferred: 'piper',
              provider: 'piper',
              stt: true,
            },
            ta: {
              available: false,
              preferred: 'indicf5',
              provider: null,
              stt: true,
            },
            or: {
              available: true,
              preferred: 'indicf5',
              provider: 'indicf5',
              stt: false,
            },
          },
        }),
      );

      const health = await client.health();

      expect(health?.sttLanguages).toEqual(['en', 'ta']);
      expect(health?.languages.ta).toEqual({
        stt: true,
        tts: false,
        provider: null,
      });
      expect(health?.languages.or).toEqual({
        stt: false,
        tts: true,
        provider: 'indicf5',
      });
    });

    it('reads a malformed or missing table as nothing known', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({ stt: true, tts: true, ocr: true, languages: 'yes' }),
      );

      const health = await client.health();
      expect(health?.languages).toEqual({});
      expect(health?.ttsProviders).toEqual([]);
    });

    it('keeps each provider’s own account of itself for the health check', async () => {
      fetchMock.mockResolvedValue(
        jsonReply({
          stt: true,
          tts: true,
          ocr: true,
          ttsProviders: [
            {
              id: 'indicf5',
              ready: false,
              detail: 'torch is not installed',
              languages: [],
            },
            { id: 'piper', ready: true, detail: '', languages: ['en', 'hi'] },
          ],
        }),
      );

      const health = await client.health();

      expect(health?.ttsProviders).toEqual([
        {
          id: 'indicf5',
          ready: false,
          detail: 'torch is not installed',
          languages: [],
        },
        { id: 'piper', ready: true, detail: '', languages: ['en', 'hi'] },
      ]);
    });
  });

  describe('refusals are written to be shown', () => {
    it('names the alternative for speech', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const error = await refusal(() => client.transcribe(Buffer.from('wav')));

      // A refusal that does not say what to do instead is a dead end, and
      // §10 requires that typing is always a way through.
      expect(error.patientMessage).toMatch(/type your answer/i);
      expect(error.patientMessage).not.toMatch(
        /\b50[0-9]\b|exception|traceback/i,
      );
    });

    it('refuses without asking when AI is switched off', async () => {
      const disabled = new SidecarClient(configWith({ AI_ENABLED: 'false' }));
      const error = await refusal(() =>
        disabled.transcribe(Buffer.from('wav')),
      );

      expect(error.patientMessage).toMatch(/switched off/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says the question is on screen when the voice is missing', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const error = await refusal(() => client.speak('hello'));
      expect(error.patientMessage).toMatch(/on screen/i);
    });
  });
});
