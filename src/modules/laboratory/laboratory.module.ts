import { Module } from '@nestjs/common';
import { LaboratoryController } from './laboratory.controller';
import { LaboratoryService } from './laboratory.service';
import { LabTestRepository } from './lab-test.repository';
import { LabOrderRepository } from './lab-order.repository';
import { LabResultRepository } from './lab-result.repository';

@Module({
  controllers: [LaboratoryController],
  providers: [
    LaboratoryService,
    LabTestRepository,
    LabOrderRepository,
    LabResultRepository,
  ],
  exports: [
    LaboratoryService,
    LabTestRepository,
    LabOrderRepository,
    LabResultRepository,
  ],
})
export class LaboratoryModule {}
