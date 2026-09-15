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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { BadRequestException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  PatientScope,
  PatientSelfGuard,
} from '../../common/guards/patient-self.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PaginatedResult } from '../../common/types/paginated.type';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CorrectExtractionDto } from './dto/correct-extraction.dto';
import { PatientDocumentQueryDto } from './dto/patient-document-query.dto';
import {
  DocumentCorrectionResponseDto,
  PatientDocumentOriginalDto,
  PatientDocumentResponseDto,
} from './dto/patient-document-response.dto';
import { UploadPatientDocumentDto } from './dto/upload-patient-document.dto';
import {
  DocumentCaller,
  DocumentCorrectionResponse,
  PatientDocumentResponse,
  PatientDocumentsService,
  PATIENT_DOCUMENT_MAX_BYTES,
  PATIENT_DOCUMENT_MIME_TYPES,
} from './patient-documents.service';
import { UNSUPPORTED_FILE } from './pipeline/messages';

/**
 * The patient dashboard's Medical Documents surface (§3).
 *
 * Every route is behind `PatientSelfGuard`, so a PATIENT caller's own id is
 * substituted for whatever id the request carried. That is what makes
 * `GET /:documentId` on somebody else's document a 404 rather than a leak: the
 * query the service runs is scoped to the caller's patient, so the row is not
 * there to return.
 *
 * ── Why the route parameter is `:documentId` and not `:id`
 *
 * `PatientSelfGuard` rewrites `params.id` to the caller's own patient id — it
 * is keyed on the *name*, and `id` is one of the two spellings a patient id
 * arrives under. A document id named `:id` was therefore overwritten with a
 * patient id before this controller ever saw it, and every one of these routes
 * answered its own owner with "That document could not be found." The URL shape
 * is unchanged; only the parameter's name is, which is the same fix and the
 * same reason `CaseTakingController` names its parameter `:sessionId`.
 */
@ApiTags('Patient Documents')
@ApiBearerAuth()
@UseGuards(PatientSelfGuard, PermissionsGuard)
@Controller('patient-documents')
export class PatientDocumentsController {
  constructor(private readonly service: PatientDocumentsService) {}

