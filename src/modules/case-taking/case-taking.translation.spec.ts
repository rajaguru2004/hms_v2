import type {
  CaseFact,
  CaseRedFlag,
  CaseSession,
  CaseTurn,
} from '@prisma/client';
import { CaseTakingService } from './case-taking.service';
import { CaseTakingRepository } from './case-taking.repository';
import { AuditService } from '../../audit/audit.service';
import {
  ExtractFactsRequest,
  ExtractFactsResult,
  LlmProvider,
} from '../ai/llm-provider.interface';
import {
  TranslationProvider,
  TranslationResult,
} from '../ai/translation-provider.interface';
import { SidecarClient } from '../ai/sidecar.client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { FactRowData } from './case-state';

/**
 * Translation, where it is wired: behind the response, never in front of it.
 *
 * The bug being fixed is measurable and was measured. On identical structured
 * facts, `classifyComplaint` read the English "chest pain for three days" as
 * `[cardiac, respiratory]` and fired ACS_TRIAD, and read the Hindi
 * "तीन दिन से सीने में दर्द हो रहा है" as `[unclassified]` and stayed silent.
 * The fix is to hand the English classifier English.
 *
 * What these tests hold it to is not that the translation is good — nothing
 * here can judge that — but that it is bought at no cost the patient pays, and
 * at no cost to the record of what they actually said:
 *
 *   • `POST /turns` returns without waiting on the translator. Ever.
 *   • `CaseTurn.answerRaw` still holds the patient's own words afterwards.
 *   • A translator that fails, throws, or is not wired at all leaves the system
 *     doing exactly what it did yesterday.
 */

const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'patient@hms.local',
  organizationId: 'org-1',
  patientId: 'pat-1',
  roles: ['PATIENT'],
} as AuthenticatedUser;

const PATIENT_ID = 'pat-1';

/** The utterance from the bug report, verbatim. */
const HINDI = 'तीन दिन से सीने में दर्द हो रहा है';
const ENGLISH = 'I have had chest pain for three days';

/** Only the methods this path touches. A fuller fake lives in the main spec. */
class FakeRepository {
  sessions = new Map<string, CaseSession>();
  turns: CaseTurn[] = [];
  facts: CaseFact[] = [];
  redFlags: CaseRedFlag[] = [];
  private counter = 0;

  private id(prefix: string): string {
    return `${prefix}${++this.counter}`;
  }

  seedSession(language: string): CaseSession {
    const session = {
      id: 'sess-1',
      organizationId: 'org-1',
      patientId: PATIENT_ID,
      appointmentId: null,
      kind: 'new_consultation',
      language,
      status: 'in_progress',
      consentGivenAt: new Date('2026-09-14T09:00:00Z'),
      consentVersion: '2026.09.1',
      currentSection: null,
      progressPercent: 0,
      clinicalState: null,
      sectionStatus: null,
      startedAt: new Date('2026-09-14T09:00:00Z'),
      lastActiveAt: new Date('2026-09-14T09:00:00Z'),
      submittedAt: null,
      updatedAt: new Date(),
      isDeleted: false,
      deletedAt: null,
    } as unknown as CaseSession;
    this.sessions.set(session.id, session);
    return session;
  }

  findSessionForPatient = jest.fn((sessionId: string) =>
    Promise.resolve(this.sessions.get(sessionId) ?? null),
  );

  touchSession = jest.fn((sessionId: string, data: Record<string, unknown>) => {
    const session = { ...this.sessions.get(sessionId)!, ...data };
    this.sessions.set(sessionId, session);
    return Promise.resolve(session);
  });

  listTurns = jest.fn((sessionId: string) =>
    Promise.resolve(this.turns.filter((t) => t.sessionId === sessionId)),
  );

  appendTurn = jest.fn((sessionId: string, data: Record<string, unknown>) => {
    const turn = {
      id: this.id('turn-'),
      sessionId,
      sequence: this.turns.length + 1,
      questionText: null,
      answerRaw: null,
      answerModality: null,
      transcriptConfidence: null,
      audioKey: null,
      llmModel: null,
      latencyMs: null,
      section: null,
      fieldKey: null,
      createdAt: new Date(),
      ...data,
    } as CaseTurn;
    this.turns.push(turn);
    return Promise.resolve(turn);
  });

