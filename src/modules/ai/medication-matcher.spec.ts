import { MedicationMatcher } from './medication-matcher.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The one property this service exists to have: what the patient said is what
 * gets stored, every time, match or no match.
 *
 * Normalising "Amlong" into "Amlodipine" produces a chart entry with a real
 * drug's name on it and nothing behind it, and once stored nothing downstream
 * can tell that guess from something the patient actually said. So the
 * catalogue hit is a *suggestion* a person confirms, never a substitution.
 */

const CATALOGUE = [
  {
    id: 'd1',
    drugName: 'Amlodipine',
    genericName: 'Amlodipine',
    brandName: 'Amlong',
  },
  {
    id: 'd2',
    drugName: 'Metformin',
    genericName: 'Metformin',
    brandName: 'Glycomet',
  },
];

function matcherWith(drugs: typeof CATALOGUE | Error): {
  matcher: MedicationMatcher;
  findMany: jest.Mock;
} {
  const findMany = jest.fn(() =>
    drugs instanceof Error ? Promise.reject(drugs) : Promise.resolve(drugs),
  );
  const prisma = { pharmacyDrug: { findMany } } as unknown as PrismaService;
  return { matcher: new MedicationMatcher(prisma), findMany };
}

describe('MedicationMatcher', () => {
  it("stores the patient's spelling and offers the catalogue name beside it", async () => {
    const { matcher } = matcherWith(CATALOGUE);

    const result = await matcher.match('amlodipin', 'org-1');

    expect(result.statedName).toBe('amlodipin');
    expect(result.suggestedName).toBe('Amlodipine');
    expect(result.similarity).toBeGreaterThan(0.6);
  });

  it('never marks a match as verified, however good it is', async () => {
    const { matcher } = matcherWith(CATALOGUE);

    const exact = await matcher.match('Amlodipine', 'org-1');

    // There is deliberately no second, higher threshold above which the
    // suggestion is applied automatically. That threshold is the thing this
    // file exists to not have.
    expect(exact.needsVerification).toBe(true);
    expect(exact.statedName).toBe('Amlodipine');
  });

  it('matches a brand name the patient used', async () => {
    const { matcher } = matcherWith(CATALOGUE);

    const result = await matcher.match('Amlong', 'org-1');

    // Brand and generic are separate catalogue entries rather than one
    // concatenated string: a patient says one or the other.
    expect(result.suggestedName).toBe('Amlong');
    expect(result.suggestedDrugId).toBe('d1');
  });

  it('offers nothing rather than the nearest thing when nothing is close', async () => {
    const { matcher } = matcherWith(CATALOGUE);

    const result = await matcher.match('something the doctor gave me', 'org-1');

    expect(result.suggestedName).toBeUndefined();
    expect(result.statedName).toBe('something the doctor gave me');
  });

  it("keeps the patient's words when the catalogue cannot be read", async () => {
    const { matcher } = matcherWith(new Error('connection lost'));

    const result = await matcher.match('amlodipin', 'org-1');

    // The degradation is the same answer this service gives for a drug the
    // pharmacy does not stock, which is why it needs no special handling above.
    expect(result).toEqual({
      statedName: 'amlodipin',
      needsVerification: true,
    });
  });

  it("keeps the patient's words when the catalogue is empty", async () => {
    const { matcher } = matcherWith([]);

    const result = await matcher.match('amlodipin', 'org-1');

    expect(result.suggestedName).toBeUndefined();
    expect(result.statedName).toBe('amlodipin');
  });

  it('caches the catalogue per organisation', async () => {
    const { matcher, findMany } = matcherWith(CATALOGUE);

    await matcher.match('amlodipin', 'org-1');
    await matcher.match('metformin', 'org-1');
    await matcher.match('metformin', 'org-2');

    // Once per organisation: the matcher runs behind a patient's turn, and the
    // catalogue changes on a pharmacist's timescale, not a patient's.
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('returns an empty statement for an empty name without asking the database', async () => {
    const { matcher, findMany } = matcherWith(CATALOGUE);

    const result = await matcher.match('   ', 'org-1');

    expect(result.statedName).toBe('');
    expect(findMany).not.toHaveBeenCalled();
  });
});
