import { Injectable } from '@nestjs/common';
import { Prisma, DeathCertificate } from '@prisma/client';
import { DeathCertificateRepository } from './repositories/death-certificate.repository';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums/action.enum';
import {
  NotFoundException,
  ConflictException,
} from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/exceptions/error-codes';
import {
  CreateDeathCertificateDto,
  UpdateDeathCertificateDto,
  IssueDeathCertificateDto,
  DeathCertificateQueryDto,
} from './dto/death-certificate.dto';
import { PaginatedResult } from '../../common/types/paginated.type';

export const DEATH_CERTIFICATE_INCLUDE = {
  patient: true,
  certifiedBy: {
    select: {
      fullName: true,
      licenseNumber: true,
      specialization: true,
    },
  },
  issuedBy: {
    select: {
      fullName: true,
    },
  },
} as const;

export type DeathCertificateWithRelations = Prisma.DeathCertificateGetPayload<{
  include: typeof DEATH_CERTIFICATE_INCLUDE;
}>;

@Injectable()
export class DeathCertificatesService {
  constructor(
    private readonly repository: DeathCertificateRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a unique Death Certificate Number.
   * Format: DCYYYYMMDDXXXX
   */
  private generateCertificateNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `DC${date}${random}`;
  }

  /**
   * Create a new Death Certificate.
   */
  async create(
    dto: CreateDeathCertificateDto,
    organizationId: string,
    userId?: string,
  ): Promise<DeathCertificate> {
    let retries = 3;
    let certificate: DeathCertificate | null = null;

    while (retries > 0) {
      try {
        const certificateNumber = this.generateCertificateNumber();
        certificate = await this.repository.create({
          organization: { connect: { id: organizationId } },
          patient: { connect: { id: dto.patientId } },
          certifiedBy: { connect: { id: dto.certifiedById } },
          certificateNumber,
          dateOfDeath: new Date(dto.dateOfDeath),
          timeOfDeath: dto.timeOfDeath,
          placeOfDeath: dto.placeOfDeath,
          locationDetails: dto.locationDetails,
          ageAtDeathYears: dto.ageAtDeathYears,
          ageAtDeathMonths: dto.ageAtDeathMonths,
          ageAtDeathDays: dto.ageAtDeathDays,
          sex: dto.sex,
          maritalStatus: dto.maritalStatus,
          occupation: dto.occupation,
          address: dto.address,
          immediateCause: dto.immediateCause,
          antecedentCauseB: dto.antecedentCauseB,
          antecedentCauseC: dto.antecedentCauseC,
          antecedentCauseD: dto.antecedentCauseD,
          otherConditions: dto.otherConditions,
          mannerOfDeath: dto.mannerOfDeath,
          autopsyPerformed: dto.autopsyPerformed ?? false,
          autopsyFindings: dto.autopsyFindings,
          isMaternalDeath: dto.isMaternalDeath ?? false,
          pregnancyRelated: dto.pregnancyRelated,
          certificationDate: new Date(),
          certifierQualification: dto.certifierQualification,
          licenseNumber: dto.licenseNumber,
          signatureUrl: dto.signatureUrl,
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[] | undefined;
          if (target?.includes('certificateNumber')) {
            retries--;
            continue;
          }
        }
        throw error;
      }
    }

    if (!certificate) {
      throw new ConflictException(
        'Failed to generate unique certificate number after retries.',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      entityName: 'DeathCertificate',
      entityId: certificate.id,
      newValues: {
        certificateNumber: certificate.certificateNumber,
        patientId: certificate.patientId,
        dateOfDeath: certificate.dateOfDeath,
      },
      metadata: { organizationId },
    });

    return certificate;
  }

  /**
   * List Death Certificates with filters and pagination.
   */
  async findAll(
    query: DeathCertificateQueryDto,
    organizationId: string,
  ): Promise<PaginatedResult<DeathCertificate>> {
    const where: Prisma.DeathCertificateWhereInput = {
      organizationId,
    };

    if (query.search) {
      const searchLower = query.search.trim();
      where.OR = [
        { certificateNumber: { contains: searchLower, mode: 'insensitive' } },
        {
          patient: {
            firstName: { contains: searchLower, mode: 'insensitive' },
          },
        },
        {
          patient: { lastName: { contains: searchLower, mode: 'insensitive' } },
        },
        { patient: { mrn: { contains: searchLower, mode: 'insensitive' } } },
      ];
    }

    if (query.place && query.place !== 'all') {
      where.placeOfDeath = query.place;
    }

    const page =
      query.offset !== undefined && query.limit !== undefined
        ? Math.floor(query.offset / query.limit) + 1
        : 1;

    return this.repository.paginate(where, {
      page,
      limit: query.limit ?? 50,
      orderBy: { createdAt: 'desc' },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            mrn: true,
          },
        },
        certifiedBy: {
          select: {
            fullName: true,
          },
        },
      },
    });
  }

  /**
   * Get Death Certificate by ID.
   */
  async findById(
    id: string,
    organizationId: string,
  ): Promise<DeathCertificateWithRelations> {
    const certificate = await this.repository.findOne(
      { id, organizationId },
      {
        patient: true,
        certifiedBy: {
          select: {
            fullName: true,
            licenseNumber: true,
            specialization: true,
          },
        },
        issuedBy: {
          select: {
            fullName: true,
          },
        },
      },
    );

    if (!certificate) {
      throw new NotFoundException(
        'Death certificate not found or belongs to another organization',
        ErrorCodes.DEATH_CERTIFICATE_NOT_FOUND,
      );
    }

    return certificate as DeathCertificateWithRelations;
  }

  /**
   * Update an existing Death Certificate.
   */
  async update(
    id: string,
    dto: UpdateDeathCertificateDto,
    organizationId: string,
    userId?: string,
  ): Promise<DeathCertificate> {
    const existing = await this.findById(id, organizationId);

    const updateData: Prisma.DeathCertificateUpdateInput = {
      dateOfDeath: dto.dateOfDeath ? new Date(dto.dateOfDeath) : undefined,
      timeOfDeath: dto.timeOfDeath,
      placeOfDeath: dto.placeOfDeath,
      locationDetails: dto.locationDetails,
      immediateCause: dto.immediateCause,
      antecedentCauseB: dto.antecedentCauseB,
      antecedentCauseC: dto.antecedentCauseC,
      antecedentCauseD: dto.antecedentCauseD,
      otherConditions: dto.otherConditions,
      mannerOfDeath: dto.mannerOfDeath,
      autopsyPerformed: dto.autopsyPerformed,
      autopsyFindings: dto.autopsyFindings,
      isMaternalDeath: dto.isMaternalDeath,
      pregnancyRelated: dto.pregnancyRelated,
      certifierQualification: dto.certifierQualification,
      licenseNumber: dto.licenseNumber,
      signatureUrl: dto.signatureUrl,
    };

    if (dto.certifiedById) {
      updateData.certifiedBy = { connect: { id: dto.certifiedById } };
    }

    const updated = await this.repository.update(id, updateData);

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'DeathCertificate',
      entityId: id,
      oldValues: {
        immediateCause: existing.immediateCause,
        mannerOfDeath: existing.mannerOfDeath,
      },
      newValues: {
        immediateCause: updated.immediateCause,
        mannerOfDeath: updated.mannerOfDeath,
      },
      metadata: { organizationId },
    });

    return updated;
  }

  /**
   * Delete a Death Certificate.
   */
  async remove(
    id: string,
    organizationId: string,
    userId?: string,
  ): Promise<void> {
    await this.findById(id, organizationId);

    await this.repository.softDelete(id);

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      entityName: 'DeathCertificate',
      entityId: id,
      metadata: { organizationId },
    });
  }

  /**
   * Record issuance of a Death Certificate.
   */
  async issue(
    id: string,
    dto: IssueDeathCertificateDto,
    organizationId: string,
    userId?: string,
  ): Promise<DeathCertificate> {
    const existing = await this.findById(id, organizationId);

    const updated = await this.repository.update(id, {
      issuedTo: dto.issuedTo,
      issuedToRelationship: dto.issuedToRelationship,
      issuedToNationalId: dto.issuedToNationalId,
      issuedBy: { connect: { id: dto.issuedById } },
      issuedAt: new Date(),
    });

    // Audit log
    void this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      entityName: 'DeathCertificate',
      entityId: id,
      oldValues: {
        issuedTo: existing.issuedTo,
      },
      newValues: {
        issuedTo: updated.issuedTo,
      },
      metadata: {
        organizationId,
        action: 'issue',
      },
    });

    return updated;
  }

  /**
   * Renders the printable HTML view.
   */
  async getPrintView(id: string, organizationId: string): Promise<string> {
    const certificate = await this.findById(id, organizationId);

    const patientName = [
      certificate.patient?.firstName,
      certificate.patient?.middleName,
      certificate.patient?.lastName,
    ]
      .filter(Boolean)
      .join(' ');

    const formattedDate = certificate.dateOfDeath
      ? new Date(certificate.dateOfDeath).toLocaleDateString()
      : 'N/A';
    const formattedCertDate = certificate.certificationDate
      ? new Date(certificate.certificationDate).toLocaleDateString()
      : 'N/A';

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Death Certificate ${certificate.certificateNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      h2 { margin: 20px 0 8px; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .meta { margin-bottom: 16px; color: #444; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
      .field { margin: 4px 0; }
      .label { font-weight: 700; }
      @media print { .no-print { display: none; } body { margin: 0; } }
    </style>
  </head>
  <body>
    <button class="no-print" onclick="window.print()">Print</button>
    <h1>Death Certificate</h1>
    <div class="meta">Certificate No: ${certificate.certificateNumber}</div>

    <h2>Patient Information</h2>
    <div class="grid">
      <div class="field"><span class="label">Name:</span> ${patientName || 'N/A'}</div>
      <div class="field"><span class="label">MRN:</span> ${certificate.patient?.mrn || 'N/A'}</div>
      <div class="field"><span class="label">Sex:</span> ${certificate.sex || 'N/A'}</div>
      <div class="field"><span class="label">Occupation:</span> ${certificate.occupation || 'N/A'}</div>
      <div class="field"><span class="label">Address:</span> ${certificate.address || 'N/A'}</div>
      <div class="field"><span class="label">Date of Death:</span> ${formattedDate}</div>
      <div class="field"><span class="label">Time of Death:</span> ${certificate.timeOfDeath || 'N/A'}</div>
      <div class="field"><span class="label">Place of Death:</span> ${certificate.placeOfDeath}</div>
    </div>

    <h2>Cause of Death</h2>
    <div class="field"><span class="label">Immediate Cause:</span> ${certificate.immediateCause || 'N/A'}</div>
    <div class="field"><span class="label">Antecedent Cause B:</span> ${certificate.antecedentCauseB || 'N/A'}</div>
    <div class="field"><span class="label">Antecedent Cause C:</span> ${certificate.antecedentCauseC || 'N/A'}</div>
    <div class="field"><span class="label">Antecedent Cause D:</span> ${certificate.antecedentCauseD || 'N/A'}</div>
    <div class="field"><span class="label">Other Conditions:</span> ${certificate.otherConditions || 'N/A'}</div>
    <div class="field"><span class="label">Manner of Death:</span> ${certificate.mannerOfDeath}</div>

    <h2>Certification</h2>
    <div class="grid">
      <div class="field"><span class="label">Certified By:</span> ${certificate.certifiedBy?.fullName || 'N/A'}</div>
      <div class="field"><span class="label">Qualification:</span> ${certificate.certifierQualification || certificate.certifiedBy?.specialization || 'N/A'}</div>
      <div class="field"><span class="label">License Number:</span> ${certificate.licenseNumber || certificate.certifiedBy?.licenseNumber || 'N/A'}</div>
      <div class="field"><span class="label">Certification Date:</span> ${formattedCertDate}</div>
      <div class="field"><span class="label">Issued To:</span> ${certificate.issuedTo || 'N/A'}</div>
      <div class="field"><span class="label">Issued By:</span> ${certificate.issuedBy?.fullName || 'N/A'}</div>
    </div>
  </body>
</html>`;
  }
}
