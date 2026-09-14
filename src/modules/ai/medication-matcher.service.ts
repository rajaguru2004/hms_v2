import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FuzzySet = require('fuzzyset.js');

/**
 * Matching what the patient called their medicine against what the pharmacy
 * stocks — without ever replacing the first with the second.
 *
 * A patient says "amlodipin", "the white blood pressure one", "Amlong 5".
 * Spec §18 wants a structured medication list out of that; the thing it must
 * never produce is a *confident wrong* one. Normalising "Amlong" to
 * "Amlodipine" is a guess with a real drug's name on it, and once it is stored
 * as a value nothing downstream can tell it from something the patient said.
 *
 * So the rule here is narrow: a strong catalogue match is offered as a
 * *suggestion* alongside the patient's own words, and the patient's own words
 * are what is stored. The fact carries `needsVerification` and the suggestion,
 * and a human — the patient at the review screen, or the clinician at the
 * consultation — decides. Nothing is normalised on the way in.
 *
 * `fuzzyset.js` because `PatientMatcher` already uses it for the same class of
 * problem on names, and one fuzzy-matching library is enough for one codebase.
 */

export interface MedicationMatch {
  /** Exactly what the patient said, always. This is what gets stored. */
  readonly statedName: string;
  /** The catalogue entry this might be. Never substituted for `statedName`. */
  readonly suggestedName?: string;
  readonly suggestedDrugId?: string;
  /**
   * The fuzzy-match score, 0..1.
   *
   * A real measurement of string similarity, not a model's opinion of itself —
   * which is why it is allowed to exist at all. It still decides nothing about
   * the chart: it decides whether there is a suggestion to show.
   */
  readonly similarity?: number;
  /**
   * True whenever the stated name has not been confirmed by a person. Which is
   * to say: true on the way out of this service, always, match or no match.
   */
  readonly needsVerification: true;
}

/**
 * Below this, a suggestion is noise. "Amlodipine" against "Metformin" scores
 * far under it; "amlodipin" against "Amlodipine" scores well over.
 *
 * Deliberately only a display threshold. There is no second, higher threshold
 * above which the suggestion is applied automatically — that threshold is the
 * thing this file exists to not have.
 */
const SUGGESTION_THRESHOLD = 0.6;

/** The catalogue is read per organisation and cached briefly; it changes rarely. */
const CATALOGUE_TTL_MS = 300_000;

interface CatalogueEntry {
  id: string;
  name: string;
}

@Injectable()
export class MedicationMatcher {
  private readonly logger = new Logger(MedicationMatcher.name);
  private readonly cache = new Map<
    string,
    { entries: CatalogueEntry[]; names: string[]; loadedAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Never throws and never returns nothing: a catalogue that cannot be read
   * degrades to the patient's own words, which is the answer this service
   * would have given anyway for a drug the pharmacy does not stock.
   */
  async match(
    statedName: string,
    organizationId: string,
  ): Promise<MedicationMatch> {
    const stated = statedName.trim();
    const base: MedicationMatch = {
      statedName: stated,
      needsVerification: true,
    };
    if (stated.length === 0) return base;

    let catalogue: { entries: CatalogueEntry[]; names: string[] };
    try {
      catalogue = await this.catalogueFor(organizationId);
    } catch (error) {
      this.logger.warn(
        `drug catalogue unavailable; storing the patient's words verbatim: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return base;
    }

    if (catalogue.names.length === 0) return base;

    const fuzzy = FuzzySet(catalogue.names);
    const matches = fuzzy.get(stated, null, SUGGESTION_THRESHOLD);
    const best = matches?.[0];
    if (!best) return base;

    const [similarity, name] = best;
    const entry = catalogue.entries.find(
      (candidate) => candidate.name === name,
    );

    return {
      statedName: stated,
      suggestedName: name,
      suggestedDrugId: entry?.id,
      similarity,
      needsVerification: true,
    };
  }

  private async catalogueFor(
    organizationId: string,
  ): Promise<{ entries: CatalogueEntry[]; names: string[] }> {
    const cached = this.cache.get(organizationId);
    if (cached && Date.now() - cached.loadedAt < CATALOGUE_TTL_MS) {
      return cached;
    }

    const drugs = await this.prisma.pharmacyDrug.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, drugName: true, genericName: true, brandName: true },
      // A ceiling rather than the whole table: the matcher runs behind a
      // patient's turn, and `PatientMatcher` sets the same precedent at 500.
      take: 2000,
    });

    // Generic and brand names are separate entries rather than one concatenated
    // string, because a patient says one or the other and a fuzzy match against
    // "Amlodipine Amlong 5mg" scores worse against either than against both.
    const entries: CatalogueEntry[] = [];
    const seen = new Set<string>();
    for (const drug of drugs) {
      for (const name of [drug.drugName, drug.genericName, drug.brandName]) {
        const trimmed = name?.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        entries.push({ id: drug.id, name: trimmed });
      }
    }

    const loaded = {
      entries,
      names: entries.map((entry) => entry.name),
      loadedAt: Date.now(),
    };
    this.cache.set(organizationId, loaded);
    return loaded;
  }
}
