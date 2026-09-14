import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CaseTakingService, TurnResult } from './case-taking.service';
import {
  CaseConsentDto,
  CorrectFactDto,
  SpeakDto,
  StartCaseSessionDto,
  SubmitTurnDto,
  TranscribeDto,
} from './dto/case-taking.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  PatientScope,
  PatientSelfGuard,
} from '../../common/guards/patient-self.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ForbiddenException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';

/**
 * The patient's own intake, and nobody else's.
 *
 * ── Why the route parameter is `:sessionId` and not `:id`
 *
 * `PatientSelfGuard` rewrites `params.id` to the caller's own patient id, by
 * design: a handler that reads `@Param('id')` out of habit on a patient-scoped
 * route then gets the right record instead of silently serving somebody else's.
 * The rewrite is keyed on the *name*, so a session id arriving as `:id` would
 * be overwritten with a patient id before this controller ever saw it — and the
 * lookup would fail in a way that looks like a missing session. Naming the
 * parameter `:sessionId` keeps the URL shape the spec asks for
 * (`/sessions/abc123/turns`) and keeps the guard's belt-and-braces rewrite
 * pointed at what it was written for.
 *
 * ── Why staff cannot read these routes
 *
 * `@PatientScope()` resolves to the caller's own patient id, and to `undefined`
 * for a staff caller who named no patient — which is every staff caller here,
 * because there is no patient id anywhere in these URLs. Rather than invent a
 * default, these handlers refuse. A clinician reads a finished intake through
 * the submission on the patient record, which is what it is for; a live
 * interview belongs to the person having it.
 */
@ApiTags('Case Taking')
@ApiBearerAuth()
@UseGuards(PatientSelfGuard, PermissionsGuard)
@Controller('case-taking')
export class CaseTakingController {
  constructor(private readonly caseTakingService: CaseTakingService) {}

