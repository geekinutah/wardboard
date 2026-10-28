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

/** Where a walker that treats the byte after one 0xFF as the marker would end that segment. */
function framedLengthEnd(bytes: Uint8Array, markerAt: number): number {
  const high = bytes[markerAt + 2] ?? 0;
  const low = bytes[markerAt + 3] ?? 0;
  return markerAt + 2 + (high * 256 + low);
}

/**
 * Independent of sanitizeJpeg. Extra 0xFF bytes are fill. TEM, RST, SOI, and EOI
 * have no length. Reserved markers and 0x00 stop the walk instead of consuming a length.
 */
function walkJpegMarkers(bytes: Uint8Array): { markers: number[]; offsets: number[]; sawSos: boolean } {
  const markers: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { markers, offsets, sawSos: false };
    offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) return { markers, offsets, sawSos: false };
    markers.push(marker);
    offsets.push(offset - 1);
    offset += 1;
    if (marker === 0xda) return { markers, offsets, sawSos: true };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (marker < 0xc0) return { markers, offsets, sawSos: false };
    if (offset + 2 > bytes.length) return { markers, offsets, sawSos: false };
    const lengthHi = bytes[offset];
    const lengthLo = bytes[offset + 1];
    if (lengthHi === undefined || lengthLo === undefined) return { markers, offsets, sawSos: false };
    const segmentLength = lengthHi * 256 + lengthLo;
    if (segmentLength < 2) return { markers, offsets, sawSos: false };
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > bytes.length) return { markers, offsets, sawSos: false };
    offset = segmentEnd;
  }
  return { markers, offsets, sawSos: false };
}

function exifApp1(canary: string): Uint8Array {
  return jpegSegment(0xe1, text(`Exif\0\0${canary}`));
}

function writeTerminatingSos(bytes: Uint8Array, sosAt: number): void {
  bytes[sosAt] = 0xff;
  bytes[sosAt + 1] = 0xda;
  bytes[sosAt + 2] = 0x00;
  bytes[sosAt + 3] = 0x02;
  const eoiAt = bytes.length - 2;
  bytes[eoiAt] = 0xff;
  bytes[eoiAt + 1] = 0xd9;
}

/**
 * FF D8, one fill FF, APP1, an early SOS, zeros, then a later SOS.
 * A one-byte marker read treats E1 00 as a length that lands on that later SOS.
 */
function fillByteApp1Jpeg(): Uint8Array {
  const earlySos = Uint8Array.of(0xff, 0xda, 0x00, 0x02);
  const head = concatBytes([Uint8Array.of(0xff, 0xd8, 0xff), exifApp1('CANARY-FILL-GPS'), earlySos]);
  const bytes = new Uint8Array(57610);
  if (head.length > 57604) throw new Error('fill-byte header overlaps the later SOS');
  bytes.set(head, 0);
  writeTerminatingSos(bytes, 57604);
  return bytes;
}

/** FF D8, a two-byte marker, APP1, zeros, then SOS. The false length is the APP1's FF E1. */
function paddedMarkerApp1Jpeg(markerCode: number, canary: string): Uint8Array {
  const head = concatBytes([Uint8Array.of(0xff, 0xd8, 0xff, markerCode), exifApp1(canary)]);
  const bytes = new Uint8Array(65515);
  if (head.length > 65509) throw new Error('padded header overlaps SOS');
  bytes.set(head, 0);
  writeTerminatingSos(bytes, 65509);
  return bytes;
}

