/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsService } from './permissions.service';
import { PermissionsRepository } from './permissions.repository';
import { Permission } from '@prisma/client';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let repo: jest.Mocked<PermissionsRepository>;

  const mockPermissions: Permission[] = [
    {
      id: 'perm-1',
      name: 'USER_CREATE',
      code: 'users:create',
      description: 'Create users',
      resource: 'users',
      action: 'create',
      category: 'users',
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      updatedBy: null,
    },
  ];

  beforeEach(async () => {
    const mockRepo = {
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PermissionsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    repo = module.get(PermissionsRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return all permissions', async () => {
    repo.findMany.mockResolvedValue(mockPermissions);
    const result = await service.findAll();
    expect(result).toEqual(mockPermissions);
    expect(repo.findMany).toHaveBeenCalled();
  });
});
