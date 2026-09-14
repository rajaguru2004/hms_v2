/**
 * The final case (§38), rendered section by section.
 *
 * Every item carries its presence, its source and its verification status,
 * because §32 wants the case traceable and §31 wants low-confidence
 * information visibly marked. A rendered item is therefore never just a string:
 * it is a string *plus* the reason that string is what it is.
 *
 * The rule this file exists to enforce: **`renderValue` throws when the
 * presence is not `recorded`.** A template that reaches for a value it does not
 * have gets a test failure, not a blank, and certainly not a "No". The
 * alternative — returning an empty string and letting the template's `||`
 * fallback supply "No" — is how "not assessed" becomes "no known allergies"
 * three layers away from the code that made the decision.
 *
 * `renderItem` never calls `renderValue` on an absent fact; it uses
 * `presenceLabel` instead. So the safe path is the easy one, and the unsafe
 * path is the one that explodes.
 */

import {
  ClinicalState,
  SECTION_ORDER,
  SECTION_TITLES,
  SectionKey,
  computeCompletion,
  groupIndices,
  readFactAt,
} from './clinical-state';
import { FieldDefinition, applicableFields, fieldsFor } from './field-registry';
import { SafetyAssessment } from './safety-engine';
import {
  Fact,
  FactPresence,
  FactSource,
  FactValue,
  VerificationStatus,
  isAssessed,
  presenceLabel,
  readFact,
  requireValue,
} from './tri-state';

/**
 * Section-specific wording for `none`, and only for `none`.
 *
 * Overriding one presence at a time is deliberate: there is no way to express
 * "and also say this for not_assessed", so no section can accidentally give two
 * different states the same words. The allergies entry is the one that matters
 * — it is the phrase that must never appear against an unasked question.
 */
const SECTION_PRESENCE_LABELS: Partial<
  Record<SectionKey, Partial<Record<FactPresence, string>>>
> = {
  allergies: { none: 'No known allergies' },
  medications: { none: 'No current medications' },
  past_medical: { none: 'Not reported' },
  surgical: { none: 'No previous surgery reported' },
  family: { none: 'No relevant family history reported' },
  investigations: { none: 'No previous investigations reported' },
};

export interface RenderedItem {
  readonly fieldPath: string;
  readonly label: string;
  readonly presence: FactPresence;
  /** Always safe to print. The value when recorded, the presence label otherwise. */
  readonly display: string;
  readonly value?: FactValue;
  readonly source?: FactSource;
  readonly confidence?: number;
  readonly verification?: VerificationStatus;
  readonly documentId?: string;
  /** True when this question still applies and has not been answered (§36). */
  readonly outstanding: boolean;
}

export interface RenderedSection {
  readonly section: SectionKey;
  readonly title: string;
  readonly items: readonly RenderedItem[];
  readonly percentComplete: number;
  readonly outstanding: readonly string[];
}

export interface RenderedCase {
  readonly sessionId: string;
  readonly revision: number;
  readonly sections: readonly RenderedSection[];
  readonly percentComplete: number;
  /** §36's list, flattened: every applicable question still unanswered. */
  readonly missingInformation: readonly string[];
  readonly safety?: SafetyAssessment;
}

/**
 * Format a recorded value for display, or throw.
 *
 * Throwing rather than returning `''` is the entire point of this function.
 * There is no presence here that could stand in for a value: "unknown" is not a
 * value, "declined" is not a value, and "nobody asked" is emphatically not a
 * value. A caller that wants a printable string for any presence wants
 * `renderItem`.
 */
export function renderValue(
  fact: Fact<FactValue> | undefined | null,
  fieldPath?: string,
): string {
  return formatValue(requireValue(fact, fieldPath));
}

function formatValue(value: FactValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  // Choice values live in the state as snake_case tokens so that rules can
  // compare them; they are read by humans here.
  const humanised = value.replace(/_/g, ' ').trim();
  return humanised.length > 0
    ? humanised.charAt(0).toUpperCase() + humanised.slice(1)
    : humanised;
}

export function renderItem(
  field: FieldDefinition,
  fact: Fact<FactValue>,
  options?: { outstanding?: boolean },
): RenderedItem {
  const reading = readFact(fact);
  const overrides = SECTION_PRESENCE_LABELS[field.section];

  if (reading.kind === 'value') {
    return {
      fieldPath: field.key,
      label: field.label,
      presence: 'recorded',
      display: formatValue(reading.value),
      value: reading.value,
      source: reading.provenance.source,
      confidence: reading.provenance.confidence,
      verification: reading.provenance.verification,
      documentId: reading.provenance.documentId,
      outstanding: false,
    };
  }

  return {
    fieldPath: field.key,
    label: field.label,
    presence: reading.presence,
    // Never `renderValue`. There is nothing to render.
    display: presenceLabel(reading.presence, overrides),
    source: reading.provenance?.source,
    confidence: reading.provenance?.confidence,
    verification: reading.provenance?.verification,
    documentId: reading.provenance?.documentId,
    outstanding: options?.outstanding ?? reading.presence === 'not_assessed',
  };
}

