import { createHash } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import FuzzySet = require('fuzzyset.js');

/**
 * Documents §21. Two signals, in order of how much they prove.
 *
 * The hash is exact and costs nothing: the same bytes are the same file, which
 * is what happens when an upload times out on a phone and the patient presses
 * the button again. It is checked before the image is even looked at, because
 * the cheapest duplicate to catch is the one caught before a minute of OCR and
 * model time has been spent on it.
 *
 * The second signal is for the re-photographed page — the patient who could not
 * find the first upload and took another picture of the same sheet. Different
 * bytes, same document. That needs the text, so it runs after OCR, and it is
 * where the interesting mistake lives.
 *
 * ── Why the comparison is on a signature and not on the page ────────────────
 *
 * The obvious implementation is `FuzzySet([previousText]).get(newText)`, and on
 * this corpus it does not work. Measured against the OCR output of the
 * fixtures:
 *
 *     the same page re-photographed (OCR slips, two lines lost)   0.933
 *     a *different* prescription, same clinic, same patient       0.930
 *
 * Those are the same number. A prescription is mostly template — letterhead,
 * address, phone number, field labels, the doctor's name and registration, the
 * standing advice at the bottom — and gram similarity over a page of template
 * measures the template. Thresholding it either misses re-photographs or, far
 * worse, marks a new prescription as a duplicate of last month's and drops a
 * real clinical event on the floor. §21's requirement is that duplicates do not
 * create duplicate clinical events; losing a genuine one to a false positive is
 * the same failure with the sign flipped, and it is the quieter of the two.
 *
 * So the comparison is run over a *signature*: the tokens that distinguish one
 * instance of a template from another — the numbers, the dates, the
 * identifiers, the drug names — with the short shared connective words dropped.
 * On the same fixtures:
 *
 *     identical text                                              1.000
 *     the same page re-photographed                               0.949
 *     a different prescription, same clinic, same patient         0.744
 *     an unrelated document                                       0.350
 *
 * which is a gap wide enough to put a threshold in.
 */

/** Chosen from the numbers above: below the re-photograph, well above a sibling. */
const SIMILARITY_THRESHOLD = 0.88;

/**
 * How many earlier documents a new one is compared against.
 *
 * A duplicate arrives minutes after its original, essentially always — a
 * patient re-uploading a document from three years ago is not the case this
 * detects. Bounding the scan keeps a long-standing patient's upload from
 * getting slower every year.
 */
export const DUPLICATE_SCAN_LIMIT = 50;

/** A previously stored document, as much of it as this check needs. */
export interface DuplicateCandidate {
  id: string;
  ocrText: string | null;
}

export interface DuplicateVerdict {
  duplicateOfId: string | null;
  method: 'sha256' | 'text_similarity' | null;
  /** 1 for a hash match; the measured score for a text match. */
  similarity: number | null;
}

export const NOT_A_DUPLICATE: DuplicateVerdict = {
  duplicateOfId: null,
  method: null,
  similarity: null,
};

/** The exact-duplicate key. Hex, and stored on the row for the next upload. */
export function documentSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Words too common to distinguish two documents printed from one template.
 *
 * Not a general stop list — it is specifically the vocabulary of a clinic
 * letterhead and a form label, which is exactly the text that is identical
 * between the two documents this check has to tell apart.
 */
const TEMPLATE_WORDS = new Set([
  'patient',
  'date',
  'name',
  'age',
  'sex',
  'gender',
  'address',
  'phone',
  'hospital',
  'clinic',
  'centre',
  'center',
  'doctor',
  'signature',
  'result',
  'unit',
  'test',
  'report',
  'reference',
  'range',
  'sample',
  'collected',
  'verified',
  'tablet',
  'tablets',
  'capsule',
  'daily',
  'twice',
  'once',
  'oral',
  'morning',
  'night',
  'before',
  'after',
  'food',
  'review',
  'follow',
  'advice',
  'diagnosis',
  'page',
  'total',
  'count',
  'number',
]);

/**
 * The tokens that make this document this document.
 *
 * Numbers are kept from two characters up: dates, doses, sample numbers and
 * registration numbers are what actually differ between two prescriptions from
 * one pad. Words are kept from six characters up, which is roughly where a
 * clinical term starts and a connective word stops. Sorted and deduplicated so
 * that a page read in a different block order still produces the same string —
 * the recogniser's ordering is not stable enough to be part of the identity.
 */
export function contentSignature(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);

  const distinctive = tokens.filter((token) =>
    /[0-9]/.test(token)
      ? token.length >= 2
      : token.length >= 6 && !TEMPLATE_WORDS.has(token),
  );

  return Array.from(new Set(distinctive)).sort().join(' ');
}

/**
 * Whether [text] is a re-reading of one of [candidates].
 *
 * `fuzzyset.js` is already how this codebase does approximate string matching —
 * `integrations/patient-matcher.ts` uses it for names — so it is the tool here
 * too rather than a second similarity implementation with its own edge cases.
 */
export function findTextDuplicate(
  text: string,
  candidates: DuplicateCandidate[],
  threshold: number = SIMILARITY_THRESHOLD,
): DuplicateVerdict {
  const signature = contentSignature(text);
  if (!signature) return NOT_A_DUPLICATE;

  const bySignature = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.ocrText) continue;
    const candidateSignature = contentSignature(candidate.ocrText);
    // First writer wins, so a document that is already a duplicate of an older
    // one does not become the thing the next copy points at. Chains of
    // `duplicateOf` pointing at duplicates are a tree nobody wants to walk.
    if (candidateSignature && !bySignature.has(candidateSignature)) {
      bySignature.set(candidateSignature, candidate.id);
    }
  }

  if (bySignature.size === 0) return NOT_A_DUPLICATE;

  const matches = FuzzySet(Array.from(bySignature.keys())).get(signature);
  const best = matches?.[0];
  if (!best) return NOT_A_DUPLICATE;

  const [score, matched] = best;
  if (score < threshold) return NOT_A_DUPLICATE;

  return {
    duplicateOfId: bySignature.get(matched) ?? null,
    method: 'text_similarity',
    similarity: Math.round(score * 10_000) / 10_000,
  };
}
