import {
  Fact,
  FactPresence,
  FactProvenance,
  FactValue,
  PresenceReason,
  factFromAnswer,
  recorded,
  CHOICE_UNSURE,
} from '../case-taking/engine/tri-state';
import { parseFieldPath } from '../case-taking/engine/clinical-state';

/**
 * A patient disagreeing with what was read off their document. §18, §35.
 *
 * Everything in this file is a pure function over an extraction envelope and
 * one correction, and it is pure for the same reason the case engine is: the
 * decision "is this a value, a denial, or an admission of not knowing" has to be
 * replayable, and a reader has to be able to see which rule made it.
 *
 * ── What a correction is allowed to touch
 *
 * A path into `PatientDocument.extraction`, in the spelling `confidence.ts`
 * already uses for provenance: `medications[0].name`, `investigations[2].result`,
 * `allergies[0]`, `document.date`. That is not a coincidence — the provenance
 * list is what the client renders, so the handle the patient taps is already the
 * handle this file expects back. A path that does not resolve to a value the
 * extraction actually holds is refused: a correction to a value nobody claimed
 * is not a correction, it is a client writing free-form JSON into a clinical
 * record by way of a field name.
 *
 * ── What it is NOT allowed to do
 *
 * Change `extraction`. Nothing here returns a modified envelope; the only
 * accessor reads. §22's evidence chain needs "the model read X" to survive "the
 * patient said Y", and a function that could return an edited extraction is a
 * function somebody will eventually assign back to the column.
 */

/** The longest correction accepted, matching the DTO. A value, not an essay. */
export const CORRECTION_MAX_LENGTH = 200;

/** The three things §18's screen offers: [ Confirm ] [ Correct ] [ Not sure ]. */
export const CORRECTION_KINDS = ['correct', 'confirm', 'unsure'] as const;

export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

/** Where the correction ended up, which the client needs in order to say so. */
export const CORRECTION_TARGETS = ['case_fact', 'document_only'] as const;

export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];

/**
 * Why a correction stayed on the document.
 *
 *   `no_session`    the document is attached to no interview, so there is no
 *                   draft for it to update.
 *   `no_case_field` the corrected value has no counterpart in the interview's
 *                   field vocabulary — see `caseFieldPathFor`.
 */
export const DOCUMENT_ONLY_REASONS = ['no_session', 'no_case_field'] as const;

export type DocumentOnlyReason = (typeof DOCUMENT_ONLY_REASONS)[number];

/**
 * One correction, as stored in `PatientDocument.corrections`.
 *
 * `originalValue` is the point of the whole feature. Everything else here could
 * be reconstructed from the case facts or the audit log; the extraction's own
 * reading at the moment the patient disagreed with it could not, because the
 * extraction is a living envelope that a reprocess could in principle replace.
 */
export interface StoredCorrection {
  /** The path into `extraction` this corrects. */
  readonly path: string;
  readonly kind: CorrectionKind;
  /** What the extraction says at [path]. Null when the model read nothing there. */
  readonly originalValue: string | null;
  /** What the patient says instead. Null for `confirm` and for an asserted nothing. */
  readonly patientValue: string | null;
  /**
   * The tri-state this lands on. Never `not_assessed`: a patient who has opened
   * the review and spoken has assessed it, whatever they said.
   */
  readonly presence: FactPresence;
  /** Which rule in `derivePresence` decided, so an odd one can be argued with. */
  readonly presenceReason: PresenceReason;
  readonly note: string | null;
  readonly correctedByUserId: string;
  /** ISO-8601. */
  readonly correctedAt: string;
  readonly target: CorrectionTarget;
  readonly documentOnlyReason: DocumentOnlyReason | null;
  /** The interview field this reached, when it reached one. */
  readonly caseFieldPath: string | null;
  readonly caseFactId: string | null;
  /** The document-derived row this replaced, when there was one to replace. */
  readonly supersededFactId: string | null;
  /**
   * When the patient confirmed the document as a whole after making this
   * correction. Null while the correction is outstanding.
   *
   * Stamped rather than removed: "disputed, then settled" and "never disputed"
   * are different histories and the row has to be able to tell them apart.
   */
  readonly acknowledgedAt: string | null;
}

/* ───────────────────────────── reading a path ───────────────────────────── */

/**
 * `name`, `name[0]`, `a.b`, `a[0].b` — the spelling `collectExtractedValues`
 * emits. Anchored, bounded, and case-sensitive on purpose: the extraction is
 * camelCase, so `referenceRange` has to be reachable even though the case
 * engine's own path grammar (lower case only) will not have it.
 */
const EXTRACTION_PATH =
  /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\[\d{1,4}\]|\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,8}$/;

