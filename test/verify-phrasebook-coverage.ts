import {
  PHRASEBOOKS,
  phrasebookCoverage,
  phrasingFor,
  allowingUnreviewedPhrasebooks,
} from '../src/modules/case-taking/engine/phrasebook';
import {
  STATIC_FIELDS,
  fieldsFor,
} from '../src/modules/case-taking/engine/field-registry';
import {
  applyFact,
  createClinicalState,
} from '../src/modules/case-taking/engine/clinical-state';
import { recorded } from '../src/modules/case-taking/engine/tri-state';

console.log('flag on:', allowingUnreviewedPhrasebooks());
for (const code of Object.keys(PHRASEBOOKS)) {
  const c = phrasebookCoverage(code);
  console.log(JSON.stringify(c, null, 2));
  const missingWithPrompt = (c?.missingQuestions ?? []).filter((k) => {
    const f = STATIC_FIELDS.find((x) => x.key === k);
    return (f?.prompt ?? '').trim().length > 0;
  });
  console.log(code, 'missing-with-a-real-prompt:', missingWithPrompt);
}

// group-template coverage: a patient who says yes to medicines + allergies
let s = createClinicalState({ sessionId: 's', language: 'hi' });
s = applyFact(
  s,
  'medications.any_current',
  recorded(true, {
    source: 'patient_text',
    verification: 'unverified',
    recordedAt: new Date().toISOString(),
  }),
);
s = applyFact(
  s,
  'allergies.reported',
  recorded(true, {
    source: 'patient_text',
    verification: 'unverified',
    recordedAt: new Date().toISOString(),
  }),
);
s = applyFact(
  s,
  'surgical.any_previous',
  recorded(true, {
    source: 'patient_text',
    verification: 'unverified',
    recordedAt: new Date().toISOString(),
  }),
);
s = applyFact(
  s,
  'family.any_relevant',
  recorded(true, {
    source: 'patient_text',
    verification: 'unverified',
    recordedAt: new Date().toISOString(),
  }),
);
s = applyFact(
  s,
  'investigations.any_previous',
  recorded(true, {
    source: 'patient_text',
    verification: 'unverified',
    recordedAt: new Date().toISOString(),
  }),
);
const expanded = fieldsFor(s);
console.log('expanded field count:', expanded.length);
const hiExpanded = phrasebookCoverage('hi', expanded);
console.log(
  'hi coverage over expanded registry:',
  hiExpanded?.translatedQuestions,
  '/',
  hiExpanded?.totalQuestions,
  'missing:',
  hiExpanded?.missingQuestions,
);

console.log('--- sample renderings (hi) ---');
for (const k of [
  'hpi.severity',
  'hpi.character',
  'social.sleep',
  'medications[0].route',
  'allergies[0].severity',
]) {
  const f = expanded.find((x) => x.key === k)!;
  console.log(k, '=>', phrasingFor(f, 'hi'));
}
