/**
 * Every sentence this module can say to a patient.
 *
 * Collected in one file so that the rule is checkable rather than remembered.
 * Documents §27 names the failure mode exactly — `PP-OCR inference exception`
 * reaching a person who wanted to know whether to take another photograph —
 * and the way that leaks is never a decision, it is an `error.message` passed
 * through one layer that did not know where it would end up.
 *
 * Three things every string here has to do: say what happened in words the
 * patient already knows, say what to do next, and name no component. A message
 * that satisfies the first two and fails the third still tells somebody
 * standing in a corridor that a Python service is down, which is not their
 * problem and not their business.
 */

/** OCR could not read the page. §27's worked example, verbatim. */
export const UNREADABLE_DOCUMENT =
  "We couldn't read this document clearly. Please upload a clearer image.";

/** The image is too small for the recogniser to have a chance. §5. */
export const IMAGE_TOO_SMALL =
  'This image is too small to read. Please take the photo again, holding the ' +
  'camera closer so the page fills the frame.';

/** Text was found, but almost none of it was legible. §5, §27. */
export const IMAGE_TOO_BLURRY =
  'The document is difficult to read. Please upload a clearer image with the ' +
  'complete page visible.';

/** The page carried no text at all — a blank sheet, or the back of one. §27. */
export const NO_TEXT_FOUND =
  "We couldn't find any text on this page. Please check that you photographed " +
  'the side with the writing on it, and that all four corners are visible.';

/** Read fine, but nothing medical could be structured out of it. §27. */
export const NOTHING_EXTRACTED =
  'We read this document but could not find any medical information in it. ' +
  'You can still keep it with your records, and a clinician can review it.';

/**
 * Read fine, but the structuring step could not run at all.
 *
 * Deliberately a different sentence from [NOTHING_EXTRACTED], and the
 * difference is the point. That one is a finding about the document — we
 * looked and there was nothing medical in it. This one is a statement about
 * us: nobody looked. Saying the first when the second is true tells a patient
 * their prescription lists no medicines, which is the §19 failure ("never
 * convert 'Not found' into 'No'") arriving a step earlier than §19 guards.
 */
export const EXTRACTION_UNAVAILABLE =
  'We saved this document but could not read it into information just now. ' +
  'It is kept with your records, and a clinician can review it.';

/**
 * Part of the document was read; the step that would have read the rest did not run.
 *
 * A third sentence beside [NOTHING_EXTRACTED] and [EXTRACTION_UNAVAILABLE],
 * and the three are distinct on purpose:
 *
 *     NOTHING_EXTRACTED       we looked at all of it, and there was nothing there
 *     EXTRACTION_UNAVAILABLE  nobody looked at any of it
 *     this                    somebody looked at some of it
 *
 * The deterministic reader makes the third case ordinary rather than rare: it
 * reads a printed prescription completely and a handwritten one barely at all,
 * and on a deployment with no model there is nothing behind it to finish the
 * job. Saying the first here tells a patient their prescription lists two
 * medicines when the page lists five — §19 arriving by the side door.
 */
export const PARTIALLY_EXTRACTED =
  'We read part of this document. Please check what we found — there may be ' +
  'more on the page that we have not listed. The original is kept with your ' +
  'records, and a clinician can review it.';

/**
 * This deployment cannot read this kind of document at all.
 *
 * [EXTRACTION_UNAVAILABLE] says "just now", which promises that trying again
 * will go differently. On a box with no model, reading an imaging report will
 * not go differently tomorrow, and what that promise costs is a patient
 * photographing the same page three times before giving up.
 */
export const EXTRACTION_NOT_SUPPORTED =
  'We saved this document, but we could not turn it into information. It is ' +
  'kept with your records, and a clinician can review it.';

/** The file was not a photograph or a PDF. §27. */
export const UNSUPPORTED_FILE =
  'This kind of file cannot be read. Please upload a photo of the document, ' +
  'or a PDF.';

/** The same document, already held. §21 — told, not refused. */
export const DUPLICATE_DOCUMENT =
  'You have already uploaded this document. We have kept it with the first ' +
  'copy rather than adding it twice.';

/**
 * The same document again — and the copy already held was never readable.
 *
 * Prefixed to the first copy's own `failureReason`, which is the only sentence
 * on the screen the patient can act on.
 *
 * [DUPLICATE_DOCUMENT] alone is actively misleading here: it says the document
 * is safely filed with the first copy, when the first copy was rejected and
 * nothing has ever been read from either. Somebody re-sending the same photo
 * gets "you already sent this" each time and is never told that the photo was
 * too small — so they re-send it again. The dedupe check runs before the status
 * check, so this was the one path where the reason could not reach them.
 */
export const DUPLICATE_OF_UNREADABLE =
  'You have already sent this document, and we could not read that copy.';

/** Everything worked. Said here because §2 forbids implying it is verified. */
export const AWAITING_REVIEW =
  'We found some information in this document. Please check that it is correct ' +
  'before it is added to your medical history.';

/** §20, on finding a difference against the existing record. */
export const CONTRADICTION_FOUND =
  'This document contains information that differs from your current record. ' +
  'Please review it.';

/** The upload landed and the pipeline is running. §28's "Processing...". */
export const PROCESSING =
  "We're reading your document now. This usually takes less than a minute.";

/**
 * The patient has told us something the page got wrong. §18, §35.
 *
 * Says two things on purpose. First that both readings are kept — a patient who
 * believes their correction erased the original will not trust it with the next
 * one. Second that the document is still waiting on them, because a correction
 * is not a confirmation and the row has gone back to needing review.
 */
export const CORRECTION_RECORDED =
  'Thank you. We have kept both what the document says and what you have told ' +
  'us, so a clinician can see the difference. Please confirm the rest of this ' +
  'document when you are ready.';

/** The patient has confirmed what was found. §18. */
export const VERIFIED =
  'Thank you. You have confirmed this information, and it is now part of your ' +
  'medical history.';

/**
 * Which of the four outcome sentences this reading earned.
 *
 * Lives here, beside the strings, and is called from two places on purpose:
 * the pipeline when it writes the row, and `messageFor` when it reads one
 * back. Those two disagreeing is not hypothetical — before this function
 * existed the read path chose from findings alone, so a row the pipeline had
 * correctly labelled [EXTRACTION_UNAVAILABLE] came back to the patient as
 * [NOTHING_EXTRACTED]: "we looked and found nothing" about a document nothing
 * had looked at.
 */
export function extractionMessage(outcome: {
  /** `none` when no reader applied to this document type. */
  method: 'rules' | 'model' | 'rules_then_model' | 'none';
  /** Something was read, but not all of it. */
  partial: boolean;
  /** A reader ran and threw, and nothing else produced anything. */
  failed: boolean;
  hasFindings: boolean;
}): string {
  if (outcome.failed) return EXTRACTION_UNAVAILABLE;
  if (outcome.method === 'none') return EXTRACTION_NOT_SUPPORTED;
  if (outcome.partial) {
    return outcome.hasFindings ? PARTIALLY_EXTRACTED : EXTRACTION_NOT_SUPPORTED;
  }
  // The only branch allowed to say "we looked and there was nothing", and it
  // is reachable only once a reader has finished the whole document.
  return outcome.hasFindings ? AWAITING_REVIEW : NOTHING_EXTRACTED;
}
