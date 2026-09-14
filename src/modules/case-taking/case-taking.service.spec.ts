/* eslint-disable @typescript-eslint/unbound-method */
import type {
  CaseFact,
  CaseRedFlag,
  CaseSession,
  CaseTurn,
} from '@prisma/client';
import { CaseTakingService, ageBandFrom } from './case-taking.service';
import { CaseTakingRepository } from './case-taking.repository';
import { AuditService } from '../../audit/audit.service';
import { LlmProvider } from '../ai/llm-provider.interface';
import { SidecarClient } from '../ai/sidecar.client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { AppException } from '../../common/exceptions/app.exception';
import { FactRowData } from './case-state';

/**
 * The interview, against an in-memory repository.
 *
 * The repository is a real store rather than a set of return-value stubs,
 * because almost everything worth asserting here is about *state* — that a
 * correction leaves two rows and not one, that an "I don't know" reads back as
 * `unknown` rather than `none`, that the same question is not asked twice. A
 * mock that returns a canned row cannot tell you any of those.
 *
 * The LLM is a strict stub that fails the test if it is called on the hot path.
 * That is the load-bearing assertion of the whole module: a patient waits on
 * the engine, never on a model.
 */

const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'patient@hms.local',
  organizationId: 'org-1',
  patientId: 'pat-1',
  roles: ['PATIENT'],
} as AuthenticatedUser;

const PATIENT_ID = 'pat-1';

/** An in-memory stand-in with the same append-only semantics as the real one. */
class FakeRepository {
  sessions = new Map<string, CaseSession>();
  turns: CaseTurn[] = [];
  facts: CaseFact[] = [];
  redFlags: CaseRedFlag[] = [];
  private counter = 0;

  private id(prefix: string): string {
    return `${prefix}${++this.counter}`;
  }

