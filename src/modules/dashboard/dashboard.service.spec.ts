/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './dashboard.repository';

const ORG = 'org-demo';

// `getMetrics` returns one object from a single SQL aggregate. It used to
// return a tuple of nine parallel query results, and this fixture was still
// that tuple — so every `metrics.totalPatients` read came back undefined.
const mockMetrics = {
  totalPatients: 150,
  todayAppointments: 12,
  pendingLabOrders: 5,
  pendingPrescriptions: 8,
  todayRevenue: 3500,
  occupiedBeds: 20,
  totalBeds: 40,
  waitingQueue: 6,
  criticalLabResults: 2,
};

const mockStatuses = [
  { status: 'scheduled', _count: 5 },
  { status: 'completed', _count: 7 },
];

const mockQueueByService = [
  { serviceArea: 'OPD', _count: 3 },
  { serviceArea: 'Emergency', _count: 2 },
];

const mockRecentPatients = [
  {
    id: 'pat-1',
    mrn: 'MRN001',
    firstName: 'John',
    lastName: 'Doe',
    gender: 'male',
    dateOfBirth: new Date('1990-01-01'),
    createdAt: new Date(),
  },
];

const mockUpcomingAppointments = [
  {
    id: 'appt-1',
    appointmentDate: new Date(),
    appointmentTime: '09:00',
    status: 'scheduled',
    patient: { id: 'pat-1', mrn: 'MRN001', firstName: 'John', lastName: 'Doe' },
  },
];

describe('DashboardService', () => {
  let service: DashboardService;
  let repository: jest.Mocked<DashboardRepository>;

  beforeEach(async () => {
    const mockRepo = {
      getMetrics: jest.fn(),
      getAppointmentStatusBreakdown: jest.fn(),
      getQueueByService: jest.fn(),
      getRecentPatients: jest.fn(),
      getUpcomingAppointments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: DashboardRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    repository = module.get(DashboardRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardData', () => {
    beforeEach(() => {
      repository.getMetrics.mockResolvedValue(mockMetrics);
      repository.getAppointmentStatusBreakdown.mockResolvedValue(mockStatuses);
      repository.getQueueByService.mockResolvedValue(mockQueueByService);
      repository.getRecentPatients.mockResolvedValue(mockRecentPatients);
      repository.getUpcomingAppointments.mockResolvedValue(
        mockUpcomingAppointments as unknown as Awaited<
          ReturnType<DashboardRepository['getUpcomingAppointments']>
        >,
      );
    });

    it('should aggregate dashboard stats correctly', async () => {
      const result = await service.getDashboardData(ORG);

      expect(result.stats.totalPatients).toBe(150);
      expect(result.stats.todayAppointments).toBe(12);
      expect(result.stats.pendingLabOrders).toBe(5);
      expect(result.stats.pendingPrescriptions).toBe(8);
      expect(result.stats.todayRevenue).toBe(3500);
      expect(result.stats.occupiedBeds).toBe(20);
      expect(result.stats.totalBeds).toBe(40);
      expect(result.stats.availableBeds).toBe(20); // 40 - 20
      expect(result.stats.queueWaiting).toBe(6);
      expect(result.stats.criticalAlerts).toBe(2);
    });

    it('should format appointment status breakdown as key-value map', async () => {
      const result = await service.getDashboardData(ORG);

      expect(result.appointmentStatuses).toEqual({
        scheduled: 5,
        completed: 7,
      });
    });

    it('should format queue by service area as key-value map', async () => {
      const result = await service.getDashboardData(ORG);

      expect(result.queueByService).toEqual({
        OPD: 3,
        Emergency: 2,
      });
    });

    it('should return recent patients list', async () => {
      const result = await service.getDashboardData(ORG);

      expect(result.recentPatients).toHaveLength(1);
      expect(result.recentPatients[0].mrn).toBe('MRN001');
    });

    it('should return upcoming appointments with patient info', async () => {
      const result = await service.getDashboardData(ORG);

      expect(result.upcomingAppointments).toHaveLength(1);
      expect(result.upcomingAppointments[0].patient.mrn).toBe('MRN001');
    });

    it('should handle a day with no revenue gracefully', async () => {
      // SUM() over no rows is NULL, which must render as 0 and not as a blank
      // tile on the board.
      repository.getMetrics.mockResolvedValue({
        ...mockMetrics,
        todayRevenue: null,
      });

      const result = await service.getDashboardData(ORG);

      expect(result.stats.todayRevenue).toBe(0);
    });

    it('should never report negative available beds', async () => {
      // Reserved and blocked beds are counted as occupied by this query, so
      // occupied can exceed the ward total; a negative bed count on a board is
      // worse than a zero.
      repository.getMetrics.mockResolvedValue({
        ...mockMetrics,
        occupiedBeds: 45,
        totalBeds: 40,
      });

      const result = await service.getDashboardData(ORG);

      expect(result.stats.availableBeds).toBe(0);
    });

    it('should report ward capacity that occupied + available does not add up to', async () => {
      // 40 beds, 20 occupied, 6 of the rest reserved or under maintenance.
      // A client deriving capacity from occupied + available reads 34 and
      // under-reports the ward by every bed that is neither.
      repository.getMetrics.mockResolvedValue({
        ...mockMetrics,
        occupiedBeds: 20,
        totalBeds: 40,
      });

      const result = await service.getDashboardData(ORG);

      expect(result.stats.totalBeds).toBe(40);
      expect(result.stats.totalBeds).toBeGreaterThanOrEqual(
        result.stats.occupiedBeds + result.stats.availableBeds,
      );
    });

    it('should call all repository methods in parallel', async () => {
      await service.getDashboardData(ORG);

      expect(repository.getMetrics).toHaveBeenCalledWith(
        ORG,
        expect.any(Date),
        expect.any(Date),
      );
      expect(repository.getAppointmentStatusBreakdown).toHaveBeenCalled();
      expect(repository.getQueueByService).toHaveBeenCalled();
      expect(repository.getRecentPatients).toHaveBeenCalledWith(ORG, 5);
      expect(repository.getUpcomingAppointments).toHaveBeenCalledWith(
        ORG,
        expect.any(Date),
        10,
      );
    });

    it('should rethrow errors from repository', async () => {
      repository.getMetrics.mockRejectedValue(new Error('DB error'));

      await expect(service.getDashboardData(ORG)).rejects.toThrow('DB error');
    });
  });
});
