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
  SectionKey,
  applyFact,
  clearPending,
  expirePending,
  markAsked,
  sectionOf,
} from './engine/clinical-state';
import { AsideIntent, classifyAside, looksInterrogative } from './engine/aside';
import {
  FieldDefinition,
  findField,
  valueSpecFor,
} from './engine/field-registry';
import { harvest, spanForAsked } from './engine/harvest';
import { leadFor } from './engine/conversation';
import {
  fallbackPhrasing,
  spokenPhrasingFor,
  interviewProgress,
  interviewStatus,
  outstandingFields,
  selectNext,
} from './engine/question-selector';
import {
  PHRASEBOOKS,
  PhrasebookSource,
  asideReplyFor,
  interviewLanguageFor,
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
  FactPresence,
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
  INTERVIEW_LANGUAGES,
  findLanguage,
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
 * ── Where the model runs in an interview, which is nowhere
 *
 * It used to run in one place: `extractInBackground`, reading a narrative for
 * the fields it answered beyond the question asked. That is `engine/harvest.ts`
 * now — a checked-in vocabulary in English, Tamil and Hindi — and the whole
 * background apparatus went with it: the fire-and-forget promise, the second
 * safety pass minutes later, the translation hop that existed only so an
 * English keyword table could read Hindi.
 *
 * What that bought is not only speed. The harvest finishes before `askNext`
 * runs, so the selector sees the volunteered facts and stops asking about the
 * three days the patient has just described — which the background job could
 * never do, because it landed two questions too late.
 *
 * The one model call left in this file is `draftReviewSummary`, behind
 * `review({narrative: true})`. It drafts prose for a clinician reading a
 * finished case, it is opt-in, and no patient waits on it.
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

/** The wording the patient agreed to. Bumped when the consent text changes. */
export const CONSENT_VERSION = '2026.09.1';

export interface NextQuestionView {
  fieldPath: string;
  section: string;
  label: string;
  kind: string;
  choices?: readonly string[];
  prompt: string;
  /**
   * The same question with no answer hint, for anything that says it out loud.
   *
   * `prompt` ends in the shape of the expected answer — "You can answer yes or
   * no." — which belongs over a row of tiles and does not belong in a
   * conversation. Spoken sixty times it is the clause that makes the interview
   * sound like a form being read at somebody.
   *
   * Sent alongside rather than instead of: the touch UI still wants the hint,
   * and a client written before this field existed still gets a complete
   * question. See `spokenPhrasingFor`.
   */
  spokenPrompt: string;
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
  /**
   * Set when the patient interrupted rather than answered, and null otherwise.
   *
   * `reply` is checked-in phrasebook copy, in the session's output language —
   * the same class of text as `nextQuestion.prompt`, and safe for a speaking
   * client to say out loud for the same reason. `intent` is the closed-set
   * member it came from, and it is there so that a client which refuses to
   * render server text — which the patient app does, deliberately — can draw
   * its own sentence for the intent instead.
   *
   * When this is set, `nextQuestion` is the question that was already on the
   * table, asked again. See `submitTurn`.
   */
  aside: { intent: AsideIntent; reply: string } | null;
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
 * The default name of the worker this API dispatches an interview to.
 *
 * Must match `AGENT_NAME` in `voice-agent/agent.py`. They are two languages
 * naming one worker: if they drift, this creates a dispatch for an agent
 * nobody is registered as, LiveKit has nothing to hand it to, and the patient
 * waits in a room that never gets a second participant. Nothing fails loudly,
 * which is exactly why the constant is named on both sides rather than typed
 * twice.
 *
 * Overridable per environment with `VOICE_AGENT_NAME`, and the reason is that
 * a LiveKit project is shared by everyone holding its credentials. The name is
 * the only thing a dispatch routes on, so two machines running the worker
 * under one name are two candidates for every job and LiveKit picks one. A
 * developer's interview then gets served by whichever worker won — possibly a
 * checkout on another desk, which joins the room, publishes nothing because it
 * cannot reach this machine's API or sidecar, and leaves the handset with a
 * participant that never speaks.
 *
 * `dispatchVoiceAgent` then makes it permanent: an agent is in the room, so it
 * declines to dispatch another. Naming each environment's worker separately is
 * what keeps one project's credentials from turning into one shared worker
 * pool. See `voice-agent/agent.py`.
 */
const DEFAULT_VOICE_AGENT_NAME = 'medihive';

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
     * Optional: a box with no LiveKit
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
      // The OUTPUT language follows, which it did not use to. A patient who
      // resumes in Tamil is asked in Tamil from the next question on — the
      // questions already asked keep the language they were asked in, because
      // the turn log records what was actually put to them.
      const chosen = normaliseLanguage(dto.language);
      const resumed =
        chosen && chosen !== sessionInputLanguage(existing)
          ? await this.repository.touchSession(existing.id, {
              language: chosen,
              inputLanguage: chosen,
              outputLanguage: interviewLanguageFor(chosen),
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
      // `inputLanguage` is the patient's choice. `outputLanguage` is derived
      // from it and never taken from the request, so a handset still cannot put
      // an unreviewed clinical translation in front of a patient by sending a
      // field — `interviewLanguageFor` asks the same review gate the renderer
      // asks, and answers English for any language whose questions would not
      // actually be spoken.
      //
      // `language` is the legacy column, kept in step with `inputLanguage` so
      // that the mobile client, the demo seed and anything else written before
      // the split keeps reading the value it always read. Nothing routes off it.
      language: inputLanguage,
      inputLanguage,
      outputLanguage: interviewLanguageFor(inputLanguage),
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

    // ── Did they answer, or did they interrupt? ─────────────────────────────
    //
    // Asked first, before anything is filed, because an interruption filed as
    // an answer is not recoverable from downstream: the field goes pending,
    // `askableFields` skips it, and the question is never put again. The
    // observed case was "Could he have been out?" against a fever question —
    // the fever answer was lost, and the patient's own question was never
    // acknowledged by anything.
    //
    // Only free speech and typing can be an aside. A tapped tile is a value the
    // patient chose off the screen in front of them; reading one as chatter
    // would be this system arguing with a button it drew itself.
    const spoken = modality === 'voice' || modality === 'text';
    const declaredAside = spoken ? classifyAside(answerText) : null;

    const patientTurn = await this.repository.appendTurn(session.id, {
      role: 'patient',
      // An aside is filed against no field. It is a real thing the patient
      // said and the transcript keeps it, but it is not evidence for the
      // question that happened to be on the table, and labelling it as though
      // it were is what a clinician reading the log back would be misled by.
      section: !declaredAside && answeredPath ? sectionOf(answeredPath) : null,
      fieldKey: declaredAside ? null : answeredPath,
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

    let aside: AsideIntent | null = declaredAside;

    if (field && !aside) {
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
        // The clause that answers the question, out of a turn that may answer
        // several. Null for a single-clause answer, where `applyAnswer`'s own
        // short-answer rule is already right.
        evidenceSpan:
          spanForAsked(
            answerText,
            field,
            sessionInputLanguage(session) ?? DEFAULT_LANGUAGE,
          ) ?? undefined,
      });
      state = applied.state;
      derivation = applied.derivation;
      factId = applied.factId;

      // ── An unreadable answer puts the question back ─────────────────────
      //
      // `markAsked` files a field under `state.pending` the moment it is put to
      // the patient, and `askableFields` skips everything pending. That was
      // right when `pending` meant "gemma3:4b is reading this answer, do not
      // ask again while it works": the extraction came back seconds later and
      // cleared it.
      //
      // Extraction is gone. `markPending` has no callers left and
      // `extraction.queued` is hard-coded false, so `pending` now means only
      // "asked, and not yet answered readably" — and nothing is in flight to
      // clear it. A `not_assessed` derivation therefore retired the question
      // instead of repeating it, which is the opposite of what
      // `acknowledgementFor` in engine/conversation.ts already says happens:
      //
      //   `not_assessed` means the answer was not readable and the question is
      //   about to be asked again
      //
      // Measured on a live voice session, 2026-09-20 20:26-20:28: the patient
      // answered `allergies.reported` with something the field could not read,
      // the field stayed pending, nothing else was askable, and
      // `interviewStatus` answered `awaiting_extraction` with `nextQuestion:
      // null` for three turns running. The worker logged "engine returned
      // nothing to say" each time and said nothing. From the patient's side the
      // interview simply stopped, with a question still on the screen, and only
      // `releaseLostExtractions`' two-minute wall clock would ever have ended
      // it.
      //
      // So the field goes back in the queue and the selector asks it again,
      // which is what a person does when an answer did not make sense.
      if (
        answeredPath &&
        derivation.presence === 'not_assessed' &&
        timesAsked(loaded.turns, answeredPath) < MAX_ASKS_PER_FIELD
      ) {
        state = clearPending(state, answeredPath);
      }

      // ── The second stage, and the only one that may run after derivation ──
      //
      // `classifyAside` above is a closed list of phrasings and misses anything
      // it was not written for. This catches the rest, and it is safe to be
      // vague here precisely because of where it sits: the field's own phrase
      // lists have already been handed the utterance and have declined to read
      // it as an answer. Nothing is taken away from the patient by calling it
      // an interruption at this point — `not_assessed` wrote no fact row, which
      // is why `applyAnswer` can be allowed to run first at all.
      //
      // `text` fields are exempt, and that exemption is the interesting part.
      // A free-text field stores whatever it is given, so derivation never
      // fails, so this branch can never fire for one — which is correct rather
      // than merely convenient: "why does my chest hurt?" is a chief complaint
      // phrased as a question, and an interview that answered it with "I can
      // only take down your answers" instead of writing it down would have
      // thrown away the most important sentence in the session.
      if (
        derivation.presence === 'not_assessed' &&
        field.kind !== 'text' &&
        looksInterrogative(answerText)
      ) {
        aside = 'unrelated';
      }
    }

    if (aside) {
      return this.answerAside({
        session,
        state,
        intent: aside,
        askedFieldPath: answeredPath,
        turnId: patientTurn.id,
        startedAt,
      });
    }

    // ── Everything else the patient just told us ────────────────────────────
    //
    // In front of the response, not behind it, and that is the change the model
    // leaving paid for. This used to be `extractInBackground`: a fire-and-forget
    // job that woke gemma3:4b, waited eight to twenty seconds, re-read a state
    // by then two questions stale, and wrote its facts into a session the
    // patient had moved on from. `harvest` is regex matching over one sentence
    // and costs microseconds, so its facts land *before* `askNext` runs — which
    // means the selector can see them, and the interview stops asking about the
    // three days the patient has just described.
    //
    // The patient's own language, never the output one. These are their words.
    const harvested = await this.harvestVolunteered({
      session,
      patientId,
      state,
      utterance: answerText,
      askedFieldPath: answeredPath,
      modality,
      sourceRef: patientTurn.id,
      language: sessionInputLanguage(session) ?? DEFAULT_LANGUAGE,
    });
    state = harvested.state;

    // ── Safety, over the state as it now stands ─────────────────────────────
    const safety = evaluate(state);
    const redFlags = await this.persistNewRedFlags(session.id, safety);

    // ── The next question, from the selector, with no model in the path ─────
    const next = await this.askNext(session, state, {
      presence: derivation ? derivation.presence : null,
      previousSection: answeredPath ? sectionOf(answeredPath) : null,
      // A rule that has just fired is about to be spoken as a routing
      // instruction. "Good." in front of it is the interview sounding pleased
      // about the answer that triggered it.
      safetyFired: redFlags.length > 0,
    });

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
      extraction: {
        // Kept on the wire, always false, and worth a sentence rather than a
        // deletion: the app reads it to draw a "still reading this properly"
        // mark under an answer. Nothing is read later any more — the harvest
        // finished before this response was built — so the mark is never
        // earned, and the field says so rather than disappearing and taking an
        // older client's parser with it.
        queued: false,
        reason:
          harvested.fields.length > 0
            ? `read ${harvested.fields.length} more field(s) from the same answer`
            : 'the engine read the answer in full',
      },
      aside: null,
      nextQuestion: next.question,
      interviewStatus: interviewStatus(next.state),
      progress: interviewProgress(next.state),
      redFlags: redFlags.map(toPatientRedFlag),
      patientMessage: safety.patientMessage,
      serverTimeMs: Date.now() - startedAt,
    };
  }

  /**
   * The patient interrupted. Answer them, then ask the same question again.
   *
   * ── Why this is a separate path and not a flag on the normal one
   *
   * Almost everything the answer path does is wrong for an interruption. No
   * fact is derived, because nothing was asserted. No extraction is queued,
   * because there is nothing in "how much longer is this?" for a model to bank
   * — and queuing one would spend eight to twenty seconds of the box's only
   * GPU slot on a question about the clock. No red flag can newly fire, because
   * the clinical state is byte-identical to the one the last turn already
   * evaluated. Reaching the same conclusion through the normal path would mean
   * four guards in four places, each of which could be got wrong separately.
   *
   * ── The one line that actually fixes the reported bug
   *
   * `clearPending`. The question was marked pending the moment it was spoken —
   * that is `askNext`'s job and it is correct — and `askableFields` filters
   * pending fields out so that a question being extracted is not asked twice in
   * a row. An interruption is the case where that filter is wrong: nothing is
   * being extracted, nothing is coming back, and left pending the field ages
   * out two questions later having never been answered. Releasing it puts the
   * state back exactly as it stood before the question was put, so `selectNext`
   * — a pure function of that state — chooses the same field again. The patient
   * hears their answer, and then hears the question they were actually asked.
   *
   * ── What it does NOT do, and should not
   *
   * It does not count the interruption against the question budget, does not
   * re-word the question (see `phrasebook.ts` on why a clinical question is
   * never re-worded on the fly), and does not give up after N attempts. A
   * patient who interrupts twice gets asked twice, the same as they would by a
   * person. `expirePending` is still the backstop for a field nobody ever
   * answers, and the question budget is still the ceiling on the interview's
   * length.
   */
  private async answerAside(input: {
    session: CaseSession;
    state: ClinicalState;
    intent: AsideIntent;
    askedFieldPath: string | null;
    turnId: string;
    startedAt: number;
  }): Promise<TurnResult> {
    const { session, intent, askedFieldPath } = input;

    // Back to the state as it stood before the question was put. When there was
    // no question on the table — an aside as the first thing said in the room —
    // this is a no-op and the selector simply opens the interview.
    const released = askedFieldPath
      ? clearPending(input.state, askedFieldPath)
      : input.state;

    const reply = asideReplyFor(intent, sessionOutputLanguage(session));

    // The acknowledgement goes in the log as something the interview said,
    // against no field. A clinician reading the transcript back sees the
    // interruption and the reply in the place they happened, which is the only
    // way the repeated question below makes sense to them.
    await this.repository.appendTurn(session.id, {
      role: 'assistant',
      section: null,
      fieldKey: null,
      questionText: reply,
    });

    const next = await this.askNext(session, released);

    // Pure, and over a state nothing has changed, so this can only return what
    // the previous turn already returned. Read for the projection's
    // `highestSeverity` and for nothing else — see the response below.
    const safety = evaluate(next.state);
    await this.saveProjection(session, next.state, safety);

    this.logger.log(
      `aside ${intent} on ${askedFieldPath ?? 'no field'}; re-asking ${
        next.question?.fieldPath ?? 'nothing'
      }`,
    );

    return {
      turnId: input.turnId,
      sessionId: session.id,
      accepted: {
        // Nothing was accepted. `fieldPath` is null rather than the question
        // that was on the table, because a client reading this back must not
        // mark that question as dealt with — it is about to be asked again.
        fieldPath: null,
        presence: null,
        value: undefined,
        reason: `aside:${intent}`,
        needsPatientConfirmation: false,
        factId: null,
      },
      extraction: {
        queued: false,
        reason: 'the patient asked something rather than answering',
      },
      aside: { intent, reply },
      nextQuestion: next.question,
      interviewStatus: interviewStatus(next.state),
      progress: interviewProgress(next.state),
      // Both empty on purpose. No fact changed, so no rule can newly fire, and
      // repeating the standing routing instruction — "tell the front desk now"
      // — after every "thank you" would train a patient to stop hearing it. The
      // banner on the patient's screen is driven by the session, which still
      // holds every flag that has fired.
      redFlags: [],
      patientMessage: null,
      serverTimeMs: Date.now() - input.startedAt,
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

    // Per row now, not once. `outputLanguage` used to be the same on every row
    // because it was the same on every session — English, always — and the
    // comment here said so. It follows the patient's choice wherever the
    // questions exist in it, so Tamil answers Tamil and Bengali still answers
    // English, and the row has to say which.
    const outputFor = (code: string): { language: string; tts: boolean } => {
      const language = interviewLanguageFor(code);
      return {
        language,
        tts: known
          ? live[language]?.tts === true
          : findLanguage(language)?.tts === true,
      };
    };

    return {
      default: DEFAULT_LANGUAGE,
      source: known ? 'sidecar' : 'catalogue',
      // `INTERVIEW_LANGUAGES`, not `SUPPORTED_LANGUAGES`: the picker shows the
      // languages the whole interview exists in, which is three of the twelve
      // the sidecar can hear. See the note beside the constant.
      languages: INTERVIEW_LANGUAGES.map((language) => {
        const reported = live[language.code];
        const output = outputFor(language.code);
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
          // What a patient picking THIS row actually gets: the language the
          // questions will be in, and whether there is a voice to read them
          // aloud. No longer the same on every row — picking Tamil gets a Tamil
          // interview, picking Bengali gets an English one — so a client must
          // read these off the row it is rendering rather than off a rule
          // written down somewhere else.
          outputLanguage: output.language,
          outputTts: output.tts,
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
      // The app sets `inputLanguage` and `outputLanguage` as participant
      // attributes on join, so an agent reading them needs no round trip. That
      // is a metadata write, LiveKit defaults the permission to false, and
      // without it the join fails outright:
      //
      //     NOT_ALLOWED - does not have permission to update own metadata
      //
      // — after the media path is fully up, which made it look like a broken
      // microphone rather than a missing claim on a token.
      //
      // Safe to grant, and narrowly so: it permits a participant to write its
      // *own* attributes in its *own* room, and nothing downstream trusts them.
      // The authority on what the patient speaks is the session row — that is
      // why `languages` above is read off the session and not off `dto`, and
      // why the same pair travels in this token's metadata and on the dispatch.
      // These attributes are a convenience for the agent, not a second source
      // of truth it could be talked into believing.
      canUpdateOwnMetadata: true,
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
  /**
   * The worker name this environment dispatches to.
   *
   * Read per call rather than cached in a field: `ConfigService` is the one
   * source, and a value read once at construction is a value that cannot be
   * corrected without a restart of the API — which is the opposite of what a
   * per-machine override is for. The read is a map lookup.
   *
   * Trimmed, and an empty string falls back, because `VOICE_AGENT_NAME=` with
   * nothing after it is what a half-finished .env line looks like, and
   * dispatching to `''` is a dispatch no worker is registered for.
   */
  private get voiceAgentName(): string {
    const configured = this.config?.get<string>('VOICE_AGENT_NAME')?.trim();
    return configured || DEFAULT_VOICE_AGENT_NAME;
  }

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
      const agentName = this.voiceAgentName;

      await dispatcher.createDispatch(roomName, agentName, {
        metadata: JSON.stringify({
          sessionId,
          token: this.mintWorkerToken(user, ttlSeconds),
          inputLanguage: languages.input,
          outputLanguage: languages.output,
        }),
      });
      this.logger.log(`dispatched ${agentName} to ${roomName}`);
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
     * The words to judge this field's presence by, when they are a part of the
     * turn rather than all of it. See `spanForAsked`.
     */
    evidenceSpan?: string;
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
      //
      // `evidenceSpan` overrides both: the caller has picked the clause out of
      // a longer turn, which is the only thing that stops "chest pain for three
      // days, no fever" being filed as an absent chief complaint.
      evidenceSpan:
        input.evidenceSpan ??
        (isShortAnswer(input.text) ? input.text : undefined),
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
   * Everything the patient volunteered beyond the question they were asked.
   *
   * ── What this is the replacement for
   *
   * `extractInBackground`, and through it `LlmProvider.extractFacts`. The shape
   * is deliberately similar — candidates in, `applyAnswer` for each, the engine
   * still deciding every presence — because the shape was never the problem.
   * What changed is where the candidates come from: a checked-in vocabulary
   * (`engine/harvest.ts`) instead of a 4B model, which makes this fast enough
   * to run in front of the response instead of behind it.
   *
   * ── Why it may run synchronously when the model could not
   *
   * Measured: gemma3:4b took eight seconds for a two-fact extraction and twenty
   * for a seven-fact one, warm, on a card it never fully fits in. Nothing may
   * make a patient wait that long between a sentence and the next question, so
   * the model had to be fire-and-forget, which cost the interview two things it
   * is now getting back — the selector seeing the harvested facts before it
   * chooses, and the safety rules evaluating over them in the same turn rather
   * than minutes later.
   *
   * ── What it is still not allowed to do
   *
   * Decide anything. Every span goes through `applyAnswer`, which calls
   * `derivePresence`, which is the only function in this system permitted to
   * turn words into a presence. A harvested span that reads as "I don't know"
   * records `unknown`; one that fails the field's shape records nothing at all
   * and leaves the question askable.
   */
  private async harvestVolunteered(input: {
    session: CaseSession;
    patientId: string;
    state: ClinicalState;
    utterance: string;
    askedFieldPath: string | null;
    modality: AnswerModality;
    sourceRef: string;
    language: string;
  }): Promise<{ state: ClinicalState; fields: readonly string[] }> {
    // A tapped tile answers exactly one field and carries no narrative. Reading
    // a button press for extra facts would be inventing them.
    if (input.modality === 'choice' || input.utterance.length === 0) {
      return { state: input.state, fields: [] };
    }

    const candidates = harvest({
      state: input.state,
      utterance: input.utterance,
      language: input.language,
      askedFieldPath: input.askedFieldPath ?? undefined,
    });
    if (candidates.length === 0) {
      return { state: input.state, fields: [] };
    }

    let state = input.state;
    const written: string[] = [];

    for (const candidate of candidates) {
      const field = findField(state, candidate.fieldPath);
      if (!field) continue;

      const applied = await this.applyAnswer({
        session: input.session,
        patientId: input.patientId,
        state,
        field,
        modality: input.modality,
        // The clause, not the whole turn. This is the entire reason `harvest`
        // returns a span: given the whole turn, "three days, I don't know about
        // allergies" derives the duration as unknown, because the uncertainty
        // phrase is in there somewhere.
        text: candidate.span,
        value: candidate.span,
        sourceRef: input.sourceRef,
        source: sourceForModality(input.modality),
        verification: 'unverified',
      });

      if (applied.factId) {
        state = applied.state;
        written.push(candidate.fieldPath);
        this.logger.debug(
          `harvested ${candidate.fieldPath} (${candidate.reason})`,
        );
      }
    }

    return { state, fields: written };
  }

  private async askNext(
    session: CaseSession,
    state: ClinicalState,
    /**
     * What just happened, so the question can be led into rather than fired.
     *
     * Omitted by callers with nothing to acknowledge — the opening question of
     * an interview, and `answerAside`, where the patient has already been
     * answered and the question is being repeated rather than introduced.
     */
    lead?: {
      presence: FactPresence | null;
      previousSection: SectionKey | null;
      safetyFired: boolean;
    },
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
    // The two or three words in front of the question — an acknowledgement of
    // the answer just given, and a lead-in when the subject changes. Checked-in
    // phrasebook copy in the session's own language, so it is the same class of
    // text as the question itself and travels the same way. See
    // `engine/conversation.ts` for why it is not a model.
    const opener = lead
      ? leadFor({
          presence: lead.presence,
          previousSection: lead.previousSection,
          nextSection: selected.field.section,
          language: state.language,
          // The revision counts questions asked, which is exactly the "how far
          // in are we" this needs to vary the wording without randomness.
          turnIndex: state.revision,
          safetyFired: lead.safetyFired,
        })
      : '';

    const prompt = joinSpoken(opener, selected.fallbackPrompt);

    await this.repository.appendTurn(session.id, {
      role: 'assistant',
      section: selected.field.section,
      fieldKey: selected.field.key,
      // What was actually put to the patient, opener and all. A clinician
      // reading the log back sees the interview as it was conducted.
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
        spokenPrompt: joinSpoken(
          opener,
          spokenPhrasingFor(selected.field, state.language),
        ),
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
/**
 * How many times one question may be asked before the interview moves on.
 *
 * Three: the question, and two more goes at it. The bound exists because the
 * re-ask above is otherwise unconditional, and a patient whose answers the
 * field cannot read — a recogniser mangling every utterance, a scale question
 * answered in words the phrasebook has no entry for — would hear the same
 * sentence until they gave up.
 *
 * Past the bound the field simply stays pending, which is the behaviour that
 * was there before: `askableFields` skips it, the selector moves to the rest of
 * the interview, and `expirePending` releases it a couple of questions later so
 * it can be tried once more with the rest of the section behind it. Nothing is
 * written to the chart either way — an unreadable answer is `not_assessed` and
 * files no fact — so the question is left unanswered rather than guessed at.
 *
 * The other way out is the one the app draws: a question with `choices` is a
 * row of tiles, and a tapped tile is `modality: 'choice'`, which needs no
 * phrase matching and works in every language.
 */
const MAX_ASKS_PER_FIELD = 3;

function isShortAnswer(text: string): boolean {
  if (text.length === 0 || text.length > SHORT_ANSWER_CHARS) return false;
  // A trailing full stop is punctuation, not a second sentence.
  return !/[.!?]\s+\S/.test(text);
}

/**
 * How many times one question has already been put to the patient.
 *
 * Read off the assistant turns rather than counted on the state, because the
 * state is rebuilt from those turns on every request and carries no memory of
 * its own.
 */
function timesAsked(turns: readonly CaseTurn[], fieldPath: string): number {
  let asked = 0;
  for (const turn of turns) {
    if (turn.role === 'assistant' && turn.fieldKey === fieldPath) asked++;
  }
  return asked;
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
      // Off the registry, never off `turn.questionText`: the stored text is
      // what was asked *with* its hint, and stripping a clause back off a
      // sentence is guesswork the phrasebook can answer exactly.
      spokenPrompt: spokenPhrasingFor(field, state.language),
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
        spokenPrompt: spokenPhrasingFor(selected.field, state.language),
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
/**
 * An opener and a question, as one thing said.
 *
 * A plain join, because every part is a finished sentence with its own
 * punctuation — "Alright." and "Now about your health in the past." and the
 * question. Nothing here builds a sentence out of fragments: word order is the
 * first thing a translation moves, and a line assembled at a call site is a
 * line that cannot be re-ordered.
 */
function joinSpoken(opener: string, question: string): string {
  const lead = opener.trim();
  return lead.length > 0 ? `${lead} ${question.trim()}` : question;
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
