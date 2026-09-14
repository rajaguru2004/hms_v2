/**
 * The status vocabularies the clinical modules actually speak.
 *
 * Every one of these columns is a bare `String` in Prisma with the allowed
 * values written in a trailing comment, so nothing stopped a caller storing
 * `"Pending "`, `"STAT"` or a typo. The rows still save; the screens that
 * switch on the value simply stop matching, and a lab order sits in a status no
 * board renders until someone reads it out of the database by hand.
 *
 * The lists below are taken from those schema comments, then widened wherever
 * the Next.js console demonstrably sends something else — a vocabulary that
 * rejects the shipping web client is a worse bug than the one it fixes. Each
 * such widening is marked with the caller that forced it.
 */

// ── Laboratory ─────────────────────────────────────────────────────────────

export const LAB_ORDER_PRIORITIES = ['routine', 'urgent', 'stat'] as const;

export const LAB_ORDER_STATUSES = [
  'pending',
  'sample_collected',
  'in_progress',
  'completed',
  'cancelled',
  // Not in the schema comment, but `LabOrder.rejectionReason` exists for it and
  // the console's LabOrderStatus map offers it (frontend src/types/index.ts).
  'rejected',
] as const;

/** H(igh), L(ow), N(ormal), A(bnormal) — the console posts A, H or N. */
export const LAB_RESULT_FLAGS = ['H', 'L', 'N', 'A'] as const;

// ── Radiology ──────────────────────────────────────────────────────────────

export const RADIOLOGY_ORDER_URGENCIES = ['routine', 'urgent', 'stat'] as const;

export const RADIOLOGY_ORDER_STATUSES = [
  'pending',
  'scheduled',
  'in_progress',
  'completed',
  'reported',
  'cancelled',
] as const;

export const RADIOLOGY_REPORT_STATUSES = ['draft', 'final', 'amended'] as const;

// ── Pharmacy ───────────────────────────────────────────────────────────────

export const PRESCRIPTION_STATUSES = [
  'pending',
  'partially_dispensed',
  'fully_dispensed',
  'cancelled',
] as const;

// ── Billing ────────────────────────────────────────────────────────────────

export const PAYMENT_METHODS = [
  'cash',
  'credit_card',
  'debit_card',
  'mobile_money',
  'insurance',
  'bank_transfer',
  'cheque',
] as const;

/** `PharmacySale.paymentStatus`. Narrower than an invoice's — a counter sale is never refunded in place. */
export const PAYMENT_STATUSES = ['pending', 'paid', 'partially_paid'] as const;

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'overdue',
  'paid',
  'cancelled',
] as const;

export const INVOICE_PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'cancelled',
  'refunded',
] as const;

// ── Inpatient ──────────────────────────────────────────────────────────────

/**
 * Both casings are allowed on purpose. The schema comment says lowercase, but
 * the console's admission form is `z.enum(['Emergency','Elective','Transfer'])`
 * and posts that value verbatim, so a lowercase-only list would 400 every
 * admission made from the web today.
 */
export const ADMISSION_TYPES = [
  'emergency',
  'elective',
  'transfer',
  'Emergency',
  'Elective',
  'Transfer',
] as const;

export const ADMISSION_STATUSES = [
  'admitted',
  'discharged',
  'transferred',
] as const;

export const BED_TYPES = ['standard', 'icu', 'special'] as const;

export const BED_STATUSES = [
  'available',
  'occupied',
  'maintenance',
  // Absent from the schema comment; the console and the mobile BedState both
  // render it, and beds are already stored this way.
  'reserved',
] as const;