  seedSession(overrides: Partial<CaseSession> = {}): CaseSession {
    const session = {
      id: 'sess-1',
      organizationId: 'org-1',
      patientId: PATIENT_ID,
      appointmentId: null,
      kind: 'new_consultation',
      language: 'en',
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
      ...overrides,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  create = jest.fn((data: Record<string, unknown>) =>
    Promise.resolve(
      this.seedSession({
        id: this.id('sess-'),
        consentGivenAt: null,
        consentVersion: null,
        language: (data.language as string) ?? 'en',
      }),
    ),
  );

  findInProgressForPatient = jest.fn(() =>
    Promise.resolve(
      [...this.sessions.values()].find((s) =>
        ['in_progress', 'review'].includes(s.status),
      ) ?? null,
    ),
  );

  findSessionForPatient = jest.fn((sessionId: string) =>
    Promise.resolve(this.sessions.get(sessionId) ?? null),
  );

  touchSession = jest.fn((sessionId: string, data: Record<string, unknown>) => {
    const session = {
      ...this.sessions.get(sessionId)!,
      ...data,
    };
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

  listAllFacts = jest.fn((sessionId: string) =>
    Promise.resolve(this.facts.filter((f) => f.sessionId === sessionId)),
  );

  findFact = jest.fn((sessionId: string, factId: string) =>
    Promise.resolve(
      this.facts.find((f) => f.id === factId && f.sessionId === sessionId) ??
        null,
    ),
  );

  /** Append-only, exactly as the real transaction does it. */
  recordFact = jest.fn(
    (input: { sessionId: string; patientId: string; row: FactRowData }) => {
      const current = this.facts.find(
        (f) =>
          f.sessionId === input.sessionId &&
          f.fieldPath === input.row.fieldPath &&
          !f.supersededById,
      );
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
      if (current) {
        // The OLD row points forwards at its replacement, which is what lets a
        // reader walk a path's history in the order it happened.
        (current as { supersededById: string | null }).supersededById =
          created.id;
        (current as { supersededAt: Date | null }).supersededAt = new Date();
      }
      return Promise.resolve(created);
    },
  );

  listRedFlags = jest.fn((sessionId: string) =>
    Promise.resolve(this.redFlags.filter((f) => f.sessionId === sessionId)),
  );

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

  createSubmission = jest.fn((data: Record<string, unknown>) =>
    Promise.resolve({
      id: this.id('sub-'),
      submittedAt: new Date(),
      consultationId: null,
      preTriageId: null,
      queueId: null,
      ...data,
    }),
  );

  findSubmission = jest.fn(() => Promise.resolve(null));

  findPatientForSession = jest.fn(() =>
    Promise.resolve({
      id: PATIENT_ID,
      dateOfBirth: new Date('1990-05-17'),
      gender: 'female',
    }),
  );
}

/** Fails the test if the hot path ever reaches it. */
function strictLlm(): jest.Mocked<LlmProvider> {
  const forbidden = (name: string) => () => {
    throw new Error(
      `${name} was called; nothing on the interview's hot path may wait on a model`,
    );
  };
  return {
    isAvailable: jest.fn(() => Promise.resolve(true)),
    extractFacts: jest.fn(forbidden('extractFacts')),
    phraseQuestion: jest.fn(forbidden('phraseQuestion')),
    draftReviewSummary: jest.fn(forbidden('draftReviewSummary')),
    extractFromDocumentText: jest.fn(forbidden('extractFromDocumentText')),
    describeImage: jest.fn(forbidden('describeImage')),
  } as unknown as jest.Mocked<LlmProvider>;
}

interface Harness {
  service: CaseTakingService;
  repo: FakeRepository;
  llm: jest.Mocked<LlmProvider>;
}

function harness(): Harness {
  const repo = new FakeRepository();
  const llm = strictLlm();
  const sidecar = {
    transcribe: jest.fn(),
    speak: jest.fn(),
  } as unknown as SidecarClient;
  const audit = {
    log: jest.fn(() => Promise.resolve()),
  } as unknown as AuditService;

  const service = new CaseTakingService(
    repo as unknown as CaseTakingRepository,
    llm,
    sidecar,
    audit,
  );
  return { service, repo, llm };
}

async function errorCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const body = (error as AppException).getResponse() as {
      errorCode?: string;
    };
    return body.errorCode ?? 'NO_CODE';
  }
  return 'NO_ERROR';
}

/** Answer whatever is currently being asked. */
async function answer(
  h: Harness,
  sessionId: string,
  body: {
    fieldPath?: string;
    modality?: string;
    text?: string;
    value?: string;
  },
) {
  return h.service.submitTurn(
    sessionId,
    {
      modality: body.modality ?? 'text',
      ...body,
    },
    USER,
    PATIENT_ID,
  );
}

describe('CaseTakingService', () => {
  describe('starting and resuming', () => {
    it('hands back the open session rather than starting a second one', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await h.service.startOrResume({}, USER, PATIENT_ID);

      expect(result.resumed).toBe(true);
      expect(h.repo.create).not.toHaveBeenCalled();
    });

    it('seeds the age band from the record, attributed to the record', async () => {
      const h = harness();

      await h.service.startOrResume({}, USER, PATIENT_ID);

      const band = h.repo.facts.find((f) => f.fieldPath === 'social.age_band');
      expect(band?.valueJson).toBe('adult');
      // The hospital already knew this; the patient did not just say it. A
      // provenance that claimed otherwise would be a small lie in the one place
      // this system has promised not to tell any.
      expect(band?.sourceType).toBe('existing_record');
    });

    it('starts the interview anyway when the age band cannot be read', async () => {
      const h = harness();
      h.repo.findPatientForSession = jest.fn(() =>
        Promise.reject(new Error('gone')),
      ) as never;

      const result = await h.service.startOrResume({}, USER, PATIENT_ID);

      // A missing age band switches the paediatric rules off, which is worth a
      // warning. It is not worth refusing to start.
      expect(result.id).toBeDefined();
    });
  });

  describe('consent', () => {
    it('refuses a turn before consent is given', async () => {
      const h = harness();
      h.repo.seedSession({ consentGivenAt: null, consentVersion: null });

      expect(
        await errorCodeOf(() => answer(h, 'sess-1', { text: 'chest pain' })),
      ).toBe('CASE_SESSION_CONSENT_REQUIRED');
    });

    it('records the version beside the moment', async () => {
      const h = harness();
      h.repo.seedSession({ consentGivenAt: null, consentVersion: null });

      const result = (await h.service.recordConsent(
        'sess-1',
        { consentVersion: '2026.09.1', accepted: true },
        USER,
        PATIENT_ID,
      )) as { consent: { given: boolean; version: string } };

      expect(result.consent.given).toBe(true);
      expect(result.consent.version).toBe('2026.09.1');
    });

    it('abandons the session on a refusal rather than leaving it open', async () => {
      const h = harness();
      h.repo.seedSession({ consentGivenAt: null });

      await h.service.recordConsent(
        'sess-1',
        { consentVersion: '2026.09.1', accepted: false },
        USER,
        PATIENT_ID,
      );

      expect(h.repo.sessions.get('sess-1')!.status).toBe('abandoned');
    });
  });

  describe('the hot path', () => {
    /**
     * The assertion the whole design exists for: the next question is produced
     * by pure synchronous engine code, with no model anywhere in the path.
     */
    it('answers a known field without calling a model at all', async () => {
      const h = harness();
      h.repo.seedSession();

      const first = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      expect(first.nextQuestion).not.toBeNull();
      // The stub throws if either is touched, so reaching here is the proof.
      expect(h.llm.phraseQuestion).not.toHaveBeenCalled();
      expect(h.llm.extractFacts).not.toHaveBeenCalled();
    });

    /**
     * And when the model IS worth calling — an opening narrative belongs to no
     * single field — the response still does not depend on it. The stubbed
     * provider throws on every call, and the turn succeeds anyway.
     */
    it('answers even when the model call it queued blows up', async () => {
      const h = harness();
      h.repo.seedSession();

      const first = await answer(h, 'sess-1', { text: 'chest pain' });

      expect(first.extraction.queued).toBe(true);
      expect(first.nextQuestion).not.toBeNull();
      expect(first.accepted.fieldPath).toBeNull();
    });

    it('asks the chief complaint first, then unlocks the history', async () => {
      const h = harness();
      h.repo.seedSession();

      const opening = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      expect(opening.accepted.presence).toBe('recorded');
      // The HPI is gated on a known complaint, so it cannot be asked before it.
      expect(opening.nextQuestion?.section).toBe('hpi');
    });

    it('does not ask the same question twice in a row', async () => {
      const h = harness();
      h.repo.seedSession();

      const first = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const second = await answer(h, 'sess-1', {
        fieldPath: first.nextQuestion!.fieldPath,
        text: 'three days',
      });

      expect(second.nextQuestion?.fieldPath).not.toBe(
        first.nextQuestion?.fieldPath,
      );
    });

    it('files the answer against the last question asked when the client names none', async () => {
      const h = harness();
      h.repo.seedSession();

      const first = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const asked = first.nextQuestion!.fieldPath;

      const second = await answer(h, 'sess-1', { text: 'three days' });

      expect(second.accepted.fieldPath).toBe(asked);
    });

    it('refuses a field path the registry does not know', async () => {
      const h = harness();
      h.repo.seedSession();

      expect(
        await errorCodeOf(() =>
          answer(h, 'sess-1', {
            fieldPath: 'hpi.likely_cause',
            text: 'angina',
          }),
        ),
      ).toBe('CASE_FIELD_UNKNOWN');
    });
  });

  describe('"I don\'t know" is not "no"', () => {
    /**
     * The single most dangerous collapse this feature could make. A chart that
     * says "no known allergies" when nobody knows is not incomplete — it is
     * wrong, and wrong in the direction that gets somebody prescribed the drug
     * that kills them.
     */
    it('stores an uncertainty as unknown, never as an asserted none', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'allergies.reported',
        text: "I don't know",
      });

      expect(result.accepted.presence).toBe('unknown');
      const stored = h.repo.facts.find(
        (f) => f.fieldPath === 'allergies.reported',
      );
      expect(stored?.presence).toBe('unknown');
      expect(stored?.valueJson).toBeNull();
    });

    it('stores a tapped "not sure" the same way', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'allergies.reported',
        modality: 'choice',
        value: 'not_sure',
      });

