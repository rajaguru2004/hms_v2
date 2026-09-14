import { DocumentLlm } from '../llm/document-llm.port';

/**
 * Documents §10, and the schema's own comment on `PatientDocument.docType`.
 *
 * `unknown` is one of the answers, not the absence of one. A classifier with no
 * way to abstain will always name a type, and the type it names for an
 * unfamiliar layout is whichever one shares the most incidental vocabulary with
 * it — which then selects an extraction schema, which then asks a language
 * model to find medications in a radiology report. Being wrong here is not one
 * mistake, it is the wrong pipeline.
 */
export const DOCUMENT_TYPES = [
  'prescription',
  'laboratory_report',
  'discharge_summary',
  'imaging_report',
  'referral_letter',
  'consultation_note',
  'other',
  'unknown',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface Classification {
  type: DocumentType;
  /**
   * 0..1, derived here from evidence this module counted. Not a model's
   * self-report — see `document-llm.port.ts` for why that number is worthless.
   */
  confidence: number;
  /** Which of the two paths answered, so a wrong call can be attributed. */
  method: 'layout_keywords' | 'model' | 'no_evidence';
}

interface Signal {
  pattern: RegExp;
  weight: number;
}

/**
 * The vocabulary each kind of document is printed in.
 *
 * Weights are evidence, not preference: 3 is a phrase that all but names the
 * document ("COMPLETE BLOOD COUNT", a bare "Rx"), 2 is strong but shared with a
 * neighbouring type, 1 is a hint that only counts alongside others. `follow up`
 * is a 1 for exactly that reason — it is on the discharge summary, and it is
 * also on the bottom of half the prescriptions ever written.
 *
 * `other` has no signals. It is not something a keyword can find; it is the
 * answer a reader gives after recognising a real medical document that is none
 * of the above, so only the model may choose it.
 */
const SIGNALS: Record<string, Signal[]> = {
  prescription: [
    { pattern: /\bprescription\b/i, weight: 3 },
    { pattern: /(^|[\s.])rx([\s.:]|$)/i, weight: 3 },
    { pattern: /\b(tab|cap|syp|inj)\b\.?\s/i, weight: 2 },
    { pattern: /\b(tablet|capsule|syrup|injection|ointment)s?\b/i, weight: 2 },
    { pattern: /\b(od|bd|bid|tds|tid|qid|hs|sos|prn)\b/i, weight: 2 },
    {
      pattern: /\b(once|twice|thrice|three times)\s+(a\s+)?(daily|day)\b/i,
      weight: 2,
    },
    { pattern: /\bat bedtime\b|\bafter food\b|\bbefore food\b/i, weight: 1 },
    { pattern: /\brefill/i, weight: 1 },
    { pattern: /\b\d+\s?(mg|mcg|ml|g)\b/i, weight: 1 },
  ],
  laboratory_report: [
    {
      pattern:
        /\b(complete blood count|cbc|lipid profile|liver function|renal function|urine routine)\b/i,
      weight: 3,
    },
    { pattern: /\breference\s+(range|interval|value)/i, weight: 3 },
    {
      pattern: /\b(laboratory|pathology|diagnostics|lab report)\b/i,
      weight: 2,
    },
    {
      pattern:
        /\b(haemoglobin|hemoglobin|platelet|creatinine|bilirubin|cholesterol)\b/i,
      weight: 2,
    },
    {
      pattern: /\b(g\/dl|mg\/dl|mmol\/l|iu\/l|u\/l|\/ul|cells\/cumm)\b/i,
      weight: 2,
    },
    { pattern: /\b(specimen|sample no|collected on|collected)\b/i, weight: 1 },
    { pattern: /\bresult\b/i, weight: 1 },
  ],
  discharge_summary: [
    { pattern: /\bdischarge summary\b/i, weight: 3 },
    {
      pattern: /\b(date of discharge|discharge date|discharged on)\b/i,
      weight: 3,
    },
    {
      pattern: /\b(date of admission|admission date|admitted on)\b/i,
      weight: 2,
    },
    { pattern: /\bhospital course\b/i, weight: 2 },
    { pattern: /\bfinal diagnosis\b/i, weight: 2 },
    {
      pattern: /\b(treating|attending)\s+(physician|consultant|doctor)\b/i,
      weight: 1,
    },
    { pattern: /\bfollow[\s-]?up\b/i, weight: 1 },
  ],
  imaging_report: [
    {
      pattern:
        /\b(x-?ray|ultrasound|sonograph|ct scan|mri|mammograph|doppler)\b/i,
      weight: 3,
    },
    { pattern: /\bimpression\s*:/i, weight: 2 },
    { pattern: /\b(radiology|radiologist|imaging)\b/i, weight: 2 },
    { pattern: /\bfindings\s*:/i, weight: 2 },
    { pattern: /\b(contrast|axial|sagittal|coronal)\b/i, weight: 1 },
  ],
  referral_letter: [
    { pattern: /\breferral\b/i, weight: 3 },
    { pattern: /\brefer(ring|red)\s+(this|the|your)\s+patient\b/i, weight: 3 },
    { pattern: /\bdear\s+(dr|doctor)\b/i, weight: 2 },
    { pattern: /\bkindly\s+(see|review|evaluate|assess)\b/i, weight: 2 },
    { pattern: /\byours\s+(sincerely|faithfully)\b/i, weight: 1 },
  ],
  consultation_note: [
    {
      pattern: /\b(consultation note|progress note|opd note|clinical note)\b/i,
      weight: 3,
    },
    { pattern: /\b(chief complaint|presenting complaint)\b/i, weight: 3 },
    { pattern: /\bhistory of present(ing)? illness\b/i, weight: 2 },
    { pattern: /\b(on examination|o\/e)\b/i, weight: 2 },
    { pattern: /\b(plan|assessment)\s*:/i, weight: 1 },
  ],
};

/**
 * Evidence at which more keywords stop making the answer more certain.
 *
 * Six is roughly "three strong phrases". Past that a document is not becoming
 * more obviously a prescription; it is just longer.
 */
const SATURATION = 6;

/**
 * Below this the keywords have not decided, and the model is asked.
 *
 * Both halves of the confidence formula can put a document here: too little
 * evidence of anything, or plenty of evidence for two types at once. A
 * discharge summary that lists the drugs the patient went home on is the second
 * case, and it is common.
 */
const ASK_MODEL_BELOW = 0.55;

/**
 * A model that answered is trusted this far and no further.
 *
 * It read the document and said a word; that is a real judgement and worth
 * acting on. It is also unverifiable, which is why it sits below the threshold
 * that an extraction has to clear before anything downstream treats the type as
 * settled rather than provisional.
 */
const MODEL_CONFIDENCE = 0.5;

/** The scores, before any decision is made about them. Exported for tests. */
export function scoreDocumentTypes(text: string): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [type, signals] of Object.entries(SIGNALS)) {
    scores[type] = signals.reduce(
      (total, signal) =>
        total + (signal.pattern.test(text) ? signal.weight : 0),
      0,
    );
  }
  return scores;
}

