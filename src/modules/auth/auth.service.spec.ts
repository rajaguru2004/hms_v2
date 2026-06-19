/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UserRepository } from '../users/user.repository';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../cache/cache.service';

describe('AuthService (getMyAccess)', () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;
  let cacheService: jest.Mocked<AppCacheService>;

  beforeEach(async () => {
    const mockUserRepo = {};
    const mockJwt = { sign: jest.fn() };
    const mockConfig = { get: jest.fn(() => '15m') };
    const mockAudit = { log: jest.fn() };
    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    const mockPrisma = {
      permission: {
        findMany: jest.fn(),
      },
      rolePermission: {
        findMany: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppCacheService, useValue: mockCache },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService);
    cacheService = module.get(AppCacheService);
  });

  it('should return cached access map if available', async () => {
    const cachedMap = {
      modules: {
        patients: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        },
      },
    };
    cacheService.get.mockResolvedValue(cachedMap);

    const result = await service.getMyAccess('user-1', ['DOCTOR']);

    expect(result).toEqual(cachedMap);
    expect(cacheService.get).toHaveBeenCalledWith('auth:access-map:user-1');
    expect(prismaService.permission.findMany).not.toHaveBeenCalled();
  });

  it('should return all true for SUPER_ADMIN role', async () => {
    cacheService.get.mockResolvedValue(null);
    (prismaService.permission.findMany as jest.Mock).mockResolvedValue([
      { category: 'patients' },
      { category: 'billing' },
    ]);

    const result = await service.getMyAccess('user-1', ['SUPER_ADMIN']);

    expect(result.modules.patients).toEqual({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    expect(result.modules.billing).toEqual({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    expect(cacheService.set).toHaveBeenCalled();
  });

  it('should aggregate role permissions with OR logic for non-SUPER_ADMIN users', async () => {
    cacheService.get.mockResolvedValue(null);
    (prismaService.permission.findMany as jest.Mock).mockResolvedValue([
      { category: 'patients' },
      { category: 'billing' },
    ]);
    (prismaService.rolePermission.findMany as jest.Mock).mockResolvedValue([
      {
        permission: { category: 'patients' },
        canRead: true,
        canUpdate: false,
        canCreate: true,
        canDelete: false,
      },
      {
        permission: { category: 'patients' },
        canRead: false,
        canUpdate: true,
        canCreate: false,
        canDelete: false,
      },
    ]);

    const result = await service.getMyAccess('user-1', ['DOCTOR']);

    expect(result.modules.patients).toEqual({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    expect(result.modules.billing).toEqual({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
  });
});
