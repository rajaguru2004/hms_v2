import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PatientAuthService } from './patient-auth.service';
import { ClaimPatientRecordDto } from './dto/claim-patient-record.dto';
import { ActivatePatientAccountDto } from './dto/activate-patient-account.dto';
import { PortalStateQueryDto } from './dto/portal-state-query.dto';
import {
  PatientClaimResponseDto,
  PatientPortalStateResponseDto,
} from './dto/patient-portal-response.dto';
import { TokenResponseDto } from '../auth/dto/auth.dto';
import {
  CurrentUser,
  Public,
} from '../../common/decorators/current-user.decorator';
import {
  PatientScope,
  PatientSelfGuard,
} from '../../common/guards/patient-self.guard';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('Patient Portal')
@Controller('patient-auth')
export class PatientAuthController {
  constructor(private readonly patientAuthService: PatientAuthService) {}

  /**
   * Throttled harder than login, and for the opposite reason.
   *
   * Login is expensive to serve — this is cheap, and that is the problem: two
   * indexed queries and an insert per attempt means the only thing standing
   * between a script and the whole MRN space is how fast it is allowed to ask.
   * The limit is configurable the way `THROTTLE_LOGIN_LIMIT` is, because the
   * verification script makes several claims in a row and must not rate-limit
   * itself; the shipped default is the one that should be in front of the
   * internet.
   */
  @Public()
  @Throttle({
    default: {
      limit: Number(process.env.THROTTLE_PATIENT_CLAIM_LIMIT ?? 5),
      ttl: 60_000,
    },
  })
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim a patient record with an MRN and date of birth',
    description:
      'Answers identically whether or not the MRN exists. A token is always ' +
      'returned; one issued against an MRN that matched nothing is refused at ' +
      'activation.',
  })
  @ApiResponse({ status: 200, type: PatientClaimResponseDto })
  async claim(
    @Body() dto: ClaimPatientRecordDto,
  ): Promise<PatientClaimResponseDto> {
    return this.patientAuthService.claim(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Spend a claim token: set a password and sign in',
    description:
      'Single use. Afterwards the patient signs in through POST /auth/login ' +
      'like every other account.',
  })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  async activate(
    @Body() dto: ActivatePatientAccountDto,
    @Req() req: Request,
  ): Promise<TokenResponseDto> {
    return this.patientAuthService.activate(dto, req.ip, req.get('user-agent'));
  }

  /**
   * The caller's own record and portal state.
   *
   * `@PatientScope()` rather than the query DTO is what says whose record this
   * is: for a PATIENT caller `PatientSelfGuard` has already discarded any id
   * they sent. `_query` is bound only so the parameter is documented and so the
   * global ValidationPipe accepts it from a staff client instead of rejecting
   * the whole request as an unknown field.
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(PatientSelfGuard)
  @ApiOperation({ summary: 'Your patient record and portal account state' })
  @ApiResponse({ status: 200, type: PatientPortalStateResponseDto })
  async getPortalState(
    @CurrentUser() currentUser: AuthenticatedUser,
    @PatientScope() patientId: string | undefined,
    @Query() _query: PortalStateQueryDto,
  ): Promise<PatientPortalStateResponseDto> {
    return this.patientAuthService.getPortalState(currentUser, patientId);
  }
}
