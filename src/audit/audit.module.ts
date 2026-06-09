import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * AuditModule — global so AuditService is injectable anywhere without imports.
 * Feature modules (users, auth, etc.) call AuditService.log() directly.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
