import { Module } from '@nestjs/common';
import { DeathCertificatesController } from './death-certificates.controller';
import { DeathCertificatesService } from './death-certificates.service';
import { DeathCertificateRepository } from './repositories/death-certificate.repository';

@Module({
  controllers: [DeathCertificatesController],
  providers: [DeathCertificatesService, DeathCertificateRepository],
  exports: [DeathCertificatesService, DeathCertificateRepository],
})
export class DeathCertificatesModule {}