  @Post('sessions')
  @Permissions(Permission.CASE_TAKING_CREATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an interview, or resume the one already open',
    description:
      'One open session per patient. Returns `resumed: true` when it handed ' +
      'back an existing session rather than creating one — 200 either way, ' +
      'because from the patient\'s side both are "carry on".',
  })
  async startOrResume(
    @Body() dto: StartCaseSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.startOrResume(dto, user, self(patientId));
  }

  /**
   * Declared before `:sessionId`, and it has to be: Nest matches routes in
   * declaration order, so the parameterised route would otherwise swallow
   * `current` and look up a session with that id.
   */
  @Get('sessions/current')
  @Permissions(Permission.CASE_TAKING_READ)
  @ApiOperation({ summary: 'The interview you have open, if you have one' })
  async current(
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown> | null> {
    return this.caseTakingService.currentSession(user, self(patientId));
  }

  @Get('sessions/:sessionId')
  @Permissions(Permission.CASE_TAKING_READ)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiOperation({
    summary: 'Where an interview has got to, and what it is asking',
  })
  async getSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.getSession(sessionId, user, self(patientId));
  }

  @Post('sessions/:sessionId/consent')
  @Permissions(Permission.CASE_TAKING_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiOperation({
    summary: 'Record consent, or a refusal',
    description:
      'The version of the wording is stored beside the timestamp: which text ' +
      'somebody agreed to matters as much as that they agreed.',
  })
  async consent(
    @Param('sessionId') sessionId: string,
    @Body() dto: CaseConsentDto,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.recordConsent(
      sessionId,
      dto,
      user,
      self(patientId),
    );
  }

  /**
   * The hot path.
   *
   * Answers from the engine alone — presence derivation, safety rules and
   * question selection are all pure and synchronous — so the next question is
   * in the response rather than eight to twenty seconds behind it. Any model
   * work this turn triggers runs after the response has gone out and lands as
   * new facts later; `extraction.queued` in the body says whether that
   * happened, and `serverTimeMs` reports what the handler actually cost.
   */
  @Post('sessions/:sessionId/turns')
  @Permissions(Permission.CASE_TAKING_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiOperation({ summary: 'Answer the current question and get the next one' })
  async submitTurn(
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitTurnDto,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<TurnResult> {
    return this.caseTakingService.submitTurn(
      sessionId,
      dto,
      user,
      self(patientId),
    );
  }

  @Patch('sessions/:sessionId/facts/:factId')
  @Permissions(Permission.CASE_TAKING_UPDATE)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiParam({ name: 'factId', type: String })
  @ApiOperation({
    summary: 'Correct something we got wrong',
    description:
      'Writes a new fact and points the old one at it. Never an update — the ' +
      'disagreement between the two readings is the part a clinician needs.',
  })
  async correct(
    @Param('sessionId') sessionId: string,
    @Param('factId') factId: string,
    @Body() dto: CorrectFactDto,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.correctFact(
      sessionId,
      factId,
      dto,
      user,
      self(patientId),
    );
  }

  @Get('sessions/:sessionId/review')
  @Permissions(Permission.CASE_TAKING_READ)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiOperation({
    summary: 'Here is what we understood about you',
    description:
      'Immediate: the document is rendered by the engine with no model in the ' +
      'path. Pass `narrative=true` to also wait for a prose read-back, which ' +
      'costs a model call.',
  })
  async review(
    @Param('sessionId') sessionId: string,
    @Query() query: ReviewQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.review(sessionId, user, self(patientId), {
      narrative: query.narrative === true,
    });
  }

  @Post('sessions/:sessionId/submit')
  @Permissions(Permission.CASE_TAKING_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'sessionId', type: String })
  @ApiOperation({
    summary: 'Send the finished case to the hospital',
    description:
      'Writes a CaseSubmission and attaches it to the patient record. It does ' +
      'not open a consultation, a queue entry or a pre-triage screening: a ' +
      'submitted intake is a document waiting to be read.',
  })
  @ApiResponse({ status: 200 })
  async submit(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.submit(sessionId, user, self(patientId));
  }

  /* ───────────────────────────── voice seams ───────────────────────────── */

  @Post('stt')
  @Permissions(Permission.CASE_TAKING_UPDATE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      // The same ceiling the sidecar enforces and the mobile client refuses
      // before it uploads. Three places agreeing is two places too many, but
      // the alternative is a patient watching a 10 MB upload succeed and then
      // be rejected.
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        language: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Transcribe a recorded answer',
    description:
      'A refusal here is a 400 with a written sentence, not a 500: voice is ' +
      'never the only way to answer a question, so the client falls back to ' +
      'the keyboard.',
  })
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: TranscribeDto,
  ): Promise<Record<string, unknown>> {
    return this.caseTakingService.transcribe(file, dto.language);
  }

  /**
   * Returns audio, so it steps outside `ResponseInterceptor`'s envelope.
   *
   * `@Res({ passthrough: false })` is the only way to send a binary body here,
   * and it is the reason this handler writes its own headers. Everything else
   * in this controller returns a plain object and is wrapped.
   */
  @Post('tts')
  @Permissions(Permission.CASE_TAKING_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a question aloud' })
  @ApiResponse({ status: 200, description: 'audio/wav' })
  async speak(@Body() dto: SpeakDto, @Res() res: Response): Promise<void> {
    const audio = await this.caseTakingService.speak(dto.text, dto.language);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', audio.length);
    res.send(audio);
  }
}

/**
 * The patient this request is about.
 *
 * Undefined means a caller with no patient record who named no patient — a
 * staff account on a route that has no patient id in it. Refused rather than
 * defaulted, for the reason `PatientSelfGuard` refuses an unlinked patient
 * account: guessing which record was meant is exactly the mistake worth
 * refusing.
 */
function self(patientId: string | undefined): string {
  if (!patientId) {
    throw new ForbiddenException(
      'These routes are for a patient reading their own intake. A clinician reads a submitted case on the patient record.',
      ErrorCodes.PATIENT_PORTAL_NOT_LINKED,
    );
  }
  return patientId;
}
