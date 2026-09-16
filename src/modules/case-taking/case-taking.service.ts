import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  CaseFact,
  CaseRedFlag,
  CaseSession,
  CaseTurn,
  Prisma,
} from '@prisma/client';
import { CaseTakingRepository } from './case-taking.repository';
import { FactRowData, rebuildState, rowDataFromFact } from './case-state';
import {
  CaseConsentDto,
  CorrectFactDto,
  SpeakDto,
  StartCaseSessionDto,
  SubmitTurnDto,
  TranscribeDto,
} from './dto/case-taking.dto';
import { LanguageCatalogueDto } from './dto/language.dto';
import { VoiceGrantDto, VoiceTokenDto } from './dto/voice-token.dto';
import {
  ClinicalState,
  applyFact,
  expirePending,
  markAsked,
  readFactAt,
  sectionOf,
} from './engine/clinical-state';
import {
  FieldDefinition,
  applicableFields,
  fieldsFor,
  findField,
  valueSpecFor,
} from './engine/field-registry';
import {
  compareFields,
  fallbackPhrasing,
  interviewProgress,
  interviewStatus,
  outstandingFields,
  selectNext,
} from './engine/question-selector';
import {
  PHRASEBOOKS,
  PhrasebookSource,
  phrasebookFor,
} from './engine/phrasebook';
import { evaluate, SafetyAssessment } from './engine/safety-engine';
import { RULESET_VERSION } from './engine/safety-rules';
import {
  RenderedCase,
  renderCase,
  renderCaseText,
} from './engine/case-renderer';
import {
  AnswerInput,
  AnswerModality,
  ANSWER_MODALITIES,
  FactProvenance,
  FactSource,
  PresenceDerivation,
  factFromAnswer,
  presenceLabel,
} from './engine/tri-state';
import { LLM_PROVIDER, LlmProvider } from '../ai/llm-provider.interface';
import {
  TRANSLATION_PROVIDER,
  TranslationProvider,
} from '../ai/translation-provider.interface';
import { SidecarClient, SidecarUnavailableError } from '../ai/sidecar.client';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions/app.exception';
import { ErrorCode, ErrorCodes } from '../../common/exceptions/error-codes';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/types/jwt-payload.type';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_OUTPUT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  findLanguage,
  isNonEnglishScript,
  normaliseLanguage,
  sttLanguageFor,
} from '../../common/constants/language.constants';

/**
 * The interview.
 *
 * ── The one design decision everything else follows from
 *
 * `gemma3:4b` on this hardware gets 38% GPU offload and runs at ten to twenty
 * tokens a second: eight seconds for a short extraction, twenty for a long one,
 * seventy-four to load cold. A patient cannot wait that long between answering
 * a question and seeing the next one — not once, and certainly not sixty times.
 *
 * So the model is never on the path between an answer and the next question.
 * `POST /turns` is answered by three pure, synchronous things: `derivePresence`
 * turns the patient's words into a presence, `evaluate` runs the safety rules
 * over the new state, and `selectNext` picks what to ask next. All three are
 * deterministic functions of the state, all three are in the engine, and none
 * of them has ever seen a model. The measured handler time is a few
 * milliseconds plus the database round trips.
 *
 * ── Where the model does run, and how it lands
 *
 * Extraction is only interesting for free text that answers more than the
 * question asked — the opening "tell me what's wrong", or a duration answered
 * with a paragraph. Those go to `extractInBackground`, which is fire-and-forget
 * and writes `CaseFact` rows when it finishes, minutes later if need be. Two
 * properties make that safe rather than merely fast:
 *
 *   • Facts are append-only rows, so a background write cannot clobber a
 *     foreground one — there is no shared document to race over.
 *   • `ClinicalState.pending` keeps the selector from re-asking a question
 *     whose answer is still being parsed, and `expirePending` releases it if
 *     the extraction never comes back, so a lost job costs a repeated question
 *     rather than a permanent hole in the chart.
 *
 * A short answer never goes near the model at all. "Three days", "no", "8",
 * "I don't know" are all handled by the engine's phrase lists and field-shape
 * validation, which is both faster and more trustworthy than asking a 4B model
 * to agree.
 */

/**
 * Above this, or across a sentence boundary, an answer is treated as a
 * narrative rather than a reply.
 *
 * The distinction decides whether the whole utterance may serve as the evidence
 * span for the field that was asked. For "three days" it obviously may — the
 * utterance *is* the evidence. For "I've had chest pain for three days and I
 * don't know if I'm allergic to anything" it must not, because judging the
 * duration against the whole turn finds the "I don't know" that was meant for
 * the allergies. Long answers are derived without a span, which the engine
 * handles conservatively and flags `needsPatientConfirmation`, and are sent to
 * the model to be split into properly attributed spans.
 */
const SHORT_ANSWER_CHARS = 120;

/** How many fields the extraction prompt offers. The menu is sorted by ask order. */
const EXTRACTION_MENU_SIZE = 30;

/** The wording the patient agreed to. Bumped when the consent text changes. */
export const CONSENT_VERSION = '2026.09.1';

export interface NextQuestionView {
  fieldPath: string;
  section: string;
  label: string;
  kind: string;
  choices?: readonly string[];
  prompt: string;
  remaining: number;
}

/**
 * A red flag as the patient sees it.
 *
 * `title`, `clinicianSummary`, `recommendedAction` and `ruleId` are all absent,
 * and deliberately: §29 says this feature performs risk detection, never
 * diagnosis, and the rule set's own title for the chest-pain screen names the
 * symptom cluster while its clinician summary names the syndrome. The only text
 * that crosses this boundary is `patientMessage`, which is a routing
 * instruction — go and tell the front desk — and is checked at import time
 * against the diagnostic-language patterns.
 */
export interface PatientRedFlagView {
  id: string;
  severity: string;
  message: string;
  triggeredAt: Date;
}

export interface TurnResult {
  turnId: string;
  sessionId: string;
  accepted: {
    fieldPath: string | null;
    presence: string | null;
    value?: string | number | boolean;
    /** Which rule in `derivePresence` decided, so an odd reading can be argued with. */
    reason: string | null;
    needsPatientConfirmation: boolean;
    factId: string | null;
  };
  extraction: { queued: boolean; reason: string };
  nextQuestion: NextQuestionView | null;
  interviewStatus: string;
  progress: ReturnType<typeof interviewProgress>;
  redFlags: PatientRedFlagView[];
  /** The single message to put in front of the patient, from the most severe rule. */
  patientMessage: string | null;
  /** Server-side handler time. The number this whole design is built around. */
  serverTimeMs: number;
}

/**
 * How long a room pass is good for.
 *
 * Long enough to cover one interview including a patient who puts the phone
 * down to think, short enough that a leaked token is an expired token before
 * it is worth anything. The client asks for another when this runs out; that
 * costs one request and is invisible.
 */
const VOICE_TOKEN_TTL_SECONDS = 60 * 30;

/**
 * The worker this API dispatches an interview to.
 *
 * Must match `AGENT_NAME` in `voice-agent/agent.py`. They are two languages
 * naming one worker: if they drift, this creates a dispatch for an agent
 * nobody is registered as, LiveKit has nothing to hand it to, and the patient
 * waits in a room that never gets a second participant. Nothing fails loudly,
 * which is exactly why the constant is named on both sides rather than typed
 * twice.
 */
const VOICE_AGENT_NAME = 'medihive';

/**
 * `ParticipantInfo.Kind.AGENT` on the LiveKit wire.
 *
 * Written as the number rather than imported. The enum lives in
 * `@livekit/protocol`, which is a transitive dependency of
 * `livekit-server-sdk` and is not declared in this project's `package.json` —
 * `livekit-server-sdk` re-exports the clients but not this enum, so reaching
 * for it means importing a package nothing here depends on, which survives
 * only as long as the installer keeps hoisting it.
 *
 * The value is a protobuf field number, which is the one kind of constant that
 * cannot change without breaking every LiveKit client in existence.
 */
const PARTICIPANT_KIND_AGENT = 4;

@Injectable()
export class CaseTakingService {
  private readonly logger = new Logger(CaseTakingService.name);

  constructor(
    private readonly repository: CaseTakingRepository,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly sidecar: SidecarClient,
    private readonly auditService: AuditService,
    /**
     * Optional on purpose.
     *
     * Translation is an improvement to a background job, not a dependency of
     * the interview: with no translator wired the service behaves exactly as it
     * did before this seam existed, which is the same behaviour a translator
     * that is down produces. Making it required would mean a missing provider
     * could stop a patient being interviewed at all.
     */
    @Optional()
    @Inject(TRANSLATION_PROVIDER)
    private readonly translator?: TranslationProvider,
    /**
     * Optional for the same reason the translator is: a box with no LiveKit
     * credentials still runs a complete interview. Nothing on the clinical
     * path reads this.
     */
    @Optional()
    private readonly config?: ConfigService,
    /**
     * Optional on the same grounds as `config`, and paired with it: it exists
     * only to mint the short-lived credential the voice worker posts turns
     * with. A box with no LiveKit has nothing to dispatch and therefore nothing
     * to sign, and `dispatchVoiceAgent` returns early when either is absent.
     * Nothing on the clinical path reads it.
     */
    @Optional()
    private readonly jwt?: JwtService,
  ) {}

  /* ═══════════════════════════════ sessions ═══════════════════════════════ */

