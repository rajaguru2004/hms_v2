import { DocumentLine } from '../layout';
import { CapturedSection } from './sections';

/**
 * The two things a discharge summary needs that no other document does.
 *
 * Everything else about it — labelled headers, verbatim sections, table rows —
 * is the shared machinery. What is particular is that a discharge summary
 * contains medications **it is not prescribing**, and that its two dates are
 * the clinically load-bearing fields on the page.
 */

/**
 * Headings under which a drug is one the patient goes home on.
 *
 * Narrower than `sections.ts`'s `medications` pattern on purpose. That one
 * matches `Treatment Given`, which on a discharge summary is the history of
 * the admission — and `Inj. Ceftriaxone 1 g IV BD` under *Hospital Course* is
 * a fact about last Tuesday, not a prescription.
 *
 * Harvested into `medications`, it becomes a drug the patient believes they
 * should still be taking. It parses cleanly, it grounds perfectly, it carries
 * a real dose, and it is wrong in a way a reviewer skimming a list has no way
 * to see. So the scope is the guard, and a summary with no discharge
 * medication section yields none — and says why — rather than guessing.
 */
const DISCHARGE_MEDICATION_HEADING =
  /^(?:discharge\s+medications?|medications?\s+on\s+discharge|treatment\s+(?:advised|on\s+discharge)|medicines?\s+(?:advised|prescribed)|drugs?\s+advised|advised\s+to\s+continue|to\s+continue|rx\s+on\s+discharge|discharge\s+advice|home\s+medications?)\b/i;

/** Headings whose medications are history rather than instruction. */
const HISTORICAL_HEADING =
  /^(?:hospital\s+course|course\s+in\s+(?:the\s+)?(?:hospital|ward)|treatment\s+given|management|progress\s+notes?|clinical\s+course)\b/i;

/**
 * The section whose drugs the patient takes home, or null.
 *
 * Null is a real answer and must stay one: it means this summary did not
 * separate its discharge medications from its narrative, and nothing here can
 * tell them apart. The caller turns that into an escalation reason.
 */
export function dischargeMedicationSection(
  sections: readonly CapturedSection[],
): CapturedSection | null {
  for (const section of sections) {
    if (section.topic !== 'medications') continue;
    const heading = section.heading.cells[0]?.text.trim() ?? '';
    if (HISTORICAL_HEADING.test(heading)) continue;
    if (DISCHARGE_MEDICATION_HEADING.test(heading)) return section;
  }
  return null;
}

/** Whether [line] sits under a heading whose contents are history. */
export function isHistorical(
  line: DocumentLine,
  sections: readonly CapturedSection[],
): boolean {
  return sections.some(
    (section) =>
      HISTORICAL_HEADING.test(section.heading.cells[0]?.text.trim() ?? '') &&
      section.body.includes(line),
  );
}
