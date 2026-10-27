import { describe, expect, it } from 'vitest';
import { sanitizePhoto } from '../../src/index.ts';
import {
  PNG_SIGNATURE,
  concatBytes,
  includesAscii,
  jpegOfSize,
  jpegSegment,
  metadataJpeg,
  metadataPng,
  minimalJpeg,
  minimalPng,
  pngChunk,
  pngChunkTypes,
  text,
} from './fixtures.ts';

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

describe('sanitizePhoto', () => {
  it('strips APP1, APP13 and COM from a JPEG and keeps APP0, APP2 and scan data', () => {
    const { original, kept } = metadataJpeg();
    const result = sanitizePhoto(original, 'image/jpeg');

    expect(result).toMatchObject({ ok: true, ext: 'jpg' });
    if (!result.ok) return;
    expect(sameBytes(result.bytes, kept)).toBe(true);
    expect(includesAscii(result.bytes, 'JFIF-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'ICC-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'SCAN-DATA-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'CANARY-IPTC')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-COM')).toBe(false);
  });

  it('output contains no canary bytes from removed JPEG segments', () => {
    const { original } = metadataJpeg();
    const result = sanitizePhoto(original, 'image/jpeg');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(includesAscii(original, 'CANARY-GPS-40.7N')).toBe(true);
    expect(includesAscii(result.bytes, 'CANARY-GPS-40.7N')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-IPTC')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-COM')).toBe(false);
  });

  it('strips tEXt, zTXt, iTXt, eXIf and tIME from a PNG and keeps IHDR, IDAT, IEND in order', () => {
    const { original, kept } = metadataPng();
    const result = sanitizePhoto(original, 'image/png');

    expect(result).toMatchObject({ ok: true, ext: 'png' });
    if (!result.ok) return;
    expect(pngChunkTypes(result.bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(sameBytes(result.bytes, kept)).toBe(true);
    expect(includesAscii(result.bytes, 'IHDR-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'IDAT-KEEP-IEND-INSIDE')).toBe(true);
    expect(includesAscii(result.bytes, 'CANARY-GPS-40.7N')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-ZTXT')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-ITXT')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-EXIF')).toBe(false);
    expect(includesAscii(result.bytes, 'CANARY-TIME')).toBe(false);
  });

  it('rejects type mismatch', () => {
    expect(sanitizePhoto(minimalPng(), 'image/jpeg')).toEqual({ ok: false, code: 'invalid_image' });
    expect(sanitizePhoto(minimalJpeg(), 'image/png')).toEqual({ ok: false, code: 'invalid_image' });
  });

  it('rejects unsupported types', () => {
    const jpeg = minimalJpeg();
    for (const contentType of ['image/gif', 'image/svg+xml', 'text/html', '']) {
      expect(sanitizePhoto(jpeg, contentType), contentType).toEqual({ ok: false, code: 'unsupported_type' });
    }
  });

  it('accepts content type case-insensitively with parameters', () => {
    const jpeg = minimalJpeg();
    const png = minimalPng();
    const jpegResult = sanitizePhoto(jpeg, 'Image/JPEG; charset=binary');
    const pngResult = sanitizePhoto(png, 'image/png ; charset=binary');

    expect(jpegResult).toMatchObject({ ok: true, ext: 'jpg' });
    expect(pngResult).toMatchObject({ ok: true, ext: 'png' });
    if (!jpegResult.ok || !pngResult.ok) return;
    expect(sameBytes(jpegResult.bytes, jpeg)).toBe(true);
    expect(sameBytes(pngResult.bytes, png)).toBe(true);
  });

  it('rejects malformed images', () => {
    const jpegCases = [
      new Uint8Array(),
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0x01),
      concatBytes([Uint8Array.of(0xff, 0xd8), jpegSegment(0xe0, text('JFIF'))]),
      Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x01, 0x02),
      Uint8Array.of(0xff, 0xd8, 0x00, 0xe0, 0x00, 0x04, 0x00, 0x00),
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00),
    ];
    for (const [index, bytes] of jpegCases.entries()) {
      expect(sanitizePhoto(bytes, 'image/jpeg'), `jpeg ${String(index)}`).toEqual({
        ok: false,
        code: 'invalid_image',
      });
    }

    const pngShort = concatBytes([
      PNG_SIGNATURE,
      Uint8Array.of(0x00, 0x00, 0x00, 0x20),
      text('IHDR'),
      Uint8Array.of(1, 2, 3, 4),
    ]);
    const pngCases = [
      new Uint8Array(),
      concatBytes([
        PNG_SIGNATURE,
        pngChunk('IDAT', text('not-first'), [1, 2, 3, 4]),
        pngChunk('IHDR', text('IHDR'), [5, 6, 7, 8]),
        pngChunk('IEND', new Uint8Array(), [9, 9, 9, 9]),
      ]),
      concatBytes([minimalPng(), Uint8Array.of(0x00)]),
      pngShort,
      concatBytes([
        PNG_SIGNATURE,
        pngChunk('IHDR', text('IHDR'), [1, 1, 1, 1]),
        pngChunk('IDAT', text('IDAT'), [2, 2, 2, 2]),
      ]),
    ];
    for (const [index, bytes] of pngCases.entries()) {
      expect(sanitizePhoto(bytes, 'image/png'), `png ${String(index)}`).toEqual({
        ok: false,
        code: 'invalid_image',
      });
    }

    expect(jpegOfSize(32).length).toBe(32);
    expect(sanitizePhoto(jpegOfSize(32), 'image/jpeg').ok).toBe(true);
  });
});
