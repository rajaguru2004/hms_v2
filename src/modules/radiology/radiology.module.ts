import { Module } from '@nestjs/common';
import { RadiologyController } from './radiology.controller';
import { RadiologyService } from './radiology.service';
import { RadiologyExamRepository } from './radiology-exam.repository';
import { RadiologyOrderRepository } from './radiology-order.repository';
import { RadiologyReportRepository } from './radiology-report.repository';

@Module({
  controllers: [RadiologyController],
  providers: [
    RadiologyService,
    RadiologyExamRepository,
    RadiologyOrderRepository,
    RadiologyReportRepository,
  ],
  exports: [
    RadiologyService,
    RadiologyExamRepository,
    RadiologyOrderRepository,
    RadiologyReportRepository,
  ],
})
export class RadiologyModule {}
