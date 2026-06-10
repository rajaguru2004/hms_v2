import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueRepository } from './queue.repository';
import { QueueService } from './queue.service';

@Module({
  controllers: [QueueController],
  providers: [QueueService, QueueRepository],
  exports: [QueueService, QueueRepository],
})
export class QueueModule {}
