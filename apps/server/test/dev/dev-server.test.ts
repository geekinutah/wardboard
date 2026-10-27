import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIXTURE_MEMBER_NAMES } from '@wardboard/core/fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { isSafeResetPath, parseDevPort, seedFixtureDataDir, startDevServer } from '../../dev/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import { openStore, type Store } from '../../src/store/index.ts';

/** Every temp directory this file creates, removed in afterAll. */
const tempDirs: string[] = [];

/** `dev-server.ts` lives in <repo>/apps/server/dev/; this file in <repo>/apps/server/test/dev/. */
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const INDEX_MARKER = 'wardboard-dev-index-marker';

async function makeTempDir(prefix = 'wb-t068-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeWebDir(): Promise<string> {
  const dir = await makeTempDir('wb-t068-web-');
  await writeFile(path.join(dir, 'index.html'), `<!doctype html><html><body>${INDEX_MARKER}</body></html>`);
  return dir;
}

/** A fresh handle on the data dir's database, for asserting what a run persisted. */
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

describe('seedFixtureDataDir', () => {
  it('first seed writes the fixture ward; second is existing', async () => {
    const dataDir = await makeTempDir();

    expect(seedFixtureDataDir(dataDir)).toBe('seeded');
    const first = openVerifiedStore(dataDir);
    expect(Object.keys(first.store.loadWard().members)).toHaveLength(FIXTURE_MEMBER_NAMES.length);
    expect(first.store.listProposals()).toHaveLength(1);
    first.close();

    // Seeding an already-initialized data dir must not duplicate or throw.
    expect(seedFixtureDataDir(dataDir)).toBe('existing');
    const second = openVerifiedStore(dataDir);
    expect(second.store.listProposals()).toHaveLength(1);
    expect(Object.keys(second.store.loadWard().members)).toHaveLength(FIXTURE_MEMBER_NAMES.length);
    second.close();
  });
});

describe('startDevServer', () => {
  it('dev server serves the app as the fictional admin', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();
    const running = await startDevServer({ dataDir, port: 0, webDir });
    try {
      // A bare request carrying no identity headers: the fixture provider must
      // identify the fictional admin and the admin must be bootstrapped.
      const res = await fetch(`${running.url}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(INDEX_MARKER);
      expect(running.seeded).toBe('seeded');
    } finally {
      await running.close();
    }
  });

  it('dev server binds loopback only', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();
    const running = await startDevServer({ dataDir, port: 0, webDir });
    try {
      expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(running.port).toBeGreaterThan(0);
    } finally {
      await running.close();
    }
  });

  it('reset wipes and reseeds a temp data dir', async () => {
    const dataDir = await makeTempDir();
    const webDir = await makeWebDir();

    const first = await startDevServer({ dataDir, port: 0, webDir });
    expect(first.seeded).toBe('seeded');
    await first.close();

    // Add a second proposal via the store, past the seed.
    const opened = openVerifiedStore(dataDir);
    let counter = 0;
    const created = opened.store.createProposal(
      { name: 'Extra proposal', rationale: null, source: { kind: 'current' } },
      () => `extra-${String(++counter)}`,
    );
    expect(created.ok).toBe(true);
    expect(opened.store.listProposals()).toHaveLength(2);
    opened.close();

    const second = await startDevServer({ dataDir, port: 0, webDir, reset: true });
    try {
      expect(second.seeded).toBe('seeded');
    } finally {
      await second.close();
    }

    const reopened = openVerifiedStore(dataDir);
    expect(reopened.store.listProposals()).toHaveLength(1);
    expect(Object.keys(reopened.store.loadWard().members)).toHaveLength(FIXTURE_MEMBER_NAMES.length);
    reopened.close();
  });
});

describe('isSafeResetPath', () => {
  it('reset guard accepts only data/dev or the temp dir', async () => {
    // Safe: exactly the repo's data/dev, and strictly inside the OS temp dir.
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev'))).toBe(true);
    expect(isSafeResetPath(path.join(os.tmpdir(), 'x'))).toBe(true);

    // Unsafe: the repo itself, its data dir, the filesystem root, the temp
    // dir itself (not strictly inside), a path escaping the temp dir through
    // `..`, and a sibling of data/dev (prefix match without a separator).
    expect(isSafeResetPath(repoRoot)).toBe(false);
    expect(isSafeResetPath(path.join(repoRoot, 'data'))).toBe(false);
    expect(isSafeResetPath('/')).toBe(false);
    expect(isSafeResetPath(os.tmpdir())).toBe(false);
    expect(isSafeResetPath(path.join(os.tmpdir(), '..', 'elsewhere'))).toBe(false);
    expect(isSafeResetPath(path.join(repoRoot, 'data', 'dev-other'))).toBe(false);

    // startDevServer with reset on an unsafe path throws and deletes nothing:
    // the temp dir itself is not *strictly inside* the temp dir, so it is unsafe.
    const child = await makeTempDir();
    const unsafeDir = path.dirname(child);
    const webDir = await makeWebDir();
    await expect(startDevServer({ dataDir: unsafeDir, port: 0, webDir, reset: true })).rejects.toThrow();
    await access(unsafeDir);
    await access(child);
  });
});

describe('parseDevPort', () => {
  it('WARDBOARD_DEV_PORT parsing: undefined defaults to 5180, invalid values error', () => {
    expect(parseDevPort(undefined)).toBe(5180);
    expect(parseDevPort('5180')).toBe(5180);
    expect(parseDevPort('1')).toBe(1);
    expect(parseDevPort('65535')).toBe(65535);
    expect(() => parseDevPort('0')).toThrow();
    expect(() => parseDevPort('70000')).toThrow();
    expect(() => parseDevPort('abc')).toThrow();
  });
});
