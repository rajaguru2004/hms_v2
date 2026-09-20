import {
  ExtractedDocument,
  ExtractedInvestigation,
  ExtractedMedication,
} from '../extraction-schema';
import { normaliseForMatch } from '../confidence';
import { RulesExtraction } from '../rules-extractor';
import { FieldOrigin } from './types';

/**
 * What the rules read, with the model allowed to fill the gaps.
 *
 * One rule governs the whole file: **the rules win on anything they filled,
 * and the model may only fill holes with values it can be shown to have read.**
 *
 * The asymmetry is not a preference for one reader over the other. A rules
 * value arrives with a named rule and a line number behind it and is a verbatim
 * slice of the page; a model value arrives with nothing but the model's word.
 * So a model value is held to the same grounding check `confidence.ts` would
 * apply — is this string actually on the page — and dropped here if it fails,
 * rather than stored and scored down afterwards. A medication the model
 * invented is not worth recording at any confidence, because what happens next
 * is that a patient is shown it and asked to confirm it.
 *
 * The other consequence is stability: with the model off, or slow, or
 * replaced, every value the rules produced is unchanged. Only the holes differ.
 */

export interface MergeResult {
  extraction: ExtractedDocument;
  origins: Map<string, FieldOrigin>;
  /** How many values the model contributed. Zero means it added nothing. */
  modelValues: number;
}

function modelOrigin(): FieldOrigin {
  return { producedBy: 'model', rule: null, line: null, page: null };
}

/** A key two readers can agree on, for matching entities across extractions. */
function keyOf(value: string | null): string {
  return normaliseForMatch(value ?? '');
}