  /**
   * Start an interview, or hand back the one already open.
   *
   * One open session per patient, because two would mean two half-finished
   * accounts of the same illness and no rule for which the doctor reads. A
   * patient who closed the app mid-interview gets theirs back, which is §37's
   * resume.
   */
  async startOrResume(
    dto: StartCaseSessionDto,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown>> {
    const existing = await this.repository.findInProgressForPatient(
      patientId,
      user.organizationId,
    );

    if (existing) {
      // The picker the patient just used governs a resumed session too.
      //
      // This branch used to ignore `dto.language` entirely, and the screen
      // immediately before it says "Pick the language you will speak". Observed
      // on a handset: the patient selected Tamil, resumed a session that had
      // been started in Telugu, and their recording went up to `/stt` tagged
      // `te`. Speech recognition given the wrong language does not fail — it
      // returns a fluent, confident transcript of something nobody said, and
      // that becomes a clinical fact. The app was doing the right thing with
      // the wrong data: it sends the *session's* input language, which was not
      // the one the patient had just chosen.
      //
      // Only the INPUT language moves. `outputLanguage` stays as it is, and
      // the facts already recorded keep the language they were recorded in —
      // this changes what the recogniser is told next, nothing retrospective.
      const chosen = normaliseLanguage(dto.language);
      const resumed =
        chosen && chosen !== sessionInputLanguage(existing)
          ? await this.repository.touchSession(existing.id, {
              language: chosen,
              inputLanguage: chosen,
            })
          : existing;

      const view = await this.describeSession(resumed);
      return { ...view, resumed: true };
    }

    // The patient chooses one language and it decides one thing: how their
    // speech is transcribed. Normalised again here rather than trusted from the
    // DTO — `@IsLanguageCode` has already reduced `ta-IN` to `ta` for anything
    // that came through the pipe, but these columns are read back by `/stt`,
    // `/tts` and the engine, and a service that assumes a pipe ran is a service
    // that stores `ta-IN` the first time somebody calls it from a job.
    const inputLanguage = normaliseLanguage(dto.language) || DEFAULT_LANGUAGE;

    const session = await this.repository.create({
      organization: { connect: { id: user.organizationId } },
      patient: { connect: { id: patientId } },
      kind: dto.kind ?? 'new_consultation',
      // Written three times on purpose, and only two of them mean anything.
      //
      // `inputLanguage` is the patient's choice. `outputLanguage` is the
      // product's — English, on every session, for the reasons written beside
      // `DEFAULT_OUTPUT_LANGUAGE` — and it is not taken from the request, so a
      // handset cannot put an unreviewed clinical translation in front of a
      // patient by sending a field.
      //
      // `language` is the legacy column, kept in step with `inputLanguage` so
      // that the mobile client, the demo seed and anything else written before
      // the split keeps reading the value it always read. Nothing routes off it.
      language: inputLanguage,
      inputLanguage,
      outputLanguage: DEFAULT_OUTPUT_LANGUAGE,
      appointmentId: dto.appointmentId,
      status: 'in_progress',
    });

    // The age band the interview never asks. It is declared NEVER_ASKED in the
    // registry exactly so it can be read off the record instead — and the
    // paediatric danger-sign rules in §29 are gated on it, so a session that
    // does not set it has those rules silently switched off. Silently is the
    // problem; this is why it happens at session start rather than on demand.
    await this.seedAgeBand(session, patientId, user.organizationId);

    void this.auditService.log({
      userId: user.id,
      action: AuditAction.CREATE,
      entityName: 'CaseSession',
      entityId: session.id,
      metadata: { organizationId: user.organizationId, patientId },
      newValues: {
        status: session.status,
        inputLanguage: session.inputLanguage,
        outputLanguage: session.outputLanguage,
      },
    });

    const view = await this.describeSession(session);
    return { ...view, resumed: false };
  }

  async currentSession(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown> | null> {
    const session = await this.repository.findInProgressForPatient(
      patientId,
      user.organizationId,
    );
    return session ? this.describeSession(session) : null;
  }

  async getSession(
    sessionId: string,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.loadSession(sessionId, user, patientId);
    return this.describeSession(session);
  }

  /**
   * Consent, recorded as the moment it was.
   *
   * The version is stored beside the timestamp because which wording somebody
   * agreed to matters as much as that they agreed. A refusal is recorded too,
   * and abandons the session rather than leaving it open in a state where the
   * next request could still ask a question.
   */
  async recordConsent(
    sessionId: string,
    dto: CaseConsentDto,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.loadSession(sessionId, user, patientId);
    this.assertOpen(session);

    const updated = await this.repository.touchSession(session.id, {
      consentGivenAt: dto.accepted ? new Date() : null,
      consentVersion: dto.consentVersion,
      status: dto.accepted ? 'in_progress' : 'abandoned',
    });

    void this.auditService.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      entityName: 'CaseSession',
      entityId: session.id,
      metadata: { organizationId: user.organizationId, patientId },
      newValues: {
        consentVersion: dto.consentVersion,
        accepted: dto.accepted,
        status: updated.status,
      },
    });

    return this.describeSession(updated);
  }

  /* ════════════════════════════════ turns ════════════════════════════════ */

