import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { UserRepository } from '../users/user.repository';
import { LoginDto, TokenResponseDto } from './dto/auth.dto';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import { comparePassword, hashPassword } from '../../common/utils/hash.util';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { AuditAction } from '../../common/enums/action.enum';

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

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {
    this.accessExpiresIn = this.config.get<string>('jwt.expiresIn', '15m');
    this.refreshExpiresIn = this.config.get<string>(
      'jwt.refreshExpiresIn',
      '7d',
    );
  }

  /**
   * Login — validate credentials, return token pair.
   */
  async login(dto: LoginDto, ipAddress?: string): Promise<TokenResponseDto> {
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

    // Load roles + permissions for token payload
    const fullUser = await this.userRepository.findByIdWithRolesAndPermissions(
      user.id,
    );
    const roles = fullUser!.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        fullUser!.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    const tokenPair = await this.generateTokenPair(
      user.id,
      user.email,
      roles,
      permissions,
      user.organizationId,
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
   * Refresh — rotate token pair.
   * Revokes old refresh token, issues new access + refresh.
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
  ): Promise<TokenResponseDto> {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: await hashPassword(refreshToken) },
      include: { user: true },
    });

    if (
      !tokenRecord ||
      tokenRecord.isRevoked ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token',
        ErrorCodes.TOKEN_INVALID,
      );
    }

    // Revoke old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    const user = tokenRecord.user;
    const fullUser = await this.userRepository.findByIdWithRolesAndPermissions(
      user.id,
    );
    const roles = fullUser!.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        fullUser!.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    return this.generateTokenPair(
      user.id,
      user.email,
      roles,
      permissions,
      user.organizationId,
      ipAddress,
    );
  }

  /**
   * Logout — revoke refresh token.
   */
  async logout(userId: string, refreshToken: string): Promise<void> {
    const hashed = await hashPassword(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, token: hashed, isRevoked: false },
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
  ): Promise<TokenResponseDto> {
    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      roles,
      permissions,
      organizationId,
      type: 'access',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: this.accessExpiresIn as StringValue,
    });

    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' as const },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.refreshExpiresIn as StringValue,
      },
    );

    // Store hashed refresh token
    const hashedRefresh = await hashPassword(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: hashedRefresh,
        expiresAt,
        ipAddress,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
      tokenType: 'Bearer',
    };
  }
}