/** The keyword-and-layout verdict on its own, with no model involved. */
export function classifyByKeywords(text: string): Classification {
  const scores = scoreDocumentTypes(text);
  const ranked = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const [topType, topScore] = ranked[0] ?? ['unknown', 0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (topScore === 0) {
    return { type: 'unknown', confidence: 0, method: 'no_evidence' };
  }

  // Two independent questions, multiplied rather than averaged: how much
  // evidence there was at all, and how much clearer the winner was than the
  // runner-up. Either one being bad should sink the answer, and averaging lets
  // a strong one carry a weak one.
  const strength = Math.min(1, topScore / SATURATION);
  const margin = (topScore - secondScore) / topScore;
  const confidence = round(strength * (0.5 + 0.5 * margin));

  return {
    type: topType as DocumentType,
    confidence,
    method: 'layout_keywords',
  };
}

/**
 * The document's type, asking the model only when the keywords could not tell.
 *
 * The order matters and is the §25 separation of responsibilities in one
 * function: the deterministic pass is auditable, reproducible and free, so it
 * goes first and usually finishes the job; the model is for the documents that
 * do not look like anything this file has seen.
 */
export async function classifyDocument(
  text: string,
  llm: DocumentLlm,
): Promise<Classification> {
  const byKeywords = classifyByKeywords(text);
  if (byKeywords.confidence >= ASK_MODEL_BELOW) return byKeywords;

  try {
    const answer = await llm.extractJson<{ documentType?: string }>({
      instruction:
        'You are classifying a scanned medical document. Read the text and ' +
        'name which kind of document it is. Answer "unknown" if the text is ' +
        'too garbled or too short to tell, and "other" if it is clearly a ' +
        'medical document but none of the listed kinds. Do not guess.',
      // Enough to see the letterhead, the section headings and the start of
      // the body. A classifier that reads the whole of a twelve-page discharge
      // summary is paying for pages that cannot change the answer.
      text: text.slice(0, 4_000),
      schema: {
        type: 'object',
        properties: {
          documentType: { type: 'string', enum: [...DOCUMENT_TYPES] },
        },
        required: ['documentType'],
      },
      timeoutMs: 60_000,
    });

    const type = answer.documentType as DocumentType | undefined;
    if (!type || !DOCUMENT_TYPES.includes(type) || type === 'unknown') {
      return { type: 'unknown', confidence: 0, method: 'model' };
    }

    return { type, confidence: MODEL_CONFIDENCE, method: 'model' };
  } catch {
    // The model being unavailable is not evidence about the document. Falling
    // back to the keyword guess would dress a 0.3 up as a decision; `unknown`
    // is what we actually know, and the row keeps the OCR text either way.
    return byKeywords.confidence > 0
      ? byKeywords
      : { type: 'unknown', confidence: 0, method: 'no_evidence' };
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
