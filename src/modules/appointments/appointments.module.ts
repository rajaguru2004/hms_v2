import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentRepository } from './appointments.repository';
import { PatientsModule } from '../patients/patients.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PatientsModule, UsersModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentRepository],
  exports: [AppointmentsService, AppointmentRepository],
})
export class AppointmentsModule {}
