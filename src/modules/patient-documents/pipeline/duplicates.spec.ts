import {
  contentSignature,
  documentSha256,
  findTextDuplicate,
} from './duplicates';

/**
 * §21, and specifically the part of §21 that is easy to get wrong in the
 * expensive direction.
 *
 * Catching a re-upload is the easy half. The hard half is not catching a
 * *different* prescription from the same clinic for the same patient, because
 * losing that one loses a real clinical event and does it silently.
 */

const PRESCRIPTION = [
  'SUNRISEMULTISPECIALITYCLINIC',
  '14 Station Road, Coimbatore 641002 Ph 0422 244 1180',
  'PRESCRIPTION',
  'Patient: Ramesh Kumar',
  'Date: 12/09/2026',
  'Age / Sex: 54 / Male',
  'OP No: OP-2026-11847',
  'Diagnosis: Type 2 Diabetes Mellitus, Hypertension',
  'Rx',
  '1. Tab. METFORMIN 500 mg',
  '1 tablet - twice daily - oral',
  '2. Tab. AMLODIPINE 5 mg',
  '1 tablet - once daily - oral',
  '3. Tab. ATORVASTATIN 10 mg',
  'Advice: Check fasting blood sugar after 2 weeks. Reduce salt intake.',
  'Follow up: Review after 30 days.',
  'Dr.Anitha Raghavan,MD',
  'Reg. No. TN 54821',
].join('\n');

/** The same sheet photographed again: OCR slips, and two lines lost to glare. */
const REPHOTOGRAPHED = PRESCRIPTION.replace('METFORMIN', 'METFORNIN')
  .replace('AMLODIPINE', 'AMLODIPIN')
  .replace('Reg. No. TN 54821', '')
  .replace('OP No: OP-2026-11847', '');

/** A different visit. Same pad, same doctor, same patient, different drugs. */
const LATER_PRESCRIPTION = PRESCRIPTION.replace('METFORMIN', 'GLIMEPIRIDE')
  .replace('500 mg', '2 mg')
  .replace('AMLODIPINE', 'TELMISARTAN')
  .replace('ATORVASTATIN', 'ASPIRIN')
  .replace('12/09/2026', '04/04/2026')
  .replace('OP-2026-11847', 'OP-2026-90021');

const LAB_REPORT = [
  'METROLAB DIAGNOSTICS',
  'COMPLETE BLOODCOUNT',
  'Patient:Ramesh Kumar',
  'Haemoglobin\t11.2\tg/dL\t13.0-17.0',
  'Total WBC Count\t8400\t/uL\t4000 - 11000',
  'Platelet Count\t250000\t/uL\t150000 - 410000',
].join('\n');

describe('duplicate detection — the exact copy', () => {
  it('hashes the same bytes to the same key', () => {
    const bytes = Buffer.from('a prescription, as uploaded');
    expect(documentSha256(bytes)).toBe(documentSha256(Buffer.from(bytes)));
    expect(documentSha256(bytes)).toHaveLength(64);
  });

  it('hashes one changed byte to a different key', () => {
    expect(documentSha256(Buffer.from('abc'))).not.toBe(
      documentSha256(Buffer.from('abd')),
    );
  });
});

describe('duplicate detection — the re-photographed page', () => {
  it('matches the same sheet read twice', () => {
    const verdict = findTextDuplicate(REPHOTOGRAPHED, [
      { id: 'doc-original', ocrText: PRESCRIPTION },
    ]);

    expect(verdict.duplicateOfId).toBe('doc-original');
    expect(verdict.method).toBe('text_similarity');
    expect(verdict.similarity).toBeGreaterThan(0.88);
  });

  it('does NOT match a different prescription on the same letterhead', () => {
    // The one that costs something. Calling this a duplicate drops a real
    // prescription, and does it without telling anybody.
    const verdict = findTextDuplicate(LATER_PRESCRIPTION, [
      { id: 'doc-original', ocrText: PRESCRIPTION },
    ]);

    expect(verdict.duplicateOfId).toBeNull();
  });

  it('separates the two cases by a usable margin', () => {
    // Guards the threshold itself: if a change to the signature narrows this
    // gap, the test says so before a patient does.
    const same = findTextDuplicate(
      REPHOTOGRAPHED,
      [{ id: 'a', ocrText: PRESCRIPTION }],
      0,
    );
    const different = findTextDuplicate(
      LATER_PRESCRIPTION,
      [{ id: 'a', ocrText: PRESCRIPTION }],
      0,
    );

    expect(same.similarity ?? 0).toBeGreaterThan(
      (different.similarity ?? 0) + 0.1,
    );
  });

  it('does not match an unrelated document', () => {
    const verdict = findTextDuplicate(LAB_REPORT, [
      { id: 'doc-original', ocrText: PRESCRIPTION },
    ]);

    expect(verdict.duplicateOfId).toBeNull();
  });

  it('answers cleanly when there is nothing to compare against', () => {
    expect(findTextDuplicate(PRESCRIPTION, []).duplicateOfId).toBeNull();
    expect(
      findTextDuplicate(PRESCRIPTION, [{ id: 'x', ocrText: null }])
        .duplicateOfId,
    ).toBeNull();
    expect(
      findTextDuplicate('', [{ id: 'x', ocrText: PRESCRIPTION }]).duplicateOfId,
    ).toBeNull();
  });
});

describe('content signature', () => {
  it('drops the template vocabulary and keeps the identifiers', () => {
    const signature = contentSignature(PRESCRIPTION);

    expect(signature).toContain('metformin');
    expect(signature).toContain('11847');
    expect(signature.split(' ')).not.toContain('patient');
    expect(signature.split(' ')).not.toContain('tablet');
  });

  it('is stable under a different block ordering', () => {
    const shuffled = PRESCRIPTION.split('\n').reverse().join('\n');
    expect(contentSignature(shuffled)).toBe(contentSignature(PRESCRIPTION));
  });

  it('is stable under punctuation and case', () => {
    expect(contentSignature('Dr.Anitha Raghavan,MD METFORMIN')).toBe(
      contentSignature('dr. anitha raghavan, md  metformin'),
    );
  });
});
