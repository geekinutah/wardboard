import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

/**
 * Tiny generated images for the fictional directory. They are not photos of
 * anyone: each is a 1x1 PNG of a seed-derived colour, or a signature-valid
 * JPEG byte stream whose comment segment carries the seed.
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function png(seed: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const pixel = Buffer.from([0, seed & 0xff, (seed * 7) & 0xff, (seed * 13) & 0xff]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

export function jpeg(seed: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    jpegSegment(0xfe, Buffer.from(`fixture-${String(seed)}`, 'latin1')),
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
