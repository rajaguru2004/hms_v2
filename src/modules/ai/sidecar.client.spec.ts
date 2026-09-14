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
      });
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
