import { DocumentLine } from '../layout';
import { clean } from '../extractor';
import { DATE_VALUE } from './tokens';

/**
 * `Label: value`, wherever a document prints it.
 *
 * Shared by every document type, because the header block of a prescription, a
 * lab report and a discharge summary are the same artefact — a clinic's
 * template with a patient's details typed into it — and the only thing that
 * differs is which labels it uses.
 *
 * The design rule is that this file finds labels and the *specs* decide what a
 * label means. A pattern that both recognised `Referred by:` and knew it was
 * not the patient would be two jobs in one place, and the failure it produces
 * is a consultant's name stored as a patient's, which reads perfectly
 * plausibly on a screen.
 */

/** One `label: value` pair, as printed. */
export interface LabelledField {
  /** Verbatim, without the separator. */
  label: string;
  /** Lowercased, non-alphanumerics removed. `Age / Sex` becomes `agesex`. */
  key: string;
  /** A verbatim slice of the source line. */
  value: string;
  page: number;
  lineIndex: number;
  /** The confidence of the cell the *value* came from, not the label's. */
  confidence: number;
}

/**
 * A label, and the separator that makes it one.
 *
 * The separator is a colon, or a dash *followed by whitespace* — never a bare
 * dash. `PAN-D`, `13.0 - 17.0` and `1-0-1` are all one token, and a pattern
 * that split them would invent a field on every prescription and every lab
 * report in the corpus.
 */
