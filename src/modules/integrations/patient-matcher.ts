import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FuzzySet = require('fuzzyset.js');

export interface PatientMatchResult {
  matched: boolean;
  patientId?: string;
  confidence?: number;
  matchMethod?: 'mrn' | 'exact_name' | 'fuzzy_name' | 'phone';
  patient?: any;
  suggestions?: Array<{
    patientId: string;
    name: string;
    mrn: string;
    confidence: number;
  }>;
}

@Injectable()
export class PatientMatcher {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempt to match a patient by various identifiers
   */
  async matchPatient(
    identifier: string,
    organizationId: string,
    options?: {
      name?: string;
      phone?: string;
      dateOfBirth?: string;
    },
  ): Promise<PatientMatchResult> {
    // Try 1: Match by MRN (exact)
    if (identifier) {
      const mrnMatch = await this.prisma.patient.findFirst({
        where: {
          organizationId,
          mrn: identifier.trim(),
          isActive: true,
        },
      });

      if (mrnMatch) {
        return {
          matched: true,
          patientId: mrnMatch.id,
          confidence: 1.0,
          matchMethod: 'mrn',
          patient: mrnMatch,
        };
      }
    }

    // Try 2: Match by exact name (if provided)
    if (options?.name) {
      const nameParts = options.name.trim().split(/\s+/);
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];

        const exactNameMatch = await this.prisma.patient.findFirst({
          where: {
            organizationId,
            firstName: { equals: firstName, mode: 'insensitive' },
            lastName: { equals: lastName, mode: 'insensitive' },
            isActive: true,
          },
        });

        if (exactNameMatch) {
          return {
            matched: true,
            patientId: exactNameMatch.id,
            confidence: 0.95,
            matchMethod: 'exact_name',
            patient: exactNameMatch,
          };
        }
      }
    }

    // Try 3: Match by phone (if provided)
    if (options?.phone) {
      const phoneMatch = await this.prisma.patient.findFirst({
        where: {
          organizationId,
          phonePrimary: options.phone.trim(),
          isActive: true,
        },
      });

      if (phoneMatch) {
        return {
          matched: true,
          patientId: phoneMatch.id,
          confidence: 0.9,
          matchMethod: 'phone',
          patient: phoneMatch,
        };
      }
    }

    // Try 4: Fuzzy name matching (get all patients and fuzzy match)
    if (options?.name) {
      const allPatients = await this.prisma.patient.findMany({
        where: {
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          mrn: true,
          dateOfBirth: true,
        },
        take: 500, // Limit to prevent performance issues
      });

      if (allPatients.length > 0) {
        const patientNames = allPatients.map((p) =>
          `${p.firstName} ${p.middleName || ''} ${p.lastName}`.trim(),
        );

        // Initialize FuzzySet
        const fuzzySet = FuzzySet(patientNames);
        const matches = fuzzySet.get(options.name.trim(), null, 0.7); // 70% similarity threshold

        if (matches && matches.length > 0) {
          const suggestions = matches.slice(0, 5).map(([confidence, name]) => {
            const index = patientNames.indexOf(name);
            const patient = allPatients[index];
            return {
              patientId: patient.id,
              name: `${patient.firstName} ${patient.lastName}`,
              mrn: patient.mrn,
              confidence,
            };
          });

          // If top match has high confidence, auto-match
          if (suggestions[0].confidence >= 0.85) {
            const bestMatch = allPatients.find(
              (p) => p.id === suggestions[0].patientId,
            );
            return {
              matched: true,
              patientId: suggestions[0].patientId,
              confidence: suggestions[0].confidence,
              matchMethod: 'fuzzy_name',
              patient: bestMatch,
              suggestions,
            };
          }

          // Otherwise, return suggestions for manual review
          return {
            matched: false,
            suggestions,
          };
        }
      }
    }

    // No match found
    return {
      matched: false,
    };
  }

  /**
   * Match multiple patient identifiers in batch
   */
  async matchPatientsBatch(
    identifiers: Array<{ identifier: string; name?: string; phone?: string }>,
    organizationId: string,
  ): Promise<PatientMatchResult[]> {
    const results: PatientMatchResult[] = [];

    for (const item of identifiers) {
      const result = await this.matchPatient(item.identifier, organizationId, {
        name: item.name,
        phone: item.phone,
      });
      results.push(result);
    }

    return results;
  }
}
