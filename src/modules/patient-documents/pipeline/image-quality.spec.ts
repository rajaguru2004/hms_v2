import { readFileSync } from 'fs';
import { join } from 'path';

import { assessImageQuality, readImageDimensions } from './image-quality';
import { IMAGE_TOO_SMALL, UNSUPPORTED_FILE } from './messages';

const FIXTURES = join(__dirname, '../../../../test/fixtures');

/** Minimal valid headers, so the parsers are tested and not the decoders. */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegHeader(width: number, height: number): Buffer {
  // SOI, then an APP1 segment of a length that has to be skipped to reach SOF0.
  const app1 = Buffer.alloc(20);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(18, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof]);
}

describe('image dimensions, from the header alone', () => {
  it('reads a PNG', () => {
    expect(readImageDimensions(pngHeader(1240, 1754))).toEqual({
      width: 1240,
      height: 1754,
    });
  });

  it('reads a JPEG past a variable-length EXIF segment', () => {
    expect(readImageDimensions(jpegHeader(3024, 4032))).toEqual({
      width: 3024,
      height: 4032,
    });
  });

  it('reads the real fixtures off disk', () => {
    expect(
      readImageDimensions(readFileSync(join(FIXTURES, 'prescription.png'))),
    ).toEqual({ width: 1240, height: 1754 });
    expect(
      readImageDimensions(readFileSync(join(FIXTURES, 'too-small.png'))),
    ).toEqual({ width: 220, height: 311 });
  });

  it('says nothing about bytes it does not recognise', () => {
    expect(
      readImageDimensions(Buffer.from('not an image at all')),
    ).toBeUndefined();
  });
});

describe('quality gate, before OCR rather than after', () => {
  it('passes a page-sized photograph', () => {
    expect(assessImageQuality(pngHeader(1240, 1754), 'image/png')).toEqual({
      ok: true,
    });
  });

  it('refuses a thumbnail, in words a patient can act on', () => {
    const verdict = assessImageQuality(pngHeader(220, 311), 'image/png');

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.message).toBe(IMAGE_TOO_SMALL);
    expect(verdict.message).toMatch(/please/i);
    // §27: never an engine's own words.
    expect(verdict.message).not.toMatch(/ocr|inference|exception|null|error/i);
  });

  it('refuses a wide but shallow strip', () => {
    // 4000x200 clears the pixel floor and is still not a page.
    expect(assessImageQuality(pngHeader(4000, 200), 'image/png').ok).toBe(
      false,
    );
  });

  it('treats a file whose bytes contradict its type as a corrupt upload', () => {
    const verdict = assessImageQuality(
      Buffer.from('%PDF-1.7 ...'),
      'image/png',
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.message).toBe(UNSUPPORTED_FILE);
  });

  it('lets a PDF through without measuring it', () => {
    // The sidecar renders PDF pages at 144 DPI whatever the page box says, so
    // the file's own dimensions predict nothing about what the recogniser sees.
    expect(
      assessImageQuality(Buffer.from('%PDF-1.7'), 'application/pdf'),
    ).toEqual({ ok: true });
  });
});
