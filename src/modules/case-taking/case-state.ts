import { Logger } from '@nestjs/common';
import type { CaseFact, CaseTurn } from '@prisma/client';
import {
  ClinicalState,
  applyFact,
  clearPending,
  createClinicalState,
  isSectionKey,
  markAsked,
  parseFieldPath,
  sectionOf,
} from './engine/clinical-state';
import {
  Fact,
  FactPresence,
  FactProvenance,
  FactSource,
  FactValue,
  VerificationStatus,
  FACT_PRESENCES,
  FACT_SOURCES,
  VERIFICATION_STATUSES,
  isAssessed,
  parseFact,
} from './engine/tri-state';

/**
 * Rows in, `ClinicalState` out.
 *
 * ── Why the state is rebuilt on every read rather than kept in the Json column
 *
 * `CaseSession.clinicalState` exists and is written, but it is a projection,
 * not the truth. The truth is the `CaseFact` rows, and the reason is the whole
 * shape of this feature's hot path.
 *
 * Extraction of a free-text answer takes eight to twenty seconds on this box,
 * so it runs behind the response rather than in front of it. That means two
 * writers touch a session at once: the request handler recording what the
 * patient just tapped, and a background extraction landing what they said two
 * questions ago. A single Json document holding the facts map makes those two
 * a read-modify-write race, and the thing that gets lost when it goes wrong is
 * a clinical fact — silently, with no error anywhere. Rows do not race: each
 * writer INSERTs its own, and the current value of a path is the newest
 * unsuperseded row for it. The schema already demanded append-only for
 * provenance reasons (§32); this makes the same property carry the concurrency
 * as well.
 *
 * ── Why `pending` is derived rather than stored
 *
 * Same argument, one level down. `ClinicalState.pending` stops the selector
 * asking a question whose answer is still being extracted, and it is mutated by
 * both writers too. Deriving it — a field is in flight if an assistant turn
 * asked it and no answered fact exists for it yet — makes it a function of the
 * same append-only rows, so it cannot be lost either. The turn's `sequence`
 * stands in for the revision it was asked at, which is what `expirePending`
 * measures staleness in.
 */

const logger = new Logger('CaseState');

/** Everything a rebuild needs, in the order the repository returns it. */
export interface StateSources {
  readonly sessionId: string;
  readonly startedAt?: Date | null;
  /** The OUTPUT language: what the questions are worded in. */
  readonly language?: string | null;
  /** The INPUT language: what the patient's own words are in. */
  readonly inputLanguage?: string | null;
  /** Unsuperseded facts only, oldest first. */
  readonly facts: readonly CaseFact[];
  /** Every turn for the session, oldest first. */
  readonly turns: readonly CaseTurn[];
  /**
   * The clock, for presuming a long-running extraction lost. Injected so the
   * rebuild stays a function of its inputs in tests; defaults to now.
   */
  readonly now?: Date;
}

/**
 * Rebuild the interview's state from what is on disk.
 *
 * Every degradation here is towards `not_assessed`. A row with a presence this
 * build does not recognise, a malformed field path, a `recorded` row whose
 * value went missing — all of them are dropped and read back as "nobody asked",
 * which is the only safe reading of a row we cannot understand. The alternative
 * is a best guess at what a corrupted clinical assertion meant, which is the
 * fabrication this engine is built to make hard.
 */
export function rebuildState(sources: StateSources): ClinicalState {
  let state = createClinicalState({
    sessionId: sources.sessionId,
    startedAt: sources.startedAt?.toISOString(),
    language: sources.language ?? undefined,
    inputLanguage: sources.inputLanguage ?? undefined,
  });

  for (const row of sources.facts) {
    const fact = factFromRow(row);
    if (!fact) continue;
    try {
      state = applyFact(state, row.fieldPath, fact);
    } catch (error) {
      logger.warn(
        `dropped fact ${row.id} at ${row.fieldPath}: ${
          error instanceof Error ? error.message : 'unreadable'
        }`,
      );
    }
  }

  return applyPending(state, sources.turns, sources.now ?? new Date());
}

/**
 * Mark the questions that are still in flight.
 *
 * A field is in flight when an assistant turn asked it and no answered fact
 * exists for it. `markAsked` bumps the revision each time, so the revision
 * after this loop counts questions asked rather than facts recorded — which is
 * the unit `expirePending` wants, since staleness here means "how many
 * questions ago", not "how many answers ago".
 *
 * ── Why every asked turn bumps the revision, answered or not
 *
 * That paragraph describes what this loop is *for*, and for a long time it did
 * not describe what it did: an answered field took an early `continue`, so the
 * revision counted only the questions still unanswered. The consequence was a
 * deadlock, and a deterministic one rather than a race.
 *
 * `expirePending` releases a field once `revision - askedAt > 2`. With the
 * revision counting only unanswered questions, the *last* thing asked always
 * sits at `askedAt === revision` — age zero — and the one before it at age one,
 * no matter how many questions have really been asked since. Fewer than four
 * lost extractions could therefore never age out. An interview that lost two
 * of them, then answered everything else, ended with two fields in flight, none
 * askable and none expirable: `interviewStatus` returned `awaiting_extraction`
 * forever and the patient sat on "we are finishing writing down your last
 * answer" with no question to answer and no way forward.
 *
 * A real session reached exactly that state — `past_medical.thyroid_disorder`
 * and `past_medical.epilepsy`, asked at turn sequences 78 and 80, still in
 * flight after twenty-nine later questions had been asked and answered. Their
 * ages were 1 and 0.
 *
 * So the revision is bumped for every question the log says was asked, and the
 * pending entry is cleared afterwards for the ones that came back. The ordering
 * matters: `markAsked` records `askedAt` against the bumped revision, so the
 * clear has to come after it rather than in place of it.
 */
