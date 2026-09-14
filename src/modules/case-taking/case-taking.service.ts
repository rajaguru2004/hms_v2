import { Inject, Injectable, Logger } from '@nestjs/common';
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
  StartCaseSessionDto,
  SubmitTurnDto,
} from './dto/case-taking.dto';
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
import { SidecarClient, SidecarUnavailableError } from '../ai/sidecar.client';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../common/exceptions/app.exception';
import { ErrorCode, ErrorCodes } from '../../common/exceptions/error-codes';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

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

@Injectable()
export class CaseTakingService {
  private readonly logger = new Logger(CaseTakingService.name);

  constructor(
    private readonly repository: CaseTakingRepository,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly sidecar: SidecarClient,
    private readonly auditService: AuditService,
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
      const view = await this.describeSession(existing);
      return { ...view, resumed: true };
    }

    const session = await this.repository.create({
      organization: { connect: { id: user.organizationId } },
      patient: { connect: { id: patientId } },
      kind: dto.kind ?? 'new_consultation',
      language: dto.language ?? 'en',
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
      newValues: { status: session.status, language: session.language },
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
        language: session.language,
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
        `We could not read that as an answer to "${field.label}". ${fallbackPhrasing(field)}`,
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
        language: session.language,
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
      language: session.language,
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

  /* ═════════════════════════════ voice seams ══════════════════════════════ */

  async transcribe(
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    language?: string,
  ): Promise<Record<string, unknown>> {
    try {
      const transcript = await this.sidecar.transcribe(file.buffer, {
        filename: file.originalname,
        mimeType: file.mimetype,
        language,
      });
      return { ...transcript, available: true };
    } catch (error) {
      // A refusal, not a 500. Voice is never the only way to answer a question
      // (§10), so the honest response is the written sentence plus a signal the
      // client can use to fall back to the keyboard.
      throw this.asDomainError(error, ErrorCodes.AI_SIDECAR_UNAVAILABLE);
    }
  }

  async speak(text: string, language = 'en'): Promise<Buffer> {
    try {
      return await this.sidecar.speak(text, language);
    } catch (error) {
      throw this.asDomainError(error, ErrorCodes.AI_SIDECAR_UNAVAILABLE);
    }
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

    const state = expirePending(
      rebuildState({
        sessionId: session.id,
        startedAt: session.startedAt,
        language: session.language,
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
      language: input.state.language,
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
  }): { queued: boolean; reason: string } {
    if (input.text.length === 0) {
      return { queued: false, reason: 'no free text in this turn' };
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

      const result = await this.llm.extractFacts({
        utterance: input.utterance,
        candidateFields: menu,
        askedFieldPath: input.askedFieldPath,
        language: input.language,
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
          text: extracted.evidenceSpan ?? input.utterance,
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

    // The registry's own phrasing. The model may reword it later — that is what
    // `phraseQuestion` is for — but the patient sees a complete question now,
    // and §42's offline mode is this line rather than a special case.
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
      language: session.language,
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
      prompt: turn.questionText ?? fallbackPhrasing(field),
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
