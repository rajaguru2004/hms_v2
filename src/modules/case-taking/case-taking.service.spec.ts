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
import { ENGLISH_ASIDE_REPLIES } from './engine/phrasebook';
import {
  INTERVIEW_LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
} from '../../common/constants/language.constants';
import { ALLOW_UNREVIEWED_PHRASEBOOKS_ENV } from './engine/phrasebook';

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

  /**
   * A row as the database holds one.
   *
   * `seedSession({ language: 'ta' })` seeds a *pre-split* row — the patient's
   * choice in the legacy column and nothing in the new ones — and then applies
   * the same backfill the migration applied, so the fake and the real table
   * agree about what an old Tamil session looks like. Passing `inputLanguage`
   * or `outputLanguage` explicitly overrides that.
   */
  seedSession(overrides: Partial<CaseSession> = {}): CaseSession {
    const language = overrides.language ?? 'en';
    const session = {
      id: 'sess-1',
      organizationId: 'org-1',
      patientId: PATIENT_ID,
      appointmentId: null,
      kind: 'new_consultation',
      language: 'en',
      inputLanguage: language,
      outputLanguage: 'en',
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
        inputLanguage: (data.inputLanguage as string) ?? 'en',
        outputLanguage: (data.outputLanguage as string) ?? 'en',
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

  /** Rows the clinician-facing reads answer from. Seeded per test. */
  submissions: Record<string, unknown>[] = [];

  listSubmissions = jest.fn(
    (
      where: { patientId?: string },
      options: { skip: number; take: number },
    ) => {
      const rows = this.submissions.filter(
        (row) => !where.patientId || row.patientId === where.patientId,
      );
      return Promise.resolve({
        rows: rows.slice(options.skip, options.skip + options.take),
        total: rows.length,
      });
    },
  );

  findSubmissionById = jest.fn((id: string) =>
    Promise.resolve(this.submissions.find((row) => row.id === id) ?? null),
  );

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
  /** Exposed so the voice tests can read what language actually reached it. */
  sidecar: jest.Mocked<Pick<SidecarClient, 'transcribe' | 'speak' | 'health'>>;
}

function harness(): Harness {
  const repo = new FakeRepository();
  const llm = strictLlm();
  const sidecar = {
    transcribe: jest.fn(),
    speak: jest.fn(),
    // Unreachable by default, which is the state the other tests run in and the
    // state the language catalogue has to survive.
    health: jest.fn(() => Promise.resolve(null)),
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
  return {
    service,
    repo,
    llm,
    sidecar: sidecar as unknown as jest.Mocked<
      Pick<SidecarClient, 'transcribe' | 'speak' | 'health'>
    >,
  };
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
     * An opening narrative belongs to no single field, which used to be the
     * case the model existed for: this turn queued `extractFacts` and the test
     * proved the response did not depend on it, by stubbing a provider that
     * throws on every call.
     *
     * There is nothing left to blow up. The provider is still strict — every
     * method throws — and the turn succeeds because nothing calls one.
     */
    it('answers an unattributed narrative with no model in the path', async () => {
      const h = harness();
      h.repo.seedSession();

      const first = await answer(h, 'sess-1', { text: 'chest pain' });

      expect(first.extraction.queued).toBe(false);
      expect(first.nextQuestion).not.toBeNull();
      expect(first.accepted.fieldPath).toBeNull();
      expect(h.llm.extractFacts).not.toHaveBeenCalled();
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
      // Answered in words the field can actually read. This used to say "three
      // days" against a boolean, which is a *failed* answer rather than an
      // answered question — and so tested the wrong thing: it passed because
      // the field was retired while still pending, which is the bug in
      // `awaiting_extraction` below rather than the behaviour named here.
      const second = await answer(h, 'sess-1', {
        fieldPath: first.nextQuestion!.fieldPath,
        text: 'no',
      });

      expect(second.accepted.presence).not.toBe('not_assessed');
      expect(second.nextQuestion?.fieldPath).not.toBe(
        first.nextQuestion?.fieldPath,
      );
    });

    /**
     * ─────────────────────────────────────────────────────────────────────
     * An answer the field cannot read puts the question back
     *
     * Measured on a live voice session, 2026-09-20 20:26-20:28. The patient
     * answered `allergies.reported` with something the field could not read;
     * the field had been marked pending when it was asked and nothing cleared
     * it, so `askableFields` skipped it, nothing else was askable, and the API
     * answered `interviewStatus: awaiting_extraction` with `nextQuestion:
     * null` — three turns running. The voice worker logged "engine returned
     * nothing to say" each time and said nothing at all. From the patient's
     * side the interview simply stopped.
     *
     * `pending` used to mean "gemma3:4b is reading this, do not ask again
     * while it works". Extraction is gone, so nothing was ever coming back to
     * clear it.
     * ─────────────────────────────────────────────────────────────────────
     */
    describe('an answer the field cannot read', () => {
      it('asks the question again rather than going quiet', async () => {
        const h = harness();
        h.repo.seedSession();

        const first = await answer(h, 'sess-1', {
          fieldPath: 'chief_complaint.symptom',
          text: 'chest pain',
        });
        const asked = first.nextQuestion!.fieldPath;

        const second = await answer(h, 'sess-1', {
          fieldPath: asked,
          // A duration against a yes/no question: readable as words, not as
          // this field's answer.
          text: 'three days',
        });

        expect(second.accepted.presence).toBe('not_assessed');
        expect(second.nextQuestion).not.toBeNull();
        expect(second.nextQuestion?.fieldPath).toBe(asked);
        expect(second.interviewStatus).toBe('ready');
      });

      it('never leaves the patient with no question and no reason', async () => {
        const h = harness();
        h.repo.seedSession();

        const first = await answer(h, 'sess-1', {
          fieldPath: 'chief_complaint.symptom',
          text: 'chest pain',
        });

        let asked = first.nextQuestion!.fieldPath;
        for (let attempt = 0; attempt < 6; attempt++) {
          const result = await answer(h, 'sess-1', {
            fieldPath: asked,
            text: 'three days',
          });
          // The failure being pinned is `nextQuestion: null` with the
          // interview neither finished nor waiting on anything real.
          expect(result.nextQuestion).not.toBeNull();
          asked = result.nextQuestion!.fieldPath;
        }
      });

      it('moves on rather than asking one question forever', async () => {
        const h = harness();
        h.repo.seedSession();

        const first = await answer(h, 'sess-1', {
          fieldPath: 'chief_complaint.symptom',
          text: 'chest pain',
        });
        const stuck = first.nextQuestion!.fieldPath;

        const asked: string[] = [];
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = await answer(h, 'sess-1', {
            fieldPath: stuck,
            text: 'three days',
          });
          asked.push(result.nextQuestion?.fieldPath ?? '(none)');
        }

        // MAX_ASKS_PER_FIELD is 3: the original plus two more goes at it. Past
        // that the field stays pending and the interview carries on, which is
        // what stops a recogniser that mangles everything from pinning the
        // patient to one sentence.
        expect(asked.filter((path) => path === stuck).length).toBeLessThan(5);
        expect(asked).toContain(stuck);
      });
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

    /**
     * The bug this whole path was built for, end to end.
     *
     * Observed in a real session: the interview asked about fever, the patient
     * said "Could he have been out?", and the interview moved on to the pain
     * scale. The fever answer was never collected and never asked for again —
     * `askNext` had marked the field pending, `askableFields` filters pending
     * fields out, and nothing ever put it back.
     */
    it('re-asks the question the patient interrupted instead of losing it', async () => {
      const h = harness();
      h.repo.seedSession();

      const opening = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const asked = opening.nextQuestion!.fieldPath;

      const interrupted = await answer(h, 'sess-1', {
        modality: 'voice',
        fieldPath: asked,
        text: 'why do you ask?',
      });

      expect(interrupted.aside?.intent).toBe('why_ask');
      expect(interrupted.nextQuestion?.fieldPath).toBe(asked);
      // Nothing was filed against the question, and nothing was sent to a model
      // to be filed later.
      expect(interrupted.accepted.fieldPath).toBeNull();
      expect(interrupted.accepted.factId).toBeNull();
      expect(interrupted.extraction.queued).toBe(false);

      // And the question is still answerable afterwards, which is the half the
      // old behaviour lost.
      const answered = await answer(h, 'sess-1', {
        fieldPath: asked,
        text: 'no',
      });
      expect(answered.accepted.fieldPath).toBe(asked);
      // `none` rather than `recorded`: the re-asked question was a yes/no one
      // and the patient said no, which is an asserted negative. What matters
      // here is that it is not `not_assessed` — the answer landed on the field
      // the interruption had been about.
      expect(answered.accepted.presence).toBe('none');
      expect(answered.nextQuestion?.fieldPath).not.toBe(asked);
    });

    it('says something back, from the phrasebook rather than a model', async () => {
      const h = harness();
      h.repo.seedSession();

      const interrupted = await answer(h, 'sess-1', {
        modality: 'voice',
        text: 'is it serious?',
      });

      expect(interrupted.aside?.intent).toBe('is_it_serious');
      expect(interrupted.aside?.reply).toBe(
        ENGLISH_ASIDE_REPLIES.is_it_serious,
      );
      expect(h.llm.extractFacts).not.toHaveBeenCalled();
    });

    it('reads an unrecognised question as an interruption once the field cannot', async () => {
      const h = harness();
      h.repo.seedSession();

      const opening = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      // No pattern covers this. It reaches the second stage only because the
      // field's own phrase lists could not read it either.
      const interrupted = await answer(h, 'sess-1', {
        modality: 'voice',
        fieldPath: opening.nextQuestion!.fieldPath,
        text: 'could he have been out?',
      });

      expect(interrupted.aside?.intent).toBe('unrelated');
      expect(interrupted.nextQuestion?.fieldPath).toBe(
        opening.nextQuestion!.fieldPath,
      );
    });

    /**
     * The failure this must never produce, stated as a test rather than as a
     * comment: an interruption is cheap to miss and expensive to invent.
     */
    it('never reads a tapped choice as an interruption', async () => {
      const h = harness();
      h.repo.seedSession();

      const opening = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });

      const tapped = await answer(h, 'sess-1', {
        modality: 'choice',
        fieldPath: opening.nextQuestion!.fieldPath,
        // A choice token that means "I do not know" — a statement about the
        // patient's knowledge, and an answer. Not a question.
        value: 'not_sure',
      });

      expect(tapped.aside).toBeNull();
      expect(tapped.accepted.fieldPath).toBe(opening.nextQuestion!.fieldPath);
    });

    it("keeps the complaint when it is a question about the patient's own body", async () => {
      const h = harness();
      h.repo.seedSession();

      // A free-text field is exempt from the second stage precisely so this
      // sentence is written down rather than answered with "I can only take
      // down your answers".
      const opening = await answer(h, 'sess-1', {
        modality: 'voice',
        fieldPath: 'chief_complaint.symptom',
        text: 'why does my chest hurt so much',
      });

      expect(opening.aside).toBeNull();
      expect(opening.accepted.fieldPath).toBe('chief_complaint.symptom');
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

  describe('reading the rest of what the patient said', () => {
    /**
     * The measured case this whole path exists for, and the one that used to
     * cost eight to twenty seconds of gemma3:4b.
     *
     * A patient answering the chief complaint volunteers a duration, a timing
     * and a denial in the same breath. All four facts are on the chart before
     * the response is built — which the background model could not do, and
     * which is why the interview then asked about the three days it had just
     * been told.
     */
    it('files the duration, timing and denial volunteered with the complaint', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain for three days, it comes and goes, no fever',
      });

      const filed = (path: string) =>
        h.repo.facts.find((f) => f.fieldPath === path);

      expect(filed('chief_complaint.symptom')?.presence).toBe('recorded');
      expect(filed('hpi.duration')?.presence).toBe('recorded');
      expect(filed('hpi.timing')?.valueJson).toBe('comes_and_goes');
      // "no fever" is a denial, and a denial is `none` — not a recorded false.
      expect(filed('hpi.associated.fever')?.presence).toBe('none');
      // And no model was anywhere near it.
      expect(h.llm.extractFacts).not.toHaveBeenCalled();
    });

    it('does not ask again about what it has just been told', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain for three days, it comes and goes',
      });

      // The selector runs AFTER the harvest, so the duration it just filed is
      // not askable any more. Under the old background extraction the facts
      // landed minutes later and this question was asked anyway.
      expect(result.nextQuestion?.fieldPath).not.toBe('hpi.duration');
      expect(result.nextQuestion?.fieldPath).not.toBe('hpi.timing');
    });

    it('reads a Tamil narrative the same way', async () => {
      const h = harness();
      h.repo.seedSession({ language: 'ta' });

      await answer(h, 'sess-1', {
        modality: 'voice',
        fieldPath: 'chief_complaint.symptom',
        text: 'நெஞ்சு வலி மூணு நாளா இருக்கு',
      });

      const duration = h.repo.facts.find((f) => f.fieldPath === 'hpi.duration');
      expect(duration?.presence).toBe('recorded');
      expect(h.llm.extractFacts).not.toHaveBeenCalled();
    });

    /**
     * The eager slot filling that was measured coming out of the model:
     * `hpi.radiation: "when I walk"`, which is an aggravating factor and not a
     * radiation. A vocabulary lookup cannot make that mistake, because it only
     * claims what it can look up — and `text` fields are never harvested at all.
     */
    it('never slot-fills a free-text field from a narrative', async () => {
      const h = harness();
      h.repo.seedSession();

      await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain, worse when I walk up the stairs',
      });

      expect(
        h.repo.facts.find((f) => f.fieldPath === 'hpi.radiation'),
      ).toBeUndefined();
      expect(
        h.repo.facts.find((f) => f.fieldPath === 'hpi.location'),
      ).toBeUndefined();
    });

    it('reads nothing extra out of a tapped choice', async () => {
      const h = harness();
      h.repo.seedSession();

      const opening = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'chest pain',
      });
      const before = h.repo.facts.length;

      await answer(h, 'sess-1', {
        modality: 'choice',
        fieldPath: opening.nextQuestion!.fieldPath,
        value: 'not_sure',
      });

      // Exactly one new fact: the one the button answered.
      expect(h.repo.facts.length).toBe(before + 1);
    });

    it('says nothing is queued, because nothing is read later any more', async () => {
      const h = harness();
      h.repo.seedSession();

      const result = await answer(h, 'sess-1', {
        fieldPath: 'chief_complaint.symptom',
        text: 'I have had chest pain for three days. It is worse when I walk up the stairs, and I do not know if I am allergic to anything.',
      });

      expect(result.extraction.queued).toBe(false);
      expect(result.nextQuestion).not.toBeNull();
    });

    /**
     * A long answer is still derived WITHOUT the whole turn as the evidence
     * span for the asked field, because judging one field against the whole
     * turn finds the "I don't know" that was meant for another.
     */
    it('flags a long answer for patient confirmation', async () => {
      const h = harness();
      h.repo.seedSession();

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

  describe('the language a session is stored with', () => {
    it('is reduced to its primary subtag, because a phone sends a region tag', async () => {
      const h = harness();
      await h.service.startOrResume({ language: 'ta-IN' }, USER, PATIENT_ID);
      expect([...h.repo.sessions.values()][0].language).toBe('ta');
    });

    it('is English when none was asked for', async () => {
      const h = harness();
      await h.service.startOrResume({}, USER, PATIENT_ID);
      expect([...h.repo.sessions.values()][0].language).toBe('en');
    });

    /**
     * The split, at the row. What the patient picked is their INPUT language —
     * it decides how their speech is transcribed and nothing else — and what
     * they read and hear is English, on every session, because that is the
     * product decision `DEFAULT_OUTPUT_LANGUAGE` records.
     */
    it("stores the patient's choice as the input language and English as the output", async () => {
      const h = harness();

      await h.service.startOrResume({ language: 'ta' }, USER, PATIENT_ID);

      expect(h.repo.create.mock.calls[0][0]).toMatchObject({
        inputLanguage: 'ta',
        outputLanguage: 'en',
      });
    });

    /** The legacy column is kept in step, so a pre-split reader still works. */
    it('keeps the old `language` column equal to the input language', async () => {
      const h = harness();

      await h.service.startOrResume({ language: 'bn' }, USER, PATIENT_ID);

      const written = h.repo.create.mock.calls[0][0];
      expect(written.language).toBe('bn');
      expect(written.language).toBe(written.inputLanguage);
    });

    /**
     * Neither language is a field the client may send: `language` is the input
     * one under its old name, and the output one is this service's decision. A
     * body that names either of the new fields is refused by
     * `forbidNonWhitelisted` at the pipe, and would be ignored here anyway.
     */
    it('ignores the new language fields if a client sends them', async () => {
      const h = harness();

      await h.service.startOrResume(
        { language: 'ta', inputLanguage: 'hi', outputLanguage: 'ta' } as Record<
          string,
          string
        >,
        USER,
        PATIENT_ID,
      );

      expect(h.repo.create.mock.calls[0][0]).toMatchObject({
        inputLanguage: 'ta',
        outputLanguage: 'en',
      });
    });

    /** What the client renders: three fields, and two of them say a direction. */
    it('reports both languages on the session view', async () => {
      const h = harness();

      const view = await h.service.startOrResume(
        { language: 'ta' },
        USER,
        PATIENT_ID,
      );

      expect(view).toMatchObject({
        language: 'ta',
        inputLanguage: 'ta',
        outputLanguage: 'en',
      });
    });

    /**
     * The point of the whole change, asserted where a patient would notice it:
     * a Tamil interview asks its questions in English.
     */
    it('asks a Tamil session its questions in English', async () => {
      const h = harness();

      const view = await h.service.startOrResume(
        { language: 'ta' },
        USER,
        PATIENT_ID,
      );
      const question = view.currentQuestion as { prompt: string } | null;

      expect(question).not.toBeNull();
      // ASCII-only is the cheap, honest test for "this is the English wording":
      // every phrasebook this could have come from is in a non-Latin script.
      expect(question!.prompt).toMatch(/^[ -~]+$/);
    });

    /**
     * A session started before the split has the patient's choice in the legacy
     * column and, in a restored dump, nothing in the new one. It still reaches
     * the recogniser as Tamil rather than as a confident English guess.
     */
    it("reads a pre-split row's `language` as its input language", async () => {
      const h = harness();
      h.repo.seedSession({ language: 'ta', inputLanguage: '' });
      h.sidecar.transcribe.mockResolvedValue({
        text: 'three days',
        confidence: 0.9,
        language: 'ta',
        segments: [],
        durationMs: 1000,
      });

      await h.service.transcribe(
        {
          buffer: Buffer.from('wav'),
          originalname: 'a.wav',
          mimetype: 'audio/wav',
        },
        { sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'ta',
      });
    });
  });

  describe('the language catalogue', () => {
    /** Just enough of a health reply for the fields the catalogue reads. */
    function healthWith(
      languages: Record<string, { stt: boolean; tts: boolean }>,
    ): Awaited<ReturnType<SidecarClient['health']>> {
      return {
        ollama: true,
        ollamaModels: [],
        stt: true,
        tts: true,
        ocr: true,
        sttLanguages: [],
        ttsLanguages: [],
        ttsProviders: [],
        languages: Object.fromEntries(
          Object.entries(languages).map(([code, row]) => [
            code,
            { ...row, provider: row.tts ? 'indicf5' : null },
          ]),
        ),
      };
    }

    /**
     * Three rows, not twelve. The catalogue is the languages the *interview*
     * exists in — questions translated, answers readable with no model, a voice
     * on disk — and not the languages the recogniser happens to hear. Offering
     * Bengali would give a patient Bengali speech recognition and an English
     * interview, which reads as broken.
     */
    /**
     * The review gate, opened for the rows that need it.
     *
     * Tamil and Hindi ship with `reviewedAt: null` — nobody who reads them has
     * signed the clinical wording off — so on a default deployment
     * `interviewLanguageFor` answers English for both and the catalogue says
     * so. That is the shipped behaviour and it is tested below too; these cases
     * are about what the catalogue reports once a deployment has opted in.
     */
    // `async`, and it has to be: a synchronous version returns the promise and
    // runs its `finally` immediately, restoring the variable before the body it
    // was opened for has got past its first await. The catalogue then reads the
    // gate as shut and the test fails for a reason that has nothing to do with
    // what it is testing.
    async function withGateOpen<T>(body: () => Promise<T>): Promise<T> {
      const before = process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
      process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = 'true';
      try {
        return await body();
      } finally {
        if (before === undefined) {
          delete process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV];
        } else {
          process.env[ALLOW_UNREVIEWED_PHRASEBOOKS_ENV] = before;
        }
      }
    }

    it('offers the languages the interview exists in, in display order', async () => {
      const catalogue = await harness().service.languages();

      expect(catalogue.default).toBe('en');
      expect(catalogue.languages.map((l) => l.code)).toEqual([
        'en',
        'hi',
        'ta',
      ]);
      expect(catalogue.languages[0].code).toBe('en');
    });

    /**
     * The picker still works when the speech service is down. Refusing to list
     * any languages because a health probe timed out would be worse than
     * listing a microphone that then refuses with a written sentence.
     */
    it('falls back to the static flags when the sidecar cannot be reached', async () => {
      const catalogue = await harness().service.languages();

      expect(catalogue.source).toBe('catalogue');
      expect(
        catalogue.languages.find((language) => language.code === 'ta'),
      ).toMatchObject({ nativeName: 'தமிழ்', stt: true, tts: true });
    });

    /**
     * The sidecar holds the weights, so it is the authority on what can
     * actually be spoken. Nine of the eleven have no voice on a given box, and
     * a picker that offered a speaker for all of them would play silence.
     */
    it('prefers what the sidecar reports over what the table hopes', async () => {
      const h = harness();
      h.sidecar.health.mockResolvedValue(
        healthWith({
          en: { stt: true, tts: true },
          ta: { stt: true, tts: false },
          or: { stt: false, tts: false },
        }),
      );

      const catalogue = await h.service.languages();
      const by = (code: string) =>
        catalogue.languages.find((language) => language.code === code);

      expect(catalogue.source).toBe('sidecar');
      // The table says Tamil has a voice; this box says it does not, and the
      // box is the one holding the weights.
      expect(by('ta')).toMatchObject({ stt: true, tts: false });
      // Odia is not offered at all, so there is no row to disagree about.
      expect(by('or')).toBeUndefined();
    });

    /**
     * `outputLanguage` used to be `en` on every row, because the interview was.
     * It follows the patient now — so a Tamil row says Tamil, and `outputTts`
     * is about the **Tamil** voice rather than the English one.
     */
    it('says what language each row is answered in, and whether it can be heard', async () => {
      const h = harness();
      h.sidecar.health.mockResolvedValue(
        healthWith({
          en: { stt: true, tts: true },
          ta: { stt: true, tts: false },
        }),
      );

      const catalogue = await withGateOpen(() => h.service.languages());
      const tamil = catalogue.languages.find((l) => l.code === 'ta');

      expect(tamil).toMatchObject({
        stt: true,
        // No Tamil voice on this box...
        tts: false,
        // ...and the interview is in Tamil, so there is nothing to read it
        // aloud with. The speaker button belongs off for this row.
        outputLanguage: 'ta',
        outputTts: false,
      });
    });

    /**
     * A row whose questions are NOT translated is still answered in English, so
     * it is the English voice that decides its speaker button. That is the case
     * the per-row output language exists to tell apart from the one above.
     */
    it('reports the English voice for a row the interview cannot be held in', async () => {
      const h = harness();
      h.sidecar.health.mockResolvedValue(
        healthWith({
          en: { stt: true, tts: false },
          ta: { stt: true, tts: true },
        }),
      );

      const catalogue = await withGateOpen(() => h.service.languages());

      // Tamil's own voice is installed and Tamil is what it is answered in.
      expect(catalogue.languages.find((l) => l.code === 'ta')).toMatchObject({
        tts: true,
        outputLanguage: 'ta',
        outputTts: true,
      });
      // English has no voice here, and English is what English is answered in.
      expect(catalogue.languages.find((l) => l.code === 'en')).toMatchObject({
        outputLanguage: 'en',
        outputTts: false,
      });
    });

    /**
     * The shipped default, and the reason the two tests above have to open a
     * gate to see anything else: nobody has signed the Tamil or Hindi wording
     * off, so `phrasebookFor` refuses both books and every row is answered in
     * English. A deployment opts in with
     * `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS`, and a clinician who reads the
     * language retires the flag by putting a date on `reviewedAt`.
     */
    it('answers in English until somebody has signed the translation off', async () => {
      const h = harness();
      h.sidecar.health.mockResolvedValue(
        healthWith({
          en: { stt: true, tts: true },
          ta: { stt: true, tts: true },
        }),
      );

      const catalogue = await h.service.languages();

      expect(catalogue.languages.find((l) => l.code === 'ta')).toMatchObject({
        // Tamil speech in, Tamil voice on the box...
        stt: true,
        tts: true,
        // ...and an English interview, because the gate is shut.
        outputLanguage: 'en',
        questions: 'none',
      });
    });

    /**
     * Odia is the row the two-flag design was written for — a voice, and no
     * recogniser anywhere. It is not offered today because its questions are
     * not translated, but the honesty it forced is still in the table and is
     * still what the picker would report if it came back.
     */
    it('keeps Odia in the catalogue table even though it is not offered', () => {
      const odia = SUPPORTED_LANGUAGES.find((l) => l.code === 'or');
      expect(odia).toMatchObject({ stt: false, tts: true });
      expect(INTERVIEW_LANGUAGE_CODES).not.toContain('or');
    });

    /**
     * Silence about a language is not a yes. A row the sidecar did not mention
     * is one it cannot serve, and reverting to the optimistic table for it
     * would put the button back.
     */
    it('reads an unmentioned language as unavailable, not as the table says', async () => {
      const h = harness();
      h.sidecar.health.mockResolvedValue(
        healthWith({ en: { stt: true, tts: true } }),
      );

      const catalogue = await h.service.languages();
      expect(
        catalogue.languages.find((language) => language.code === 'hi'),
      ).toMatchObject({ stt: false, tts: false });
    });
  });

  /**
   * The routes that used to let the phone decide what language the patient
   * speaks. The session is the authority now — it is what the patient chose,
   * what the rest of the interview runs on, and what the clinician sees.
   */
  describe('voice, and whose language wins', () => {
    const speech = {
      buffer: Buffer.from('wav'),
      originalname: 'a.wav',
      mimetype: 'audio/wav',
    };

    function transcript(): Record<string, unknown> {
      return {
        text: 'three days',
        confidence: 0.9,
        language: 'ta',
        segments: [],
        durationMs: 1000,
      };
    }

    it("prefers the session's language over the body's", async () => {
      const h = harness();
      h.repo.seedSession({ language: 'ta' });
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await h.service.transcribe(
        speech,
        { language: 'en', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'ta',
      });
    });

    it('falls back to the body when no session was named', async () => {
      const h = harness();
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await h.service.transcribe(speech, { language: 'hi' }, USER, PATIENT_ID);

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'hi',
      });
    });

    /**
     * Measured: naming the language cuts warm transcription from 3.857 s to
     * 2.073 s for identical text. Detection is the fallback, not the goal.
     */
    it('names the language whenever it knows one', async () => {
      const h = harness();
      h.repo.seedSession({ language: 'bn' });
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await h.service.transcribe(
        speech,
        { sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'bn',
      });
    });

    it('detects when it knows nothing, rather than guessing English', async () => {
      const h = harness();
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await h.service.transcribe(speech, {}, USER, PATIENT_ID);

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: undefined,
      });
    });

    /**
     * The asymmetry, at the one place it can hurt somebody.
     *
     * This test used to assert that an Odia session sent `language: undefined`
     * and let the recogniser detect. It passed, and the behaviour it described
     * was the bug: `undefined` is "detect", not "refuse", and detection on a
     * language Whisper has no model for returns somebody else's language at
     * HTTP 200. Measured against the running stack, an Odia session's `/stt`
     * answered `{"text":"I have had chest pain for three days.",
     * "confidence":0.7829,"language":"en"}`.
     *
     * So the assertion is inverted: the recording is refused in writing and
     * the recogniser is never called at all.
     */
    it('refuses an Odia session in writing rather than letting the recogniser guess', async () => {
      const h = harness();
      h.repo.seedSession({ language: 'or' });
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await expect(
        h.service.transcribe(speech, { sessionId: 'sess-1' }, USER, PATIENT_ID),
      ).rejects.toThrow(
        /We cannot listen in Odia yet\. Please type your answer\./,
      );

      expect(h.sidecar.transcribe).not.toHaveBeenCalled();
    });

    /**
     * The half of the split that changed behaviour. A Tamil session is
     * transcribed as Tamil and read aloud in English, because what the patient
     * reads and hears is the OUTPUT language and the output language is English
     * on every session. Before the split this was one column and the answer had
     * to be `ta` for both.
     */
    it("reads aloud in the session's OUTPUT language, which is English", async () => {
      const h = harness();
      h.repo.seedSession({ language: 'ta' });
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      await h.service.speak(
        { text: 'How long?', language: 'ta', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.speak).toHaveBeenCalledWith('How long?', 'en');
    });

    /**
     * And the other half, side by side, so the asymmetry is one assertion and
     * not an inference across two files: the same session, the same request,
     * two different languages, each going where it belongs.
     */
    it('sends the input language to the recogniser and the output language to the voice', async () => {
      const h = harness();
      h.repo.seedSession({ inputLanguage: 'ta', outputLanguage: 'en' });
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      await h.service.transcribe(
        speech,
        { sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );
      await h.service.speak(
        { text: 'How long?', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'ta',
      });
      expect(h.sidecar.speak).toHaveBeenCalledWith('How long?', 'en');
    });

    /**
     * The output language is this service's decision, not the handset's. A
     * phone that could override it is a phone that can put an unreviewed
     * clinical translation in front of a patient.
     */
    it('does not let the request body override the output language', async () => {
      const h = harness();
      h.repo.seedSession({ inputLanguage: 'ta', outputLanguage: 'en' });
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      await h.service.speak(
        { text: 'How long?', language: 'hi', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.speak).toHaveBeenCalledWith('How long?', 'en');
    });

    it('reads aloud in English when nobody said otherwise', async () => {
      const h = harness();
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      await h.service.speak({ text: 'How long?' }, USER, PATIENT_ID);

      expect(h.sidecar.speak).toHaveBeenCalledWith('How long?', 'en');
    });

    /**
     * Naming a session scopes the call, which these two routes previously were
     * not at all: somebody else's session id is not found rather than a way to
     * learn what language they speak.
     */
    it("is not found when the session is somebody else's", async () => {
      const h = harness();
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      expect(
        await errorCodeOf(() =>
          h.service.speak(
            { text: 'hello', sessionId: 'not-yours' },
            USER,
            PATIENT_ID,
          ),
        ),
      ).toBe('CASE_SESSION_NOT_FOUND');
    });

    /**
     * A row written before the table existed can hold anything — the column was
     * a free sixteen-character string. For the INPUT direction it degrades to
     * what the caller asked for, never to a confident English transcription of
     * Tamil speech: a wrong transcript becomes a clinical fact, and the body at
     * least carries something the client believes.
     */
    it('ignores a stored input language that is not one we support', async () => {
      const h = harness();
      h.repo.seedSession({ language: 'klingon', inputLanguage: 'klingon' });
      h.sidecar.transcribe.mockResolvedValue(transcript() as never);

      await h.service.transcribe(
        speech,
        { language: 'hi', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.transcribe.mock.calls[0][1]).toMatchObject({
        language: 'hi',
      });
    });

    /**
     * The OUTPUT direction degrades the other way, and deliberately so: what the
     * patient hears is a decision this service makes, so an unreadable column
     * falls back to the decision rather than to whatever the handset sent.
     */
    it('falls back to English, not to the body, for an unreadable output language', async () => {
      const h = harness();
      h.repo.seedSession({ outputLanguage: 'klingon' });
      h.sidecar.speak.mockResolvedValue(Buffer.from('audio'));

      await h.service.speak(
        { text: 'hello', language: 'hi', sessionId: 'sess-1' },
        USER,
        PATIENT_ID,
      );

      expect(h.sidecar.speak).toHaveBeenCalledWith('hello', 'en');
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

/**
 * The clinician's side: reading an intake somebody else wrote.
 *
 * Everything above this point is the patient having the interview. These are
 * the two reads a doctor makes afterwards, and what they are careful about is
 * the opposite thing: not what may be written, but what may be *seen*.
 */
describe('reading submitted intakes', () => {
  const DOCTOR: AuthenticatedUser = {
    id: 'user-9',
    email: 'a.okonkwo@hms.local',
    organizationId: 'org-1',
    roles: ['DOCTOR'],
  } as AuthenticatedUser;

  /** A stored document of the shape `submit()` writes. */
  const storedCase = (overrides: Record<string, unknown> = {}) => ({
    rulesetVersion: '2026.09.1',
    consentVersion: 'v1',
    language: 'ta',
    inputLanguage: 'ta',
    outputLanguage: 'en',
    renderedAt: '2026-09-20T08:00:00.000Z',
    percentComplete: 80,
    missingInformation: ['hpi.radiation'],
    sections: [{ section: 'chief_complaint', title: 'What brought you in' }],
    safety: {
      rulesetVersion: '2026.09.1',
      highestSeverity: 'urgent',
      // `TriggeredRule`'s own keys — see `safety-engine.ts`. `{ id, title }`
      // is a shape this API never sends, and a fixture that invents one lets
      // a client be written against the invention: the Flutter model read
      // `id`/`rationale`/`action` for a wire that says
      // `ruleId`/`clinicianSummary`/`recommendedAction`, and both tiers
      // agreed with each other while neither agreed with the server.
      triggered: [
        {
          ruleId: 'chest_pain_acs',
          ruleVersion: 1,
          severity: 'urgent',
          title: 'Possible acute coronary syndrome',
          patientMessage: 'Please tell the desk you are here.',
          clinicianSummary: 'Meets the ACS screening triad.',
          recommendedAction: 'Assess before the routine queue.',
          matched: [],
        },
      ],
    },
    text: 'Chief Complaint\n  Main concern: chest pain',
    ...overrides,
  });

  const row = (
    id: string,
    patientId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    sessionId: `sess-${id}`,
    patientId,
    organizationId: 'org-1',
    submittedAt: new Date('2026-09-20T08:05:00.000Z'),
    structuredCase: storedCase(overrides),
    patient: {
      id: patientId,
      mrn: '10421',
      firstName: 'Ifeoma',
      lastName: 'Balogun',
      dateOfBirth: new Date('1991-04-12'),
      gender: 'Female',
    },
  });

  it('lists intakes with the header a clinician scans by', async () => {
    const h = harness();
    h.repo.submissions = [row('sub-1', 'pat-1'), row('sub-2', 'pat-2')];

    const page = await h.service.listSubmissions({}, DOCTOR);

    expect(page.meta.total).toBe(2);
    const first = page.data[0];
    expect(first.highestSeverity).toBe('urgent');
    expect(first.triggeredCount).toBe(1);
    // Both languages, because one cannot say that a Tamil speaker was
    // answered in English.
    expect(first.inputLanguage).toBe('ta');
    expect(first.outputLanguage).toBe('en');
    // A row has a count and not the rules: there is no room on a list line
    // for a rule, and a half-quoted one is worse than "open this".
    expect(first).not.toHaveProperty('safety');
    expect(first).not.toHaveProperty('sections');
  });

  it('filters to one chart when a patient is named', async () => {
    const h = harness();
    h.repo.submissions = [row('sub-1', 'pat-1'), row('sub-2', 'pat-2')];

    const page = await h.service.listSubmissions(
      { patientId: 'pat-2' },
      DOCTOR,
    );

    expect(page.data).toHaveLength(1);
    expect(page.data[0].patientId).toBe('pat-2');
  });

  it('shows the clinician which rules fired', async () => {
    const h = harness();
    h.repo.submissions = [row('sub-1', 'pat-1')];

    const full = await h.service.readSubmission('sub-1', DOCTOR);
    const safety = full.safety as { triggered: unknown[] };

    // The difference from the patient's own view of the same case. §43 keeps a
    // rule set's titles off a *patient's* screen because they name syndromes;
    // withholding them from the clinician deciding what to do would be the
    // inverse mistake.
    expect(safety.triggered).toHaveLength(1);
    expect(full.text).toContain('chest pain');
    expect(full.sections).toHaveLength(1);
  });

  it('answers from the stored document rather than re-rendering', async () => {
    const h = harness();
    // A session that has moved on since it was sent: the stored case says 80%
    // and two sections were added to the live state afterwards. What the
    // doctor opened must stay what the patient sent.
    h.repo.seedSession();
    h.repo.submissions = [row('sub-1', 'pat-1', { percentComplete: 80 })];

    const full = await h.service.readSubmission('sub-1', DOCTOR);

    expect(full.percentComplete).toBe(80);
    expect(h.repo.listCurrentFacts).not.toHaveBeenCalled();
  });

  it("answers not-found for another patient's intake", async () => {
    const h = harness();
    h.repo.submissions = [row('sub-2', 'pat-2')];

    // A patient caller, scoped to themselves. Not-found rather than forbidden:
    // a 403 on an id that exists and a 404 on one that does not are different
    // answers, and the difference enumerates the register.
    expect(
      await errorCodeOf(() => h.service.readSubmission('sub-2', USER, 'pat-1')),
    ).toBe('CASE_SESSION_NOT_FOUND');
  });

  it('opens a document an older build wrote', async () => {
    const h = harness();
    // A case rendered before the language split, with no safety block at all.
    // It must open as the parts this build can read: the alternative is an
    // error where a patient's own account of their symptoms should be.
    h.repo.submissions = [
      {
        ...row('sub-old', 'pat-1'),
        structuredCase: {
          sections: [],
          text: 'Chief Complaint',
          language: 'hi',
        },
      },
    ];

    const full = await h.service.readSubmission('sub-old', DOCTOR);

    expect(full.percentComplete).toBe(0);
    expect((full.safety as { highestSeverity: string }).highestSeverity).toBe(
      'none',
    );
    expect(full.inputLanguage).toBe('hi');
  });
});