export function renderCase(
  state: ClinicalState,
  options?: { safety?: SafetyAssessment },
): RenderedCase {
  const applicable = applicableFields(state);
  const applicableKeys = new Set(applicable.map((field) => field.key));
  const completion = computeCompletion(state, applicable);
  const completionBySection = new Map(
    completion.sections.map((section) => [section.section, section]),
  );

  // An item appears if the interview would ask it, or if anybody has answered
  // it. The second half matters for fields the interview never asks — the age
  // band read off the patient record, an investigation lifted from an uploaded
  // report — which belong in the case even though they were never questions.
  const renderable = fieldsFor(state).filter(
    (field) =>
      applicableKeys.has(field.key) || isAssessed(readFactAt(state, field.key)),
  );

  const sections: RenderedSection[] = [];
  for (const section of SECTION_ORDER) {
    const fields = renderable.filter((field) => field.section === section);
    if (fields.length === 0) continue;

    const items = fields
      .slice()
      .sort(byRenderOrder)
      .map((field) =>
        renderItem(field, readFactAt(state, field.key), {
          outstanding:
            applicableKeys.has(field.key) &&
            !isAssessed(readFactAt(state, field.key)),
        }),
      );

    const sectionCompletion = completionBySection.get(section);
    sections.push({
      section,
      title: SECTION_TITLES[section],
      items,
      percentComplete: sectionCompletion?.percent ?? 100,
      outstanding: sectionCompletion?.outstanding ?? [],
    });
  }

  return {
    sessionId: state.sessionId,
    revision: state.revision,
    sections,
    percentComplete: completion.percent,
    missingInformation: completion.sections.flatMap(
      (section) => section.outstanding,
    ),
    safety: options?.safety,
  };
}

/**
 * Within a section, group items keep their list order (`medications[0]` before
 * `medications[1]`) and everything else falls back to the registry's priority.
 * Read order in a chart is not the same as ask order, which is why this is not
 * the selector's comparator.
 */
function byRenderOrder(a: FieldDefinition, b: FieldDefinition): number {
  const indexA = groupIndexIn(a.key);
  const indexB = groupIndexIn(b.key);
  if (indexA !== indexB) return indexA - indexB;
  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function groupIndexIn(key: string): number {
  const match = /\[(\d+)\]/.exec(key);
  // Summary fields (`allergies.reported`) sort above their list items.
  return match ? Number(match[1]) : -1;
}

/**
 * The §38 plain-text case, for the handoff to the doctor's workflow and for the
 * patient review screen (§34).
 *
 * Items that were never assessed are printed as "Not assessed" rather than
 * omitted. An omitted line reads as "nothing to report"; a printed one reads as
 * "we did not get to this", and those are different facts about the case.
 */
export function renderCaseText(rendered: RenderedCase): string {
  const lines: string[] = ['PATIENT CASE', ''];

  for (const section of rendered.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      const annotations: string[] = [];
      if (item.presence === 'recorded' && item.verification) {
        annotations.push(item.verification.replace(/_/g, ' '));
      }
      if (item.confidence !== undefined) {
        annotations.push(`confidence ${Math.round(item.confidence * 100)}%`);
      }
      const suffix =
        annotations.length > 0 ? `  [${annotations.join('; ')}]` : '';
      lines.push(`  ${item.label}: ${item.display}${suffix}`);
    }
    lines.push('');
  }

  if (rendered.safety && rendered.safety.triggered.length > 0) {
    lines.push('Safety');
    for (const rule of rendered.safety.triggered) {
      // The clinician summary, not the patient message: this block is read by
      // the triage desk. The patient's copy uses `safety.patientMessage`.
      lines.push(
        `  [${rule.severity.toUpperCase()}] ${rule.title} — ${rule.clinicianSummary} (${rule.ruleId} v${rule.ruleVersion})`,
      );
    }
    lines.push('');
  }

  lines.push('Completion');
  lines.push(`  ${rendered.percentComplete}% of applicable questions answered`);
  if (rendered.missingInformation.length > 0) {
    lines.push(`  Not assessed: ${rendered.missingInformation.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Convenience for the list sections: the indices actually present, so a caller
 * can iterate medications or allergies without guessing how many there are.
 */
export function renderedGroupIndices(
  state: ClinicalState,
  prefix: string,
): readonly number[] {
  return groupIndices(state, prefix);
}