const LABEL = /([A-Za-z][A-Za-z0-9 .'()&/-]{1,34}?)\s*(?::|[-–](?=\s))\s*/g;

/**
 * The same pattern without `g`, for one-off tests.
 *
 * `RegExp.test` on a global regex advances `lastIndex` and answers differently
 * the second time it is asked about the same string. Sharing [LABEL] for both
 * jobs makes the parse depend on how many cells preceded this one.
 */
const HAS_LABEL = new RegExp(LABEL.source, 'i');

/** Labels a dash may introduce only at the start of a cell. See [readLabelledFields]. */
const DASH_SEPARATED = /[-–]\s*$/;

/** `Age / Sex` and `Age/Sex` are the same label and must key the same. */
function keyOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Every labelled field on the page.
 *
 * Three shapes are read, and the third is the one geometry forces on us: the
 * recogniser frequently boxes `Patient:` separately from `Ramesh Kumar`, so a
 * label whose value is empty continues into the **next cell of the same line**.
 *
 * It does not continue onto the next *line*. A label alone on a line —
 * `Final Diagnosis:` with the diagnosis beneath it — is a section heading, and
 * `sections.ts` owns those. Reading it here as well is how a diagnosis ends up
 * in the patient-name field.
 */
export function readLabelledFields(lines: DocumentLine[]): LabelledField[] {
  const fields: LabelledField[] = [];

  for (const line of lines) {
    for (let index = 0; index < line.cells.length; index += 1) {
      const cell = line.cells[index];
      const matches = [...cell.text.matchAll(LABEL)];

      for (let n = 0; n < matches.length; n += 1) {
        const match = matches[n];
        const start = match.index + match[0].length;
        const end = matches[n + 1]?.index ?? cell.text.length;

        // A dash may only introduce a label at the very start of a cell.
        // Mid-cell it is overwhelmingly a separator between values —
        // `1 tablet - twice daily - oral` would otherwise read as a field
        // called "tablet" on every dosing line in the document.
        if (DASH_SEPARATED.test(match[0]) && match.index !== 0) continue;

        let value = cell.text.slice(start, end).trim();
        let confidence = cell.confidence;

        if (value === '' && n === matches.length - 1) {
          const next = line.cells[index + 1];
          if (next && !HAS_LABEL.test(next.text)) {
            value = next.text.trim();
            confidence = Math.min(confidence, next.confidence);
            index += 1;
          }
        }

        const cleaned = clean(value);
        if (cleaned === null) continue;

        fields.push({
          label: match[1].trim(),
          key: keyOf(match[1]),
          value: cleaned,
          page: line.page,
          lineIndex: line.index,
          confidence,
        });
      }
    }
  }

  return fields;
}

/**
 * The labels each schema field answers to, in priority order.
 *
 * Tiers are **priority, not alternatives**: the first tier that yields an
 * accepted value wins, and a later tier is only consulted when every earlier
 * one came back empty. That is what stops a lab report's sample number
 * becoming the patient's hospital identifier when the report also prints a
 * UHID — a wrong cross-reference that would then follow the patient around the
 * record.
 */
export const FIELD_SPECS = {
  patientName: [
    /^(?:patient|patientname|name|nameofpatient|ptname|patientsname)$/,
  ],
  patientIdentifier: [
    /^(?:uhid|uhidno|mrn|mrno|mrdno|hospitalno|hospno|regnno|patientid|abhano|abhaid|healthid)$/,
    /^(?:ipno|ipdno|ipnumber|admissionno|caseno)$/,
    /^(?:opno|opdno|opnumber|tokenno|visitno)$/,
    /^(?:sampleno|labno|accessionno|barcodeno|specimenno|reportno)$/,
  ],
  documentDate: [
    /^(?:date|reportdate|dateofreport|reportedon|printedon|dateofissue|issuedon)$/,
    /^(?:visitdate|dateofvisit|consultationdate|prescriptiondate|dateofprescription)$/,
    /^(?:collectedon|collected|collectiondate|sampledate|dateofcollection|sampledon|receivedon)$/,
  ],
  author: [
    /^(?:prescribedby|consultant|consultingdoctor|doctor|physician|treatingphysician|treatingconsultant|attendingphysician|attendingdoctor|underdrof)$/,
    /^(?:referredby|referringdoctor|referringphysician|orderedby|refby)$/,
    /^(?:verifiedby|reportedby|pathologist|radiologist|checkedby|authorisedby|authorizedby)$/,
  ],
  facility: [
    /^(?:hospital|hospitalname|clinic|clinicname|centre|center|lab|laboratory|labname|facility|institution)$/,
  ],
  admittedOn: [
    /^(?:dateofadmission|admissiondate|admittedon|doa|dateandtimeofadmission|admitteddate)$/,
  ],
  dischargedOn: [
    /^(?:dateofdischarge|dischargedate|dischargedon|dod|dateandtimeofdischarge|dischargeddate)$/,
  ],
} as const;

export type FieldName = keyof typeof FIELD_SPECS;

/**
 * Whether a value is allowed to be this field.
 *
 * Where fabrication is actually prevented. Every guard here exists because the
 * unguarded version produces a value that is wrong and looks right — a
 * consultant's name in the patient field, a phone number as a hospital
 * identifier, a letterhead's printing date as the day a drug was prescribed.
 */
function accepts(field: FieldName, value: string): boolean {
  switch (field) {
    case 'patientName':
      return (
        value.length <= 60 &&
        !DATE_VALUE.test(value) &&
        !/^dr\.?\s/i.test(value) &&
        !/\d{4}/.test(value) &&
        /[A-Za-z]{2}/.test(value)
      );
    case 'patientIdentifier':
      return value.length <= 32 && /\d/.test(value);
    case 'documentDate':
    case 'admittedOn':
    case 'dischargedOn':
      return DATE_VALUE.test(value);
    case 'author':
      return value.length <= 80 && /[A-Za-z]{2}/.test(value);
    case 'facility':
      return value.length <= 80 && /[A-Za-z]{3}/.test(value);
  }
}

/**
 * The value for one schema field, or null.
 *
 * A date field returns only the matched date, so `12/09/2026 11:24` yields
 * `12/09/2026` — still a verbatim substring of the line, and therefore still
 * grounded, while a reformatted date would not be.
 */
export function pickField(
  fields: readonly LabelledField[],
  field: FieldName,
  allowedTiers = FIELD_SPECS[field].length,
): LabelledField | null {
  const tiers = FIELD_SPECS[field];

  for (let tier = 0; tier < Math.min(tiers.length, allowedTiers); tier += 1) {
    for (const candidate of fields) {
      if (!tiers[tier].test(candidate.key)) continue;

      const value =
        field === 'documentDate' ||
        field === 'admittedOn' ||
        field === 'dischargedOn'
          ? (DATE_VALUE.exec(candidate.value)?.[0] ?? candidate.value)
          : candidate.value;

      if (!accepts(field, value)) continue;
      return { ...candidate, value };
    }
  }

  return null;
}

/** Letterheads say what kind of place printed them. Nothing else on page 1 does. */
const FACILITY_WORD =
  /\b(?:hospitals?|clinics?|multi-?speciali[ts]y|diagnostics?|laborator(?:y|ies)|labs?|nursing\s+home|medical\s+(?:centre|center)|health\s?care|polyclinic|scans?|imaging|pathology|institute)\b/i;

/**
 * The facility, from a letterhead that carries no label at all.
 *
 * Restricted to the first two lines of page one and to lines that *say* what
 * they are. Taking line 1 unconditionally would store `Ramesh Kumar & Sons` as
 * a hospital on any document whose letterhead happens to be a patient's own
 * letter, so a document with an unrecognisable letterhead correctly gets null.
 */
export function facilityFromLetterhead(
  lines: readonly DocumentLine[],
): DocumentLine | null {
  for (const line of lines.slice(0, 2)) {
    if (line.page !== 1) continue;
    const text = line.text.trim();
    if (text.includes(':') || text.split(/\s+/).length < 2) continue;
    if (FACILITY_WORD.test(text)) return line;
  }
  return null;
}

/**
 * The signing doctor, when no label named one.
 *
 * Looked for in the last fifth of the document, because that is where a
 * signature block is; a `Dr.` anywhere earlier is as likely to be the referrer
 * named in the body, which is a different person and a different field.
 */
export function authorFromSignature(
  lines: readonly DocumentLine[],
): DocumentLine | null {
  const from = Math.floor(lines.length * 0.8);
  for (const line of lines.slice(from)) {
    if (/^dr\.?\s+[A-Za-z]/i.test(line.text.trim())) return line;
  }
  return null;
}
