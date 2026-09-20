import {
  assertedNone,
  Fact,
  FactPresence,
  FactProvenance,
  NOT_ASSESSED,
  presenceLabel,
  recorded,
} from '../../case-taking/engine/tri-state';
import { ExtractedDocument } from './extraction-schema';

/**
 * Documents §19, which is the one rule in this feature that is not a trade-off.
 *
 *     It must never convert "Not found" into "No".
 *     For example, if an allergy is not mentioned in a prescription, that does
 *     not mean the patient has no allergies.
 *
 * The extraction two files over produces `allergies: []` for a prescription
 * with no allergy section, and `allergies: []` is where the collapse happens.
 * An empty array is falsy-shaped: every natural way to render it — "Allergies:
 * none", `allergies?.length ? list : 'No known allergies'` — turns silence into
 * an assertion, and the assertion it turns silence into is the one that gets
 * somebody prescribed the drug that kills them.
 *
 * So the empty array does not leave this file. What leaves is a `Fact` from the
 * case-taking engine, where absence is a presence rather than a missing value,
 * and where `assertedNone` cannot be constructed without a provenance — i.e.
 * without somebody to attribute the "no" to. The engine's own header makes the
 * argument at length; this file is the document pipeline holding up its end.
 *
 * Three outcomes, and the third is the default:
 *
 *   `recorded`      the document named something
 *   `none`          the document explicitly said there was nothing
 *   `not_assessed`  the document did not raise the subject
 *
 * The middle one needs evidence — a phrase in the OCR text saying so, checked
 * against the source rather than taken from the model. "NKDA" printed on a
 * discharge summary is a clinician asserting something and is worth recording
 * as an assertion. A model writing "None" into an empty array is not.
 */

/** The topics a document can speak to. */
export type FactTopic =
  | 'allergies'
  | 'medications'
  | 'diagnoses'
  | 'procedures'
  | 'investigations';

export type DocumentFacts = Record<FactTopic, Fact<string[]>>;

/**
 * Phrases that are a document asserting emptiness.
 *
 * Deliberately narrow and anchored. A looser pattern is worse than no pattern:
 * every false positive here manufactures a clinical negative out of a document
 * that never made one, which is the exact failure the file exists to prevent.
 * Where there is doubt the answer is `not_assessed`, which costs a question and
 * nothing else.
 *
 * `diagnoses` and `investigations` have no entries on purpose. There is no
 * conventional phrase by which a prescription or a lab report declares that the
 * patient has no diagnoses; a document that lists none has simply not been
 * asked.
 */
const EXPLICIT_ABSENCE: Record<FactTopic, RegExp[]> = {
  allergies: [
    /\bno\s+known\s+(drug\s+)?allerg/i,
    /\bnkda\b/i,
    /\bno\s+allergies\b/i,
    /\bdenies\s+(any\s+)?(drug\s+)?allerg/i,
    /\bnot\s+allergic\s+to\s+any/i,
    /\ballerg(y|ies)\s*[:\-–]\s*(nil|none|no|not\s+known|nkda)\b/i,
  ],
  medications: [
    /\bno\s+(current|regular|other|concurrent)\s+medication/i,
    /\bnot\s+(currently\s+)?(taking|on)\s+any\s+(medication|medicine|drug)/i,
    /\b(current\s+)?medications?\s*[:\-–]\s*(nil|none)\b/i,
  ],
  procedures: [/\bprocedures?\s*[:\-–]\s*(nil|none)\b/i],
  diagnoses: [],
  investigations: [],
};

/**
 * Items that are themselves a denial.
 *
 * A model asked for a list of allergies from a document that has none will
 * sometimes answer `["No known allergies"]` rather than `[]`. Recording that
 * verbatim gives the patient an allergy whose name is a sentence; converting it
 * to `none` on the model's say-so is §19 arriving through the side door. It is
 * dropped from the list, and then the ordinary rules run — so the topic ends up
 * `none` if the *document* says so and `not_assessed` if only the model did.
 */
const DENIAL_ITEM =
  /^(nil|none|no|n\/?a|nkda|nka|no known allerg\w*|no known drug allerg\w*|not applicable|not known|none known|none reported|no allergies|not on any medication|no medications?)\.?$/i;

/** Wording a patient reads, per presence. §19's five states, in English. */
const LABELS: Record<FactTopic, Partial<Record<FactPresence, string>>> = {
  allergies: {
    none: 'No known allergies — stated in this document',
    not_assessed: 'This document does not mention allergies',
  },
  medications: {
    none: 'No medications — stated in this document',
    not_assessed: 'This document does not mention medications',
  },
  diagnoses: { not_assessed: 'This document does not record a diagnosis' },
  procedures: { not_assessed: 'This document does not mention procedures' },
  investigations: {
    not_assessed: 'This document does not include test results',
  },
};

/**
 * The document's facts, in the engine's vocabulary.
 *
 * [sourceText] is the OCR output, not the extraction — an assertion of absence
 * has to be found on the page. [recordedAt] is passed in rather than read from
 * the clock, matching the engine's rule that a state can be replayed exactly.
 */