function applyPending(
  state: ClinicalState,
  turns: readonly CaseTurn[],
  now: Date,
): ClinicalState {
  let next = state;
  /** When each still-pending field was last put to the patient. */
  const askedAt = new Map<string, Date>();

  for (const turn of turns) {
    if (turn.role !== 'assistant' || !turn.fieldKey) continue;
    try {
      next = markAsked(next, turn.fieldKey);
    } catch {
      // A turn naming a field path the registry no longer parses. It cannot
      // block a question that does not exist, so there is nothing to do — and
      // it must not advance the revision either, or a registry rename would
      // start ageing out live extractions.
      continue;
    }
    askedAt.set(turn.fieldKey, turn.createdAt);
    // An answered field is not in flight, whatever the turn log says. This is
    // what releases the question the patient has just answered, and it is why
    // the facts are applied before this runs. The revision bump above stands:
    // the question was still asked, and staleness is counted in questions.
    if (isAssessed(readFactSafely(next, turn.fieldKey))) {
      next = clearPending(next, turn.fieldKey);
      askedAt.delete(turn.fieldKey);
    }
  }

  return releaseLostExtractions(next, askedAt, now);
}

/**
 * How long an extraction may be in flight before the answer is presumed lost.
 *
 * Above `AI_TIMEOUT_MS` (90s in the demo stack) by a margin, because releasing a
 * field whose extraction is still legitimately running would ask the patient a
 * question they are in the middle of answering.
 */
const LOST_EXTRACTION_AFTER_MS = 120_000;

/**
 * The backstop for the one case `expirePending` cannot see.
 *
 * `expirePending` measures staleness in questions asked, which is the right unit
 * while the interview is moving: a lost extraction is released two questions
 * later and the patient never notices. It has a blind spot at the end, and the
 * blind spot is total. When every remaining field is in flight there is nothing
 * askable, so no further question can be asked, so the revision can never
 * advance, so the age of those fields is frozen wherever it stood. They cannot
 * expire, `interviewStatus` answers `awaiting_extraction` on every load, and the
 * interview is over in the only sense that matters — the patient is looking at a
 * screen with no question on it and no way to get one.
 *
 * That is not hypothetical. It is what a restart of the API does to whatever was
 * being extracted at the time: the background job lives in the process, the
 * process goes away, and nothing is left to clear the pending entry or to notice
 * that nobody will.
 *
 * So the wall clock is consulted too. It is a worse unit — it needs a clock in
 * what is otherwise a pure rebuild, and it is why `now` is a parameter rather
 * than a call to `Date.now()` in here — but it is the only one that keeps
 * running when the interview has stopped.
 */
function releaseLostExtractions(
  state: ClinicalState,
  askedAt: ReadonlyMap<string, Date>,
  now: Date,
): ClinicalState {
  let next = state;
  for (const [fieldPath, at] of askedAt) {
    if (now.getTime() - at.getTime() <= LOST_EXTRACTION_AFTER_MS) continue;
    logger.warn(
      `releasing ${fieldPath}: asked ${Math.round(
        (now.getTime() - at.getTime()) / 1000,
      )}s ago and still in flight; presuming the extraction was lost`,
    );
    next = clearPending(next, fieldPath);
  }
  return next;
}

function readFactSafely(
  state: ClinicalState,
  fieldPath: string,
): Fact<FactValue> {
  return Object.prototype.hasOwnProperty.call(state.facts, fieldPath)
    ? state.facts[fieldPath]
    : { presence: 'not_assessed' };
}

/**
 * One row, as a fact — or null when the row cannot be trusted to be one.
 *
 * `parseFact` is the engine's boundary for exactly this: untrusted JSON
 * becoming a clinical assertion. It throws on a `recorded` row with no value
 * and on an asserted absence with no provenance, and both of those are right —
 * a stored negative with nobody to attribute it to is the unattributed claim
 * the tri-state exists to refuse.
 */
