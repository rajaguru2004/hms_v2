import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(organizationId: string, todayStart: Date, todayEnd: Date) {
    return Promise.all([
      // Total patients (not deleted)
      this.prisma.patient.count({
        where: {
          organizationId,
          isActive: true,
          isDeleted: false,
        },
      }),

      // Today's appointments (not deleted)
      this.prisma.appointment.count({
        where: {
          organizationId,
          appointmentDate: {
            gte: todayStart,
            lte: todayEnd,
          },
          isDeleted: false,
        },
      }),

      // Pending lab orders
      this.prisma.labOrder.count({
        where: {
          organizationId,
          status: { in: ['pending', 'sample_collected', 'in_progress'] },
        },
      }),

      // Pending prescriptions
      this.prisma.prescription.count({
        where: {
          organizationId,
          status: 'pending',
        },
      }),

      // Today's payments (revenue)
      this.prisma.payment.aggregate({
        where: {
          organizationId,
          paymentDate: {
            gte: todayStart,
            lte: todayEnd,
          },
          isRefund: false,
        },
        _sum: { amount: true },
      }),

      // Occupied beds
      this.prisma.bed.count({
        where: {
          organizationId,
          status: 'occupied',
        },
      }),

      // Total beds
      this.prisma.bed.count({
        where: {
          organizationId,
        },
      }),

      // Waiting in queue (not deleted)
      this.prisma.queueManagement.count({
        where: {
          organizationId,
          status: 'waiting',
          joinedQueueAt: {
            gte: todayStart,
            lte: todayEnd,
          },
          isDeleted: false,
        },
      }),

      // Critical lab results (filtered by organizationId to preserve multi-tenancy)
      this.prisma.labResult.count({
        where: {
          isCritical: true,
          verifiedAt: null,
          OR: [{ organizationId }, { organizationId: null }],
        },
      }),
    ]);
  }

  async getAppointmentStatusBreakdown(
    organizationId: string,
    todayStart: Date,
    todayEnd: Date,
  ) {
    return this.prisma.appointment.groupBy({
      by: ['status'],
      where: {
        organizationId,
        appointmentDate: {
          gte: todayStart,
          lte: todayEnd,
        },
        isDeleted: false,
      },
      _count: true,
    });
  }

  async getQueueByService(
    organizationId: string,
    todayStart: Date,
    todayEnd: Date,
  ) {
    return this.prisma.queueManagement.groupBy({
      by: ['serviceArea'],
      where: {
        organizationId,
        status: { in: ['waiting', 'called', 'in_service'] },
        joinedQueueAt: {
          gte: todayStart,
          lte: todayEnd,
        },
        isDeleted: false,
      },
      _count: true,
    });
  }

  async getRecentPatients(organizationId: string, limit: number) {
    return this.prisma.patient.findMany({
      where: {
        organizationId,
        isActive: true,
        isDeleted: false,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        createdAt: true,
      },
    });
  }

  async getUpcomingAppointments(
    organizationId: string,
    todayStart: Date,
    limit: number,
  ) {
    return this.prisma.appointment.findMany({
      where: {
        organizationId,
        status: { in: ['scheduled', 'confirmed'] },
        appointmentDate: {
          gte: todayStart,
        },
        isDeleted: false,
      },
      take: limit,
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }
}
