import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DepartmentRepository } from './repositories/department.repository';
import { OrganizationRepository } from './repositories/organization.repository';
import { UsersModule } from '../users/users.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [UsersModule, IntegrationsModule],
  controllers: [SettingsController],
  providers: [SettingsService, DepartmentRepository, OrganizationRepository],
  exports: [SettingsService],
})
export class SettingsModule {}
