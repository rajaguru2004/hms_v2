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

/** The file was not a photograph or a PDF. §27. */
export const UNSUPPORTED_FILE =
  'This kind of file cannot be read. Please upload a photo of the document, ' +
  'or a PDF.';

/** The same document, already held. §21 — told, not refused. */
export const DUPLICATE_DOCUMENT =
  'You have already uploaded this document. We have kept it with the first ' +
  'copy rather than adding it twice.';

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
