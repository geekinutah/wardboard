export type SanitizeResult =
  | { ok: true; bytes: Uint8Array; ext: 'jpg' | 'png' }
  | { ok: false; code: 'unsupported_type' | 'invalid_image' };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function mediaType(contentType: string): string {
  const separator = contentType.indexOf(';');
  const raw = separator === -1 ? contentType : contentType.slice(0, separator);
  return raw.trim().toLowerCase();
}

/**
 * JPEG segment length includes its own two bytes and excludes the marker.
 * A length below 2 is not a real segment.
 */
function sanitizeJpeg(bytes: Uint8Array): Uint8Array | null {
  const first = bytes[0];
  const second = bytes[1];
  if (bytes.length < 2 || first !== 0xff || second !== 0xd8) return null;

  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;
    if (marker === 0xda) {
      const endHi = bytes[bytes.length - 2];
      const endLo = bytes[bytes.length - 1];
      if (endHi !== 0xff || endLo !== 0xd9) return null;
      parts.push(bytes.subarray(offset));
      return concatBytes(parts);
    }
    if (offset + 4 > bytes.length) return null;
    const lengthHi = bytes[offset + 2];
    const lengthLo = bytes[offset + 3];
    if (lengthHi === undefined || lengthLo === undefined) return null;
    const segmentLength = lengthHi * 256 + lengthLo;
    if (segmentLength < 2) return null;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > bytes.length) return null;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }
  return null;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return null;
  return b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3;
}

function chunkType(bytes: Uint8Array, offset: number): string | null {
  let type = '';
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index];
    if (value === undefined) return null;
    type += String.fromCharCode(value);
  }
  return type;
}

function isDroppedPngChunk(type: string): boolean {
  return type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'eXIf' || type === 'tIME';
}

function sanitizePng(bytes: Uint8Array): Uint8Array | null {
  if (!hasPngSignature(bytes)) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
  let offset: number = PNG_SIGNATURE.length;
  let chunks = 0;
  let lastType = '';
  while (offset < bytes.length) {
    if (lastType === 'IEND') return null;
    const available = bytes.length - offset;
    if (available < 12) return null;
    const dataLength = readUint32(bytes, offset);
    if (dataLength === null || dataLength > available - 12) return null;
    const type = chunkType(bytes, offset + 4);
    if (type === null) return null;
    if (chunks === 0 && type !== 'IHDR') return null;
    const chunkEnd = offset + 12 + dataLength;
    if (!isDroppedPngChunk(type)) parts.push(bytes.subarray(offset, chunkEnd));
    lastType = type;
    chunks += 1;
    offset = chunkEnd;
  }
  if (lastType !== 'IEND') return null;
  return concatBytes(parts);
}

export function sanitizePhoto(bytes: Uint8Array, contentType: string): SanitizeResult {
  const media = mediaType(contentType);
  if (media === 'image/jpeg') {
    const sanitized = sanitizeJpeg(bytes);
    if (sanitized === null) return { ok: false, code: 'invalid_image' };
    return { ok: true, bytes: sanitized, ext: 'jpg' };
  }
  if (media === 'image/png') {
    const sanitized = sanitizePng(bytes);
    if (sanitized === null) return { ok: false, code: 'invalid_image' };
    return { ok: true, bytes: sanitized, ext: 'png' };
  }
  return { ok: false, code: 'unsupported_type' };
}
