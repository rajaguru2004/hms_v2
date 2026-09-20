import { linesFromText } from '../layout';
import {
  authorFromSignature,
  facilityFromLetterhead,
  pickField,
  readLabelledFields,
} from './fields';

/** The prescription fixture's header, as `layout.ts` renders it. */
const PRESCRIPTION_HEADER = [
  'SUNRISE MULTISPECIALITY CLINIC',
  '14 Station Road, Coimbatore 641002  ·  Ph 0422 244 1180',
  'PRESCRIPTION',
  'Patient:  Ramesh Kumar\tDate:  12/09/2026',
  'Age / Sex:  54 / Male\tOP No:  OP-2026-11847',
  'Diagnosis:  Type 2 Diabetes Mellitus, Hypertension',
].join('\n');

const fieldsOf = (text: string) => readLabelledFields(linesFromText(text));

describe('labelled fields', () => {
  it('reads two fields off one printed line', () => {
    const fields = fieldsOf('Patient:  Ramesh Kumar\tDate:  12/09/2026');

    expect(fields.map((f) => [f.key, f.value])).toEqual([
      ['patient', 'Ramesh Kumar'],
      ['date', '12/09/2026'],
    ]);
  });

  it('continues a label into the next cell when the recogniser split them', () => {
    // PP-OCRv5 boxes `Patient:` separately from the name often enough that
    // not handling it loses the patient's name on those documents.
    const fields = fieldsOf('Patient:\tRamesh Kumar');

    expect(fields).toHaveLength(1);
    expect(fields[0].value).toBe('Ramesh Kumar');
  });

  it('does not continue a label onto the next line', () => {
    // `Final Diagnosis:` alone on a line is a section heading, and
    // `sections.ts` owns those. Reading it here puts a diagnosis in a name.
    const fields = fieldsOf('Final Diagnosis:\nType 2 Diabetes Mellitus');

    expect(fields).toHaveLength(0);
  });

  it('keys a label with punctuation the way its siblings key', () => {
    expect(fieldsOf('Age / Sex:  54 / Male')[0].key).toBe('agesex');
  });

  it('does not read a bare dash as a separator', () => {
    // Every one of these is one token. A pattern that split them would invent
    // a field on every dosing line and every lab row in the corpus.
    expect(fieldsOf('1 tablet  -  twice daily  -  oral')).toHaveLength(0);
    expect(fieldsOf('Haemoglobin\t11.2\tg/dL\t13.0 - 17.0')).toHaveLength(0);
    expect(fieldsOf('Tab. PAN-D 40mg OD')).toHaveLength(0);
  });
});

describe('what a label is allowed to mean', () => {
  const prescription = fieldsOf(PRESCRIPTION_HEADER);

  it('finds the patient, the date and the identifier', () => {
    expect(pickField(prescription, 'patientName')?.value).toBe('Ramesh Kumar');
    expect(pickField(prescription, 'documentDate')?.value).toBe('12/09/2026');
    expect(pickField(prescription, 'patientIdentifier')?.value).toBe(
      'OP-2026-11847',
    );
  });

  it('does not let a referring doctor become the patient', () => {
    // The lab fixture prints `Referred by: Dr. Anitha Raghavan`. Stored as a
    // patient name it reads perfectly plausibly on a screen and is wrong.
    const fields = fieldsOf(
      'Patient:  Ramesh Kumar\nReferred by:  Dr. Anitha Raghavan',
    );

    expect(pickField(fields, 'patientName')?.value).toBe('Ramesh Kumar');
    expect(pickField(fields, 'author')?.value).toBe('Dr. Anitha Raghavan');
  });

  it('rejects a name that is really a date or a doctor', () => {
    expect(pickField(fieldsOf('Name:  12/09/2026'), 'patientName')).toBeNull();
    expect(
      pickField(fieldsOf('Name:  Dr. S. Nandakumar'), 'patientName'),
    ).toBeNull();
  });

  it('prefers a hospital identifier over a sample number', () => {
    // Tiers are priority, not alternatives. A sample number stored as the
    // patient's identifier is a cross-reference that follows them around.
    const fields = fieldsOf('UHID:  UH-4471\tSample No:  ML-88213');

    expect(pickField(fields, 'patientIdentifier')?.value).toBe('UH-4471');
  });

  it('falls through to the sample number when nothing better was printed', () => {
    const fields = fieldsOf('Sample No:  ML-88213');

    expect(pickField(fields, 'patientIdentifier')?.value).toBe('ML-88213');
  });

  it('takes only the date out of a timestamp, so the slice still grounds', () => {
    const fields = fieldsOf('Collected:  12/09/2026 11:24');

    expect(pickField(fields, 'documentDate')?.value).toBe('12/09/2026');
  });

  it('does not accept an identifier with no digits in it', () => {
    expect(
      pickField(fieldsOf('UHID:  Unknown'), 'patientIdentifier'),
    ).toBeNull();
  });
});

describe('the two fields documents rarely label', () => {
  it('reads the facility off a letterhead that says what it is', () => {
    const lines = linesFromText(PRESCRIPTION_HEADER);

    expect(facilityFromLetterhead(lines)?.text).toBe(
      'SUNRISE MULTISPECIALITY CLINIC',
    );
  });

  it('does not take line one when it names no kind of place', () => {
    // Otherwise a patient's own covering letter files as a hospital.
    const lines = linesFromText('Ramesh Kumar & Sons\n14 Station Road');

    expect(facilityFromLetterhead(lines)).toBeNull();
  });

  it('reads the signing doctor out of the signature block', () => {
    const lines = linesFromText(
      [
        'Rx',
        'Tab. METFORMIN 500 mg',
        'Advice:  Reduce salt intake.',
        'Follow up:  Review after 30 days.',
        'Dr. Anitha Raghavan, MD',
      ].join('\n'),
    );

    expect(authorFromSignature(lines)?.text).toBe('Dr. Anitha Raghavan, MD');
  });
});