  /**
   * Upload or capture a medical document.
   *
   * The field name is `file` because that is the shape the mobile client
   * already posts, and it is the shape the radiology upload route established.
   *
   * The `fileFilter` here and the mime check inside `ObjectStorageService` are
   * both deliberate. This one keeps a 60 MB video out of the process heap —
   * Multer buffers before anything else runs — and the one downstream is
   * because the storage service is a public API that the next caller may reach
   * without passing through this route.
   */
  @Post()
  @Permissions(Permission.PATIENT_DOCUMENT_CREATE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PATIENT_DOCUMENT_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (
          !(PATIENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          // A sentence, not a type list, because this one reaches a patient.
          callback(
            new BadRequestException(
              UNSUPPORTED_FILE,
              ErrorCodes.PATIENT_DOCUMENT_UNSUPPORTED_TYPE,
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        sessionId: { type: 'string' },
        patientId: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a medical document for reading',
    description:
      'Returns immediately. The document is read in the background; poll ' +
      'GET /patient-documents/{documentId} until the status leaves "processing". ' +
      'Nothing extracted is ever written to the medical record without ' +
      'confirmation.',
  })
  @ApiResponse({ status: 201, type: PatientDocumentResponseDto })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPatientDocumentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PatientDocumentResponse> {
    return this.service.upload(
      file,
      dto,
      resolveCaller(currentUser, scopedPatientId, dto.patientId),
    );
  }

  @Get()
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiOperation({ summary: 'List the documents held for this patient' })
  async list(
    @Query() query: PatientDocumentQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PaginatedResult<PatientDocumentResponse>> {
    return this.service.list(
      query,
      resolveCaller(currentUser, scopedPatientId, query.patientId),
    );
  }

  @Get(':documentId')
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary: 'One document, with everything extracted from it',
    description:
      'Carries the OCR confidence and the extraction confidence as separate ' +
      'numbers, the provenance of each extracted value, and any contradiction ' +
      'against the existing record.',
  })
  @ApiResponse({ status: 200, type: PatientDocumentResponseDto })
  async findOne(
    @Param('documentId') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PatientDocumentResponse> {
    return this.service.findOne(
      id,
      resolveCaller(currentUser, scopedPatientId),
    );
  }

  /**
   * A short-lived link to the original the extraction came from.
   *
   * §22 requires the original be preserved as evidence, and evidence nobody can
   * look at is filing. The bucket is private, so what comes back is a signed
   * URL with an expiry rather than a permanent address.
   */
  @Get(':documentId/original')
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({ summary: 'A signed, expiring link to the original file' })
  @ApiResponse({ status: 200, type: PatientDocumentOriginalDto })
  async getOriginal(
    @Param('documentId') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PatientDocumentOriginalDto> {
    return this.service.getOriginalUrl(
      id,
      resolveCaller(currentUser, scopedPatientId),
    );
  }

  /**
   * The original itself, served on this API's own origin.
   *
   * `/original` signs a link straight at the object store, which is cheaper and
   * correct whenever the client shares a network with it. A phone does not:
   * over a tunnel, or on mobile data, `minio:9000` resolves to nothing and
   * §22's preserved evidence becomes evidence nobody can open.
   *
   * So both exist, and they are for different callers rather than one being a
   * replacement. A console on this host takes the signed URL; the app takes
   * this. It costs a proxy hop and buys "view the original" working from
   * wherever the patient actually is.
   */
  @Get(':documentId/file')
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({ summary: 'The original file, streamed through the API' })
  async getOriginalFile(
    @Param('documentId') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.streamOriginal(
      id,
      resolveCaller(currentUser, scopedPatientId),
    );

    response.set({
      'Content-Type': file.mimeType,
      // `inline`, so a phone shows the prescription rather than downloading it.
      'Content-Disposition': `inline; filename="${file.filename}"`,
      ...(file.contentLength
        ? { 'Content-Length': String(file.contentLength) }
        : {}),
      // A medical document on a shared device has no business in a cache.
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(file.body);
  }

  /**
   * Correct one value the model misread. §18's [ Correct ] and [ Not sure ].
   *
   * `PATCH` rather than `POST`, because this is a partial change to the
   * document's review state rather than a new sub-resource — and the path says
   * `extraction` because that is what the patient is looking at when they press
   * the button, even though the column of that name is never written. What gets
   * written is `corrections`, beside it. `patient-documents.service.ts` sets out
   * why that separation is not merely tidy.
   *
   * The parameter is `:documentId`, and the header of this file explains what
   * happens when it is not.
   */
  @Patch(':documentId/extraction')
  @Permissions(Permission.PATIENT_DOCUMENT_UPDATE)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary: 'Tell us what one extracted value should say',
    description:
      'Records the correction beside the extraction, never inside it: the ' +
      'value the model read is kept alongside the value the patient gave, so ' +
      'the disagreement stays readable. When the document is attached to a ' +
      'case-taking session the correction also supersedes the fact derived ' +
      'from the document; the response says which happened. A document with an ' +
      'outstanding correction is no longer reportable as verified.',
  })
  @ApiResponse({ status: 200, type: DocumentCorrectionResponseDto })
  async correctExtraction(
    @Param('documentId') id: string,
    @Body() dto: CorrectExtractionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<DocumentCorrectionResponse> {
    return this.service.correctExtraction(
      id,
      dto,
      resolveCaller(currentUser, scopedPatientId),
    );
  }

  @Post(':documentId/verify')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.PATIENT_DOCUMENT_UPDATE)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary: 'Confirm that what was extracted from this document is correct',
    description:
      'The only way out of needs_review. Marks the document as confirmed; it ' +
      'does not by itself write anything onto the medical record.',
  })
  @ApiResponse({ status: 200, type: PatientDocumentResponseDto })
  async verify(
    @Param('documentId') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PatientDocumentResponse> {
    return this.service.verify(id, resolveCaller(currentUser, scopedPatientId));
  }
}

/**
 * Which patient this request acts on, and who is acting.
 *
 * The order is the security property. `scopedPatientId` comes from
 * `PatientSelfGuard`, which for a PATIENT caller ignores every id in the
 * request and answers with the one in their token — so for a patient it is
 * always set, always their own, and always wins. The request-supplied id is
 * only ever consulted when the guard supplied nothing, which happens for a
 * staff caller (and, on a multipart POST, because the body does not exist yet
 * when guards run).
 *
 * The user id is never taken from the request at all.
 */
function resolveCaller(
  currentUser: AuthenticatedUser,
  scopedPatientId: string | undefined,
  requestedPatientId?: string,
): DocumentCaller {
  const patientId = scopedPatientId ?? requestedPatientId;

  if (!patientId) {
    // A staff caller who named nobody. Refused rather than defaulted: guessing
    // which record they meant is exactly the mistake worth refusing.
    throw new BadRequestException(
      'Say which patient this document belongs to.',
      ErrorCodes.PATIENT_DOCUMENT_PATIENT_REQUIRED,
    );
  }

  return {
    organizationId: currentUser.organizationId,
    patientId,
    userId: currentUser.id,
  };
}