export function mergeExtractions(
  rules: RulesExtraction,
  model: ExtractedDocument,
  sourceText: string,
): MergeResult {
  const haystack = normaliseForMatch(sourceText);
  const origins = new Map(rules.origins);
  let modelValues = 0;

  /** A model value, if the page actually carries it. */
  const grounded = (value: string | null): string | null => {
    if (value === null) return null;
    const needle = normaliseForMatch(value);
    return needle !== '' && haystack.includes(needle) ? value : null;
  };

  /** Keep the rules value; else take the model's, if it grounds. */
  const fill = (
    path: string,
    ours: string | null,
    theirs: string | null,
  ): string | null => {
    if (ours !== null) return ours;
    const value = grounded(theirs);
    if (value === null) return null;
    origins.set(path, modelOrigin());
    modelValues += 1;
    return value;
  };

  const extraction: ExtractedDocument = {
    ...rules.extraction,
    document: {
      ...rules.extraction.document,
      date: fill(
        'document.date',
        rules.extraction.document.date,
        model.document.date,
      ),
      facility: fill(
        'document.facility',
        rules.extraction.document.facility,
        model.document.facility,
      ),
      author: fill(
        'document.author',
        rules.extraction.document.author,
        model.document.author,
      ),
    },
    patient: {
      name: fill(
        'patient.name',
        rules.extraction.patient.name,
        model.patient.name,
      ),
      identifier: fill(
        'patient.identifier',
        rules.extraction.patient.identifier,
        model.patient.identifier,
      ),
    },
  };

  // ── Medications ───────────────────────────────────────────────────────────
  // Order settles here, before provenance runs: `collectExtractedValues` keys
  // on array indices, so a later reshuffle would point every citation at the
  // wrong drug.
  const medications: ExtractedMedication[] = rules.extraction.medications.map(
    (ours, index) => {
      const theirs = model.medications.find(
        (candidate) => keyOf(candidate.name) === keyOf(ours.name),
      );
      if (!theirs) return ours;

      const at = `medications[${index}]`;
      return {
        ...ours,
        strength: fill(`${at}.strength`, ours.strength, theirs.strength),
        dose: fill(`${at}.dose`, ours.dose, theirs.dose),
        frequency: fill(`${at}.frequency`, ours.frequency, theirs.frequency),
        route: fill(`${at}.route`, ours.route, theirs.route),
        duration: fill(`${at}.duration`, ours.duration, theirs.duration),
        instructions: fill(
          `${at}.instructions`,
          ours.instructions,
          theirs.instructions,
        ),
        startDate: fill(`${at}.startDate`, ours.startDate, theirs.startDate),
        stopDate: fill(`${at}.stopDate`, ours.stopDate, theirs.stopDate),
        // The conservative default of `normaliseMedication` survives the
        // merge: either reader doubting the entry is enough to flag it.
        uncertain: ours.uncertain || theirs.uncertain,
      };
    },
  );

  const seenMedications = new Set(
    medications.map((entry) => keyOf(entry.name)),
  );
  for (const theirs of model.medications) {
    if (seenMedications.has(keyOf(theirs.name))) continue;
    // A drug the rules did not find at all. Its *name* must be on the page —
    // an invented medication is the one value that must never reach a patient.
    if (grounded(theirs.name) === null) continue;

    origins.set(`medications[${medications.length}].name`, modelOrigin());
    modelValues += 1;
    medications.push(theirs);
    seenMedications.add(keyOf(theirs.name));
  }

  // ── Investigations ────────────────────────────────────────────────────────
  const investigations: ExtractedInvestigation[] =
    rules.extraction.investigations.map((ours, index) => {
      const theirs = model.investigations.find(
        (candidate) => keyOf(candidate.test) === keyOf(ours.test),
      );
      if (!theirs) return ours;

      const at = `investigations[${index}]`;
      return {
        ...ours,
        result: fill(`${at}.result`, ours.result, theirs.result),
        unit: fill(`${at}.unit`, ours.unit, theirs.unit),
        referenceRange: fill(
          `${at}.referenceRange`,
          ours.referenceRange,
          theirs.referenceRange,
        ),
        flag: fill(`${at}.flag`, ours.flag, theirs.flag),
        date: fill(`${at}.date`, ours.date, theirs.date),
      };
    });

  const seenTests = new Set(investigations.map((entry) => keyOf(entry.test)));
  for (const theirs of model.investigations) {
    if (seenTests.has(keyOf(theirs.test))) continue;
    if (grounded(theirs.test) === null) continue;

    origins.set(`investigations[${investigations.length}].test`, modelOrigin());
    modelValues += 1;
    investigations.push(theirs);
    seenTests.add(keyOf(theirs.test));
  }

  // ── Lists ─────────────────────────────────────────────────────────────────
  // `followUp` is the one list the model may paraphrase. `collectExtractedValues`
  // already exempts it from grounding, because turning "Follow up: Review after
  // 30 days." into "Review after 30 days" is the model doing the right thing.
  const union = (
    field: 'diagnosesRecorded' | 'procedures' | 'allergies' | 'followUp',
    ungroundedAllowed = false,
  ): string[] => {
    const merged = [...rules.extraction[field]];
    const seen = new Set(merged.map(keyOf));

    model[field].forEach((value) => {
      if (seen.has(keyOf(value))) return;
      if (!ungroundedAllowed && grounded(value) === null) return;

      origins.set(`${field}[${merged.length}]`, modelOrigin());
      modelValues += 1;
      merged.push(value);
      seen.add(keyOf(value));
    });

    return merged;
  };

  extraction.medications = medications;
  extraction.investigations = investigations;
  extraction.diagnosesRecorded = union('diagnosesRecorded');
  extraction.procedures = union('procedures');
  extraction.followUp = union('followUp', true);
  // Nothing special is done for allergies here on purpose. `document-facts.ts`
  // owns turning a denial into a presence, and a second filter in this file is
  // how the two drift apart — §19 arriving by the side door, again.
  extraction.allergies = union('allergies');

  extraction.admission =
    rules.extraction.admission ??
    (model.admission
      ? {
          admittedOn: grounded(model.admission.admittedOn),
          dischargedOn: grounded(model.admission.dischargedOn),
        }
      : null);

  return { extraction, origins, modelValues };
}
