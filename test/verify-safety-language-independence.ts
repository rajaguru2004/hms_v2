import {
  applyFact,
  createClinicalState,
  ClinicalState,
} from '../src/modules/case-taking/engine/clinical-state';
import { recorded } from '../src/modules/case-taking/engine/tri-state';
import { derivePresence } from '../src/modules/case-taking/engine/tri-state';
import { evaluate } from '../src/modules/case-taking/engine/safety-engine';
import {
  classifyComplaint,
  complaintCategories,
  applicableFields,
  valueSpecFor,
  STATIC_FIELDS,
} from '../src/modules/case-taking/engine/field-registry';

const prov = {
  source: 'patient_text' as const,
  verification: 'unverified' as const,
  recordedAt: '2026-09-15T00:00:00.000Z',
};
const put = (
  s: ClinicalState,
  k: string,
  v: string | number | boolean,
): ClinicalState => applyFact(s, k, recorded(v, prov));

function scenario(language: string, complaint: string): void {
  let s = createClinicalState({ sessionId: 's', language });
  s = put(s, 'chief_complaint.symptom', complaint);
  s = put(s, 'hpi.associated.breathlessness', true);
  s = put(s, 'hpi.associated.sweating', true);
  s = put(s, 'hpi.onset', 'sudden');
  s = put(s, 'ros.neurological.face_droop', true);
  s = put(s, 'ros.gastrointestinal.black_stools', true);
  s = put(s, 'ros.psychiatric.self_harm_thoughts', true);
  s = put(s, 'ros.allergic.throat_or_lip_swelling', true);
  const a = evaluate(s);
  console.log(`[${language}] complaint=${JSON.stringify(complaint)}`);
  console.log(
    `   classifyComplaint -> ${JSON.stringify(classifyComplaint(complaint))}`,
  );
  console.log(
    `   complaintCategories(state) -> ${JSON.stringify(complaintCategories(s))}`,
  );
  console.log(`   applicableFields -> ${applicableFields(s).length}`);
  console.log(
    `   triggered -> ${JSON.stringify(a.triggered.map((t) => `${t.ruleId}/${t.severity}`))}`,
  );
  console.log(`   highestSeverity -> ${a.highestSeverity}`);
}

console.log(
  '=== A. same structured facts, complaint text in two languages ===',
);
scenario('en', 'chest pain for three days');
scenario('hi', 'तीन दिन से सीने में दर्द हो रहा है');
scenario('ta', 'enakku moonu naala nenju vali irukku');

console.log(
  '\n=== B. derivePresence: are the English phrase lists applied to Hindi text? ===',
);
const boolSpec = valueSpecFor(
  STATIC_FIELDS.find((f) => f.key === 'hpi.associated.breathlessness')!,
);
for (const [lang, text] of [
  ['en', 'no, not at all'],
  ['hi', 'नहीं, बिल्कुल नहीं'],
  ['hi', 'no, not at all'],
] as const) {
  const d = derivePresence({
    modality: 'text',
    utterance: text,
    evidenceSpan: text,
    field: boolSpec,
    language: lang,
  });
  console.log(
    `   language=${lang} text=${JSON.stringify(text)} -> presence=${d.presence} reason=${d.reason} languageCovered=${d.languageCovered} needsConfirm=${d.needsPatientConfirmation}`,
  );
}

console.log('\n=== C. a tapped choice token, identical in every language ===');
for (const lang of ['en', 'hi', 'ta']) {
  const d = derivePresence({
    modality: 'choice',
    extractedValue: 'yes',
    field: boolSpec,
    language: lang,
  });
  console.log(
    `   language=${lang} -> presence=${d.presence} value=${String(d.value)} reason=${d.reason}`,
  );
}
