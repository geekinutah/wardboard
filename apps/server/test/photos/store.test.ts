import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhotoStore } from '../../src/index.ts';

const readAttempts: string[] = [];

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      const target = args[0];
      readAttempts.push(typeof target === 'string' ? target : 'non-string');
      return actual.readFile(...args);
    }) as typeof actual.readFile,
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-photo-store-'));
  tempDirs.push(dir);
  return dir;
}

describe('createPhotoStore', () => {
  it('put returns sha256-hex.ext and read returns identical bytes and content type', async () => {
    const dataDir = await makeTemp();
    const photosDir = path.join(dataDir, 'photos');
    const bytes = Uint8Array.of(1, 2, 3, 4, 5);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const store = createPhotoStore(dataDir);

    expect(existsSync(photosDir)).toBe(false);
    const jpg = await store.put(bytes, 'jpg');
    const png = await store.put(bytes, 'png');

    expect(existsSync(photosDir)).toBe(true);
    expect(jpg).toBe(`${hash}.jpg`);
    expect(png).toBe(`${hash}.png`);

    const jpgRead = await store.read(jpg);
    const pngRead = await store.read(png);
    expect(jpgRead).not.toBeNull();
    expect(pngRead).not.toBeNull();
    if (jpgRead === null || pngRead === null) return;
    expect(jpgRead.contentType).toBe('image/jpeg');
    expect(pngRead.contentType).toBe('image/png');
    expect(jpgRead.bytes.equals(Buffer.from(bytes))).toBe(true);
    expect(pngRead.bytes.equals(Buffer.from(bytes))).toBe(true);
  });

  it('same bytes twice → same ref, one file, no .tmp- leftovers', async () => {
    const dataDir = await makeTemp();
    const bytes = Uint8Array.of(9, 8, 7, 6);
    const store = createPhotoStore(dataDir);

    const first = await store.put(bytes, 'jpg');
    const second = await store.put(bytes, 'jpg');
    const names = await readdir(path.join(dataDir, 'photos'));

    expect(second).toBe(first);
    expect(names).toEqual([first]);
    expect(names.some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  it('read rejects traversal and malformed refs without filesystem access', async () => {
    const dataDir = await makeTemp();
    const photosDir = path.join(dataDir, 'photos');
    const hex = 'cd'.repeat(32);
    const uppercase = `${'A'.repeat(64)}.jpg`;
    const gif = `${hex}.gif`;
    await mkdir(photosDir, { recursive: true });
    await writeFile(path.join(dataDir, 'x'), 'CANARY-OUTSIDE-PHOTOS');
    await writeFile(path.join(photosDir, 'x'), 'CANARY-NESTED');
    await writeFile(path.join(photosDir, uppercase), 'CANARY-UPPER');
    await writeFile(path.join(photosDir, gif), 'CANARY-GIF');
    const store = createPhotoStore(dataDir);
    const refs = ['../x', uppercase, gif, `${hex}.jpg/../x`];

    readAttempts.length = 0;
    for (const ref of refs) {
      const loaded = await store.read(ref);
      expect(loaded, ref).toBeNull();
    }
    expect(readAttempts).toEqual([]);
  });

  it('read of a well-formed unknown ref → null', async () => {
    const dataDir = await makeTemp();
    const store = createPhotoStore(dataDir);
    const missing = `${'ab'.repeat(32)}.jpg`;

    await expect(store.read(missing)).resolves.toBeNull();
  });
});
