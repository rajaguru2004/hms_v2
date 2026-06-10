import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyDrugRepository } from './pharmacy-drug.repository';
import { PharmacyBatchRepository } from './pharmacy-batch.repository';
import { PrescriptionRepository } from './prescription.repository';
import { PharmacySaleRepository } from './pharmacy-sale.repository';

@Module({
  controllers: [PharmacyController],
  providers: [
    PharmacyService,
    PharmacyDrugRepository,
    PharmacyBatchRepository,
    PrescriptionRepository,
    PharmacySaleRepository,
  ],
  exports: [
    PharmacyService,
    PharmacyDrugRepository,
    PharmacyBatchRepository,
    PrescriptionRepository,
    PharmacySaleRepository,
  ],
})
export class PharmacyModule {}
