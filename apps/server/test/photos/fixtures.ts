export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
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

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const length = data.length + 2;
  if (length > 0xffff) throw new Error('jpeg segment is too long');
  const out = new Uint8Array(2 + length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set(data, 4);
  return out;
}

export function pngChunk(
  type: string,
  data: Uint8Array,
  crc: readonly [number, number, number, number],
): Uint8Array {
  if (type.length !== 4) throw new Error('png chunk type must be 4 characters');
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  const crcAt = 8 + data.length;
  out[crcAt] = crc[0];
  out[crcAt + 1] = crc[1];
  out[crcAt + 2] = crc[2];
  out[crcAt + 3] = crc[3];
  return out;
}

/** APP0 contains an embedded FF DA so a scan for the first SOS marker would truncate it. */
export function metadataJpeg(): { original: Uint8Array; kept: Uint8Array } {
  const app0 = jpegSegment(0xe0, concatBytes([text('JFIF-KEEP'), Uint8Array.of(0xff, 0xda)]));
  const app1 = jpegSegment(0xe1, text('CANARY-GPS-40.7N'));
  const app1Again = jpegSegment(0xe1, text('CANARY-GPS-40.7N'));
  const app13 = jpegSegment(0xed, text('CANARY-IPTC'));
  const com = jpegSegment(0xfe, text('CANARY-COM'));
  const app2 = jpegSegment(0xe2, text('ICC-KEEP'));
  const scan = concatBytes([
    Uint8Array.of(0xff, 0xda, 0x00, 0x02),
    text('SCAN-DATA-KEEP'),
    Uint8Array.of(0xff, 0xd9),
  ]);
  const soi = Uint8Array.of(0xff, 0xd8);
  return {
    original: concatBytes([soi, app0, app1, app13, com, app2, app1Again, scan]),
    kept: concatBytes([soi, app0, app2, scan]),
  };
}

/** IDAT payload contains the letters IEND so a text search must not end the file early. */
export function metadataPng(): { original: Uint8Array; kept: Uint8Array } {
  const ihdr = pngChunk('IHDR', text('IHDR-KEEP'), [1, 2, 3, 4]);
  const textChunk = pngChunk('tEXt', text('CANARY-GPS-40.7N'), [5, 5, 5, 5]);
  const textAgain = pngChunk('tEXt', text('CANARY-GPS-40.7N'), [6, 6, 6, 6]);
  const ztxt = pngChunk('zTXt', text('CANARY-ZTXT'), [7, 7, 7, 7]);
  const itxt = pngChunk('iTXt', text('CANARY-ITXT'), [8, 8, 8, 8]);
  const exif = pngChunk('eXIf', text('CANARY-EXIF'), [9, 9, 9, 9]);
  const time = pngChunk('tIME', text('CANARY-TIME'), [10, 10, 10, 10]);
  const idat = pngChunk('IDAT', text('IDAT-KEEP-IEND-INSIDE'), [11, 12, 13, 14]);
  const iend = pngChunk('IEND', new Uint8Array(), [15, 16, 17, 18]);
  return {
    original: concatBytes([PNG_SIGNATURE, ihdr, textChunk, ztxt, itxt, exif, time, textAgain, idat, iend]),
    kept: concatBytes([PNG_SIGNATURE, ihdr, idat, iend]),
  };
}

export function minimalJpeg(): Uint8Array {
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
}

export function minimalPng(): Uint8Array {
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', text('IHDR'), [1, 1, 1, 1]),
    pngChunk('IDAT', text('IDAT'), [2, 2, 2, 2]),
    pngChunk('IEND', new Uint8Array(), [3, 3, 3, 3]),
  ]);
}

export function jpegOfSize(size: number): Uint8Array {
  if (size < 6) throw new Error('jpeg must include SOI, SOS, and EOI');
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xda;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

export function pngChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    let type = '';
    for (let index = 0; index < 4; index += 1) {
      const value = bytes[offset + 4 + index];
      if (value === undefined) return types;
      type += String.fromCharCode(value);
    }
    types.push(type);
    const next = offset + 12 + length;
    if (next <= offset) return types;
    offset = next;
  }
  return types;
}

export function includesAscii(bytes: Uint8Array, value: string): boolean {
  return Buffer.from(bytes).toString('latin1').includes(value);
}
