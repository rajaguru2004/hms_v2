import { Module } from '@nestjs/common';
import { PatientAuthController } from './patient-auth.controller';
import { PatientAuthService } from './patient-auth.service';
import { PatientAuthRepository } from './patient-auth.repository';
import { AuthModule } from '../auth/auth.module';
import { PatientsModule } from '../patients/patients.module';

/**
 * Patient portal identity.
 *
 * Imports AuthModule rather than minting its own tokens: an activated patient
 * gets the same session a staff login produces, from the same code.
 */
@Module({
  imports: [AuthModule, PatientsModule],
  controllers: [PatientAuthController],
  providers: [PatientAuthService, PatientAuthRepository],
  exports: [PatientAuthService, PatientAuthRepository],
})
export class PatientAuthModule {}
