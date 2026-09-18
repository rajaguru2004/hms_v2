/**
 * Every prompt this system sends a model, in one place.
 *
 * They are constants rather than strings assembled at the call site so that
 * "what did we actually ask it?" is answerable by reading a file, and so that
 * the specs beside them can assert on the rules that matter — chiefly that no
 * schema ever grows a `presence` field. A prompt built inline in a service is a
 * prompt nobody reviews again.
 */
export * from './extraction.prompt';
export * from './question-phrasing.prompt';
export * from './review-summary.prompt';
export * from './document-extraction.prompt';
export * from './translation.prompt';