  listCurrentFacts = jest.fn((sessionId: string) =>
    Promise.resolve(
      this.facts.filter((f) => f.sessionId === sessionId && !f.supersededById),
    ),
  );

  recordFact = jest.fn(
    (input: { sessionId: string; patientId: string; row: FactRowData }) => {
      const created = {
        id: this.id('fact-'),
        sessionId: input.sessionId,
        patientId: input.patientId,
        ...input.row,
        supersededById: null,
        supersededAt: null,
        createdAt: new Date(),
      } as unknown as CaseFact;
      this.facts.push(created);
      return Promise.resolve(created);
    },
  );

  listRedFlags = jest.fn(() => Promise.resolve(this.redFlags));

  recordRedFlag = jest.fn((data: Record<string, unknown>) => {
    const flag = {
      id: this.id('flag-'),
      triggeredAt: new Date(),
      acknowledgedAt: null,
      escalatedAt: null,
      escalationRef: null,
      ...data,
    } as unknown as CaseRedFlag;
    this.redFlags.push(flag);
    return Promise.resolve(flag);
  });

  findPatientForSession = jest.fn(() =>
    Promise.resolve({
      id: PATIENT_ID,
      dateOfBirth: new Date('1990-05-17'),
      gender: 'female',
    }),
  );
}

/** Extraction is allowed here — it is the background path. Everything else is not. */
function backgroundLlm(): {
  llm: LlmProvider;
  calls: ExtractFactsRequest[];
} {
  const calls: ExtractFactsRequest[] = [];
  const forbidden = (name: string) => (): never => {
    throw new Error(`${name} was called on the hot path`);
  };

  const llm = {
    isAvailable: jest.fn(() => Promise.resolve(true)),
    extractFacts: jest.fn((request: ExtractFactsRequest) => {
      calls.push(request);
      return Promise.resolve({
        facts: [],
        discardedPaths: [],
        model: 'gemma3:4b',
        latencyMs: 12,
        degraded: false,
        promptVersion: 'test',
      } as ExtractFactsResult);
    }),
    phraseQuestion: jest.fn(forbidden('phraseQuestion')),
    draftReviewSummary: jest.fn(forbidden('draftReviewSummary')),
    extractFromDocumentText: jest.fn(forbidden('extractFromDocumentText')),
    describeImage: jest.fn(forbidden('describeImage')),
  } as unknown as LlmProvider;

  return { llm, calls };
}

function translationResult(
  overrides: Partial<TranslationResult> = {},
): TranslationResult {
  return {
    originalText: HINDI,
    englishText: ENGLISH,
    sourceLanguage: 'hi',
    passthrough: false,
    model: 'gemma3:4b',
    latencyMs: 9_000,
    degraded: false,
    promptVersion: 'test',
    ...overrides,
  };
}

interface Harness {
  service: CaseTakingService;
  repo: FakeRepository;
  extractions: ExtractFactsRequest[];
  translate: jest.Mock<
    Promise<TranslationResult>,
    [{ text: string; sourceLanguage: string }]
  >;
}

function harness(options: {
  language: string;
  translate?: jest.Mock<
    Promise<TranslationResult>,
    [{ text: string; sourceLanguage: string }]
  >;
  withTranslator?: boolean;
}): Harness {
  const repo = new FakeRepository();
  repo.seedSession(options.language);

  const { llm, calls } = backgroundLlm();
  const translate =
    options.translate ??
    jest.fn<
      Promise<TranslationResult>,
      [{ text: string; sourceLanguage: string }]
    >(() => Promise.resolve(translationResult()));

  const translator = { translateToEnglish: translate } as TranslationProvider;

  const service = new CaseTakingService(
    repo as unknown as CaseTakingRepository,
    llm,
    {
      transcribe: jest.fn(),
      speak: jest.fn(),
      health: jest.fn(),
    } as unknown as SidecarClient,
    { log: jest.fn(() => Promise.resolve()) } as unknown as AuditService,
    options.withTranslator === false ? undefined : translator,
  );

  return { service, repo, extractions: calls, translate };
}

/** A narrative turn: no field, so `extractionDecision` queues the model. */
async function narrate(
  h: Harness,
  text: string,
): Promise<{ serverTimeMs: number }> {
  const result = await h.service.submitTurn(
    'sess-1',
    { modality: 'text', text },
    USER,
    PATIENT_ID,
  );
  return result;
}

