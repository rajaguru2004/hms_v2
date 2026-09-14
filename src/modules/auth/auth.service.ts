import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { StringValue } from 'ms';
import { UserRepository } from '../users/user.repository';
import { LoginDto, TokenResponseDto } from './dto/auth.dto';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { AuditAction } from '../../common/enums/action.enum';
import { AppCacheService } from '../../cache/cache.service';
import { comparePassword, hashPassword } from '../../common/utils/hash.util';
import {
  JwtPayload,
  AuthenticatedUser,
} from '../../common/types/jwt-payload.type';
import { SettingsService } from '../settings/settings.service';
import { AuthCacheService } from '../../cache/auth-cache.service';
import { hashRefreshToken } from './refresh-token.util';
import { ChangePasswordDto } from '../users/dto/user.dto';
import { MeResponseDto } from './dto/me.dto';
import { BadRequestException } from '../../common/exceptions/app.exception';

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Turns `15m` / `1440m` / `7d` into milliseconds.
 *
 * Hand-rolled rather than delegating to the `ms` package: `ms` is CommonJS and
 * this tsconfig runs without `esModuleInterop`, so `import ms from 'ms'`
 * typechecks and then compiles to `ms_1.default`, which is undefined at
 * runtime. The failure is at construction time, so the whole API refuses to
 * boot — worth six lines to avoid.
 *
 * Throws on an unreadable value rather than defaulting: a mistyped lifetime
 * that silently becomes fifteen minutes is a session length nobody chose, and
 * it is invisible until somebody is logged out mid-shift.
 */
