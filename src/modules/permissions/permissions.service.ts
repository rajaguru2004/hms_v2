import { Injectable } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { PermissionsRepository } from './permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(private readonly permissionsRepository: PermissionsRepository) {}

  async findAll(): Promise<Permission[]> {
    return this.permissionsRepository.findMany(
      {},
      { orderBy: { name: 'asc' } },
    );
  }
}
