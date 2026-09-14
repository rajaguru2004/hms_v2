import { IMAGE_TOO_SMALL, UNSUPPORTED_FILE } from './messages';

/**
 * Documents §5: is this page worth an OCR pass at all?
 *
 * Deliberately *before* the model rather than after it. A 220x311 thumbnail of
 * a prescription will come back from the recogniser as a handful of blocks at
 * plausible-looking confidence, because the recogniser is confident about the
 * characters it thinks it saw; the failure is that it saw the wrong ones. There
 * is no confidence number that separates that from a good read, so the only
 * place to catch it is the pixel count, and the only time to catch it is before
 * a patient has waited forty seconds for a wrong answer.
 *
 * The check reads the file header rather than decoding the image. Three formats
 * and about sixty lines against a native image library in the dependency tree,
 * for a question that is answered entirely by two integers.
 */

/** A4 at 150 DPI is 1240x1754; a phone photograph of a page is larger again. */
const MIN_SHORT_EDGE_PX = 500;
const MIN_PIXELS = 400_000;

export interface ImageDimensions {
  width: number;
  height: number;
}

export type QualityVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Written for the patient. Never an engine's own words. */
      readonly message: string;
    };

/**
 * Whether this upload is legible enough to be worth reading.
 *
 * A PDF always passes. Its pages are rendered by the OCR sidecar at 144 DPI
 * whatever the page box says, so the dimensions of the file tell you nothing
 * about the dimensions the recogniser will see — and a PDF is usually a
 * generated document rather than a photograph, which is the case this gate
 * exists for.
 */
export function assessImageQuality(
  bytes: Buffer,
  mimeType: string,
): QualityVerdict {
  if (mimeType === 'application/pdf') return { ok: true };

  const dimensions = readImageDimensions(bytes);
  if (!dimensions) {
    // The declared type said image and the bytes disagree. That is a corrupt
    // or mislabelled file (§27), not a blurry one, so it gets its own sentence.
    return { ok: false, message: UNSUPPORTED_FILE };
  }

  const shortEdge = Math.min(dimensions.width, dimensions.height);
  const pixels = dimensions.width * dimensions.height;

  if (shortEdge < MIN_SHORT_EDGE_PX || pixels < MIN_PIXELS) {
    return { ok: false, message: IMAGE_TOO_SMALL };
  }

  return { ok: true };
}

/**
 * Width and height from the file header, or nothing.
 *
 * `undefined` means "these bytes are not one of the formats this route
 * accepts", which the caller treats as a corrupt upload rather than guessing.
 */
export function readImageDimensions(
  bytes: Buffer,
): ImageDimensions | undefined {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

/** PNG: the IHDR chunk is always first and always at a fixed offset. */
function readPng(bytes: Buffer): ImageDimensions | undefined {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    return undefined;
  }
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * JPEG: walk the marker chain to the first start-of-frame.
 *
 * There is no fixed offset to read. A photograph off a phone carries an EXIF
 * block, often a thumbnail, and sometimes an ICC profile ahead of the frame
 * header, and every one of those is a variable-length segment that has to be
 * skipped rather than assumed.
 */
function readJpeg(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = bytes[offset + 1];

    // Padding and the standalone markers carry no length field.
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return undefined;

    // SOF0..SOF15, minus the four that are not frame headers at all.
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return undefined;
}

/** WebP: three container variants, each with the size in a different place. */
function readWebp(bytes: Buffer): ImageDimensions | undefined {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('latin1') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('latin1') !== 'WEBP'
  ) {
    return undefined;
  }

  const format = bytes.subarray(12, 16).toString('latin1');

  if (format === 'VP8 ') {
    // Lossy: 14-bit dimensions after the three-byte start code.
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }

  if (format === 'VP8L') {
    // Lossless: two 14-bit fields packed across four bytes, both minus one.
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }

  if (format === 'VP8X') {
    // Extended: 24-bit fields, both minus one.
    const width = bytes.readUIntLE(24, 3) + 1;
    const height = bytes.readUIntLE(27, 3) + 1;
    return { width, height };
  }

  return undefined;
}