/**
 * Segment names that address the prototype chain rather than the data.
 *
 * The walk below only ever reads, so this is not the classic pollution hole —
 * but `constructor` resolves to a function on any object, and a function is not
 * a value a patient corrected. Refusing by name is clearer than filtering by
 * `typeof` after the fact.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export type PathReading =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the extraction's own value at [path].
 *
 * Three outcomes worth keeping apart, and they are the reason this returns a
 * union rather than `string | null`:
 *
 *   the path resolves to a scalar   → `{ ok: true, value }`
 *   the path resolves to `null`     → `{ ok: true, value: null }` — the model
 *                                     read nothing there, which is a thing a
 *                                     patient may legitimately fill in
 *   the path resolves to nothing    → `{ ok: false }` — there is no such value
 *                                     in this document, so there is nothing to
 *                                     correct
 *
 * An object or an array is `ok: false` too. Correcting `medications[0]` whole
 * would mean accepting a client-supplied object into a clinical record, and the
 * unit of §18's screen is a value with a Confirm button beside it, not a group.
 */
export function readExtractionValue(
  extraction: unknown,
  path: string,
): PathReading {
  if (!EXTRACTION_PATH.test(path)) {
    return { ok: false, reason: 'that is not a value on this document' };
  }

  let cursor: unknown = extraction;

  for (const segment of segmentsOf(path)) {
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor) || segment >= cursor.length) {
        return { ok: false, reason: 'that is not a value on this document' };
      }
      cursor = cursor[segment];
      continue;
    }

    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return { ok: false, reason: 'that is not a value on this document' };
    }
    if (
      typeof cursor !== 'object' ||
      cursor === null ||
      Array.isArray(cursor) ||
      !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) {
      return { ok: false, reason: 'that is not a value on this document' };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (cursor === null || cursor === undefined) {
    // The key is there and holds nothing. The model read the slot and found no
    // value, which §11 asks it to say rather than fill — so this is a real
    // position in the document and the patient may supply what belongs in it.
    return { ok: true, value: null };
  }
  if (
    typeof cursor === 'string' ||
    typeof cursor === 'number' ||
    typeof cursor === 'boolean'
  ) {
    return { ok: true, value: String(cursor) };
  }

  return { ok: false, reason: 'that is not a single value on this document' };
}

/** `medications[0].name` → `['medications', 0, 'name']`. */
function segmentsOf(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path)) !== null) {
    segments.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return segments;
}

/* ──────────────────────── the bridge into the case ──────────────────────── */

/**
 * The interview field a corrected extraction path belongs to, or null.
 *
 * The rule is one line and it is deliberately the case engine's own grammar
 * rather than a translation table here: a path reaches the interview exactly
 * when the interview could have addressed it. `medications[0].name`,
 * `allergies[0]` and `investigations[0].result` all parse as field paths in
 * sections the registry knows, so a correction to any of them updates the draft.
 *
 * Everything else stays on the document, and the two families that stay are the
 * interesting ones:
 *
 *   `diagnosesRecorded[0]`, `procedures[0]` — there is no `diagnoses` section
 *   and there is deliberately no diagnosis field anywhere in the registry.
 *   `field-registry.ts` opens with a wall of text about why, and the short
 *   version is that a slot which does not exist cannot be filled by a model or
 *   by a client. Manufacturing one here so a correction had somewhere to land
 *   would defeat the only structural defence that file has.
 *
 *   `document.date`, `patient.name`, `investigations[0].referenceRange` — these
 *   are facts about the piece of paper, not about the patient. They belong to
 *   the document and the document is where they stay.
 *
 * Both of those are reported to the client as `no_case_field` rather than
 * silently dropped, because "we kept this but it did not change your interview"
 * is a different thing to tell somebody than "we saved it".
 */
export function caseFieldPathFor(path: string): string | null {
  try {
    parseFieldPath(path);
    return path;
  } catch {
    return null;
  }
}

/* ─────────────────────── the correction as a fact ─────────────────────── */

export interface CorrectionOutcome {
  readonly fact: Fact<FactValue>;
  readonly presence: FactPresence;
  readonly reason: PresenceReason;
  /** What to store as the patient's value; null when they asserted nothing. */
  readonly patientValue: string | null;
}

export type CorrectionDerivation =
  | { readonly ok: true; readonly outcome: CorrectionOutcome }
  | { readonly ok: false; readonly reason: string };

/**
 * Turn one correction into the fact it asserts.
 *
 * The three kinds do not share a path through `derivePresence`, and that is the
 * design rather than an omission:
 *
 *   `unsure`  goes in as the reserved choice token `not_sure`, because that is
 *             literally what it is — a button the patient pressed, in the
 *             vocabulary `tri-state.ts` reserves for exactly this. It comes back
 *             `unknown`. Not `not_assessed`: somebody asked, and the patient
 *             answered that they do not know, and those are different states.
 *
 *   `correct` goes in as free text with modality `correction`, so the engine's
 *             own ordering — refusal, then uncertainty, then negation, then
 *             value — decides. This is what gives §19's hardest case its
 *             answer without a seventh presence: a patient who says the
 *             document is wrong and that the truth is *nothing* types "none",
 *             the negation rules read it, and the fact lands as `none` — an
 *             asserted absence with the patient's name on it, which is a world
 *             away from `not_assessed`.
 *
 *             Known edge, stated rather than hidden: a medicine whose name
 *             begins with a negation ("No-Spa") reads as a denial. It is the
 *             same behaviour free text has everywhere else in the interview,
 *             and a special case here would be a second set of rules for one
 *             field.
 *
 *   `confirm` bypasses derivation entirely and records the extraction's own
 *             value. There is nothing to derive: the patient did not supply
 *             words, they agreed with words already on the page. A confirmation
 *             of a value the model never found is refused, because agreeing
 *             with silence is how "not found" becomes "no".
 */
