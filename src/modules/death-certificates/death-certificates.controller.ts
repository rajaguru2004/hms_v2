import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { DeathCertificatesService } from './death-certificates.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CreateDeathCertificateDto,
  UpdateDeathCertificateDto,
  IssueDeathCertificateDto,
  DeathCertificateQueryDto,
} from './dto/death-certificate.dto';

@ApiTags('Death Certificates')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('death-certificates')
export class DeathCertificatesController {
  constructor(private readonly service: DeathCertificatesService) {}

  @Get()
  @Permissions(Permission.DEATH_CERTIFICATE_READ)
  @ApiOperation({ summary: 'Get death certificates with search and filter' })
  async findAll(
    @Query() query: DeathCertificateQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    // ResponseInterceptor wraps the return value — no manual envelope needed.
    return this.service.findAll(query, currentUser.organizationId);
  }

  @Post()
  @Permissions(Permission.DEATH_CERTIFICATE_CREATE)
  @ApiOperation({ summary: 'Create a new death certificate' })
  async create(
    @Body() dto: CreateDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.create(dto, currentUser.organizationId, currentUser.id);
  }

  @Get(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_READ)
  @ApiOperation({ summary: 'Get death certificate details' })
  @ApiParam({ name: 'id', type: String })
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.findById(id, currentUser.organizationId);
  }

  @Patch(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_UPDATE)
  @ApiOperation({ summary: 'Update death certificate details' })
  @ApiParam({ name: 'id', type: String })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_DELETE)
  @ApiOperation({ summary: 'Delete a death certificate' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.service.remove(id, currentUser.organizationId, currentUser.id);
    return { message: 'Death certificate deleted successfully' };
  }

  @Patch(':id/issue')
  @Permissions(Permission.DEATH_CERTIFICATE_UPDATE)
  @ApiOperation({ summary: 'Record issuance of a death certificate' })
  @ApiParam({ name: 'id', type: String })
  async issue(
    @Param('id') id: string,
    @Body() dto: IssueDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.issue(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  /**
   * Print endpoint bypasses the ResponseInterceptor intentionally.
   * Raw HTML must be streamed with Content-Type: text/html.
   * Using @Res() disables NestJS response handling for this route only.
   */
  @Get(':id/print')
  @Permissions(Permission.DEATH_CERTIFICATE_READ)
  @ApiOperation({ summary: 'Get printable HTML of a death certificate' })
  @ApiParam({ name: 'id', type: String })
  async print(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const html = await this.service.getPrintView(
      id,
      currentUser.organizationId,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(HttpStatus.OK).send(html);
  }
}