function expectMetadataNotStored(bytes: Uint8Array, canary: string): void {
  const result = sanitizePhoto(bytes, 'image/jpeg');
  if (!result.ok) {
    expect(result).toEqual({ ok: false, code: 'invalid_image' });
    return;
  }
  expect(includesAscii(result.bytes, canary)).toBe(false);
  const walked = walkJpegMarkers(result.bytes);
  expect(walked.sawSos).toBe(true);
  expect(walked.markers).not.toContain(0xe1);
  expect(walked.markers).not.toContain(0xed);
  expect(walked.markers).not.toContain(0xfe);
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

  it('does not keep an APP1 hidden behind a JPEG fill byte', () => {
    const bytes = fillByteApp1Jpeg();
    const walked = walkJpegMarkers(bytes);
    const app1 = walked.markers.indexOf(0xe1);
    const sos = walked.markers.indexOf(0xda);

    expect(bytes.length).toBe(57610);
    expect(includesAscii(bytes, 'CANARY-FILL-GPS')).toBe(true);
    expect(framedLengthEnd(bytes, 2)).toBe(57604);
    expect(bytes[57604]).toBe(0xff);
    expect(bytes[57605]).toBe(0xda);
    expect(walked.sawSos).toBe(true);
    expect(app1).toBeGreaterThanOrEqual(0);
    expect(sos).toBeGreaterThan(app1);

    expectMetadataNotStored(bytes, 'CANARY-FILL-GPS');
  });

  it('does not keep an APP1 hidden behind a JPEG RST0 marker', () => {
    const bytes = paddedMarkerApp1Jpeg(0xd0, 'CANARY-RST-GPS');
    const walked = walkJpegMarkers(bytes);
    const app1 = walked.markers.indexOf(0xe1);

    expect(bytes.length).toBe(65515);
    expect(includesAscii(bytes, 'CANARY-RST-GPS')).toBe(true);
    expect(bytes[2]).toBe(0xff);
    expect(bytes[3]).toBe(0xd0);
    expect(bytes[4]).toBe(0xff);
    expect(bytes[5]).toBe(0xe1);
    expect(framedLengthEnd(bytes, 2)).toBe(65509);
    expect(bytes[65509]).toBe(0xff);
    expect(bytes[65510]).toBe(0xda);
    expect(walked.offsets[app1]).toBe(4);
    expect(walked.markers).toContain(0xd0);
    expect(walked.sawSos).toBe(false);

    expectMetadataNotStored(bytes, 'CANARY-RST-GPS');
  });

  it('does not keep an APP1 hidden behind TEM, RST7, SOI, or EOI', () => {
    const cases = [
      { code: 0x01, canary: 'CANARY-TEM-GPS' },
      { code: 0xd7, canary: 'CANARY-RST7-GPS' },
      { code: 0xd8, canary: 'CANARY-SOI-GPS' },
      { code: 0xd9, canary: 'CANARY-EOI-GPS' },
    ];
    for (const { code, canary } of cases) {
      const bytes = paddedMarkerApp1Jpeg(code, canary);
      const walked = walkJpegMarkers(bytes);
      expect(framedLengthEnd(bytes, 2), canary).toBe(65509);
      expect(walked.markers, canary).toContain(0xe1);
      expect(walked.offsets[walked.markers.indexOf(0xe1)], canary).toBe(4);
      expectMetadataNotStored(bytes, canary);
    }
  });

  it('does not keep an APP1 hidden behind a stuffed byte or a reserved marker', () => {
    const cases = [
      { code: 0x00, canary: 'CANARY-STUFF-GPS' },
      { code: 0x02, canary: 'CANARY-RES-GPS' },
    ];
    for (const { code, canary } of cases) {
      const bytes = paddedMarkerApp1Jpeg(code, canary);
      expect(bytes[3], canary).toBe(code);
      expect(framedLengthEnd(bytes, 2), canary).toBe(65509);
      expect(includesAscii(bytes, canary), canary).toBe(true);
      expectMetadataNotStored(bytes, canary);
    }
  });

  it('keeps APP0 and scan data when fill bytes precede segments', () => {
    const app1 = exifApp1('CANARY-FILL-GPS');
    const app0 = jpegSegment(0xe0, text('JFIF-KEEP'));
    const scan = concatBytes([
      Uint8Array.of(0xff, 0xda, 0x00, 0x02),
      text('SCAN-DATA-KEEP'),
      Uint8Array.of(0xff, 0xd9),
    ]);
    const original = concatBytes([Uint8Array.of(0xff, 0xd8, 0xff), app1, Uint8Array.of(0xff), app0, scan]);
    const result = sanitizePhoto(original, 'image/jpeg');

    expect(result).toMatchObject({ ok: true, ext: 'jpg' });
    if (!result.ok) return;
    expect(includesAscii(result.bytes, 'JFIF-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'SCAN-DATA-KEEP')).toBe(true);
    expect(includesAscii(result.bytes, 'CANARY-FILL-GPS')).toBe(false);
    const walked = walkJpegMarkers(result.bytes);
    expect(walked.sawSos).toBe(true);
    expect(walked.markers).toContain(0xe0);
    expect(walked.markers).not.toContain(0xe1);
    expect(walked.markers).not.toContain(0xed);
    expect(walked.markers).not.toContain(0xfe);
  });
});