export function deriveCorrection(input: {
  kind: CorrectionKind;
  originalValue: string | null;
  patientValue?: string;
  provenance: FactProvenance;
}): CorrectionDerivation {
  if (input.kind === 'confirm') {
    if (input.originalValue === null) {
      return {
        ok: false,
        reason:
          'There is nothing recorded here to confirm. Tell us what it should ' +
          'say instead.',
      };
    }
    return {
      ok: true,
      outcome: {
        fact: recorded<FactValue>(input.originalValue, input.provenance),
        presence: 'recorded',
        reason: 'extracted_value',
        patientValue: null,
      },
    };
  }

  const answer =
    input.kind === 'unsure'
      ? { modality: 'choice' as const, extractedValue: CHOICE_UNSURE }
      : {
          modality: 'correction' as const,
          // Both, and the same string in both: the correction *is* its own
          // evidence span. Supplying it is what stops `derivePresence` flagging
          // the result for re-confirmation on the grounds that an uncertainty
          // phrase might have belonged to some other field in the same turn.
          utterance: (input.patientValue ?? '').trim(),
          evidenceSpan: (input.patientValue ?? '').trim(),
          extractedValue: (input.patientValue ?? '').trim(),
        };

  const { fact, derivation } = factFromAnswer(
    {
      ...answer,
      field: { kind: 'text', accepts: { maxLength: CORRECTION_MAX_LENGTH } },
    },
    input.provenance,
  );

  if (derivation.presence === 'not_assessed') {
    // The correction did not land as anything. Refused rather than stored: a
    // correction that reads as "nobody asked" would turn a value the patient
    // was looking at into a hole, which is worse than the misreading they were
    // trying to fix. `CaseTakingService.correctFact` refuses for the same
    // reason and in the same words.
    return {
      ok: false,
      reason:
        'We could not read that as a correction. Tell us what the document ' +
        'should say, or choose "Not sure".',
    };
  }

  return {
    ok: true,
    outcome: {
      fact,
      presence: derivation.presence,
      reason: derivation.reason,
      patientValue:
        derivation.presence === 'recorded'
          ? String(derivation.value ?? '')
          : null,
    },
  };
}

/**
 * The fact the *document* asserts at a path, so a correction has something to
 * supersede.
 *
 * Built at correction time rather than at upload, and the distinction matters.
 * §2 forbids the system treating extracted information as verified clinical
 * truth, so the pipeline does not write the model's readings into the interview
 * draft wholesale — an upload must not silently populate a chart. But the moment
 * a patient disputes one value, that value's history has to start somewhere: a
 * `patient_correction` row with nothing behind it says what the patient thinks
 * and loses what they were disagreeing with. So the document's claim is written
 * first, and superseded in the same breath. It is never live as an unchallenged
 * assertion — it exists to be the first link of §22's chain.
 */
export function documentFactFor(
  originalValue: string,
  provenance: FactProvenance,
): Fact<FactValue> {
  return recorded<FactValue>(originalValue, provenance);
}

/* ────────────────────────── the stored array ────────────────────────── */

/**
 * The corrections held on a row, defensively.
 *
 * A `Json?` column can hold anything a past version wrote, so this degrades to
 * an empty list rather than throwing: a document whose corrections cannot be
 * read must still be readable, because refusing to render it would hide the
 * extraction and the original as well.
 */
export function readCorrections(raw: unknown): StoredCorrection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredCorrection);
}

function isStoredCorrection(value: unknown): value is StoredCorrection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredCorrection>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.correctedAt === 'string' &&
    (CORRECTION_KINDS as readonly string[]).includes(candidate.kind as string)
  );
}

/** Corrections the patient has made and not yet confirmed the document over. */
export function outstandingCorrections(
  corrections: readonly StoredCorrection[],
): StoredCorrection[] {
  return corrections.filter((correction) => correction.acknowledgedAt === null);
}

/**
 * Stamp every outstanding correction as settled.
 *
 * Called when the patient confirms the document as a whole: confirming *is* the
 * acknowledgement, because what they are confirming is the document as they
 * have now corrected it.
 */
export function acknowledgeAll(
  corrections: readonly StoredCorrection[],
  at: Date,
): StoredCorrection[] {
  return corrections.map((correction) =>
    correction.acknowledgedAt === null
      ? { ...correction, acknowledgedAt: at.toISOString() }
      : correction,
  );
}