export function factFromRow(row: CaseFact): Fact<FactValue> | null {
  if (!(FACT_PRESENCES as readonly string[]).includes(row.presence)) {
    logger.warn(
      `fact ${row.id} has unrecognised presence "${row.presence}"; read as not assessed`,
    );
    return null;
  }
  if (row.presence === 'not_assessed') return null;

  try {
    parseFieldPath(row.fieldPath);
  } catch {
    logger.warn(`fact ${row.id} has a malformed field path "${row.fieldPath}"`);
    return null;
  }

  try {
    const fact = parseFact({
      presence: row.presence,
      value: row.valueJson as FactValue,
      provenance: provenanceFromRow(row),
    });
    return fact.presence === 'not_assessed' ? null : fact;
  } catch (error) {
    logger.warn(
      `fact ${row.id} at ${row.fieldPath} could not be read: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    );
    return null;
  }
}

/**
 * ── The two vocabularies, and which one wins
 *
 * `schema.prisma` documents `sourceType` as including `document`, and
 * `verification` as `pending | patient_confirmed | patient_corrected |
 * patient_unsure`. The engine's `FACT_SOURCES` says `uploaded_document`, and
 * its `VERIFICATION_STATUSES` are `unverified | patient_confirmed |
 * clinician_confirmed | disputed`. Neither column is constrained, so both
 * spellings fit in the database and only one can be right in the code.
 *
 * The engine wins, for the reason the `touch` / `choice` split was settled the
 * same way: two spellings of one concept is two spellings somebody has to map,
 * and one of them will be missed. Writes use the engine's vocabulary; reads
 * translate the schema comment's spellings where they are unambiguous and fall
 * back to the safe value where they are not. `pending` is such a case — it is
 * the column default, it means nobody has confirmed anything, and `unverified`
 * is the engine's word for that.
 *
 * ── Why a model's confidence never survives a round trip
 *
 * There is no `confidenceSource` column, and a confidence without one is the
 * exact comparison the engine forbids: an OCR engine's character confidence is
 * a measurement, a language model's self-report is a constant 0.95, and a bare
 * float column cannot tell a reader which it is holding. So only measured
 * confidences are written at all (see `rowDataFromFact`), and a confidence read
 * back is therefore always `derived`.
 */
function provenanceFromRow(row: CaseFact): FactProvenance {
  return {
    source: normaliseSource(row.sourceType),
    verification: normaliseVerification(row.verification),
    ...(row.confidence !== null
      ? { confidence: row.confidence, confidenceSource: 'derived' as const }
      : {}),
    recordedAt: row.createdAt.toISOString(),
    ...(row.sourceRef ? { note: `turn:${row.sourceRef}` } : {}),
    factId: row.id,
  };
}

function normaliseSource(raw: string): FactSource {
  if ((FACT_SOURCES as readonly string[]).includes(raw)) {
    return raw as FactSource;
  }
  if (raw === 'document') return 'uploaded_document';
  // Not `patient_voice`: a source we cannot read must not be upgraded into a
  // claim that the patient said it out loud. `existing_record` is the weakest
  // attribution available and the only honest one for a row of unknown origin.
  logger.warn(
    `fact source "${raw}" is not a known source; read as existing_record`,
  );
  return 'existing_record';
}

function normaliseVerification(raw: string): VerificationStatus {
  if ((VERIFICATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as VerificationStatus;
  }
  // `patient_corrected` is a real thing the schema comment names and the engine
  // does not: a correction the patient made themselves is confirmed by them, by
  // definition, so it maps onto `patient_confirmed` rather than downwards.
  if (raw === 'patient_corrected') return 'patient_confirmed';
  if (raw === 'patient_unsure') return 'unverified';
  return 'unverified';
}

/** The columns one fact writes. Shared by the interview, corrections and documents. */
export interface FactRowData {
  section: string;
  fieldPath: string;
  valueJson: FactValue | null;
  presence: FactPresence;
  sourceType: FactSource;
  sourceRef: string | null;
  confidence: number | null;
  verification: VerificationStatus;
}

export function rowDataFromFact(
  fieldPath: string,
  fact: Fact<FactValue>,
  sourceRef?: string,
): FactRowData {
  const section = sectionOf(fieldPath);
  if (!isSectionKey(section)) {
    throw new Error(
      `refusing to store a fact outside a known section: ${fieldPath}`,
    );
  }

  const provenance =
    fact.presence === 'not_assessed' ? undefined : fact.provenance;

  return {
    section,
    fieldPath,
    valueJson: fact.presence === 'recorded' ? fact.value : null,
    presence: fact.presence,
    // `not_assessed` never reaches here — the service does not write a row for
    // it, because the absence of a row already means exactly that, and a row
    // saying "nobody asked" would be an assertion about nothing.
    sourceType: provenance?.source ?? 'existing_record',
    sourceRef: sourceRef ?? null,
    // Only a measured confidence is stored. A model's self-report is dropped
    // here rather than written as a bare float that a later reader could
    // mistake for an OCR measurement — see the comment on `provenanceFromRow`.
    confidence:
      provenance?.confidenceSource === 'derived' ||
      provenance?.confidenceSource === 'ocr'
        ? (provenance.confidence ?? null)
        : null,
    verification: provenance?.verification ?? 'unverified',
  };
}

/** Presences that are worth a row. `not_assessed` is not one: see above. */
export function isStorablePresence(presence: FactPresence): boolean {
  return presence !== 'not_assessed';
}
