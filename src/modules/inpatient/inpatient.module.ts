import { Module } from '@nestjs/common';
import { InpatientController } from './inpatient.controller';
import { InpatientService } from './inpatient.service';
import { WardRepository } from './ward.repository';
import { BedRepository } from './bed.repository';
import { AdmissionRepository } from './admission.repository';

@Module({
  controllers: [InpatientController],
  providers: [
    InpatientService,
    WardRepository,
    BedRepository,
    AdmissionRepository,
  ],
  exports: [
    InpatientService,
    WardRepository,
    BedRepository,
    AdmissionRepository,
  ],
})
export class InpatientModule {}
