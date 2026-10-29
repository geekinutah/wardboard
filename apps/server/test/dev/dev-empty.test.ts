import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isSafeResetPath, parseDevArgs, seedFixtureDataDir, startDevServer } from '../../dev/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import { openStore, type Store } from '../../src/store/index.ts';

/** Every temp directory this file creates, removed in afterAll. */
const tempDirs: string[] = [];

/** This file lives in <repo>/apps/server/test/dev/. */
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const INDEX_MARKER = 'wardboard-dev-empty-index-marker';

async function makeTempDir(prefix = 'wb-t104-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeWebDir(): Promise<string> {
  const dir = await makeTempDir('wb-t104-web-');
  await writeFile(path.join(dir, 'index.html'), `<!doctype html><html><body>${INDEX_MARKER}</body></html>`);
  return dir;
}

function openVerifiedStore(dataDir: string): { store: Store; close(): void } {
  const db = openDatabase(databasePath(dataDir));
  migrate(db);
  return {
    store: openStore(db, () => new Date()),
    close: () => {
      db.close();
    },
  };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('unseeded dev server', () => {
  it('an unseeded dev server has no Current', async () => {
    const dataDir = path.join(await makeTempDir(), 'fresh');
    const webDir = await makeWebDir();
    const running = await startDevServer({ dataDir, port: 0, webDir, seed: false });
    try {
      const res = await fetch(`${running.url}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(INDEX_MARKER);
      expect(running.seeded).toBe('unseeded');
    } finally {
      await running.close();
    }
    const verified = openVerifiedStore(dataDir);
    expect(verified.store.loadCurrent()).toBeNull();
    expect(Object.keys(verified.store.loadWard().members)).toHaveLength(0);
    verified.close();
  });

  it('an unseeded dev server stays unseeded on restart', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();
    for (let run = 0; run < 2; run += 1) {
      const running = await startDevServer({ dataDir, port: 0, webDir, seed: false });
      expect(running.seeded).toBe('unseeded');
      await running.close();
    }
    const verified = openVerifiedStore(dataDir);
    expect(verified.store.loadCurrent()).toBeNull();
    verified.close();
  });

  it('reset with seed false wipes without reseeding', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();
    expect(seedFixtureDataDir(dataDir)).toBe('seeded');
    const running = await startDevServer({ dataDir, port: 0, webDir, reset: true, seed: false });
    await running.close();
    const verified = openVerifiedStore(dataDir);
    expect(verified.store.loadCurrent()).toBeNull();
    expect(Object.keys(verified.store.loadWard().members)).toHaveLength(0);
    verified.close();
  });

  it('seed defaults to true', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();
    const running = await startDevServer({ dataDir, port: 0, webDir });
    expect(running.seeded).toBe('seeded');
    await running.close();
    const verified = openVerifiedStore(dataDir);
    expect(verified.store.loadCurrent()).not.toBeNull();
    verified.close();
  });
});

describe('parseDevArgs', () => {
  it('parseDevArgs reads --empty and --reset', () => {
    expect(parseDevArgs([])).toEqual({ reset: false, empty: false });
    expect(parseDevArgs(['--empty'])).toEqual({ reset: false, empty: true });
    expect(parseDevArgs(['--reset'])).toEqual({ reset: true, empty: false });
    expect(parseDevArgs(['--', '--empty', '--reset'])).toEqual({ reset: true, empty: true });
    expect(parseDevArgs(['--', '--bogus', 'x'])).toEqual({ reset: false, empty: false });
  });
});

describe('isSafeResetPath for data/dev-empty', () => {
  it('reset guard also accepts data/dev-empty only', () => {
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev-empty'))).toBe(true);
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev'))).toBe(true);
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev-empty-x'))).toBe(false);
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev-empty', '..', 'dev-other'))).toBe(false);
    expect(isSafeResetPath(path.join(repoRoot, 'data'))).toBe(false);
  });
});
