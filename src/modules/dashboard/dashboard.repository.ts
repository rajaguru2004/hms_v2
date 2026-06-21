import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DashboardMetrics {
  totalPatients: number;
  todayAppointments: number;
  pendingLabOrders: number;
  pendingPrescriptions: number;
  todayRevenue: number | null;
  occupiedBeds: number;
  totalBeds: number;
  waitingQueue: number;
  criticalLabResults: number;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch all dashboard metrics in a single DB round-trip using correlated
   * subqueries. Previously 10 separate COUNT/SUM queries (each 1-2s due to
   * missing indexes). Now: 1 query + composite indexes = <200ms.
   */
  async getMetrics(
    organizationId: string,
    todayStart: Date,
    todayEnd: Date,
  ): Promise<DashboardMetrics> {
    type MetricsRow = {
      total_patients: bigint;
      today_appointments: bigint;
      pending_lab_orders: bigint;
      pending_prescriptions: bigint;
      today_revenue: string | null;
      occupied_beds: bigint;
      total_beds: bigint;
      waiting_queue: bigint;
      critical_lab_results: bigint;
    };

    const rows = await this.prisma.$queryRaw<MetricsRow[]>`
      SELECT
        -- Total active patients (Patient_organizationId_isActive_isDeleted_idx)
        (SELECT COUNT(*) FROM "Patient"
          WHERE "organizationId" = ${organizationId}
            AND "isActive" = true
            AND "isDeleted" = false
        ) AS total_patients,

        -- Today's appointments (Appointment_organizationId_appointmentDate_isDeleted_idx)
        (SELECT COUNT(*) FROM "Appointment"
          WHERE "organizationId" = ${organizationId}
            AND "appointmentDate" >= ${todayStart}
            AND "appointmentDate" <= ${todayEnd}
            AND "isDeleted" = false
        ) AS today_appointments,

        -- Pending lab orders (LabOrder_organizationId_status_idx)
        (SELECT COUNT(*) FROM "LabOrder"
          WHERE "organizationId" = ${organizationId}
            AND "status" IN ('pending', 'sample_collected', 'in_progress')
        ) AS pending_lab_orders,

        -- Pending prescriptions (Prescription_organizationId_status_idx)
        (SELECT COUNT(*) FROM "Prescription"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'pending'
        ) AS pending_prescriptions,

        -- Today's revenue sum (Payment_organizationId_paymentDate_isRefund_idx)
        (SELECT SUM("amount") FROM "Payment"
          WHERE "organizationId" = ${organizationId}
            AND "paymentDate" >= ${todayStart}
            AND "paymentDate" <= ${todayEnd}
            AND "isRefund" = false
        ) AS today_revenue,

        -- Occupied beds (Bed_organizationId_status_idx)
        (SELECT COUNT(*) FROM "Bed"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'occupied'
        ) AS occupied_beds,

        -- Total beds (Bed organizationId idx)
        (SELECT COUNT(*) FROM "Bed"
          WHERE "organizationId" = ${organizationId}
        ) AS total_beds,

        -- Waiting in queue today (QueueManagement_organizationId_status_joinedQueueAt_isDeleted_idx)
        (SELECT COUNT(*) FROM "QueueManagement"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'waiting'
            AND "joinedQueueAt" >= ${todayStart}
            AND "joinedQueueAt" <= ${todayEnd}
            AND "isDeleted" = false
        ) AS waiting_queue,

        -- Critical unverified lab results (LabResult_organizationId_isCritical_verifiedAt_idx)
        (SELECT COUNT(*) FROM "LabResult"
          WHERE "isCritical" = true
            AND "verifiedAt" IS NULL
            AND ("organizationId" = ${organizationId} OR "organizationId" IS NULL)
        ) AS critical_lab_results
    `;

    const r = rows[0];
    return {
      totalPatients: Number(r.total_patients),
      todayAppointments: Number(r.today_appointments),
      pendingLabOrders: Number(r.pending_lab_orders),
      pendingPrescriptions: Number(r.pending_prescriptions),
      todayRevenue: r.today_revenue ? parseFloat(r.today_revenue) : null,
      occupiedBeds: Number(r.occupied_beds),
      totalBeds: Number(r.total_beds),
      waitingQueue: Number(r.waiting_queue),
      criticalLabResults: Number(r.critical_lab_results),
    };
  }

  async getAppointmentStatusBreakdown(
    organizationId: string,
    todayStart: Date,
    todayEnd: Date,
  ) {
    // Uses Appointment_organizationId_status_appointmentDate_isDeleted_idx
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
    // Uses QueueManagement_organizationId_status_joinedQueueAt_isDeleted_idx
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
    // Uses Patient_organizationId_isActive_isDeleted_idx
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
    // Uses Appointment_organizationId_status_appointmentDate_isDeleted_idx
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
