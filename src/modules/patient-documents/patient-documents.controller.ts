import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { PatientDocumentQueryDto } from './dto/patient-document-query.dto';
import {
  PatientDocumentOriginalDto,
  PatientDocumentResponseDto,
} from './dto/patient-document-response.dto';
import { UploadPatientDocumentDto } from './dto/upload-patient-document.dto';
import {
  DocumentCaller,
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
 * `GET /:id` on somebody else's document a 404 rather than a leak: the query
 * the service runs is scoped to the caller's patient, so the row is not there
 * to return.
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
      'GET /patient-documents/{id} until the status leaves "processing". ' +
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

  @Get(':id')
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'One document, with everything extracted from it',
    description:
      'Carries the OCR confidence and the extraction confidence as separate ' +
      'numbers, the provenance of each extracted value, and any contradiction ' +
      'against the existing record.',
  })
  @ApiResponse({ status: 200, type: PatientDocumentResponseDto })
  async findOne(
    @Param('id') id: string,
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
  @Get(':id/original')
  @Permissions(Permission.PATIENT_DOCUMENT_READ)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'A signed, expiring link to the original file' })
  @ApiResponse({ status: 200, type: PatientDocumentOriginalDto })
  async getOriginal(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() scopedPatientId: string | undefined,
  ): Promise<PatientDocumentOriginalDto> {
    return this.service.getOriginalUrl(
      id,
      resolveCaller(currentUser, scopedPatientId),
    );
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.PATIENT_DOCUMENT_UPDATE)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Confirm that what was extracted from this document is correct',
    description:
      'The only way out of needs_review. Marks the document as confirmed; it ' +
      'does not by itself write anything onto the medical record.',
  })
  @ApiResponse({ status: 200, type: PatientDocumentResponseDto })
  async verify(
    @Param('id') id: string,
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
