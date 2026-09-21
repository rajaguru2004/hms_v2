/**
 * Which reader produced an extraction.
 *
 * Its own file so that the envelope in `document-pipeline.service.ts`, the
 * `rules/` directory and the read path in `patient-documents.service.ts` can
 * all name it without importing each other.
 *
 *   `rules`             the deterministic pass alone, and it cleared its gate
 *   `model`             no rule set applied; a language model read it
 *   `rules_then_model`  the rules read what they could and a model filled gaps
 *   `none`              no rule set applied and no model was available
 *
 * Stored inside `PatientDocument.extraction` rather than in a column, because
 * the read path has to see it: `messageFor` re-derives the patient's sentence
 * on every GET, and without this it cannot tell a partial reading from a
 * complete one that found nothing.
 */
export type ExtractionMethod = 'rules' | 'model' | 'rules_then_model' | 'none';

/** A row written before the deterministic pass existed was, by definition, all model. */
export const LEGACY_EXTRACTION_METHOD: ExtractionMethod = 'model';
