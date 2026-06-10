import { Module } from '@nestjs/common';
import { PreTriageController } from './pre-triage.controller';
import { PreTriageService } from './pre-triage.service';
import { PreTriageRepository } from './pre-triage.repository';
import { PatientsModule } from '../patients/patients.module';

@Module({
  imports: [PatientsModule],
  controllers: [PreTriageController],
  providers: [PreTriageService, PreTriageRepository],
  exports: [PreTriageService, PreTriageRepository],
})
export class PreTriageModule {}
