import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CreateBillingServiceDto,
  UpdateBillingServiceDto,
} from './dto/service.dto';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { CreatePaymentDto } from './dto/payment.dto';
import {
  BillingQueryDto,
  BillingPostCompatDto,
  BillingPatchCompatDto,
} from './dto/billing-compat.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // =========================================================================
  // BACKWARD COMPATIBILITY MULTIPLEXED ROUTES
  // =========================================================================

  @Get()
  @Permissions(Permission.BILLING_READ)
  @ApiOperation({
    summary: 'Multiplexed GET route matching Next.js API compatibility',
    description:
      'Supports resource query param: invoices, services, payments, stats',
  })
  async compatibilityGet(
    @Query() query: BillingQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const resource = query.resource || 'invoices';
    let resultData: unknown;

    if (resource === 'services') {
      resultData = await this.billingService.getServices(
        currentUser.organizationId,
        query.category,
      );
    } else if (resource === 'invoices') {
      resultData = await this.billingService.getInvoices(
        currentUser.organizationId,
        query.status,
        query.patientId,
      );
    } else if (resource === 'payments') {
      resultData = await this.billingService.getPayments(
        currentUser.organizationId,
        query.invoiceId,
      );
    } else if (resource === 'stats') {
      resultData = await this.billingService.getStats(
        currentUser.organizationId,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return {
      success: true,
      data: resultData,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  @Post()
  @Permissions(Permission.BILLING_CREATE)
  @ApiOperation({
    summary: 'Multiplexed POST route matching Next.js API compatibility',
    description: 'Creates service, invoice, or payment based on body.resource',
  })
  async compatibilityPost(
    @Body() dto: BillingPostCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const resource = dto.resource || 'invoice';

    if (resource === 'service') {
      if (!dto.serviceName || dto.unitPrice === undefined) {
        throw new BadRequestException(
          'serviceName and unitPrice are required for service creation',
        );
      }
      const service = await this.billingService.createService(
        {
          serviceName: dto.serviceName,
          serviceCode: dto.serviceCode,
          serviceCategory: dto.serviceCategory,
          department: dto.department,
          unitPrice: dto.unitPrice,
          isTaxable: dto.isTaxable,
          taxPercentage: dto.taxPercentage,
          isCoveredByInsurance: dto.isCoveredByInsurance,
          insuranceCopayPercentage: dto.insuranceCopayPercentage,
          description: dto.description,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: service,
        message: 'Service created successfully',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    if (resource === 'invoice') {
      if (!dto.patientId || !dto.items || dto.items.length === 0) {
        throw new BadRequestException(
          'patientId and items array are required for invoice creation',
        );
      }
      const invoice = await this.billingService.createInvoice(
        {
          patientId: dto.patientId,
          consultationId: dto.consultationId,
          items: dto.items,
          discountAmount: dto.discountAmount,
          discountPercentage: dto.discountPercentage,
          notes: dto.notes,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: invoice,
        message: 'Invoice created',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    if (resource === 'payment') {
      if (!dto.invoiceId || dto.amount === undefined || !dto.paymentMethod) {
        throw new BadRequestException(
          'invoiceId, amount, and paymentMethod are required for payment recording',
        );
      }
      const payment = await this.billingService.createPayment(
        {
          invoiceId: dto.invoiceId,
          patientId: dto.patientId,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          paymentReference: dto.paymentReference,
          mobileMoneyProvider: dto.mobileMoneyProvider,
          bankName: dto.bankName,
          chequeNumber: dto.chequeNumber,
          notes: dto.notes,
        },
        currentUser.organizationId,
        currentUser.id,
      );
      return {
        success: true,
        data: payment,
        message: 'Payment recorded',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      };
    }

    throw new BadRequestException('Invalid resource specified');
  }

  @Patch()
  @Permissions(Permission.BILLING_UPDATE)
  @ApiOperation({
    summary: 'Multiplexed PATCH route matching Next.js API compatibility',
    description: 'Updates invoice or service based on body.resource',
  })
  async compatibilityPatch(
    @Body() dto: BillingPatchCompatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
  ) {
    let updated: unknown;

    if (dto.resource === 'invoice') {
      updated = await this.billingService.updateInvoice(
        dto.id,
        {
          status: dto.status,
          paymentStatus: dto.paymentStatus,
          notes: dto.notes,
          cancellationReason: dto.cancellationReason,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else if (dto.resource === 'service') {
      updated = await this.billingService.updateService(
        dto.id,
        {
          serviceName: dto.serviceName,
          serviceCode: dto.serviceCode,
          serviceCategory: dto.serviceCategory,
          department: dto.department,
          unitPrice: dto.unitPrice,
          isTaxable: dto.isTaxable,
          taxPercentage: dto.taxPercentage,
          isCoveredByInsurance: dto.isCoveredByInsurance,
          insuranceCopayPercentage: dto.insuranceCopayPercentage,
          description: dto.description,
          isActive: dto.isActive,
        },
        currentUser.organizationId,
        currentUser.id,
      );
    } else {
      throw new BadRequestException('Invalid resource specified');
    }

    return {
      success: true,
      data: updated,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
    };
  }

  // =========================================================================
  // ENHANCED RESTFUL ENDPOINTS
  // =========================================================================

  @Get('services')
  @Permissions(Permission.BILLING_READ)
  @ApiOperation({ summary: 'Get all active billing services' })
  async getServices(
    @Query('category') category: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.getServices(
      currentUser.organizationId,
      category,
    );
  }

  @Post('services')
  @Permissions(Permission.BILLING_CREATE)
  @ApiOperation({ summary: 'Create a new billing service catalog entry' })
  async createService(
    @Body() dto: CreateBillingServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.createService(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('services/:id')
  @Permissions(Permission.BILLING_UPDATE)
  @ApiOperation({ summary: 'Update a billing service' })
  @ApiParam({ name: 'id', type: String })
  async updateService(
    @Param('id') id: string,
    @Body() dto: UpdateBillingServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.updateService(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('invoices')
  @Permissions(Permission.BILLING_READ)
  @ApiOperation({ summary: 'Get all invoices' })
  async getInvoices(
    @Query('status') status: string,
    @Query('patientId') patientId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.getInvoices(
      currentUser.organizationId,
      status,
      patientId,
    );
  }

  @Post('invoices')
  @Permissions(Permission.BILLING_CREATE)
  @ApiOperation({ summary: 'Create a new draft invoice' })
  async createInvoice(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.createInvoice(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch('invoices/:id')
  @Permissions(Permission.BILLING_UPDATE)
  @ApiOperation({ summary: 'Update or cancel an invoice' })
  @ApiParam({ name: 'id', type: String })
  async updateInvoice(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.updateInvoice(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('payments')
  @Permissions(Permission.BILLING_READ)
  @ApiOperation({ summary: 'Get all payment transaction records' })
  async getPayments(
    @Query('invoiceId') invoiceId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.getPayments(
      currentUser.organizationId,
      invoiceId,
    );
  }

  @Post('payments')
  @Permissions(Permission.BILLING_CREATE)
  @ApiOperation({
    summary: 'Record a new payment transaction against an invoice',
  })
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.billingService.createPayment(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Get('stats')
  @Permissions(Permission.BILLING_READ)
  @ApiOperation({ summary: 'Get billing dashboard statistics' })
  async getStats(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.billingService.getStats(currentUser.organizationId);
  }
}