export function buildDocumentFacts(
  extraction: ExtractedDocument,
  sourceText: string,
  provenance: {
    documentId: string;
    ocrConfidence: number | null;
    recordedAt: string;
  },
): DocumentFacts {
  const items: Record<FactTopic, string[]> = {
    allergies: dropDenials(extraction.allergies),
    medications: dropDenials(extraction.medications.map((m) => m.name)),
    diagnoses: dropDenials(extraction.diagnosesRecorded),
    procedures: dropDenials(extraction.procedures),
    investigations: dropDenials(extraction.investigations.map((i) => i.test)),
  };

  const facts = {} as DocumentFacts;
  for (const topic of Object.keys(items) as FactTopic[]) {
    facts[topic] = factFor(topic, items[topic], sourceText, provenance);
  }
  return facts;
}

function factFor(
  topic: FactTopic,
  items: string[],
  sourceText: string,
  provenance: {
    documentId: string;
    ocrConfidence: number | null;
    recordedAt: string;
  },
): Fact<string[]> {
  if (items.length > 0) {
    return recorded(items, factProvenance(provenance));
  }

  if (statesAbsence(topic, sourceText)) {
    // Somebody wrote it on the page. That is an assertion with an author, which
    // is the only thing `assertedNone` will accept — and the note records who,
    // so a reviewer can go and look at the line.
    return assertedNone({
      ...factProvenance(provenance),
      note: `the document states there are no ${topic}`,
    });
  }

  // Nothing was found and nothing was denied. The default, and the safe one.
  return NOT_ASSESSED;
}

function factProvenance(provenance: {
  documentId: string;
  ocrConfidence: number | null;
  recordedAt: string;
}): FactProvenance {
  return {
    source: 'uploaded_document',
    verification: 'unverified',
    // The OCR measurement, tagged as one. `confidenceSource` is what stops it
    // ever being compared against a model's self-report downstream.
    ...(provenance.ocrConfidence !== null
      ? {
          confidence: provenance.ocrConfidence,
          confidenceSource: 'ocr' as const,
        }
      : {}),
    recordedAt: provenance.recordedAt,
    documentId: provenance.documentId,
  };
}

/** Whether the document itself says there is nothing to record on [topic]. */
export function statesAbsence(topic: FactTopic, sourceText: string): boolean {
  return EXPLICIT_ABSENCE[topic].some((pattern) => pattern.test(sourceText));
}

function dropDenials(items: string[]): string[] {
  return items.filter((item) => !DENIAL_ITEM.test(item.trim()));
}

/**
 * What to show a patient for each topic, with the value when there is one.
 *
 * The labels are per-presence and per-topic so that "No known allergies" can
 * only ever be printed for `none`. `presenceLabel` is keyed by presence for
 * that reason: a section can rename one state, and cannot make two states share
 * a wording.
 */
export function describeFacts(
  facts: DocumentFacts,
  /**
   * Topics nothing actually read — because the rule set for this document type
   * does not cover them and no model ran.
   *
   * §19 arrives by a new door once a deterministic reader goes first. "This
   * document does not mention allergies" is a sentence about the document, and
   * a rule set with no allergy pattern has not established it — it has
   * established only that it did not look. Printed anyway, it is the same
   * false "no" the rest of this file exists to prevent, manufactured out of a
   * blind spot rather than out of an empty array.
   */
  unread?: ReadonlySet<FactTopic>,
): Record<
  FactTopic,
  { presence: FactPresence; label: string; values: string[]; read: boolean }
> {
  const described = {} as Record<
    FactTopic,
    { presence: FactPresence; label: string; values: string[]; read: boolean }
  >;

  for (const topic of Object.keys(facts) as FactTopic[]) {
    const fact = facts[topic];

    // Only `not_assessed` is relabelled. `recorded` means something was found,
    // so the topic plainly was read; and `assertedNone` comes from
    // `statesAbsence`, which is a finding about the *page* — "NKDA is printed
    // here" stays true whether or not any rule parsed the section.
    const wasRead = !(unread?.has(topic) && fact.presence === 'not_assessed');

    described[topic] = {
      presence: fact.presence,
      label: wasRead
        ? presenceLabel(fact.presence, LABELS[topic])
        : UNREAD_LABELS[topic],
      values: fact.presence === 'recorded' ? fact.value : [],
      read: wasRead,
    };
  }

  return described;
}

/**
 * What to say about a topic nothing looked at.
 *
 * Never "does not mention". Every sentence here is about us rather than about
 * the document, which is the only honest thing to say when nobody read it.
 */
const UNREAD_LABELS: Record<FactTopic, string> = {
  allergies: 'We have not read the allergy information on this document',
  medications: 'We have not read the medicines on this document',
  diagnoses: 'We have not read the diagnosis on this document',
  procedures: 'We have not read the procedures on this document',
  investigations: 'We have not read the test results on this document',
};