/** Background work lands on later ticks; poll rather than guess at a delay. */
async function settle(check: () => boolean, ticks = 50): Promise<void> {
  for (let i = 0; i < ticks && !check(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('translation on the background path', () => {
  it('answers the turn without waiting for the translator', async () => {
    // A translator that never resolves. If the response waited on it, this test
    // would time out — which is precisely the twenty-second wait the whole
    // design exists to avoid.
    const translate = jest.fn<
      Promise<TranslationResult>,
      [{ text: string; sourceLanguage: string }]
    >(() => new Promise<TranslationResult>(() => {}));

    const h = harness({ language: 'hi', translate });

    const result = await narrate(h, HINDI);

    expect(result.serverTimeMs).toBeLessThan(1_000);
    // It was reached — just not in front of the patient.
    await settle(() => translate.mock.calls.length > 0);
    expect(translate).toHaveBeenCalled();
  });

  it('hands extraction the English, and tells it the text is English', async () => {
    const h = harness({ language: 'hi' });

    await narrate(h, HINDI);
    await settle(() => h.extractions.length > 0);

    expect(h.extractions[0].utterance).toBe(ENGLISH);
    // `en`, so the extraction prompt drops its "copy their words, do not
    // translate" line — the text it is looking at really is English now.
    expect(h.extractions[0].language).toBe('en');
  });

  it('never replaces the patient’s own words in the turn log', async () => {
    const h = harness({ language: 'hi' });

    await narrate(h, HINDI);
    await settle(() => h.extractions.length > 0);

    const patientTurn = h.repo.turns.find((turn) => turn.role === 'patient');
    // The stored fact. Still Devanagari, still the patient's sentence, after a
    // translation has been through. Nothing a clinician reads was rewritten.
    expect(patientTurn?.answerRaw).toBe(HINDI);
    expect(h.repo.turns.every((t) => t.answerRaw !== ENGLISH)).toBe(true);
  });

  it('sends the translator exactly what the patient said', async () => {
    const h = harness({ language: 'hi' });

    await narrate(h, HINDI);
    await settle(() => h.translate.mock.calls.length > 0);

    expect(h.translate.mock.calls[0][0]).toEqual({
      text: HINDI,
      sourceLanguage: 'hi',
    });
  });

  it('falls back to the original when translation degrades', async () => {
    const translate = jest.fn<
      Promise<TranslationResult>,
      [{ text: string; sourceLanguage: string }]
    >(() =>
      Promise.resolve(
        translationResult({
          englishText: null,
          degraded: true,
          degradedReason: 'model unavailable',
        }),
      ),
    );

    const h = harness({ language: 'hi', translate });

    await narrate(h, HINDI);
    await settle(() => h.extractions.length > 0);

    // Today's behaviour, exactly: the patient's words, in their language, to a
    // model told they are in that language. Worse classification, never a lost
    // sentence.
    expect(h.extractions[0].utterance).toBe(HINDI);
    expect(h.extractions[0].language).toBe('hi');
  });

  it('survives a translator that throws, and still extracts', async () => {
    const translate = jest.fn<
      Promise<TranslationResult>,
      [{ text: string; sourceLanguage: string }]
    >(() => Promise.reject(new Error('provider contract violated')));

    const h = harness({ language: 'hi', translate });

    await narrate(h, HINDI);
    await settle(() => h.extractions.length > 0);

    expect(h.extractions[0].utterance).toBe(HINDI);
  });

  it('does not translate an English session at all', async () => {
    const h = harness({ language: 'en' });

    await narrate(h, 'I have had chest pain for three days');
    await settle(() => h.extractions.length > 0);

    expect(h.translate).not.toHaveBeenCalled();
    expect(h.extractions[0].utterance).toBe(
      'I have had chest pain for three days',
    );
  });

  it('works with no translator wired at all', async () => {
    const h = harness({ language: 'hi', withTranslator: false });

    await narrate(h, HINDI);
    await settle(() => h.extractions.length > 0);

    expect(h.extractions[0].utterance).toBe(HINDI);
    expect(h.repo.turns.find((t) => t.role === 'patient')?.answerRaw).toBe(
      HINDI,
    );
  });
});