function parseDuration(value: string, settingName: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i.exec(value.trim());
  const unit = match?.[2]?.toLowerCase() ?? 'ms';
  const amount = match ? Number(match[1]) : NaN;
  const parsed = amount * (DURATION_UNITS_MS[unit] ?? NaN);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${settingName} is not a valid duration: "${value}". Use a number with a unit, such as 15m, 24h or 7d.`,
    );
  }
  return parsed;
}

/**
 * AuthService — handles login, token issuance, refresh, logout.
 *
 * Security decisions:
 * - Access tokens: 15m (short-lived, can't be revoked, accepted JWT risk)
 * - Refresh tokens: 7d, stored hashed in DB, single-use rotation
 * - On refresh: old token revoked, new pair issued
 * - On logout: refresh token revoked in DB
 */
@Injectable()
export class AuthService {
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  /** Access-token lifetime in seconds, derived from config — never assumed. */
  private readonly accessExpiresInSeconds: number;
  private readonly refreshExpiresInMs: number;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly settingsService: SettingsService,
    private readonly authCache: AuthCacheService,
  ) {
    this.accessExpiresIn = this.config.get<string>('jwt.expiresIn', '15m');
    this.refreshExpiresIn = this.config.get<string>(
      'jwt.refreshExpiresIn',
      '7d',
    );

    // `expiresIn` used to be the literal `15 * 60` regardless of what was
    // configured. With JWT_EXPIRES_IN=1440m the API told every client the
    // token lasted 15 minutes when it lasted a day — a client that schedules a
    // refresh off that number is wrong by a factor of ninety-six.
    this.accessExpiresInSeconds = Math.floor(
      parseDuration(this.accessExpiresIn, 'jwt.expiresIn') / 1000,
    );
    this.refreshExpiresInMs = parseDuration(
      this.refreshExpiresIn,
      'jwt.refreshExpiresIn',
    );
  }

  /**
   * Login — validate credentials, return token pair.
   */
  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    const user = await this.userRepository.findByEmail(dto.email);

    if (!user || !user.isActive) {
      await this.auditService.log({
        action: AuditAction.LOGIN_FAILED,
        entityName: 'User',
        ipAddress,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException(
        'Invalid credentials',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    if (!user.password) {
      await this.auditService.log({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        entityName: 'User',
        entityId: user.id,
        ipAddress,
        metadata: { reason: 'Password not set' },
      });
      throw new UnauthorizedException(
        'Password not set. Please accept your invitation first.',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    const passwordValid = await comparePassword(dto.password, user.password);
    if (!passwordValid) {
      await this.auditService.log({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        entityName: 'User',
        entityId: user.id,
        ipAddress,
      });
      throw new UnauthorizedException(
        'Invalid credentials',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    const tokenPair = await this.generateTokenPair(
      user.id,
      user.email,
      roles,
      permissions,
      user.organizationId,
      ipAddress,
      userAgent,
    );

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Audit successful login
    void this.auditService.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      entityName: 'User',
      entityId: user.id,
      ipAddress,
    });

    return tokenPair;
  }

  /**
   * Refresh — rotate the token pair.
   *
   * Four checks before anything is issued: the signature and type are real,
   * the row exists, it has not been revoked, and it has not expired. A revoked
   * row that is presented again is treated as a stolen token: the whole family
   * for that user is revoked, because either the thief or the rightful owner is
   * holding a copy and there is no way to tell which.
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwtService.verify<{ sub: string; type?: string }>(
        refreshToken,
        { secret: this.config.get<string>('jwt.refreshSecret') },
      );
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    if (payload.type !== 'refresh') {
      // An access token presented here would otherwise mint a new pair from a
      // credential that was never meant to be long-lived.
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: hashRefreshToken(refreshToken) },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    if (tokenRecord.isRevoked) {
      await this.revokeAllForUser(tokenRecord.userId);
      void this.auditService.log({
        userId: tokenRecord.userId,
        action: AuditAction.LOGIN_FAILED,
        entityName: 'RefreshToken',
        entityId: tokenRecord.id,
        ipAddress,
        metadata: { reason: 'Revoked refresh token replayed' },
      });
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    const user = tokenRecord.user;
    if (!user || !user.isActive || user.isDeleted) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    // Revoke the presented token before issuing its replacement, so a crash
    // between the two leaves the user logged out rather than holding two live
    // tokens.
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    return this.generateTokenPair(
      user.id,
      user.email,
      roles,
      permissions,
      user.organizationId,
      ipAddress,
      userAgent,
    );
  }

  /**
   * Logout — revoke refresh token.
   */
  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        token: hashRefreshToken(refreshToken),
        isRevoked: false,
      },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    void this.auditService.log({
      userId,
      action: AuditAction.LOGOUT,
      entityName: 'User',
      entityId: userId,
    });
  }

  /**
   * Issue a token pair for a user whose credentials were proven some other way.
   *
   * Patient portal activation is the one such path: the caller proved who they
   * are with a claim token rather than a password, and is then signed in on the
   * spot. It goes through here rather than building its own payload so a portal
   * session is the *same* session a staff login produces — same claims, same
   * refresh row, same rotation — and so `patientId` is resolved by the one
   * method that resolves it.
   */
  async issueTokensForUser(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    const user = await this.userRepository.findById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Your account no longer exists.',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    const { roles, permissions } = await this.loadRolesAndPermissions(userId);

    return this.generateTokenPair(
      user.id,
      user.email,
      roles,
      permissions,
      user.organizationId,
      ipAddress,
      userAgent,
    );
  }

  /**
   * Generate access + refresh token pair.
   * Stores hashed refresh token in DB.
   */
  private async generateTokenPair(
    userId: string,
    email: string,
    roles: string[],
    permissions: string[],
    organizationId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    // Resolved here rather than at the call sites, for the same reason
    // `loadRolesAndPermissions` is: login and refresh must not be able to
    // disagree. A token minted at sign-in that carries `patientId` and one
    // minted an hour later that does not would log the patient out of their own
    // record halfway through a session, and the guard would report it as a
    // permissions problem.
    const patientRecord = await this.prisma.patient.findUnique({
      where: { userId },
      select: { id: true },
    });

    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      roles,
      permissions,
      organizationId,
      type: 'access',
      ...(patientRecord && { patientId: patientRecord.id }),
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: this.accessExpiresIn as StringValue,
    });

    // `jti` is what makes each refresh token unique.
    //
    // The payload is otherwise just {sub, type, iat, exp}, so two tokens minted
    // for the same user within the same second are byte-identical — and since
    // the stored hash is now deterministic, the second one collides with the
    // first on a unique index. (Under the old salted-bcrypt scheme they hashed
    // differently, which hid this; it also meant no row could ever be found
    // again.) A nonce is the right fix rather than tolerating the collision:
    // one refresh token, one row, individually revocable.
    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' as const, jti: randomUUID() },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.refreshExpiresIn as StringValue,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshExpiresInMs),
        ipAddress,
        deviceInfo: userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessExpiresInSeconds,
      tokenType: 'Bearer',
    };
  }

  /**
   * The roles and permission names attached to a user, deduplicated.
   *
   * Login and refresh both need exactly this, and they used to each build it
   * inline — which is how a claim set can drift between the token you get at
   * sign-in and the one you get an hour later.
   */
  private async loadRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const fullUser =
      await this.userRepository.findByIdWithRolesAndPermissions(userId);

    const roles = fullUser?.userRoles.map((ur) => ur.role.name) ?? [];
    const permissions = [
      ...new Set(
        fullUser?.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ) ?? [],
      ),
    ];

    return { roles, permissions };
  }

  /** Ends every session this user holds, on every device. */
  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Who am I, what may I do, and where do I work — in one call.
   *
   * Deliberately not permission-gated. A clinician needs their own name, their
   * own access map and their hospital's currency to render a screen; requiring
   * SETTINGS_READ for the last of those is why the organisation fetch used to
   * 403 for everyone below an administrator.
   */
  async getMe(currentUser: AuthenticatedUser): Promise<MeResponseDto> {
    const [user, access, organization] = await Promise.all([
      this.userRepository.findByIdWithRolesAndPermissions(currentUser.id),
      this.getMyAccess(currentUser.id, currentUser.roles),
      this.settingsService.findOrganizationById(currentUser.organizationId),
    ]);

    if (!user) {
      throw new UnauthorizedException(
        'Your account no longer exists.',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    const department = user.departmentId
      ? await this.prisma.department.findUnique({
          where: { id: user.departmentId },
          select: { id: true, name: true },
        })
      : null;

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        name: user.fullName,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: roles[0] ?? user.role ?? null,
        roles,
        permissions,
        departmentId: user.departmentId,
        department,
        departmentName: department?.name ?? null,
        specialization: user.specialization,
        licenseNumber: user.licenseNumber,
        employeeId: user.employeeId,
        avatar: null,
        lastLoginAt: user.lastLoginAt,
      },
      access,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logoUrl: organization.logoUrl,
        logoTextUrl: organization.logoTextUrl,
        primaryColor: organization.primaryColor,
        secondaryColor: organization.secondaryColor,
        settings: organization.settings,
        modulesEnabled: organization.modulesEnabled,
      },
    };
  }

  /**
   * Change your own password.
   *
   * Every other session ends: a password change is usually somebody reacting to
   * a device they no longer trust, and leaving that device's refresh token live
   * for seven more days defeats the point.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ipAddress?: string,
  ): Promise<void> {
    const user = await this.userRepository.findById(userId);

    if (!user?.password) {
      throw new UnauthorizedException(
        'Invalid credentials',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    const valid = await comparePassword(dto.currentPassword, user.password);
    if (!valid) {
      void this.auditService.log({
        userId,
        action: AuditAction.LOGIN_FAILED,
        entityName: 'User',
        entityId: userId,
        ipAddress,
        metadata: { reason: 'Wrong current password on change' },
      });
      throw new UnauthorizedException(
        'That current password is not right.',
        ErrorCodes.INVALID_CREDENTIALS,
      );
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'The new password must be different from the current one.',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await hashPassword(dto.newPassword) },
    });

    await this.revokeAllForUser(userId);
    await this.authCache.invalidateUser(userId);

    void this.auditService.log({
      userId,
      action: AuditAction.PASSWORD_CHANGE,
      entityName: 'User',
      entityId: userId,
      ipAddress,
    });
  }

  /**
   * Get dynamic permission map per module for user.
   */
  async getMyAccess(userId: string, roles: string[]) {
    const cacheKey = AppCacheService.buildKey('auth:access-map', userId);
    const cached = await this.cacheService.get<{
      modules: Record<
        string,
        {
          canCreate: boolean;
          canRead: boolean;
          canUpdate: boolean;
          canDelete: boolean;
        }
      >;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    // 1. Get all distinct active permission categories
    const permissions = await this.prisma.permission.findMany({
      where: { isDeleted: false },
      select: { category: true },
      distinct: ['category'],
    });

    const categories = permissions
      .map((p) => p.category)
      .filter((c): c is string => !!c);

    const modules: Record<
      string,
      {
        canCreate: boolean;
        canRead: boolean;
        canUpdate: boolean;
        canDelete: boolean;
      }
    > = {};

    // 2. Initialize map for all modules to false
    for (const cat of categories) {
      modules[cat] = {
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
      };
    }

    // 3. Populate permissions
    if (roles.includes('SUPER_ADMIN')) {
      // Super admin has full control over all modules
      for (const cat of categories) {
        modules[cat] = {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        };
      }
    } else {
      // Query role permissions assigned to the user
      const rolePermissions = await this.prisma.rolePermission.findMany({
        where: {
          role: {
            userRoles: {
              some: {
                userId,
              },
            },
            isDeleted: false,
          },
        },
        include: {
          permission: true,
        },
      });

      for (const rp of rolePermissions) {
        const cat = rp.permission?.category;
        if (cat) {
          if (!modules[cat]) {
            modules[cat] = {
              canCreate: false,
              canRead: false,
              canUpdate: false,
              canDelete: false,
            };
          }
          modules[cat].canCreate = modules[cat].canCreate || rp.canCreate;
          modules[cat].canRead = modules[cat].canRead || rp.canRead;
          modules[cat].canUpdate = modules[cat].canUpdate || rp.canUpdate;
          modules[cat].canDelete = modules[cat].canDelete || rp.canDelete;
        }
      }
    }

    const result = { modules };
    // Cache map for 5 minutes
    await this.cacheService.set(cacheKey, result, 300);

    return result;
  }
}
