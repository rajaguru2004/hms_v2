import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ConsultationRepository } from './consultations.repository';
import { PatientsModule } from '../patients/patients.module';
import { UsersModule } from '../users/users.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [PatientsModule, UsersModule, AppointmentsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, ConsultationRepository],
  exports: [ConsultationsService, ConsultationRepository],
})
export class ConsultationsModule {}
