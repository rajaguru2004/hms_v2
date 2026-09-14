import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * The non-file half of `POST /patient-documents`.
 *
 * Both fields are optional and neither is trusted the way it looks. The file
 * itself is bound by `@UploadedFile()`; everything here arrives as a multipart
 * text part, which means it arrives as a string no matter what it was on the
 * client.
 */
export class UploadPatientDocumentDto {
  @ApiPropertyOptional({
    description:
      'Attach this document to an in-progress case-taking session, so the ' +
      'interview can stop asking what the document already answers.',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  /**
   * Whose document this is — for a staff caller only.
   *
   * A patient caller cannot reach it. `PatientSelfGuard` resolves the patient
   * from the token and `@PatientScope()` delivers that, and the handler prefers
   * the scope over this field whenever the scope exists, which for a PATIENT
   * token is always. Declared so a receptionist scanning a referral letter on
   * behalf of somebody at the desk has somewhere to say who, and so the global
   * `forbidNonWhitelisted` does not 400 them for trying.
   *
   * Worth knowing: on a multipart request the body does not exist yet when
   * guards run — Multer parses it in an interceptor, which is downstream — so
   * `PatientSelfGuard` never sees this value at all. That is not a gap. The
   * guard's job on a patient request is to supply the id from the token, and it
   * does; this field is only ever consulted when the guard supplied nothing,
   * which is the staff case.
   */
  @ApiPropertyOptional({
    description:
      'Staff only: whose record this document belongs to. Ignored for patient ' +
      'callers, who always upload to their own.',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
