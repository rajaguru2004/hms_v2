import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '../common/enums/action.enum';

export interface CreateAuditLogDto {
  userId?: string;
  action: AuditAction;
  entityName: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * AuditService — records all state-changing operations in audit_logs table.
 *
 * Design decisions:
 * - Fire-and-forget logging: audit failures don't break business operations.
 *   We log errors but don't throw.
 * - Called explicitly from services (not interceptor) for full control
 *   over what old/new values to record.
 * - Async — doesn't block response.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event. Non-throwing — errors are caught and logged to stderr.
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      let orgId: string | undefined = dto.metadata?.organizationId as
        | string
        | undefined;
      if (dto.userId && !orgId) {
        const user = await this.prisma.user.findUnique({
          where: { id: dto.userId },
          select: { organizationId: true },
        });
        orgId = user?.organizationId;
      }

      if (!orgId) {
        const defaultOrg = await this.prisma.organization.findFirst({
          select: { id: true },
        });
        orgId = defaultOrg?.id;
      }

      await this.prisma.auditLog.create({
        data: {
          action: dto.action,
          entityName: dto.entityName,
          entityId: dto.entityId,
          oldValues: dto.oldValues as object,
          newValues: dto.newValues as object,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
          metadata: dto.metadata as object,
          user: dto.userId ? { connect: { id: dto.userId } } : undefined,
          organization: orgId ? { connect: { id: orgId } } : undefined,
        },
      });
    } catch (error) {
      // Audit log failure must never break business operations
      console.error('[AuditService] Failed to write audit log:', error);
    }
  }

  /**
   * Retrieve audit trail for a specific entity.
   */
  async getEntityAuditTrail(entityName: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entityName, entityId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Retrieve audit trail for a specific user.
   */
  async getUserAuditTrail(userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
