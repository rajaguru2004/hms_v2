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
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
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
    @Req() req: Request,
  ) {
    const result = await this.service.findAll(
      query,
      currentUser.organizationId,
    );
    return {
      success: true,
      data: result.data,
      meta: {
        total: result.meta.total,
        limit: result.meta.limit,
        offset: query.offset ?? 0,
        hasMore: result.meta.hasNextPage,
      },
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Post()
  @Permissions(Permission.DEATH_CERTIFICATE_CREATE)
  @ApiOperation({ summary: 'Create a new death certificate' })
  async create(
    @Body() dto: CreateDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const certificate = await this.service.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
    return {
      success: true,
      data: certificate,
      message: 'Death certificate created successfully',
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Get(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_READ)
  @ApiOperation({ summary: 'Get death certificate details' })
  @ApiParam({ name: 'id', type: String })
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const certificate = await this.service.findById(
      id,
      currentUser.organizationId,
    );
    return {
      success: true,
      data: certificate,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Patch(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_UPDATE)
  @ApiOperation({ summary: 'Update death certificate details' })
  @ApiParam({ name: 'id', type: String })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const certificate = await this.service.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
    return {
      success: true,
      data: certificate,
      message: 'Death certificate updated successfully',
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Delete(':id')
  @Permissions(Permission.DEATH_CERTIFICATE_DELETE)
  @ApiOperation({ summary: 'Delete a death certificate' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.service.remove(id, currentUser.organizationId, currentUser.id);
    return {
      success: true,
      message: 'Death certificate deleted successfully',
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Patch(':id/issue')
  @Permissions(Permission.DEATH_CERTIFICATE_UPDATE)
  @ApiOperation({ summary: 'Record issuance of a death certificate' })
  @ApiParam({ name: 'id', type: String })
  async issue(
    @Param('id') id: string,
    @Body() dto: IssueDeathCertificateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const certificate = await this.service.issue(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
    return {
      success: true,
      data: certificate,
      message: 'Death certificate issuance recorded successfully',
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

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
