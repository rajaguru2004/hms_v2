import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { LoginDto, RefreshTokenDto, TokenResponseDto } from './dto/auth.dto';
import { MeResponseDto } from './dto/me.dto';
import { ChangePasswordDto } from '../users/dto/user.dto';
import { Public } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Rate limited hard, and separately from everything else.
   *
   * This is the one unauthenticated endpoint that does bcrypt work, so it is
   * both the cheapest to attack and the most expensive to serve. The limit is
   * configurable because the verification script signs in as a dozen roles in
   * a row and must not rate-limit itself.
   */
  @Public()
  @Throttle({
    default: {
      limit: Number(process.env.THROTTLE_LOGIN_LIMIT ?? 10),
      ttl: 60_000,
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<TokenResponseDto> {
    return this.authService.login(dto, req.ip, req.get('user-agent'));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<TokenResponseDto> {
    return this.authService.refreshTokens(
      dto.refreshToken,
      req.ip,
      req.get('user-agent'),
    );
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    await this.authService.logout(user.id, dto.refreshToken);
  }

  /**
   * The client bootstrap: identity, access map and organisation in one call.
   *
   * No permission decorator on purpose — see AuthService.getMe.
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user, access map and organisation' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.authService.getMe(user);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change your own password; ends every other session',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.changePassword(user.id, dto, req.ip);
  }

  @Get('me/access')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user access permissions per module' })
  async getMyAccess(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMyAccess(user.id, user.roles);
  }
}