  /**
   * The hot path. Everything about the shape of this method is about what it
   * does NOT do: it does not call a model, and it does not wait for one.
   */
  async submitTurn(
    sessionId: string,
    dto: SubmitTurnDto,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<TurnResult> {
    const startedAt = Date.now();

    const session = await this.loadSession(sessionId, user, patientId);
    this.assertOpen(session);
    this.assertConsented(session);

    const loaded = await this.loadState(session);
    let state = loaded.state;

    // The field this answer is about: what the client named, or failing that,
    // the field the last question was about. A client that tracks its own
    // question does not have to tell us twice; one that does not, cannot end up
    // filing an answer against the wrong field by omission.
    const answeredPath =
      dto.fieldPath ?? lastAssistantFieldKey(loaded.turns) ?? null;

    const modality = dto.modality as AnswerModality;
    const answerText = (dto.text ?? '').trim();

    const patientTurn = await this.repository.appendTurn(session.id, {
      role: 'patient',
      section: answeredPath ? sectionOf(answeredPath) : null,
      fieldKey: answeredPath,
      answerRaw: answerText || dto.value || null,
      answerModality: modality,
      transcriptConfidence: dto.transcriptConfidence ?? null,
      audioKey: dto.audioKey ?? null,
    });

    // ── Derive, synchronously, in code ──────────────────────────────────────
    let derivation: PresenceDerivation | null = null;
    let factId: string | null = null;

    const field = answeredPath ? findField(state, answeredPath) : undefined;
    if (answeredPath && !field) {
      // A path the registry does not know is refused rather than stored. The
      // same allow-list the model is held to, applied to the client.
      throw new BadRequestException(
        `There is no question with the identifier "${answeredPath}".`,
        ErrorCodes.CASE_FIELD_UNKNOWN,
      );
    }

    if (field) {
      const applied = await this.applyAnswer({
        session,
        patientId,
        state,
        field,
        modality,
        text: answerText,
        value: dto.value,
        transcriptConfidence: dto.transcriptConfidence,
        sourceRef: patientTurn.id,
        source: sourceForModality(modality),
        verification: 'unverified',
      });
      state = applied.state;
      derivation = applied.derivation;
      factId = applied.factId;
    }

    // ── Decide whether the model has anything to add ────────────────────────
    const extraction = this.extractionDecision({
      field,
      text: answerText,
      derivation,
    });

    if (extraction.queued) {
      // Fire and forget, deliberately. Awaiting this is the twenty-second wait
      // the whole design exists to avoid, and there is nothing in the response
      // that depends on it: the next question comes from the selector, which
      // reads a state one turn behind on purpose.
      void this.extractInBackground({
        sessionId: session.id,
        patientId,
        organizationId: user.organizationId,
        utterance: answerText,
        askedFieldPath: answeredPath ?? undefined,
        // The utterance being extracted is in the patient's own language, so
        // this is the INPUT language. Telling the model the output language
        // would have it read Tamil as though it were English.
        language: sessionInputLanguage(session) ?? DEFAULT_LANGUAGE,
        turnId: patientTurn.id,
      });
    }

    // ── Safety, over the state as it now stands ─────────────────────────────
    const safety = evaluate(state);
    const redFlags = await this.persistNewRedFlags(session.id, safety);

    // ── The next question, from the selector, with no model in the path ─────
    const next = await this.askNext(session, state);

    await this.saveProjection(session, next.state, safety);

    return {
      turnId: patientTurn.id,
      sessionId: session.id,
      accepted: {
        fieldPath: answeredPath,
        presence: derivation ? derivation.presence : null,
        value: derivation?.value,
        reason: derivation ? derivation.reason : null,
        needsPatientConfirmation: derivation?.needsPatientConfirmation ?? false,
        factId,
      },
      extraction,
      nextQuestion: next.question,
      interviewStatus: interviewStatus(next.state),
      progress: interviewProgress(next.state),
      redFlags: redFlags.map(toPatientRedFlag),
      patientMessage: safety.patientMessage,
      serverTimeMs: Date.now() - startedAt,
    };
  }

  /**
   * A correction (§35).
   *
   * Writes a new row and points the old one at it. Never an UPDATE: the
   * disagreement between what was first understood and what the patient then
   * said is the part a clinician needs, and an overwrite throws it away. The
   * supersession itself happens in `recordFact`, inside a transaction.
   */
  async correctFact(
    sessionId: string,
    factId: string,
    dto: CorrectFactDto,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.loadSession(sessionId, user, patientId);
    if (session.status === 'submitted') {
      throw new ConflictException(
        'This case has already been sent to the hospital and can no longer be changed here.',
        ErrorCodes.CASE_SESSION_ALREADY_SUBMITTED,
      );
    }

    const existing = await this.repository.findFact(session.id, factId);
    if (!existing) {
      throw new NotFoundException(
        'That answer is not part of this interview.',
        ErrorCodes.CASE_FACT_NOT_FOUND,
      );
    }
    if (existing.supersededById) {
      throw new ConflictException(
        'That answer has already been corrected. Correct the current one instead.',
        ErrorCodes.CASE_FACT_ALREADY_SUPERSEDED,
      );
    }

    const loaded = await this.loadState(session);
    const field = findField(loaded.state, existing.fieldPath);
    if (!field) {
      throw new BadRequestException(
        'That answer belongs to a question this version no longer asks.',
        ErrorCodes.CASE_FIELD_UNKNOWN,
      );
    }

    const turn = await this.repository.appendTurn(session.id, {
      role: 'patient',
      section: existing.section,
      fieldKey: existing.fieldPath,
      answerRaw: dto.text ?? dto.value ?? null,
      answerModality: dto.modality ?? 'correction',
    });

    const applied = await this.applyAnswer({
      session,
      patientId,
      state: loaded.state,
      field,
      modality: (dto.modality as AnswerModality) ?? 'correction',
      text: (dto.text ?? '').trim(),
      value: dto.value,
      sourceRef: turn.id,
      source: 'patient_correction',
      // A correction the patient made themselves is confirmed by them, by
      // definition. `factFromAnswer` still downgrades it to `unverified` if the
      // derivation needed confirming, which is the case that matters.
      verification: 'patient_confirmed',
    });

    if (!applied.factId) {
      // The correction did not produce a storable fact — an empty body, or a
      // value the field's shape refuses. The original stands rather than being
      // quietly retired, because a correction that lands as "not assessed"
      // would turn a recorded answer into a hole.
      throw new BadRequestException(
        // Re-asked in the session's OUTPUT language, because this sentence is
        // read by the patient and the question inside it is the one they just
        // failed to answer — so it has to be worded exactly as the interview
        // words it, not in some second language the patient never saw.
        `We could not read that as an answer to "${field.label}". ${fallbackPhrasing(
          field,
          sessionOutputLanguage(session),
        )}`,
        ErrorCodes.CASE_ANSWER_NOT_UNDERSTOOD,
      );
    }

    const safety = evaluate(applied.state);
    await this.persistNewRedFlags(session.id, safety);
    await this.saveProjection(session, applied.state, safety);

    void this.auditService.log({
      userId: user.id,
      action: AuditAction.UPDATE,
      entityName: 'CaseFact',
      entityId: applied.factId,
      metadata: {
        organizationId: user.organizationId,
        patientId,
        sessionId: session.id,
        fieldPath: existing.fieldPath,
      },
      oldValues: { presence: existing.presence, value: existing.valueJson },
      newValues: {
        presence: applied.derivation.presence,
        value: applied.derivation.value ?? null,
        supersedes: existing.id,
      },
    });

    return {
      factId: applied.factId,
      supersededFactId: existing.id,
      fieldPath: existing.fieldPath,
      presence: applied.derivation.presence,
      value: applied.derivation.value ?? null,
      reason: applied.derivation.reason,
      needsPatientConfirmation: applied.derivation.needsPatientConfirmation,
    };
  }

  /* ════════════════════════════ review & submit ═══════════════════════════ */

  /**
   * §34's "here is what we understood about you".
   *
   * The structured document is rendered by the engine and returned
   * immediately — no model, so no wait. The prose read-back is opt-in through
   * `narrative`, because drafting it costs the same eight to twenty seconds
   * everything else here refuses to spend, and it is an addition to the
   * document rather than the document itself.
   */
  async review(
    sessionId: string,
    user: AuthenticatedUser,
    patientId: string,
    options: { narrative?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const session = await this.loadSession(sessionId, user, patientId);
    const { state } = await this.loadState(session);
    const safety = evaluate(state);
    const rendered = renderCase(state, { safety });

    let narrative: string | null = null;
    if (options.narrative) {
      const drafted = await this.llm.draftReviewSummary({
        // Rendered lines, never the state: every one has already been through
        // `renderItem`, so "Not assessed" arrives as those words and there is
        // no raw value for the model to reach past them into.
        sections: rendered.sections.map((section) => ({
          title: section.title,
          lines: section.items.map((item) => `${item.label}: ${item.display}`),
        })),
        // The narrative is read by the patient, so it is the OUTPUT language.
        language: sessionOutputLanguage(session),
      });
      narrative = drafted.summary;
    }

    return {
      sessionId: session.id,
      status: session.status,
      ...toReviewView(rendered),
      text: renderCaseText(rendered),
      narrative,
      safety: toPatientSafetyView(safety),
    };
  }

  /**
   * Submit (§38, §40).
   *
   * Mirrors `POST /pre-triage/:id/convert`: it renders the finished artefact,
   * writes it whole, and attaches it to the patient record. What it
   * deliberately does not do is open a consultation, a queue entry or a
   * pre-triage screening — `consultationId`, `queueId` and `preTriageId` stay
   * null until a workflow picks the case up. A submitted intake is a document
   * waiting to be read, not an appointment nobody booked.
   *
   * The submission is stored separately from the session because the session
   * keeps moving — the patient can still correct something afterwards — and
   * what the doctor opened must stay exactly what the doctor opened.
   */
  async submit(
    sessionId: string,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.loadSession(sessionId, user, patientId);
    this.assertConsented(session);

    const already = await this.repository.findSubmission(session.id);
    if (already) {
      throw new ConflictException(
        'This case has already been sent to the hospital.',
        ErrorCodes.CASE_SESSION_ALREADY_SUBMITTED,
      );
    }

    const { state } = await this.loadState(session);
    const safety = evaluate(state);
    const rendered = renderCase(state, { safety });
    const progress = interviewProgress(state);

    const structuredCase = {
      // Versioned so a case reviewed in a year can be read against the rules
      // that actually ran on it, not the ones in the file today.
      rulesetVersion: RULESET_VERSION,
      consentVersion: session.consentVersion,
      // Both, on the record. A clinician reading this case a year from now needs
      // to know the patient spoke Tamil and was answered in English — one code
      // could not say that, and "language: ta" over an English transcript is
      // the kind of half-truth that gets read as a translation that never ran.
      language: session.language,
      inputLanguage: sessionInputLanguage(session),
      outputLanguage: sessionOutputLanguage(session),
      renderedAt: new Date().toISOString(),
      percentComplete: rendered.percentComplete,
      // §36: printed, not omitted. An omitted line reads as nothing to report.
      missingInformation: rendered.missingInformation,
      sections: rendered.sections,
      safety: {
        rulesetVersion: safety.rulesetVersion,
        highestSeverity: safety.highestSeverity,
        triggered: safety.triggered,
      },
      text: renderCaseText(rendered),
    };

    const submission = await this.repository.createSubmission({
      organizationId: user.organizationId,
      sessionId: session.id,
      patientId,
      structuredCase: structuredCase as unknown as Prisma.InputJsonValue,
    });

    await this.repository.touchSession(session.id, {
      status: 'submitted',
      submittedAt: new Date(),
      progressPercent: progress.percent,
    });

    void this.auditService.log({
      userId: user.id,
      action: AuditAction.CONVERT,
      entityName: 'CaseSession',
      entityId: session.id,
      metadata: {
        organizationId: user.organizationId,
        patientId,
        submissionId: submission.id,
      },
      newValues: {
        status: 'submitted',
        percentComplete: rendered.percentComplete,
        highestSeverity: safety.highestSeverity,
        rulesetVersion: RULESET_VERSION,
      },
    });

    return {
      submissionId: submission.id,
      sessionId: session.id,
      patientId,
      submittedAt: submission.submittedAt,
      percentComplete: rendered.percentComplete,
      sectionCount: rendered.sections.length,
      missingInformation: rendered.missingInformation,
      safety: toPatientSafetyView(safety),
      structuredCase,
    };
  }

  /* ═══════════════════════════════ languages ══════════════════════════════ */

  /**
   * The languages this interview can be taken in, and what each can actually do
   * on this box right now.
   *
   * ── What a row means now that the interview has two languages
   *
   * A row is an INPUT language: the language a patient may speak. `stt` is the
   * flag that decides whether they may speak it at all, and it is still
   * reported per language and still honestly — Odia is `false`, because
   * faster-whisper has no Odia model, and a row the sidecar cannot serve is
   * `false` whatever this table hopes.
   *
   * `tts` and `questions` are the other direction, and they are no longer about
   * the patient who picks this row. They describe what this system can do with
   * text IN that language — whether a voice for it is installed, whether anyone
   * has checked a translation of the questions — which is a fact about the
   * catalogue and the box, and is what a clinician auditing coverage is asking.
   * What the patient will actually read and hear is `outputLanguage`, which is
   * `en` on every row today, and whether they can hear it is `outputTts`. A
   * picker that greys out the speaker on `tts` would now be wrong: a Tamil
   * patient hears English, and English has a voice.
   *
   * ── Two sources, and which wins
   *
   * The *list* — which languages exist, what they are called in their own
   * script, what order to show them in — comes from `language.constants.ts`.
   * The *capabilities* come from the sidecar, because it is the process holding
   * the weights and it is the only thing that knows whether the Tamil reference
   * audio is on the disk. A config file cannot know that, and a config file
   * that claims to is how a patient gets offered a speaker that plays nothing.
   *
   * When the sidecar cannot be reached the static flags stand and `source` says
   * `catalogue`. That is the honest degradation: the picker still works, it may
   * offer a microphone that then refuses, and the refusal is a written sentence
   * with a keyboard behind it. Refusing to list any languages because a health
   * probe timed out would be worse.
   *
   * ── Why the health call is safe to make here
   *
   * It was not, until the breaker was split per capability: a health probe
   * against a down sidecar used to push the one shared counter towards opening,
   * so opening a language picker three times could have switched off document
   * reading. Now a health failure only opens the health breaker, and `health()`
   * already answers `null` rather than throwing.
   *
   * ── Why there is no repository call
   *
   * There is no data. The catalogue is a property of the models we run, not of
   * this hospital's database, and a table in Postgres would be a third copy
   * free to disagree with both of the above. The layering is honoured — a
   * Repository is the data-access layer and this has no data to access — and
   * §4's pagination rule is about list endpoints that scan a table, which this
   * cannot.
   */
  async languages(): Promise<LanguageCatalogueDto> {
    const health = await this.sidecar.health();
    const live = health?.languages ?? {};
    const known = Object.keys(live).length > 0;

    // Resolved once, not per row: every row's output is the same language, and
    // asking the same question twelve times would invite twelve answers.
    const outputLanguage = DEFAULT_OUTPUT_LANGUAGE;
    const outputTts = known
      ? live[outputLanguage]?.tts === true
      : findLanguage(outputLanguage)?.tts === true;

    return {
      default: DEFAULT_LANGUAGE,
      source: known ? 'sidecar' : 'catalogue',
      languages: SUPPORTED_LANGUAGES.map((language) => {
        const reported = live[language.code];
        return {
          code: language.code,
          nativeName: language.nativeName,
          englishName: language.englishName,
          // Once the sidecar has answered at all, it is the authority for every
          // row — including the ones it did not mention. It builds that table
          // from its own full language list, so a language missing from it is
          // one it does not know rather than one it forgot, and treating
          // silence as a yes is how the speaker button gets offered for a voice
          // that is not installed.
          stt: known ? reported?.stt === true : language.stt,
          tts: known ? reported?.tts === true : language.tts,
          // Not from the sidecar: the sidecar holds voices and recognisers, and
          // knows nothing about whether the QUESTIONS have been translated. A
          // language can have a voice and no phrasebook — Hindi did until
          // today — and a client that reads `tts: true` as "the interview is in
          // Hindi" is reading the wrong flag. So the two are reported side by
          // side and separately.
          ...questionCapability(language.code),
          // The two fields that say what this patient actually gets. They are
          // the same on every row on purpose: the output language is a product
          // decision, not a consequence of what the patient picked, and a
          // client should be able to read it off the row it is rendering
          // rather than infer it from a rule written down somewhere else.
          outputLanguage,
          outputTts,
        };
      }),
    };
  }

  /* ═════════════════════════════ live voice ═══════════════════════════════ */

  /**
   * A short-lived pass into this patient's own voice room.
   *
   * ## Why the client names neither the room nor itself
   *
   * Both are derived here from the session the caller already owns. A client
   * that could name its own room could name somebody else's, and two patients
   * in one room is two clinical interviews sharing an audio stream — a
   * disclosure with no recovery once it has happened. `loadSession` is what
   * proves the caller owns the session; everything after it is derived.
   *
   * ## Why the TTL is minutes
   *
   * The token is the whole credential: anyone holding it can join that room
   * and hear that interview. It only has to survive the dial, so it is scoped
   * to roughly the length of one interview and no longer. A client whose token
   * expires mid-session asks for another; a token that lasted a day would
   * outlive the consultation it was minted for.
   *
   * ## What the phone never receives
   *
   * The API secret. It mints this and stays on the server. A credential
   * shipped inside an APK belongs to anybody who has the APK, so the worst a
   * decompiled build yields is an expired pass to a finished interview.
   *
   * ## What this being unavailable must not do
   *
   * Stop an interview. With no LiveKit configured this refuses in writing and
   * the patient notices nothing: the microphone still records, `/stt` still
   * answers, and the tiles and the keyboard were never conditional on any of
   * it. That is why the config is optional and this returns a refusal rather
   * than throwing something a client would render as a fault.
   */
  async voiceToken(
    dto: VoiceTokenDto,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<VoiceGrantDto> {
    const url = this.config?.get<string>('LIVEKIT_URL');
    const key = this.config?.get<string>('LIVEKIT_API_KEY');
    const secret = this.config?.get<string>('LIVEKIT_API_SECRET');

    if (!url || !key || !secret) {
      throw new BadRequestException(
        'Live voice is not available here. You can still speak your answer, ' +
          'type it, or tap one of the choices.',
        ErrorCodes.AI_SIDECAR_UNAVAILABLE,
      );
    }

    // Proves the caller owns this session before anything is derived from it.
    const session = await this.loadSession(dto.sessionId, user, patientId);
    this.assertOpen(session);

    const roomName = `case-${session.id}`;
    const identity = `patient-${patientId}`;
    const ttlSeconds = VOICE_TOKEN_TTL_SECONDS;

    // Off the session row, never off `dto` — the session is the authority on
    // what the patient speaks. Hoisted into one pair because the room token and
    // the agent dispatch both carry them, and two readings that could disagree
    // is a recogniser listening for one language while the worker speaks
    // another.
    const languages = {
      input: sessionInputLanguage(session) ?? DEFAULT_LANGUAGE,
      output: sessionOutputLanguage(session),
    };

    const { AccessToken } = await import('livekit-server-sdk');
    const token = new AccessToken(key, secret, {
      identity,
      ttl: ttlSeconds,
      // Read by the agent that joins the room, so it knows which language to
      // listen for without a second round trip. Advisory: the session remains
      // the authority, which is why these come off the row and not off `dto`.
      metadata: JSON.stringify({
        sessionId: session.id,
        inputLanguage: languages.input,
        outputLanguage: languages.output,
      }),
    });

    // The minimum that works. A patient publishes their microphone and hears
    // the agent; they do not create rooms, do not administer one, and do not
    // publish data — so a token that leaked cannot be used to open a room of
    // its own or to speak into somebody else's as them.
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      roomCreate: false,
      roomAdmin: false,
    });

    await this.dispatchVoiceAgent(
      session.id,
      roomName,
      user,
      ttlSeconds,
      languages,
    );

    return {
      token: await token.toJwt(),
      url,
      roomName,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /**
   * Ask LiveKit to put the interview worker in this patient's room.
   *
   * ## Why this exists at all
   *
   * The worker used to join by itself: with no `agent_name` registered, LiveKit
   * dispatches a job for every room in the project automatically. It worked, in
   * the sense that audio flowed — and it was useless, because a job LiveKit
   * invents carries no metadata, and metadata is the only channel that can hand
   * the worker a credential. It joined, it listened, and it posted nothing:
   * `no session id or token: listening only`, on a room that looked healthy from
   * both ends. A whole interview could be spoken into it and the record stayed
   * empty.
   *
   * ## What the worker is trusted with
   *
   * A token that is this caller's own authority and nothing more, expiring with
   * the room pass. The worker posts the patient's answers *as the patient*,
   * which is what it is doing on their behalf; it gains no role they do not
   * have, and it cannot outlive the interview it was minted for. There is no
   * long-lived credential anywhere in this path — the alternative, a shared
   * `MEDIHIVE_API_TOKEN` in the worker's environment, would have made every
   * patient's answers post as one identity.
   *
   * ## Why a failure here does not throw
   *
   * Same rule as the rest of this method: losing live voice must not stop an
   * interview. If the dispatch fails the patient is in a room no agent joins,
   * which is a silent room — but the microphone, `/stt`, the tiles and the
   * keyboard are all still there and none of them route through LiveKit. A
   * throw would take those away too, to punish a failure they do not share.
   * It is logged at error, because a silent room is not something to discover
   * from a patient.
   */
  private async dispatchVoiceAgent(
    sessionId: string,
    roomName: string,
    user: AuthenticatedUser,
    ttlSeconds: number,
    languages: { input: string; output: string },
  ): Promise<void> {
    const url = this.config?.get<string>('LIVEKIT_URL');
    const key = this.config?.get<string>('LIVEKIT_API_KEY');
    const secret = this.config?.get<string>('LIVEKIT_API_SECRET');
    if (!url || !key || !secret || !this.jwt) return;

    // `AgentDispatchClient` speaks HTTP to the same host the client dials over
    // WebSocket, and it will not do the conversion for us: handed `wss://…` it
    // fails on an unsupported protocol rather than connecting. The SDK's own
    // docs say "hostname including protocol. i.e. 'https://<project>.livekit.cloud'".
    const host = url.replace(/^ws(s?):\/\//, 'http$1://');

    try {
      const { AgentDispatchClient, RoomServiceClient } =
        await import('livekit-server-sdk');

      // Is an agent in the room *right now* — not "was one ever dispatched".
      //
      // The distinction is the whole guard. A dispatch is consumed once: the
      // job it creates ends when the room empties, and the dispatch stays in
      // `listDispatch` afterwards looking exactly like a live one. Guarding on
      // that list meant a patient whose phone dropped for ten seconds asked for
      // a new pass, was told an agent had already been dispatched, and spent
      // the rest of the interview alone in a silent room. Observed directly:
      // one `received job request`, then `the participant we were listening to
      // left`, and every later join heard nothing.
      //
      // Presence is the condition actually wanted — exactly one agent in the
      // room — and it is true only while a worker is really there, so a
      // reconnection dispatches again and a double-tap does not.
      let agentPresent = false;
      try {
        const rooms = new RoomServiceClient(host, key, secret);
        const participants = await rooms.listParticipants(roomName);
        // `Number(...)` rather than a bare comparison: `kind` is typed as the
        // protocol's enum, and comparing an enum to a loose numeric literal is
        // what `@typescript-eslint/no-unsafe-enum-comparison` exists to catch.
        // The conversion says plainly what this is — a wire value checked
        // against a wire value — instead of silencing the rule.
        agentPresent = participants.some(
          (p) => Number(p.kind) === PARTICIPANT_KIND_AGENT,
        );
      } catch {
        // On the first call the room does not exist yet — `createDispatch` is
        // what brings it into being — and `listParticipants` answers
        // `requested room does not exist` by throwing. A room that does not
        // exist contains no agent, which is the same answer as an empty one,
        // and both mean "dispatch". Letting this escape to the outer handler
        // would log a failure and return without ever dispatching, so the
        // guard against a second agent would have prevented the first.
        agentPresent = false;
      }
      if (agentPresent) {
        this.logger.debug(`voice agent already in ${roomName}`);
        return;
      }

      const dispatcher = new AgentDispatchClient(host, key, secret);

      await dispatcher.createDispatch(roomName, VOICE_AGENT_NAME, {
        metadata: JSON.stringify({
          sessionId,
          token: this.mintWorkerToken(user, ttlSeconds),
          inputLanguage: languages.input,
          outputLanguage: languages.output,
        }),
      });
      this.logger.log(`dispatched ${VOICE_AGENT_NAME} to ${roomName}`);
    } catch (error) {
      this.logger.error(
        `could not dispatch the voice agent to ${roomName}; the patient will ` +
          `be alone in the room and should use the keyboard or /stt: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /**
   * The worker's bearer token: this caller's authority, for this room's life.
   *
   * Re-signed rather than forwarded. The caller's own token is already in
   * memory on this request, and passing *that* through would hand the worker a
   * credential outliving the interview by however long was left on it. Minting
   * a fresh one costs a signature and bounds the worker to the room.
   *
   * The claims mirror `AuthService.generateTokenPair` exactly, because
   * `JwtStrategy` refuses anything that is not `type: 'access'` and reads
   * `patientId` straight off the payload. A token missing it is a token that
   * `PatientSelfGuard` then refuses on the patient's own data.
   */
  private mintWorkerToken(user: AuthenticatedUser, ttlSeconds: number): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      organizationId: user.organizationId,
      type: 'access',
      ...(user.patientId && { patientId: user.patientId }),
    };
    return this.jwt!.sign(payload, { expiresIn: ttlSeconds });
  }

  /* ═════════════════════════════ voice seams ══════════════════════════════ */

  /**
   * Transcribe a recorded answer.
   *
   * The language sent to the recogniser is the session's INPUT language when a
   * session was named, and the caller's otherwise — see `voiceLanguage`. This
   * is the half of the interview the patient's choice governs: a Tamil speaker
   * is transcribed as Tamil, whatever language they are being answered in.
   *
   * A language the table marks `stt: false` is refused here, in writing, and
   * the recording is never sent. Today that is Odia and only Odia.
   *
   * ── Why the refusal has to be on this path too
   *
   * `@IsLanguageCode('stt')` already refuses `language=or` in the request body,
   * so the phone cannot name it. But the app does not name it: it sends
   * `sessionId`, and the session's own language wins. On that path `or` used to
   * resolve through `sttLanguageFor` to `undefined`, and `undefined` does not
   * mean "refuse" — it means "send no language hint", which is the instruction
   * to auto-detect. Whisper has no `or` model to detect, so it lands on a
   * neighbouring language and returns a fluent, confident transcript of words
   * the patient never said, at HTTP 200.
   *
   * Measured on this box, an Odia session with `sessionId` set:
   *
   *   POST /api/case-taking/stt  ->  200
   *   {"text":"I have had chest pain for three days.","confidence":0.7829,
   *    "language":"en"}
   *
   * Nothing downstream can tell that from a transcript the patient meant. It
   * becomes a fact, the fact becomes a chart, and the only person who could
   * catch it is the one who cannot read what they never said. A refused upload
   * costs an Odia patient the microphone, which they never had; a wrong
   * transcript costs them the record.
   */
  async transcribe(
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    dto: TranscribeDto,
    user: AuthenticatedUser,
    patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    const language = await this.voiceLanguage(
      dto.sessionId,
      dto.language,
      { user, patientId },
      'input',
    );

    // Refused before the upload is spent, and named rather than hardcoded: the
    // sentence comes off the row in `SUPPORTED_LANGUAGES`, so a language whose
    // recogniser arrives later stops being refused by editing that table.
    // `AI_SIDECAR_UNAVAILABLE` is the code the client already reads as "offer
    // the keyboard", which is exactly the fallback an Odia interview runs on.
    const definition = findLanguage(language);
    if (definition !== undefined && !definition.stt) {
      throw new BadRequestException(
        `We cannot listen in ${definition.englishName} yet. Please type your answer.`,
        ErrorCodes.AI_SIDECAR_UNAVAILABLE,
      );
    }

    try {
      const transcript = await this.sidecar.transcribe(file.buffer, {
        filename: file.originalname,
        mimeType: file.mimetype,
        language: sttLanguageFor(language),
      });
      return { ...transcript, available: true };
    } catch (error) {
      // A refusal, not a 500. Voice is never the only way to answer a question
      // (§10), so the honest response is the written sentence plus a signal the
      // client can use to fall back to the keyboard.
      throw this.asDomainError(error, ErrorCodes.AI_SIDECAR_UNAVAILABLE);
    }
  }

  /**
   * Read a line out loud.
   *
   * The OUTPUT language, which is English on every session — so this is served
   * by Piper's English voice, the one that is actually installed, rather than
   * by an IndicF5 reference audio that may not be on this box. The IndicF5
   * providers stay wired up behind the same call: a session whose
   * `outputLanguage` is `hi` reaches them without anything here changing.
   */
  async speak(
    dto: SpeakDto,
    user: AuthenticatedUser,
    patientId: string | undefined,
  ): Promise<Buffer> {
    const language = await this.voiceLanguage(
      dto.sessionId,
      dto.language,
      { user, patientId },
      'output',
    );

    try {
      return await this.sidecar.speak(dto.text, language ?? DEFAULT_LANGUAGE);
    } catch (error) {
      throw this.asDomainError(error, ErrorCodes.AI_SIDECAR_UNAVAILABLE);
    }
  }

  /**
   * Which language a voice call is actually in.
   *
   * ── Which of the session's two
   *
   * `direction` says it, and it is the only thing that says it: `/stt` asks for
   * `'input'` and `/tts` for `'output'`, once each, and no other caller exists.
   * The two used to be one column, which meant a Tamil patient could either be
   * transcribed as Tamil or read to in English and never both.
   *
   * ── Why the session wins
   *
   * `/tts` and `/stt` used to take the language from the request body and
   * nothing else, so the phone decided. The phone is the wrong authority: it is
   * remembering a choice, and a resumed app, a shared handset or a client
   * written before the picker existed all remember the wrong one. The session
   * row holds what the patient chose when they started, it is the value the
   * rest of the interview already runs on, and it is the value a clinician sees
   * on the record. Two answers to "what language is this interview in" is one
   * answer too many.
   *
   * ── Why `sessionId` is optional rather than required
   *
   * Both routes are legitimately used before there is a session: the consent
   * text is read aloud, and so is the language picker. Making it required would
   * break those, and inferring the patient's open session instead would be
   * worse — the language would change under a caller who never mentioned a
   * session, at the moment an unrelated interview was opened or submitted.
   *
   * Naming a session also *scopes* the call, which these two routes previously
   * were not at all: it is loaded through the same patient-and-organisation
   * check as everything else, so somebody else's session id is not found rather
   * than being a way to learn what language they speak.
   */
  private async voiceLanguage(
    sessionId: string | undefined,
    requested: string | undefined,
    caller: { user: AuthenticatedUser; patientId: string | undefined },
    direction: VoiceDirection,
  ): Promise<string | undefined> {
    const fromBody = normaliseLanguage(requested) || undefined;
    if (!sessionId) return fromBody;

    if (!caller.patientId) {
      throw new ForbiddenException(
        'Naming an interview here is for the patient whose interview it is. A clinician reads a submitted case on the patient record.',
        ErrorCodes.PATIENT_PORTAL_NOT_LINKED,
      );
    }

    const session = await this.loadSession(
      sessionId,
      caller.user,
      caller.patientId,
    );
    // The output direction never falls back to the body: what the patient reads
    // and hears is a decision this service makes, and `sessionOutputLanguage`
    // always answers with a language we have (English, when the column holds
    // something unreadable). Letting the handset override it here would be a
    // second authority on the one thing that is deliberately not the handset's.
    if (direction === 'output') return sessionOutputLanguage(session);

    const stored = sessionInputLanguage(session);

    // A row written before this table existed can hold anything — the column
    // was a free sixteen-character string. An unrecognised value is not
    // silently turned into English, which is the exact failure the sidecar
    // stopped making; it is discarded in favour of what the caller asked for,
    // so a legacy session degrades to the behaviour it already had.
    if (stored === null) {
      this.logger.warn({
        message:
          'session input language is not in the supported set; using the request language',
        sessionId: session.id,
        storedLanguage: normaliseLanguage(
          session.inputLanguage || session.language,
        ),
      });
      return fromBody;
    }

    return stored;
  }

  /* ══════════════════════════════ internals ═══════════════════════════════ */

  private async loadSession(
    sessionId: string,
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<CaseSession> {
    const session = await this.repository.findSessionForPatient(
      sessionId,
      patientId,
      user.organizationId,
    );
    if (!session) {
      // The same answer whether the session belongs to somebody else or does
      // not exist. Two answers here would make this route an existence oracle,
      // which is the hole `PatientSelfGuard` closes one level up.
      throw new NotFoundException(
        'We could not find that interview.',
        ErrorCodes.CASE_SESSION_NOT_FOUND,
      );
    }
    return session;
  }

  private assertOpen(session: CaseSession): void {
    if (session.status === 'submitted' || session.status === 'abandoned') {
      throw new ConflictException(
        session.status === 'submitted'
          ? 'This case has already been sent to the hospital.'
          : 'This interview was stopped. Start a new one when you are ready.',
        session.status === 'submitted'
          ? ErrorCodes.CASE_SESSION_ALREADY_SUBMITTED
          : ErrorCodes.CASE_SESSION_NOT_IN_PROGRESS,
      );
    }
  }

  private assertConsented(session: CaseSession): void {
    if (!session.consentGivenAt) {
      throw new ConflictException(
        'Please agree to how your answers will be used before we start.',
        ErrorCodes.CASE_SESSION_CONSENT_REQUIRED,
      );
    }
  }

  /**
   * The state, rebuilt from rows, with anything stale released.
   *
   * `expirePending` runs on every load rather than on a timer, because a lost
   * extraction has no other way of being noticed: without it, a question whose
   * background job died would sit in flight forever and the interview would
   * simply never ask it again. For `allergies.reported` that is a permanent
   * hole in a chart that nobody is told about.
   */
  private async loadState(
    session: CaseSession,
  ): Promise<{ state: ClinicalState; turns: CaseTurn[]; facts: CaseFact[] }> {
    const [facts, turns] = await Promise.all([
      this.repository.listCurrentFacts(session.id),
      this.repository.listTurns(session.id),
    ]);

    // The one place the two languages reach the engine.
    //
    // `language` on the state is the OUTPUT language: it is read by
    // `fallbackPhrasing`, and by nothing else, so it decides how questions are
    // worded. `inputLanguage` is read by `derivePresence`, and by nothing else,
    // so it decides what the patient's own words are matched against. Routing
    // them here rather than at each call site is what keeps "questions are
    // English, answers are Tamil" a property of the session rather than a rule
    // every caller has to remember.
    const state = expirePending(
      rebuildState({
        sessionId: session.id,
        startedAt: session.startedAt,
        language: sessionOutputLanguage(session),
        inputLanguage: sessionInputLanguage(session),
        facts,
        turns,
      }),
    );

    return { state, turns, facts };
  }

  /**
   * One answer, through the engine and into a row.
   *
   * The provenance passed in says *where* the answer came from; it cannot say
   * what state it represents, because `factFromAnswer` takes no parameter for
   * that. `derivePresence` decides, from the patient's own words.
   */
  private async applyAnswer(input: {
    session: CaseSession;
    patientId: string;
    state: ClinicalState;
    field: FieldDefinition;
    modality: AnswerModality;
    text: string;
    value?: string;
    transcriptConfidence?: number;
    sourceRef: string;
    source: FactSource;
    verification: 'unverified' | 'patient_confirmed';
    /**
     * What language `text` is in, when it is not the language the patient
     * speaks. The only caller that passes it is the extraction path, after a
     * translation has actually run: the span it hands over is English by then,
     * and the phrase lists it is about to be matched against are English too.
     *
     * Omitted everywhere else, and it must stay that way — the default is the
     * session's INPUT language, which is what the patient's own words are in.
     * Passing `en` for a Tamil answer would claim the English phrase lists had
     * read it, and an unmatched "no" would become a recorded negative.
     */
    textLanguage?: string;
  }): Promise<{
    state: ClinicalState;
    derivation: PresenceDerivation;
    factId: string | null;
  }> {
    const answer: AnswerInput = {
      modality: input.modality,
      utterance: input.text || undefined,
      // A short reply *is* the evidence for the field that was asked; a
      // narrative is not, and passing it as one is how "I don't know if I'm
      // allergic to anything" ends up deciding a duration.
      evidenceSpan: isShortAnswer(input.text) ? input.text : undefined,
      extractedValue: input.value ?? (input.text || undefined),
      field: valueSpecFor(input.field),
      // The language of THESE WORDS. Normally the session's INPUT language,
      // because the words are the patient's and the phrase lists they are
      // matched against are English: a Tamil "illai" is an unmatched answer
      // that the engine flags for confirmation, which is the honest reading.
      // The OUTPUT language is never right here — it would claim the English
      // lists had covered Tamil, and an unmatched "no" would become a recorded
      // negative. `textLanguage` overrides it for the one caller whose text is
      // no longer the patient's own: extraction, after a translation ran.
      language: input.textLanguage ?? input.state.inputLanguage,
    };

    const provenance: FactProvenance = {
      source: input.source,
      verification: input.verification,
      // The speech recogniser's number, which is a measurement of a real
      // quantity — unlike the language model's constant self-report, which is
      // why that one never reaches a provenance at all.
      ...(input.transcriptConfidence !== undefined
        ? {
            confidence: input.transcriptConfidence,
            confidenceSource: 'derived' as const,
          }
        : {}),
      recordedAt: new Date().toISOString(),
    };

    const { fact, derivation } = factFromAnswer(answer, provenance);

    if (fact.presence === 'not_assessed') {
      // Nothing usable. No row is written, because the absence of a row already
      // means "nobody answered this" — and the question stays askable, which is
      // what we want when a value failed the field's shape.
      return { state: input.state, derivation, factId: null };
    }

    const row: FactRowData = rowDataFromFact(
      input.field.key,
      fact,
      input.sourceRef,
    );
    const created = await this.repository.recordFact({
      sessionId: input.session.id,
      patientId: input.patientId,
      row,
    });

    return {
      state: applyFact(input.state, input.field.key, fact),
      derivation,
      factId: created.id,
    };
  }

  /**
   * Is there anything here the model could add that the engine could not?
   *
   * The bar is deliberately high. Every yes costs a background job and, on this
   * box, eight to twenty seconds of one CPU; every no is an answer that was
   * fully understood by deterministic code that can be read and argued with.
   */
  private extractionDecision(input: {
    field?: FieldDefinition;
    text: string;
    derivation: PresenceDerivation | null;
    language?: string;
  }): { queued: boolean; reason: string } {
    if (input.text.length === 0) {
      return { queued: false, reason: 'no free text in this turn' };
    }

    // Text the engine cannot read is text the engine did not read, however
    // short it is and however cleanly it stored.
    //
    // This branch has to come before the `isShortAnswer` one below, and that
    // ordering is the whole fix. A chief complaint is a `text` field: the
    // engine "reads" it by storing it verbatim, so derivation succeeds and a
    // short answer took the "engine read the answer without a model" exit —
    // which for `எனக்கு மூணு நாளா நெஞ்சு வலி இருக்கு` is not true. It stored
    // it; it understood none of it.
    //
    // The cost of that was precise and measured: no extraction meant no
    // translation, so `classifyComplaint` — an English keyword table — went on
    // reading Tamil, and a cardiac complaint never reached the cardiac
    // pathway. The short chief complaint is the single most common utterance
    // in the whole interview and it was the one case that skipped the model.
    //
    // `chief_complaint.symptom` is also the highest-value text in the session:
    // `complaintCategories` reads it to decide which fifty review-of-systems
    // fields apply and whether ACS_TRIAD is even evaluated. Paying a
    // background job for it is worth it.
    if (isNonEnglishScript(input.text)) {
      return {
        queued: true,
        reason: 'answer is not in a script the engine can read',
      };
    }

    if (!input.field) {
      // An opening narrative belongs to no single field, which is exactly the
      // case the model is for.
      return { queued: true, reason: 'narrative turn with no field' };
    }

    if (!isShortAnswer(input.text)) {
      // More was said than the question asked for. The engine has taken the
      // conservative reading; the model's job is to split it into properly
      // attributed spans.
      return { queued: true, reason: 'answer is longer than the question' };
    }

    if (input.derivation && input.derivation.presence === 'not_assessed') {
      return {
        queued: true,
        reason: `engine could not read it (${input.derivation.reason})`,
      };
    }

    return { queued: false, reason: 'engine read the answer without a model' };
  }

  /**
   * Extraction, behind the response.
   *
   * Nothing awaits this and nothing may throw out of it — a rejected
   * floating promise takes the process down under Node's default handler, and
   * an interview is not worth a hospital API. Everything it writes goes through
   * the same `derivePresence` the foreground path uses: the model supplies a
   * value and a span, and the engine still decides what state they represent.
   */
  private async extractInBackground(input: {
    sessionId: string;
    patientId: string;
    organizationId: string;
    utterance: string;
    askedFieldPath?: string;
    language: string;
    turnId: string;
  }): Promise<void> {
    try {
      const session = await this.repository.findSessionForPatient(
        input.sessionId,
        input.patientId,
        input.organizationId,
      );
      if (!session) return;

      const loaded = await this.loadState(session);
      const menu = extractionMenu(loaded.state, input.askedFieldPath);
      if (menu.length === 0) return;

      // ── The patient's words, in English, for the English engine ───────────
      //
      // Everything after this line that reads *meaning* reads English;
      // everything that is a *record of what the patient said* still reads the
      // original, which was written to `CaseTurn.answerRaw` before the response
      // shipped and is not touched here or anywhere below.
      //
      // This is on the background path deliberately. It is a second model call
      // on a job that already costs eight to twenty seconds and already lands
      // minutes late — which is affordable — and it would be a catastrophe on
      // the turn path, where the measured handler time is a few milliseconds.
      const englishUtterance = await this.translateForEngine(
        input.utterance,
        input.language,
      );

      const result = await this.llm.extractFacts({
        // English when there is English to give. The values that come back
        // populate `chief_complaint.symptom`, which is what `classifyComplaint`
        // reads — an English keyword table that returned `[unclassified]` for
        // "तीन दिन से सीने में दर्द हो रहा है" and silenced ACS_TRIAD.
        utterance: englishUtterance.text,
        candidateFields: menu,
        askedFieldPath: input.askedFieldPath,
        // `en` only when the text really is English, because this tag drives
        // the prompt's "copy their words, do not translate" line. Telling the
        // model a Hindi sentence is English would invite it to translate — the
        // one thing extraction must never do, since a translated value cannot
        // be matched back to the span it came from.
        language: englishUtterance.translated
          ? DEFAULT_LANGUAGE
          : input.language,
      });

      if (result.degraded) {
        this.logger.warn(
          `extraction degraded for session ${input.sessionId}: ${result.degradedReason ?? 'unknown'}`,
        );
        return;
      }

      // Re-read rather than reuse: the patient has answered one or two more
      // questions while this ran, and the state that was loaded before the call
      // is minutes old by now.
      const fresh = await this.loadState(session);
      let state = fresh.state;
      let written = 0;

      for (const extracted of result.facts) {
        const field = findField(state, extracted.fieldPath);
        if (!field) continue;

        const applied = await this.applyAnswer({
          session,
          patientId: input.patientId,
          state,
          field,
          // Not the patient's original modality: what reached us here is text
          // the model attributed, and the source has to say so.
          modality: 'text',
          // The span the extractor returned, verified against the same text the
          // extractor was given — so when translation ran, both are English and
          // the fallback is the English utterance rather than the original. It
          // has to be one or the other: a span verified against English cannot
          // be found in Devanagari, and `derivePresence`'s phrase lists are
          // English too. None of this is stored: `rowDataFromFact` writes a
          // value and a presence, never the text. The patient's own words stay
          // where they were put, in the turn row, untouched.
          text: extracted.evidenceSpan ?? englishUtterance.text,
          // ...and when it is English, `derivePresence` is told so, so its
          // English phrase lists actually run over it. Without this the span
          // would be tagged with the language the patient spoke, the lists
          // would be skipped as uncovered, and the translation would have
          // bought nothing for the one thing it was meant to help.
          ...(englishUtterance.translated
            ? { textLanguage: DEFAULT_LANGUAGE }
            : {}),
          value: extracted.value,
          sourceRef: input.turnId,
          source: 'patient_text',
          verification: 'unverified',
        });

        if (applied.factId) {
          state = applied.state;
          written++;
        }
      }

      if (written === 0) return;

      // A fact the model found can be the one that completes a red flag, so the
      // rules run again here rather than only on the next turn. Waiting would
      // mean a patient who stopped answering after their opening narrative
      // never saw the alert their own words triggered.
      const safety = evaluate(state);
      await this.persistNewRedFlags(session.id, safety);
      await this.saveProjection(session, state, safety);

      this.logger.log(
        `extraction landed ${written} fact(s) for session ${input.sessionId} in ${result.latencyMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `background extraction failed for session ${input.sessionId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * The patient's utterance in English — or the utterance, unchanged.
   *
   * ── What this is for
   *
   * `classifyComplaint` is an English keyword table and `complaintCategories`
   * runs it over `chief_complaint.symptom`. Given the patient's own Hindi it
   * returned `[unclassified]`, which cut the applicable field set from 64 to 44
   * and left ACS_TRIAD silent for a patient describing cardiac chest pain. The
   * table is not wrong; it was being handed something it cannot read. This
   * hands it English.
   *
   * ── What it is careful not to be
   *
   * It returns a *pair*, never a replacement. The original utterance was
   * written to `CaseTurn.answerRaw` on the synchronous path before the response
   * shipped, and nothing downstream of here rewrites it — `rowDataFromFact`
   * persists a value and a presence and has no column for text at all. So the
   * verbatim record a clinician reads is the patient's, and English is a
   * derived reading of it that exists only in memory, for the duration of one
   * background job.
   *
   * Three ways out, all of them today's behaviour: no translator wired, the
   * session already in English, or a translation that failed. The last is the
   * common one on this box and it is a `warn`, not a throw — the caller is
   * inside a fire-and-forget promise, and a rejection there takes the process
   * down under Node's default handler.
   *
   * Nothing here logs the utterance. It is PHI, and a translation failure is
   * diagnosable from the language tag and the reason.
   */
  private async translateForEngine(
    utterance: string,
    language: string,
  ): Promise<{ text: string; translated: boolean }> {
    const untranslated = { text: utterance, translated: false };

    if (!this.translator) return untranslated;
    if (normaliseLanguage(language) === DEFAULT_LANGUAGE) return untranslated;

    try {
      const result = await this.translator.translateToEnglish({
        text: utterance,
        sourceLanguage: language,
      });

      if (result.englishText === null) {
        this.logger.warn(
          `translation degraded for a "${language}" utterance (${
            result.degradedReason ?? 'unknown'
          }); extracting from the patient's own words instead`,
        );
        return untranslated;
      }

      this.logger.log(
        `translated a "${language}" utterance for extraction in ${result.latencyMs}ms`,
      );
      return { text: result.englishText, translated: !result.passthrough };
    } catch (error) {
      // The provider contract says this cannot happen. The contract is not a
      // reason to let a background promise reject if it ever does.
      this.logger.error(
        `translation threw for a "${language}" utterance: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return untranslated;
    }
  }

  /**
   * Choose the next question and record that it was asked.
   *
   * The assistant turn is written before the response goes out, so a client
   * that drops the reply and re-reads the session gets the same question back
   * rather than skipping one. That is also why `describeSession` reads the
   * current question off the turn log instead of re-running the selector: the
   * selector would see the field it just asked sitting in `pending` and move on.
   */
  private async askNext(
    session: CaseSession,
    state: ClinicalState,
  ): Promise<{ question: NextQuestionView | null; state: ClinicalState }> {
    const selected = selectNext(state);
    if (!selected) return { question: null, state };

    // Already in the session's language: `selectNext` resolved it through the
    // phrasebook, which is checked-in data and costs nothing. The model may
    // reword it later — that is what `phraseQuestion` is for — but the patient
    // sees a complete question now, and §42's offline mode is this line rather
    // than a special case.
    //
    // This is also why translation is not a model call. The measured cost of
    // this handler is a few milliseconds plus the database round trips; a
    // per-turn translation would be eight to twenty seconds of it, sixty times
    // an interview, and nobody would have read the question it produced.
    const prompt = selected.fallbackPrompt;

    await this.repository.appendTurn(session.id, {
      role: 'assistant',
      section: selected.field.section,
      fieldKey: selected.field.key,
      questionText: prompt,
    });

    return {
      question: {
        fieldPath: selected.field.key,
        section: selected.field.section,
        label: selected.field.label,
        kind: selected.field.kind,
        choices: selected.field.choices,
        prompt,
        remaining: selected.remaining,
      },
      // `markAsked` rather than the selector's combined call, because the turn
      // row is what actually makes the question pending on the next load; this
      // keeps the in-memory state in step with it for the rest of this request.
      state: markAskedSafely(state, selected.field.key),
    };
  }

  /**
   * Persist the flags that have newly fired.
   *
   * Keyed on rule id *and* version: a rule whose conditions were rewritten is a
   * different screen, and a case that trips the new one deserves its own row
   * rather than being silently deduplicated against the old.
   */
  private async persistNewRedFlags(
    sessionId: string,
    safety: SafetyAssessment,
  ): Promise<CaseRedFlag[]> {
    if (safety.triggered.length === 0) return [];

    const existing = await this.repository.listRedFlags(sessionId);
    const seen = new Set(
      existing.map((flag) => `${flag.ruleId}@${flag.ruleVersion}`),
    );

    const created: CaseRedFlag[] = [];
    for (const rule of safety.triggered) {
      if (seen.has(`${rule.ruleId}@${rule.ruleVersion}`)) continue;
      created.push(
        await this.repository.recordRedFlag({
          sessionId,
          ruleId: rule.ruleId,
          ruleVersion: rule.ruleVersion,
          severity: rule.severity,
          matchedFacts: rule.matched as unknown as Prisma.InputJsonValue,
          // What the patient was shown, stored because it is what they read and
          // because it must never have contained a diagnosis.
          message: rule.patientMessage,
        }),
      );
    }

    return created;
  }

  /**
   * The session's denormalised view of itself.
   *
   * Written best-effort and read by nothing that matters: the facts are the
   * rows. It exists so the dashboard can show §37's progress without replaying
   * an interview, and so a clinician opening the row in a database client sees
   * something legible.
   */
  private async saveProjection(
    session: CaseSession,
    state: ClinicalState,
    safety: SafetyAssessment,
  ): Promise<void> {
    const progress = interviewProgress(state);
    const status = interviewStatus(state);
    const next = selectNext(state);

    try {
      await this.repository.touchSession(session.id, {
        progressPercent: progress.percent,
        currentSection: next?.field.section ?? session.currentSection,
        clinicalState: {
          revision: state.revision,
          interviewStatus: status,
          highestSeverity: safety.highestSeverity,
          facts: Object.fromEntries(
            Object.entries(state.facts).map(([path, fact]) => [
              path,
              fact.presence === 'recorded'
                ? { presence: fact.presence, value: fact.value }
                : { presence: fact.presence },
            ]),
          ),
        },
        sectionStatus: progress.sections as unknown as Prisma.InputJsonValue,
        // `review` rather than `submitted`: the interview has run out of
        // questions, which is not the same as the patient having sent it.
        ...(status === 'complete' && session.status === 'in_progress'
          ? { status: 'review' }
          : {}),
      });
    } catch (error) {
      // A projection that fails to write is a stale dashboard, not a lost fact.
      this.logger.warn(
        `could not update the session projection for ${session.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /** The session as the client renders it: where we are, and what is being asked. */
  private async describeSession(
    session: CaseSession,
  ): Promise<Record<string, unknown>> {
    const loaded = await this.loadState(session);
    const safety = evaluate(loaded.state);
    const progress = interviewProgress(loaded.state);
    const redFlags = await this.repository.listRedFlags(session.id);

    return {
      id: session.id,
      patientId: session.patientId,
      kind: session.kind,
      // Three fields, two meanings. `language` is the legacy name and carries
      // the input language, so a client written before the split reads exactly
      // what it always read; the two explicit names say which direction they
      // are. A client that wants to label the microphone reads `inputLanguage`;
      // one that wants to know what script the questions arrive in reads
      // `outputLanguage`.
      language: session.language,
      inputLanguage: sessionInputLanguage(session) ?? session.language,
      outputLanguage: sessionOutputLanguage(session),
      status: session.status,
      consent: {
        given: Boolean(session.consentGivenAt),
        givenAt: session.consentGivenAt,
        version: session.consentVersion,
        // The version the client should present if consent has not been given.
        requiredVersion: CONSENT_VERSION,
      },
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      submittedAt: session.submittedAt,
      progress,
      interviewStatus: interviewStatus(loaded.state),
      // Off the turn log, not the selector: the selector skips what is pending,
      // so re-running it here would hand back the question *after* the one the
      // patient is looking at.
      currentQuestion: currentQuestionFrom(loaded.turns, loaded.state),
      answeredCount: loaded.facts.length,
      outstanding: outstandingFields(loaded.state)
        .slice(0, 5)
        .map((field) => field.key),
      redFlags: redFlags.map(toPatientRedFlag),
      patientMessage: safety.patientMessage,
    };
  }

  /**
   * The age band, from the record rather than from a question.
   *
   * Recorded as `existing_record` — the hospital already knew this, the patient
   * did not just say it, and a provenance that claimed otherwise would be a
   * small lie in the one place the system has promised not to tell any.
   */
  private async seedAgeBand(
    session: CaseSession,
    patientId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const patient = await this.repository.findPatientForSession(
        patientId,
        organizationId,
      );
      const band = ageBandFrom(patient?.dateOfBirth ?? null);
      if (!band) return;

      await this.repository.recordFact({
        sessionId: session.id,
        patientId,
        row: {
          section: 'social',
          fieldPath: 'social.age_band',
          valueJson: band,
          presence: 'recorded',
          sourceType: 'existing_record',
          sourceRef: null,
          confidence: null,
          verification: 'unverified',
        },
      });
    } catch (error) {
      // A missing age band switches the paediatric rules off, which is worth a
      // warning — but it is not worth refusing to start the interview.
      this.logger.warn(
        `could not seed the age band for session ${session.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private asDomainError(error: unknown, code: ErrorCode): Error {
    if (error instanceof SidecarUnavailableError) {
      return new BadRequestException(error.patientMessage, code);
    }
    return error instanceof Error ? error : new Error('unknown failure');
  }
}

/* ────────────────────────────── pure helpers ────────────────────────────── */

/**
 * Which of the interview's two languages a voice call is about. `/stt` is the
 * patient talking, `/tts` is the interview talking back, and they have not been
 * the same language since the day output became English.
 */
type VoiceDirection = 'input' | 'output';

/**
 * The language the patient SPEAKS, or `null` when the row does not say.
 *
 * Reads `inputLanguage` and falls back to the legacy `language` column, because
 * a session that was started before the split has the patient's choice in the
 * old column and the migration's backfill is the only thing that copied it
 * across — a row restored from a pre-split dump would not have been backfilled.
 *
 * `null` rather than English when neither column holds a language we know:
 * quietly transcribing an unknown language as English is exactly the confident
 * wrong-language transcript this module exists to prevent, and a wrong
 * transcript becomes a clinical fact. The caller decides what to do with the
 * `null` — `/stt` falls back to what the request asked for, which is the
 * behaviour a legacy session already had.
 */
function sessionInputLanguage(session: CaseSession): string | null {
  for (const candidate of [session.inputLanguage, session.language]) {
    const code = normaliseLanguage(candidate);
    if (findLanguage(code)) return code;
  }
  return null;
}

/**
 * The language the patient READS AND HEARS. Always answers.
 *
 * The asymmetry with the function above is deliberate. The input language is a
 * fact about the patient that we can fail to know; the output language is a
 * decision this system makes, and it has a defined answer even for a row that
 * predates the column — `DEFAULT_OUTPUT_LANGUAGE`, which is English, which is
 * the one language whose wording a clinician here has actually signed off.
 */
function sessionOutputLanguage(session: CaseSession): string {
  const code = normaliseLanguage(session.outputLanguage);
  return findLanguage(code) ? code : DEFAULT_OUTPUT_LANGUAGE;
}

/**
 * Whether the interview's QUESTIONS come out in this language, and on whose
 * authority — the half of "supported" that the sidecar cannot answer.
 *
 * `phrasebookFor` is the authority rather than `PHRASEBOOKS`, because it is the
 * function the interview itself calls: it applies the review gate and the
 * `MEDIHIVE_ALLOW_UNREVIEWED_PHRASEBOOKS` override, so what this endpoint
 * reports and what a patient is actually asked cannot disagree. Reading the
 * registry directly would produce a picker that promises Hindi while the gate
 * quietly serves English, which is the specific confusion this field exists to
 * end.
 */
function questionCapability(code: string): {
  questions: 'none' | 'unreviewed' | 'reviewed';
  questionSource: PhrasebookSource | null;
} {
  const spoken = phrasebookFor(code);
  const declared = PHRASEBOOKS[code];
  if (!spoken) {
    return { questions: 'none', questionSource: declared?.source ?? null };
  }
  return {
    questions: spoken.reviewedAt === null ? 'unreviewed' : 'reviewed',
    questionSource: spoken.source,
  };
}

/**
 * Short enough that the whole utterance is the evidence for one field.
 *
 * A sentence boundary is disqualifying on its own, regardless of length: two
 * sentences are two things said, and the second is rarely about the question.
 */
function isShortAnswer(text: string): boolean {
  if (text.length === 0 || text.length > SHORT_ANSWER_CHARS) return false;
  // A trailing full stop is punctuation, not a second sentence.
  return !/[.!?]\s+\S/.test(text);
}

function lastAssistantFieldKey(turns: readonly CaseTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn.role === 'assistant' && turn.fieldKey) return turn.fieldKey;
  }
  return null;
}

/** The question on screen: the last one asked that has not been answered. */
function currentQuestionFrom(
  turns: readonly CaseTurn[],
  state: ClinicalState,
): NextQuestionView | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn.role !== 'assistant' || !turn.fieldKey) continue;
    const field = findField(state, turn.fieldKey);
    if (!field) continue;
    if (!Object.prototype.hasOwnProperty.call(state.pending, field.key)) {
      // Already answered. Whatever is on screen now comes from the selector.
      break;
    }
    return {
      fieldPath: field.key,
      section: field.section,
      label: field.label,
      kind: field.kind,
      choices: field.choices,
      prompt: turn.questionText ?? fallbackPhrasing(field, state.language),
      remaining: outstandingFields(state).length,
    };
  }

  const selected = selectNext(state);
  return selected
    ? {
        fieldPath: selected.field.key,
        section: selected.field.section,
        label: selected.field.label,
        kind: selected.field.kind,
        choices: selected.field.choices,
        prompt: selected.fallbackPrompt,
        remaining: selected.remaining,
      }
    : null;
}

/**
 * The fields the extraction prompt is allowed to fill.
 *
 * Unanswered fields from the whole registry rather than only the currently
 * applicable ones: a patient's opening narrative routinely answers questions
 * the interview has not unlocked yet — the HPI is gated on a known complaint,
 * and the same sentence usually supplies both. Storing an answer to a
 * not-yet-applicable field is safe, because `renderCase` prints any field that
 * has been answered and the interview simply finds it already done when it gets
 * there. Capped, because a sixty-line menu costs tokens on a model that has
 * few to spare.
 */
function extractionMenu(
  state: ClinicalState,
  askedFieldPath?: string,
): readonly FieldDefinition[] {
  const unanswered = fieldsFor(state).filter(
    (field) => readFactAt(state, field.key).presence === 'not_assessed',
  );
  const applicable = new Set(applicableFields(state).map((field) => field.key));

  const ordered = unanswered.slice().sort((a, b) => {
    // Applicable fields first — they are what the interview is about to ask —
    // then the selector's own order, so the menu and the interview agree.
    const byApplicable =
      Number(applicable.has(b.key)) - Number(applicable.has(a.key));
    return byApplicable !== 0 ? byApplicable : compareFields(a, b);
  });

  const menu = ordered.slice(0, EXTRACTION_MENU_SIZE);
  if (askedFieldPath && !menu.some((field) => field.key === askedFieldPath)) {
    const asked = ordered.find((field) => field.key === askedFieldPath);
    if (asked) menu.push(asked);
  }
  return menu;
}

/** `markAsked` throws on a malformed path; a question we just chose cannot be one. */
function markAskedSafely(
  state: ClinicalState,
  fieldPath: string,
): ClinicalState {
  try {
    return markAsked(state, fieldPath);
  } catch {
    return state;
  }
}

function sourceForModality(modality: AnswerModality): FactSource {
  switch (modality) {
    case 'voice':
      return 'patient_voice';
    case 'text':
      return 'patient_text';
    case 'correction':
      return 'patient_correction';
    case 'uploaded_document':
      return 'uploaded_document';
    case 'existing_record':
      return 'existing_record';
    case 'choice':
    case 'skip':
    case 'no_answer':
      // A tap, a skip and a timeout all reach us as a button the patient did or
      // did not press. `patient_choice` is the honest attribution for all three.
      return 'patient_choice';
    default:
      return 'patient_text';
  }
}

function toPatientRedFlag(flag: CaseRedFlag): PatientRedFlagView {
  return {
    id: flag.id,
    severity: flag.severity,
    // `message` only. See the comment on `PatientRedFlagView`.
    message: flag.message,
    triggeredAt: flag.triggeredAt,
  };
}

function toPatientSafetyView(
  safety: SafetyAssessment,
): Record<string, unknown> {
  return {
    rulesetVersion: safety.rulesetVersion,
    highestSeverity: safety.highestSeverity,
    patientMessage: safety.patientMessage,
    // A count, not the rules. The patient is told to go to the front desk; the
    // clinical summaries go to the front desk, not to them.
    triggeredCount: safety.triggered.length,
  };
}

/**
 * The review document, with the presence label spelled out on every line.
 *
 * `display` already carries it — the renderer never prints a value for a fact
 * that has none — and `presenceText` repeats it explicitly so a client cannot
 * accidentally render a blank where "Patient unsure" belongs.
 */
function toReviewView(rendered: RenderedCase): Record<string, unknown> {
  return {
    revision: rendered.revision,
    percentComplete: rendered.percentComplete,
    missingInformation: rendered.missingInformation,
    sections: rendered.sections.map((section) => ({
      section: section.section,
      title: section.title,
      percentComplete: section.percentComplete,
      outstanding: section.outstanding,
      items: section.items.map((item) => ({
        ...item,
        presenceText: presenceLabel(item.presence),
      })),
    })),
  };
}

/**
 * The band, not the age.
 *
 * `social.age_band` is a choice field with five values and the paediatric rules
 * read it as one; storing a number would invite somebody to threshold it
 * differently somewhere else.
 */
export function ageBandFrom(dateOfBirth: Date | null): string | null {
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime())) return null;

  const years =
    (Date.now() - dateOfBirth.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  if (years < 0) return null;
  if (years < 1) return 'infant';
  if (years < 12) return 'child';
  if (years < 18) return 'adolescent';
  if (years < 65) return 'adult';
  return 'older_adult';
}

/** Re-exported so the spec can assert on the vocabulary the DTO validates against. */
export { ANSWER_MODALITIES };
