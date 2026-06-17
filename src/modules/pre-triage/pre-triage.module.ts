import { Module } from '@nestjs/common';
import { PreTriageController } from './pre-triage.controller';
import { PreTriageService } from './pre-triage.service';
import { PreTriageRepository } from './pre-triage.repository';
import { PatientsModule } from '../patients/patients.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PatientsModule, QueueModule],
  controllers: [PreTriageController],
  providers: [PreTriageService, PreTriageRepository],
  exports: [PreTriageService, PreTriageRepository],
})
export class PreTriageModule {}
