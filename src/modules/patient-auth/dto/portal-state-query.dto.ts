import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Declared so the parameter is documented and so the global ValidationPipe's
 * `forbidNonWhitelisted` does not 400 a staff client that sends it.
 *
 * It is not how the handler learns which patient to read. `PatientSelfGuard`
 * resolves that and `@PatientScope()` delivers it — for a patient caller this
 * field is discarded, and it has to be discarded rather than overwritten
 * because Express 5 re-parses `req.query` on every access and a guard's write
 * to it does not survive.
 */
export class PortalStateQueryDto {
  @ApiPropertyOptional({
    description:
      'Staff only: whose portal state to read. Ignored for patient callers, ' +
      'who always read their own.',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}
