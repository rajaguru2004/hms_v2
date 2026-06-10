import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MachineIntegrationRepository } from './machine-integration.repository';
import { MachineResultsQueueRepository } from './machine-results-queue.repository';
import { IntegrationLogRepository } from './integration-log.repository';
import { PatientMatcher } from './patient-matcher';

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    MachineIntegrationRepository,
    MachineResultsQueueRepository,
    IntegrationLogRepository,
    PatientMatcher,
  ],
  exports: [
    IntegrationsService,
    MachineIntegrationRepository,
    MachineResultsQueueRepository,
    IntegrationLogRepository,
    PatientMatcher,
  ],
})
export class IntegrationsModule {}
