import { describe, expect, it } from 'vitest';
import { readTar, writeTar, type TarEntry } from '../../src/backup/tar.ts';

const BLOCK = 512;

function fillChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += header[index] ?? 0;
  }
  const digits = sum.toString(8).padStart(6, '0');
  header.write(digits, 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
}

/** A one-entry archive based on our writer, with the header mutated and the checksum recomputed. */
function mutated(mutate: (header: Buffer) => void): Buffer {
  const archive = writeTar([{ name: 'regular.txt', bytes: Buffer.alloc(0) }]);
  const header = Buffer.from(archive.subarray(0, BLOCK));
  mutate(header);
  fillChecksum(header);
  return Buffer.concat([header, Buffer.alloc(BLOCK * 2)]);
}

function expectInvalid(archive: Uint8Array): void {
  const read = readTar(archive);
  expect(read).toEqual({ ok: false, error: 'invalid_archive' });
}

describe('tar', () => {
  it('round-trips entries byte-for-byte including a 0-byte file and a file whose size is a multiple of 512', () => {
    const entries: TarEntry[] = [
      { name: 'empty.bin', bytes: Buffer.alloc(0) },
      { name: 'block.bin', bytes: Buffer.alloc(512, 0x7a) },
      { name: 'odd.bin', bytes: Buffer.from('odd-bytes') },
    ];

    const archive = writeTar(entries);

    expect(archive.length % BLOCK).toBe(0);
    const read = readTar(archive);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    for (let index = 0; index < entries.length; index += 1) {
      const expected = entries[index];
      const actual = read.entries[index];
      expect(actual).toBeDefined();
      if (expected === undefined || actual === undefined) return;
      expect(actual.bytes.equals(expected.bytes)).toBe(true);
    }
  });

  it('rejects directory, symlink and hardlink entries, ../ and absolute names, duplicates, bad checksum, truncated entry', () => {
    const readable = mutated((header) => {
      header[156] = '0'.charCodeAt(0);
    });
    const control = readTar(readable);
    expect(control.ok).toBe(true);
    if (!control.ok) return;
    expect(control.entries[0]?.name).toBe('regular.txt');

    expectInvalid(mutated((header) => {
      header[156] = '5'.charCodeAt(0);
    }));
    expectInvalid(mutated((header) => {
      header[156] = '2'.charCodeAt(0);
      header.write('target', 157, 'ascii');
    }));
    expectInvalid(mutated((header) => {
      header[156] = '1'.charCodeAt(0);
      header.write('target', 157, 'ascii');
    }));
    expectInvalid(mutated((header) => {
      header.fill(0, 0, 100);
      header.write('../secret', 0, 'ascii');
    }));
    expectInvalid(mutated((header) => {
      header.fill(0, 0, 100);
      header.write('/etc/passwd', 0, 'ascii');
    }));

    const duplicate = writeTar([
      { name: 'same.txt', bytes: Buffer.from('one') },
      { name: 'same.txt', bytes: Buffer.from('two') },
    ]);
    expectInvalid(duplicate);

    const valid = writeTar([{ name: 'note.txt', bytes: Buffer.from('hello') }]);
    const badChecksum = Buffer.from(valid);
    const checksumByte = badChecksum[148] ?? 0;
    badChecksum[148] = checksumByte === 0x30 ? 0x31 : 0x30;
    expectInvalid(badChecksum);

    expectInvalid(valid.subarray(0, BLOCK + 2));
  });
});
