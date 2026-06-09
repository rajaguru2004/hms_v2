import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { AppointmentRepository } from './appointments.repository';
import { PatientsService } from '../patients/patients.service';
import { UserService } from '../users/user.service';
import { AuditService } from '../../audit/audit.service';
import { AppCacheService } from '../../cache/cache.service';
import { Appointment } from '@prisma/client';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import {
  NotFoundException,
  ForbiddenException,
} from '../../common/exceptions/app.exception';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let repository: jest.Mocked<AppointmentRepository>;
  let patientsService: jest.Mocked<PatientsService>;
  let userService: jest.Mocked<UserService>;
  let cacheService: jest.Mocked<AppCacheService>;
  let auditService: jest.Mocked<AuditService>;

  const mockAppointment: Appointment = {
    id: 'appt-1',
    organizationId: 'org-1',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    appointmentDate: new Date('2026-06-10T00:00:00.000Z'),
    appointmentTime: '09:30',
    durationMinutes: 30,
    appointmentType: 'follow_up',
    departmentId: null,
    status: 'scheduled',
    chiefComplaint: 'Checkup',
    notes: 'Bring records',
    consultationNotes: null,
    checkedInAt: null,
    checkedInById: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    rescheduledFromId: null,
    rescheduledToId: null,
    reminderSent: false,
    reminderSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-1',
    isDeleted: false,
    deletedAt: null,
  };

  const mockPatient = {
    id: 'pat-1',
    organizationId: 'org-1',
    mrn: 'MRN001',
    firstName: 'John',
    lastName: 'Doe',
  };

  const mockDoctor = {
    id: 'doc-1',
    organizationId: 'org-1',
    email: 'doc@hms.local',
    firstName: 'Jane',
    lastName: 'Smith',
    fullName: 'Jane Smith',
  };

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
    };

    const mockPatientsService = {
      findById: jest.fn(),
    };

    const mockUserService = {
      findById: jest.fn(),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const mockAudit = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: AppointmentRepository, useValue: mockRepo },
        { provide: PatientsService, useValue: mockPatientsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AppCacheService, useValue: mockCache },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    repository = module.get(AppointmentRepository);
    patientsService = module.get(PatientsService);
    userService = module.get(UserService);
    cacheService = module.get(AppCacheService);
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto: CreateAppointmentDto = {
      patientId: 'pat-1',
      doctorId: 'doc-1',
      appointmentDate: '2026-06-10',
      appointmentTime: '09:30',
      durationMinutes: 30,
      appointmentType: 'follow_up',
      chiefComplaint: 'Checkup',
      notes: 'Bring records',
    };

    it('should schedule an appointment successfully', async () => {
      patientsService.findById.mockResolvedValue(mockPatient as any);
      userService.findById.mockResolvedValue(mockDoctor as any);
      repository.create.mockResolvedValue(mockAppointment);
      repository.findOne.mockResolvedValue(mockAppointment); // for findById populate call

      const result = await service.create(createDto, 'org-1', 'user-1');

      expect(patientsService.findById).toHaveBeenCalledWith('pat-1', 'org-1');
      expect(userService.findById).toHaveBeenCalledWith('doc-1');
      expect(repository.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(result.id).toBe(mockAppointment.id);
    });

    it('should throw ForbiddenException if doctor belongs to another organization', async () => {
      patientsService.findById.mockResolvedValue(mockPatient as any);
      userService.findById.mockResolvedValue({
        ...mockDoctor,
        organizationId: 'org-different',
      } as any);

      await expect(
        service.create(createDto, 'org-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findById', () => {
    it('should return cached appointment if present', async () => {
      cacheService.get.mockResolvedValue(mockAppointment);

      const result = await service.findById('appt-1', 'org-1');

      expect(cacheService.get).toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(result.id).toBe(mockAppointment.id);
    });

    it('should fetch from DB and cache if not cached', async () => {
      cacheService.get.mockResolvedValue(null);
      repository.findOne.mockResolvedValue(mockAppointment);

      const result = await service.findById('appt-1', 'org-1');

      expect(cacheService.get).toHaveBeenCalled();
      expect(repository.findOne).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalled();
      expect(result.id).toBe(mockAppointment.id);
    });

    it('should throw NotFoundException if appointment does not exist', async () => {
      cacheService.get.mockResolvedValue(null);
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('appt-99', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated appointments', async () => {
      repository.paginate.mockResolvedValue({
        data: [mockAppointment],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const query = Object.assign(new AppointmentQueryDto(), {
        page: 1,
        limit: 10,
      });
      const result = await service.findAll(query, 'org-1');

      expect(repository.paginate).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockAppointment.id);
    });
  });

  describe('update', () => {
    const updateDto: UpdateAppointmentDto = {
      status: 'checked_in',
    };

    it('should update appointment and invalidate cache', async () => {
      repository.findOne.mockResolvedValue(mockAppointment);
      repository.update.mockResolvedValue({
        ...mockAppointment,
        status: 'checked_in',
        checkedInAt: new Date(),
      });

      const result = await service.update(
        'appt-1',
        updateDto,
        'org-1',
        'user-1',
      );

      expect(repository.findOne).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException if appointment to update is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('appt-99', updateDto, 'org-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete appointment and invalidate cache', async () => {
      repository.findOne.mockResolvedValue(mockAppointment);

      await service.remove('appt-1', 'org-1', 'user-1');

      expect(repository.findOne).toHaveBeenCalled();
      expect(repository.softDelete).toHaveBeenCalledWith('appt-1', 'user-1');
      expect(cacheService.del).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException if appointment to remove is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('appt-99', 'org-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
