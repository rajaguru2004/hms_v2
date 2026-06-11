import { Injectable, Logger } from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository';
import { DashboardResponseDto } from './dto/dashboard.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly repository: DashboardRepository) {}

  async getDashboardData(
    organizationId: string,
  ): Promise<DashboardResponseDto> {
    try {
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      // Run aggregates in parallel for optimal performance
      const [
        [
          totalPatients,
          todayAppointments,
          pendingLabOrders,
          pendingPrescriptions,
          todayPayments,
          occupiedBeds,
          totalBeds,
          waitingQueue,
          criticalLabResults,
        ],
        appointmentStatuses,
        queueByService,
        recentPatients,
        upcomingAppointments,
      ] = await Promise.all([
        this.repository.getMetrics(organizationId, todayStart, todayEnd),
        this.repository.getAppointmentStatusBreakdown(
          organizationId,
          todayStart,
          todayEnd,
        ),
        this.repository.getQueueByService(organizationId, todayStart, todayEnd),
        this.repository.getRecentPatients(organizationId, 5),
        this.repository.getUpcomingAppointments(organizationId, todayStart, 10),
      ]);

      const formattedStatuses = appointmentStatuses.reduce(
        (acc, item) => {
          acc[item.status] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      );

      const formattedQueue = queueByService.reduce(
        (acc, item) => {
          acc[item.serviceArea] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      );

      const formattedUpcomingAppointments = upcomingAppointments.map((app) => ({
        id: app.id,
        appointmentDate: app.appointmentDate,
        appointmentTime: app.appointmentTime,
        status: app.status,
        patient: {
          id: app.patient.id,
          mrn: app.patient.mrn,
          firstName: app.patient.firstName,
          lastName: app.patient.lastName,
        },
      }));

      return {
        stats: {
          totalPatients,
          todayAppointments,
          pendingLabOrders,
          pendingPrescriptions,
          todayRevenue: todayPayments?._sum?.amount || 0,
          occupiedBeds,
          availableBeds: Math.max(0, totalBeds - occupiedBeds),
          queueWaiting: waitingQueue,
          criticalAlerts: criticalLabResults,
        },
        appointmentStatuses: formattedStatuses,
        queueByService: formattedQueue,
        recentPatients: recentPatients.map((p) => ({
          id: p.id,
          mrn: p.mrn,
          firstName: p.firstName,
          lastName: p.lastName,
          gender: p.gender,
          dateOfBirth: p.dateOfBirth,
          createdAt: p.createdAt,
        })),
        upcomingAppointments: formattedUpcomingAppointments,
      };
    } catch (error) {
      this.logger.error(
        {
          message: 'Failed to fetch dashboard data',
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
