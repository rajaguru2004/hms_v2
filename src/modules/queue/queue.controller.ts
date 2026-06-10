import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CreateQueueDto } from './dto/create-queue.dto';
import { QueueQueryDto } from './dto/queue-query.dto';
import { QueueResponseDto } from './dto/queue-response.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import { QueueService } from './queue.service';

@ApiTags('Queue')
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissionsGuard)
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  @Permissions(Permission.QUEUE_READ)
  @ApiOperation({ summary: 'List queue entries by service area and status' })
  @ApiResponse({ status: 200, type: [QueueResponseDto] })
  async findAll(
    @Query() query: QueueQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QueueResponseDto[]> {
    return this.queueService.findAll(query, currentUser.organizationId);
  }

  @Post()
  @Permissions(Permission.QUEUE_CREATE)
  @ApiOperation({ summary: 'Add a patient to the queue' })
  @ApiResponse({ status: 201, type: QueueResponseDto })
  async create(
    @Body() dto: CreateQueueDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QueueResponseDto> {
    return this.queueService.create(
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Patch(':id')
  @Permissions(Permission.QUEUE_UPDATE)
  @ApiOperation({ summary: 'Update queue item status and assignment' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: QueueResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateQueueDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QueueResponseDto> {
    return this.queueService.update(
      id,
      dto,
      currentUser.organizationId,
      currentUser.id,
    );
  }

  @Delete(':id')
  @Permissions(Permission.QUEUE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a queue item' })
  @ApiParam({ name: 'id', type: String })
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.queueService.remove(
      id,
      currentUser.organizationId,
      currentUser.id,
    );
  }
}
