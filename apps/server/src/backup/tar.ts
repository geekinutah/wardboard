export type TarEntry = {
  name: string;
  bytes: Buffer;
};

export type TarReadResult =
  | { ok: true; entries: TarEntry[] }
  | { ok: false; error: 'invalid_archive' };

const BLOCK = 512;

const invalid: TarReadResult = { ok: false, error: 'invalid_archive' };

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const digits = value.toString(8).padStart(length - 1, '0');
  if (digits.length !== length - 1) throw new Error('tar numeric field overflow');
  header.write(digits, offset, 'ascii');
  header[offset + length - 1] = 0;
}

function placeName(header: Buffer, name: string): void {
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.includes(0)) throw new Error('tar name contains NUL');
  if (bytes.length <= 100) {
    bytes.copy(header, 0);
    return;
  }
  let splitAt = -1;
  for (let index = 0; index < name.length; index += 1) {
    if (name[index] !== '/') continue;
    const prefix = Buffer.byteLength(name.slice(0, index));
    const rest = Buffer.byteLength(name.slice(index + 1));
    if (prefix > 0 && prefix <= 155 && rest > 0 && rest <= 100) splitAt = index;
  }
  if (splitAt < 0) throw new Error('tar name too long');
  header.write(name.slice(0, splitAt), 345, 'utf8');
  header.write(name.slice(splitAt + 1), 0, 'utf8');
}

function writeChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += header[index] ?? 0;
  const digits = sum.toString(8).padStart(6, '0');
  header.write(digits, 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
}

function headerFor(entry: TarEntry): Buffer {
  const header = Buffer.alloc(BLOCK);
  placeName(header, entry.name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, 0);
  header[156] = 0x30;
  header.write('ustar', 257, 'ascii');
  header.write('00', 263, 'ascii');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeChecksum(header);
  return header;
}

export function writeTar(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(headerFor(entry));
    if (entry.bytes.length === 0) continue;
    parts.push(entry.bytes);
    const remainder = entry.bytes.length % BLOCK;
    if (remainder !== 0) parts.push(Buffer.alloc(BLOCK - remainder));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function isZero(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
}

function parseOctal(field: Uint8Array): number | null {
  let text = '';
  for (const byte of field) {
    if (byte === 0 || byte === 0x20) continue;
    if (byte < 0x30 || byte > 0x37) return null;
    text += String.fromCharCode(byte);
  }
  if (text.length === 0) return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function headerChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return sum;
}

function fieldText(field: Uint8Array): string | null {
  const end = field.indexOf(0);
  const slice = end === -1 ? field : field.subarray(0, end);
  return Buffer.from(slice).toString('utf8');
}

function entryName(header: Uint8Array): string | null {
  const name = fieldText(header.subarray(0, 100));
  const prefix = fieldText(header.subarray(345, 500));
  if (name === null || prefix === null || name.length === 0) return null;
  const full = prefix.length === 0 ? name : `${prefix}/${name}`;
  if (full.startsWith('/') || full.endsWith('/') || full.includes('..') || full.includes('\0')) return null;
  return full;
}

export function readTar(input: Uint8Array): TarReadResult {
  if (input.length % BLOCK !== 0) return invalid;
  const data = Buffer.from(input);
  const entries: TarEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < data.length) {
    const header = data.subarray(offset, offset + BLOCK);
    if (isZero(header)) {
      if (!isZero(data.subarray(offset))) return invalid;
      break;
    }
    if (headerChecksum(header) !== parseOctal(header.subarray(148, 156))) return invalid;
    const typeflag = header[156];
    if (typeflag !== 0 && typeflag !== 0x30) return invalid;
    const name = entryName(header);
    if (name === null || seen.has(name)) return invalid;
    seen.add(name);

    const size = parseOctal(header.subarray(124, 136));
    if (size === null) return invalid;
    const padded = size === 0 ? 0 : Math.ceil(size / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(padded) || padded > data.length - offset - BLOCK) return invalid;
    offset += BLOCK;
    entries.push({ name, bytes: Buffer.from(data.subarray(offset, offset + size)) });
    offset += padded;
  }

  return { ok: true, entries };
}
