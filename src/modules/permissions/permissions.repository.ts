import { Injectable } from '@nestjs/common';
import { Prisma, Permission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/repositories/base.repository';

@Injectable()
export class PermissionsRepository extends BaseRepository<
  Permission,
  Prisma.PermissionCreateInput,
  Prisma.PermissionUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'permission');
  }
}