      expect(result.accepted.presence).toBe('unknown');
    });

    it('still stores an actual "no" as an asserted none', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'allergies.reported',
        text: 'no',
      });

      // `none` is a real clinical statement — the patient said no — and is a
      // legitimate thing for a safety rule to key on.
      expect(result.accepted.presence).toBe('none');
    });

    it('never writes a row for a field nobody answered', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'hpi.severity',
        text: 'quite bad',
      });

      // "Quite bad" is not a 0-10 rating and not a named band. A rejected value
      // leaves the field askable rather than storing a measurement nobody made.
      expect(h.repo.facts.some((f) => f.fieldPath === 'hpi.severity')).toBe(
        false,
      );
    });

    it('reports which rule decided, so an odd reading can be argued with', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'allergies.reported',
        text: "I'm not sure",
      });

      expect(result.accepted.reason).toBe('uncertainty_phrase');
    });
  });

  describe('red flags', () => {
    /**
     * §29's worked example: chest pain + breathlessness + sweating. The rule
     * fires from the state, not from anything a model said about it.
     */
    it('fires the chest-pain screen and shows the patient no diagnosis', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.breathlessness',
        text: 'yes',
      });
      const result = await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.sweating',
        text: 'yes',
      });

      expect(result.redFlags).toHaveLength(1);
      expect(result.redFlags[0].severity).toBe('critical');
      expect(result.patientMessage).toMatch(/front desk/i);

      // The rule's own title names the symptom cluster and its clinician
      // summary names the syndrome. Neither crosses this boundary.
      const shown =
        JSON.stringify(result.redFlags) + String(result.patientMessage);
      expect(shown).not.toMatch(
        /ACS|cardiac|heart attack|angina|triad|diagnos/i,
      );
    });

    it('does not raise the same flag twice as the interview continues', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.breathlessness',
        text: 'yes',
      });
      await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.sweating',
        text: 'yes',
      });
      const later = await answer(h, 'sess-1', {
        fieldPath: 'hpi.duration',
        text: 'three days',
      });

      expect(later.redFlags).toHaveLength(0);
      expect(h.repo.redFlags).toHaveLength(1);
    });

    it('stores the message the patient was shown', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.breathlessness',
        text: 'yes',
      });
      await answer(h, 'sess-1', {
        fieldPath: 'hpi.associated.sweating',
        text: 'yes',
      });

      // Stored because it is what they read, and because it must never have
      // contained a diagnosis.
      expect(h.repo.redFlags[0].message).toMatch(/front desk/i);
      expect(h.repo.redFlags[0].ruleVersion).toBe(1);
    });
  });

  describe('background extraction', () => {
    it('does not queue a model call for a short answer', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      expect(result.extraction.queued).toBe(false);
      expect(result.extraction.reason).toMatch(/without a model/);
    });

    it('queues one for an answer longer than the question', async () => {
      const h = harness();
      h.repo.seedSession();
      h.llm.extractFacts = jest.fn(() =>
        Promise.resolve({
          facts: [],
          discardedPaths: [],
          model: 'gemma3:4b',
          latencyMs: 1,
          degraded: false,
          promptVersion: '2026.09.1',
        }),
      ) as never;

      const result = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'I have had chest pain for three days. It is worse when I walk up the stairs, and I do not know if I am allergic to anything.',
      });

      expect(result.extraction.queued).toBe(true);
      // Queued, not awaited: the response is already here.
      expect(result.nextQuestion).not.toBeNull();
    });

    /**
     * A long answer is derived WITHOUT the whole turn as the evidence span,
     * because judging one field against the whole turn finds the "I don't know"
     * that was meant for another. The engine says so by flagging the result.
     */
    it('flags a long answer for patient confirmation', async () => {
      const h = harness();
      h.repo.seedSession();
      h.llm.extractFacts = jest.fn(() =>
        Promise.resolve({
          facts: [],
          discardedPaths: [],
          model: 'gemma3:4b',
          latencyMs: 1,
          degraded: false,
          promptVersion: '2026.09.1',
        }),
      ) as never;

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const result = await answer(h, 'sess-1', {
        fieldPath: 'hpi.duration',
        text: 'It started about three days ago, I think on the Tuesday, but honestly I do not know if that is right because the days blur.',
      });

      expect(result.accepted.needsPatientConfirmation).toBe(true);
    });
  });

  describe('corrections', () => {
    /**
     * §35 and §32 together: the disagreement between what was first understood
     * and what the patient then said is the part a clinician needs. An
     * overwrite throws it away.
     */
    it('writes a new fact and points the old one at it', async () => {
      const h = harness();
      h.repo.seedSession();

      const turn = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const original = turn.accepted.factId!;

      const corrected = (await h.service.correctFact(
        'sess-1',
        original,
        { text: 'stomach pain' },
        USER,
        PATIENT_ID,
      )) as { factId: string; supersededFactId: string };

      const rows = h.repo.facts.filter(
        (f) => f.fieldPath === 'chief_complaint.symptom',
      );
      expect(rows).toHaveLength(2);
      expect(rows.find((f) => f.id === original)!.supersededById).toBe(
        corrected.factId,
      );
      expect(
        rows.find((f) => f.id === corrected.factId)!.supersededById,
      ).toBeNull();
      expect(corrected.supersededFactId).toBe(original);
    });

    it('attributes the correction to the patient correcting it', async () => {
      const h = harness();
      h.repo.seedSession();

      const turn = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const corrected = (await h.service.correctFact(
        'sess-1',
        turn.accepted.factId!,
        { text: 'stomach pain' },
        USER,
        PATIENT_ID,
      )) as { factId: string };

      const row = h.repo.facts.find((f) => f.id === corrected.factId)!;
      expect(row.sourceType).toBe('patient_correction');
      // A correction the patient made themselves is confirmed by them.
      expect(row.verification).toBe('patient_confirmed');
    });

    it('refuses to correct a fact that was already corrected', async () => {
      const h = harness();
      h.repo.seedSession();

      const turn = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      await h.service.correctFact(
        'sess-1',
        turn.accepted.factId!,
        { text: 'stomach pain' },
        USER,
        PATIENT_ID,
      );

      expect(
        await errorCodeOf(() =>
          h.service.correctFact(
            'sess-1',
            turn.accepted.factId!,
            { text: 'back pain' },
            USER,
            PATIENT_ID,
          ),
        ),
      ).toBe('CASE_FACT_ALREADY_SUPERSEDED');
    });

    it('leaves the original standing when the correction is unreadable', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const severity = await answer(h, 'sess-1', {
        fieldPath: 'hpi.severity',
        modality: 'choice',
        value: '7',
      });

      expect(
        await errorCodeOf(() =>
          h.service.correctFact(
            'sess-1',
            severity.accepted.factId!,
            { text: 'quite bad' },
            USER,
            PATIENT_ID,
          ),
        ),
      ).toBe('CASE_ANSWER_NOT_UNDERSTOOD');

      // A correction that landed as "not assessed" would turn a recorded answer
      // into a hole, so it is refused instead.
      const rows = h.repo.facts.filter((f) => f.fieldPath === 'hpi.severity');
      expect(rows).toHaveLength(1);
      expect(rows[0].valueJson).toBe(7);
    });
  });

  describe('review', () => {
    it('reads an unknown allergy back as unsure, never as "no known allergies"', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'allergies.reported',
        text: "I don't know",
      });

      const review = (await h.service.review('sess-1', USER, PATIENT_ID)) as {
        text: string;
        sections: {
          section: string;
          items: { fieldPath: string; display: string }[];
        }[];
      };

      const allergies = review.sections.find((s) => s.section === 'allergies')!;
      const item = allergies.items.find(
        (i) => i.fieldPath === 'allergies.reported',
      )!;
      expect(item.display).toBe('Patient unsure');
      expect(review.text).not.toMatch(/No known allergies/i);
    });

    it('does not call the model unless a narrative is asked for', async () => {
      const h = harness();
      h.repo.seedSession();

      await h.service.review('sess-1', USER, PATIENT_ID);

      expect(h.llm.draftReviewSummary).not.toHaveBeenCalled();
    });

    it('prints an unanswered question rather than omitting it', async () => {
      const h = harness();
      h.repo.seedSession();

      const review = (await h.service.review('sess-1', USER, PATIENT_ID)) as {
        text: string;
        missingInformation: string[];
      };

      // An omitted line reads as "nothing to report"; a printed one reads as
      // "we did not get to this", and those are different facts about the case.
      expect(review.text).toMatch(/Not assessed/);
      expect(review.missingInformation).toContain('allergies.reported');
    });
  });

  describe('submit', () => {
    it('writes the case and opens nothing', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      const result = (await h.service.submit('sess-1', USER, PATIENT_ID)) as {
        submissionId: string;
        structuredCase: { rulesetVersion: string; sections: unknown[] };
      };

      expect(result.submissionId).toBeDefined();
      expect(result.structuredCase.rulesetVersion).toBe('2026.09.1');
      expect(result.structuredCase.sections.length).toBeGreaterThan(0);

      // A submitted intake is a document waiting to be read, not an
      // appointment nobody booked.
      const written = h.repo.createSubmission.mock.calls[0][0];
      expect(written).not.toHaveProperty('consultationId');
      expect(written).not.toHaveProperty('queueId');
    });

    it('marks the session submitted', async () => {
      const h = harness();
      h.repo.seedSession();

      await h.service.submit('sess-1', USER, PATIENT_ID);

      expect(h.repo.sessions.get('sess-1')!.status).toBe('submitted');
    });

    it('refuses a second submission', async () => {
      const h = harness();
      h.repo.seedSession();
      h.repo.findSubmission = jest.fn(() =>
        Promise.resolve({ id: 'sub-1' }),
      ) as never;

      expect(
        await errorCodeOf(() => h.service.submit('sess-1', USER, PATIENT_ID)),
      ).toBe('CASE_SESSION_ALREADY_SUBMITTED');
    });

    it('refuses to submit without consent', async () => {
      const h = harness();
      h.repo.seedSession({ consentGivenAt: null });

      expect(
        await errorCodeOf(() => h.service.submit('sess-1', USER, PATIENT_ID)),
      ).toBe('CASE_SESSION_CONSENT_REQUIRED');
    });

    it('records the missing information rather than hiding it', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = (await h.service.submit('sess-1', USER, PATIENT_ID)) as {
        structuredCase: {
          missingInformation: string[];
          percentComplete: number;
        };
      };

      expect(result.structuredCase.missingInformation).toContain(
        'allergies.reported',
      );
      expect(result.structuredCase.percentComplete).toBeLessThan(100);
    });
  });

  describe('a session that is not yours', () => {
    it('is not found rather than forbidden', async () => {
      const h = harness();

      // Two distinguishable answers would make this route an existence oracle,
      // which is the hole `PatientSelfGuard` closes one level up.
      expect(
        await errorCodeOf(() =>
          h.service.getSession('someone-elses', USER, PATIENT_ID),
        ),
      ).toBe('CASE_SESSION_NOT_FOUND');
    });
  });
});

describe('ageBandFrom', () => {
  const yearsAgo = (years: number): Date =>
    new Date(Date.now() - years * 365.2425 * 24 * 60 * 60 * 1000);

  it.each([
    [0.5, 'infant'],
    [6, 'child'],
    [15, 'adolescent'],
    [36, 'adult'],
    [72, 'older_adult'],
  ])('reads %s years as %s', (years, expected) => {
    expect(ageBandFrom(yearsAgo(years))).toBe(expected);
  });

  it('returns nothing rather than a guess when there is no date of birth', () => {
    expect(ageBandFrom(null)).toBeNull();
    expect(ageBandFrom(new Date('not a date'))).toBeNull();
  });
});
