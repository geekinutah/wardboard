import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  createProposal,
  proposalId,
  sequentialIds,
  userId,
  type Board,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBackup,
  createPhotoStore,
  openStore,
  readTar,
  restoreBackup,
  writeTar,
  type BackupSummary,
  type TarEntry,
} from '../../src/index.ts';
import { databasePath, migrate, migrations, openDatabase } from '../../src/db/index.ts';
import type { Store } from '../../src/store/index.ts';

const CLOCK_ISO = '2026-07-01T15:04:05.000Z';

const databases: DatabaseSync[] = [];
const directories: string[] = [];

function clock(): Date {
  return new Date(CLOCK_ISO);
}

function serverSchemaVersion(): number {
  return migrations.reduce((highest, migration) => Math.max(highest, migration.id), 0);
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function makeData(): Promise<{ root: string; dataDir: string; db: DatabaseSync }> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-backup-'));
  directories.push(root);
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  return { root, dataDir, db };
}

function insertUser(db: DatabaseSync, id: string, login: string, role: 'admin' | 'editor'): void {
  db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, login, id, role, CLOCK_ISO);
}

function mustStore<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function mustCore<T>(result: { ok: true; value: T } | { ok: false; errors: readonly { message: string }[] }): T {
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

function quoteName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unexpected table ${name}`);
  return `"${name}"`;
}

function contentSignature(db: DatabaseSync): string {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((row) => {
      const name = row['name'];
      if (typeof name !== 'string') throw new Error('table name is not text');
      return name;
    });
  const dump: unknown[] = [];
  for (const table of tables) {
    dump.push([table, db.prepare(`SELECT * FROM ${quoteName(table)} ORDER BY rowid`).all()]);
  }
  return JSON.stringify(dump);
}

async function photoSignature(dataDir: string): Promise<string> {
  const directory = path.join(dataDir, 'photos');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error: unknown) {
    if (isEnoent(error)) return '[]';
    throw error;
  }
  names.sort();
  const files: [string, string][] = [];
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name));
    files.push([name, bytes.toString('base64')]);
  }
  return JSON.stringify(files);
}

async function stateOf(dataDir: string, db: DatabaseSync): Promise<string> {
  return `${contentSignature(db)}\n${await photoSignature(dataDir)}`;
}

async function dotFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name.startsWith('.')) found.push(path.relative(root, full));
    }
  }
  await walk(root);
  return found;
}

function countOf(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params);
  const value = row?.['n'];
  if (typeof value !== 'number') throw new Error(`expected a count from ${sql}`);
  return value;
}

type Seed = {
  root: string;
  dataDir: string;
  db: DatabaseSync;
  store: Store;
  ward: Ward;
  current: Board;
  draft: Proposal;
  accepted: Proposal;
  jpg: string;
  png: string;
};

async function seedFixture(): Promise<Seed> {
  const { root, dataDir, db } = await makeData();
  const store = openStore(db, clock);
  insertUser(db, 'admin-1', 'admin@example.test', 'admin');
  insertUser(db, 'approver', 'approver@example.test', 'editor');
  db.prepare(
    `INSERT INTO invitations (id, login, invited_by, created_at, revoked_at)
     VALUES ('inv-1', 'guest@example.test', 'admin-1', ?, NULL)`,
  ).run(CLOCK_ISO);

  const built = buildFixtureWard();
  const members = Object.values(built.ward.members);
  const first = members[0];
  const second = members[1];
  if (first === undefined || second === undefined) throw new Error('fixture ward has no members');
  const photos = createPhotoStore(dataDir);
  const jpg = await photos.put(Buffer.from('fictional-jpg-portrait'), 'jpg');
  const png = await photos.put(Buffer.from('fictional-png-portrait'), 'png');
  const ward: Ward = {
    ...built.ward,
    members: {
      ...built.ward.members,
      [first.id]: { ...first, photoRef: jpg },
      [second.id]: { ...second, photoRef: png },
    },
  };
  mustStore(store.initialize({ ward, current: built.current, importVersion: 'fixture' }));
  store.setShowNeedsApproval(true);
  const draft = mustStore(
    store.createProposal(
      { name: 'Spring draft', rationale: 'A fictional draft.', source: { kind: 'current' } },
      sequentialIds('draft'),
    ),
  );
  const organ = placed(built.current, 'Organist');
  const approval = {
    memberId: organ.memberId,
    positionId: organ.positionId,
    approvedBy: userId('approver'),
    approvedAt: CLOCK_ISO,
  };
  const acceptedInput = buildFixtureProposal(built.current, ward, {
    id: proposalId('pr-accepted'),
    name: 'Accepted plan',
    tabOrder: 1,
  });
  const accepted = mustCore(
    createProposal(
      {
        ...acceptedInput,
        status: 'accepted',
        accepted: { by: userId('approver'), at: CLOCK_ISO, summary: 'Frozen summary.' },
        baseline: { ...acceptedInput.baseline, approvals: [approval] },
        board: { ...acceptedInput.board, approvals: [approval] },
      },
      ward,
    ),
  );
  mustStore(store.insertProposal(accepted));
  db.prepare(`UPDATE schema_migrations SET applied_at = '2020-01-02T03:04:05.000Z' WHERE id = 1`).run();
  const loadedDraft = store.loadProposal(draft.id);
  const loadedAccepted = store.loadProposal(accepted.id);
  if (loadedDraft === null || loadedAccepted === null) throw new Error('seeded proposal did not load');
  return {
    root,
    dataDir,
    db,
    store,
    ward: store.loadWard(),
    current: built.current,
    draft: loadedDraft,
    accepted: loadedAccepted,
    jpg,
    png,
  };
}

function placed(board: Board, title: string): { memberId: Board['placements'][keyof Board['placements']]; positionId: keyof Board['placements'] & string } {
  const assignment = Object.values(board.assignments).find((item) => item.title === title);
  if (assignment === undefined) throw new Error(`no assignment titled ${title}`);
  const position = Object.values(board.positions).find(
    (item) => item.assignmentId === assignment.id && Object.hasOwn(board.placements, item.id),
  );
  if (position === undefined) throw new Error(`no occupant for ${title}`);
  const memberId = board.placements[position.id];
  if (memberId === undefined) throw new Error(`no occupant for ${title}`);
  return { memberId, positionId: position.id };
}

function mustRead(archive: Uint8Array): TarEntry[] {
  const read = readTar(archive);
  if (!read.ok) throw new Error('expected a readable archive');
  return read.entries;
}

function replaceEntry(entries: readonly TarEntry[], name: string, bytes: Buffer): TarEntry[] {
  return entries.map((entry) => (entry.name === name ? { name, bytes } : entry));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

function manifestBytes(entries: readonly TarEntry[], patch: (manifest: Record<string, unknown>) => void): Buffer {
  const entry = entries.find((item) => item.name === 'manifest.json');
  if (entry === undefined) throw new Error('missing manifest');
  const manifest = asRecord(JSON.parse(entry.bytes.toString('utf8')) as unknown);
  patch(manifest);
  return Buffer.from(JSON.stringify(manifest));
}

async function editSqlite(root: string, bytes: Buffer, edit: (db: DatabaseSync) => void): Promise<Buffer> {
  const file = path.join(root, `edit-${randomBytes(4).toString('hex')}.sqlite`);
  await writeFile(file, bytes);
  const db = new DatabaseSync(file);
  try {
    edit(db);
  } finally {
    db.close();
  }
  try {
    return await readFile(file);
  } finally {
    await rm(file, { force: true });
  }
}

function sqliteEntry(entries: readonly TarEntry[]): Buffer {
  const entry = entries.find((item) => item.name === 'wardboard.sqlite');
  if (entry === undefined) throw new Error('missing sqlite entry');
  return Buffer.from(entry.bytes);
}

async function olderArchive(root: string): Promise<Buffer> {
  const dataDir = path.join(root, 'older');
  await mkdir(dataDir);
  const db = openDatabase(databasePath(dataDir));
  try {
    const older = migrations.slice(0, -1);
    const last = older[older.length - 1];
    if (last === undefined) throw new Error('server has no older migration');
    migrate(db, older);
    insertUser(db, 'old-admin', 'old-admin@example.test', 'admin');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('PRAGMA journal_mode = DELETE');
    const version = last.id;
    const sqlite = await readFile(databasePath(dataDir));
    const manifest = {
      format: 'wardboard-backup',
      formatVersion: 1,
      createdAt: CLOCK_ISO,
      schemaVersion: version,
      photos: [],
    };
    return writeTar([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'wardboard.sqlite', bytes: sqlite },
    ]);
  } finally {
    db.close();
  }
}

describe('backup', () => {
  it('backup → restore into a fresh data dir reproduces members, tags, users, settings, Current, every proposal (status, accepted summary, approvals) and photo bytes', async () => {
    const source = await seedFixture();
    const archive = await createBackup(source.dataDir, clock);
    expect(await dotFiles(source.dataDir)).toEqual([]);

    const fresh = await makeData();
    const restored = await restoreBackup(fresh.db, fresh.dataDir, archive, { mode: 'apply' });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const freshStore = openStore(fresh.db, clock);
    expect(freshStore.loadWard()).toEqual(source.store.loadWard());
    expect(freshStore.loadCurrent()).toEqual(source.store.loadCurrent());
    expect(freshStore.loadSettings()).toEqual({ showNeedsApproval: true });
    const draft = freshStore.loadProposal(source.draft.id);
    const accepted = freshStore.loadProposal(source.accepted.id);
    expect(draft).toEqual(source.draft);
    expect(accepted).toEqual(source.accepted);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.accepted?.summary).toBe('Frozen summary.');
    expect(accepted?.board.approvals).toEqual(source.accepted.board.approvals);
    expect(accepted?.baseline.approvals).toEqual(source.accepted.baseline.approvals);
    expect(draft?.status).toBe('draft');
    expect(draft?.accepted).toBeNull();

    const users = fresh.db.prepare('SELECT id, login, role, revoked_at FROM users ORDER BY id').all();
    expect(users).toEqual(source.db.prepare('SELECT id, login, role, revoked_at FROM users ORDER BY id').all());
    expect(contentSignature(fresh.db)).toBe(contentSignature(source.db));

    const photos = createPhotoStore(fresh.dataDir);
    const jpg = await photos.read(source.jpg);
    const png = await photos.read(source.png);
    expect(jpg?.bytes.equals(Buffer.from('fictional-jpg-portrait'))).toBe(true);
    expect(png?.bytes.equals(Buffer.from('fictional-png-portrait'))).toBe(true);
    expect(await photoSignature(fresh.dataDir)).toBe(await photoSignature(source.dataDir));
    expect(await dotFiles(fresh.dataDir)).toEqual([]);
    expect(restored.summary).toEqual({
      createdAt: CLOCK_ISO,
      schemaVersion: serverSchemaVersion(),
      members: Object.keys(source.ward.members).length,
      proposals: 2,
      users: 2,
      photos: 2,
      hasCurrent: true,
    } satisfies BackupSummary);
  });

  it('backup taken while a write transaction is open in another connection is consistent and excludes the uncommitted row', async () => {
    const { dataDir, db } = await makeData();
    insertUser(db, 'admin-1', 'admin@example.test', 'admin');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('committed-marker', 'true')`).run();
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('pending-marker', 'true')`).run();

    const archive = await createBackup(dataDir, clock);
    const liveFile = await readFile(databasePath(dataDir));
    const entries = mustRead(archive);
    const snapshot = sqliteEntry(entries);
    expect(snapshot.equals(liveFile)).toBe(false);

    const snapPath = path.join(dataDir, 'opened-snapshot.sqlite');
    await writeFile(snapPath, snapshot);
    const opened = new DatabaseSync(snapPath, { readOnly: true });
    try {
      expect(opened.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
      const keys = opened.prepare('SELECT key FROM settings ORDER BY key').all().map((row) => row['key']);
      expect(keys).toEqual(['committed-marker']);
    } finally {
      opened.close();
      await rm(snapPath, { force: true });
    }

    db.exec('ROLLBACK');
    const fresh = await makeData();
    const dry = await restoreBackup(fresh.db, fresh.dataDir, archive, { mode: 'dry-run' });
    expect(dry.ok).toBe(true);
    expect(await dotFiles(dataDir)).toEqual([]);
  });

  it('backup skips .tmp- and non-ref files in photos/', async () => {
    const { dataDir } = await makeData();
    const directory = path.join(dataDir, 'photos');
    await mkdir(directory);
    const photos = createPhotoStore(dataDir);
    const ref = await photos.put(Buffer.from('kept-portrait'), 'png');
    await writeFile(path.join(directory, '.tmp-partial'), Buffer.from('partial'));
    await writeFile(path.join(directory, 'notes.txt'), Buffer.from('notes'));
    await writeFile(path.join(directory, `${'ab'.repeat(32)}.gif`), Buffer.from('gif'));
    await writeFile(path.join(directory, `${'CD'.repeat(32)}.jpg`), Buffer.from('upper'));

    const entries = mustRead(await createBackup(dataDir, clock));
    const photoNames = entries.filter((entry) => entry.name.startsWith('photos/')).map((entry) => entry.name);
    expect(photoNames).toEqual([`photos/${ref}`]);
    const manifest = entries.find((entry) => entry.name === 'manifest.json');
    expect(manifest).toBeDefined();
    if (manifest === undefined) return;
    const parsed = asRecord(JSON.parse(manifest.bytes.toString('utf8')) as unknown);
    expect(parsed.photos).toEqual([{ ref, size: Buffer.from('kept-portrait').length }]);
  });

  it('dry-run returns the summary and changes nothing (row counts and data identical before/after)', async () => {
    const source = await seedFixture();
    const archive = await createBackup(source.dataDir, clock);
    insertUser(source.db, 'extra', 'extra@example.test', 'editor');
    const before = await stateOf(source.dataDir, source.db);
    const usersBefore = countOf(source.db, 'SELECT COUNT(*) AS n FROM users');

    const dry = await restoreBackup(source.db, source.dataDir, archive, { mode: 'dry-run' });

    expect(dry).toEqual({
      ok: true,
      summary: {
        createdAt: CLOCK_ISO,
        schemaVersion: serverSchemaVersion(),
        members: Object.keys(source.ward.members).length,
        proposals: 2,
        users: 2,
        photos: 2,
        hasCurrent: true,
      },
    });
    expect(await stateOf(source.dataDir, source.db)).toBe(before);
    expect(countOf(source.db, 'SELECT COUNT(*) AS n FROM users')).toBe(usersBefore);
    expect(countOf(source.db, 'SELECT COUNT(*) AS n FROM members')).toBe(Object.keys(source.ward.members).length);
  });

  it('each validation failure leaves the live database byte-identical in content and returns its code', async () => {
    const live = await seedFixture();
    const archive = Buffer.from(await createBackup(live.dataDir, clock));
    const entries = mustRead(archive);
    const sqlite = sqliteEntry(entries);
    const before = await stateOf(live.dataDir, live.db);

    const corrupted = Buffer.from(sqlite);
    corrupted.fill(0, 100, Math.min(corrupted.length, 512));

    const newerSqlite = await editSqlite(live.root, sqlite, (db) => {
      db.prepare(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, 'future', ?)`).run(
        serverSchemaVersion() + 1,
        CLOCK_ISO,
      );
    });
    const newerManifest = manifestBytes(entries, (manifest) => {
      manifest.schemaVersion = serverSchemaVersion() + 1;
    });

    const missingSqlite = await editSqlite(live.root, sqlite, (db) => {
      const row = db.prepare('SELECT id FROM members LIMIT 1').get();
      const id = row?.['id'];
      if (typeof id !== 'string') throw new Error('missing member');
      db.prepare('UPDATE members SET photo_ref = ? WHERE id = ?').run(`${'ab'.repeat(32)}.jpg`, id);
    });

    const noAdminSqlite = await editSqlite(live.root, sqlite, (db) => {
      db.prepare(`UPDATE users SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE role = 'admin'`).run();
    });

    const photo = entries.find((entry) => entry.name.startsWith('photos/'));
    if (photo === undefined) throw new Error('expected a photo entry');
    const flipped = Buffer.from(photo.bytes);
    const firstByte = flipped[0] ?? 0;
    flipped[0] = firstByte ^ 0xff;
    expect(createHash('sha256').update(flipped).digest('hex')).not.toBe(photo.name.slice('photos/'.length, 'photos/'.length + 64));

    const cases: { code: string; bytes: Buffer }[] = [
      { code: 'corrupt_database', bytes: writeTar(replaceEntry(entries, 'wardboard.sqlite', corrupted)) },
      { code: 'incompatible_schema', bytes: await olderArchive(live.root) },
      {
        code: 'incompatible_schema',
        bytes: writeTar(replaceEntry(replaceEntry(entries, 'wardboard.sqlite', newerSqlite), 'manifest.json', newerManifest)),
      },
      { code: 'missing_photo', bytes: writeTar(replaceEntry(entries, 'wardboard.sqlite', missingSqlite)) },
      { code: 'no_admin', bytes: writeTar(replaceEntry(entries, 'wardboard.sqlite', noAdminSqlite)) },
      { code: 'invalid_archive', bytes: writeTar(replaceEntry(entries, photo.name, flipped)) },
    ];

    expect(cases.map((item) => item.code)).toEqual([
      'corrupt_database',
      'incompatible_schema',
      'incompatible_schema',
      'missing_photo',
      'no_admin',
      'invalid_archive',
    ]);
    for (const item of cases) {
      const result = await restoreBackup(live.db, live.dataDir, item.bytes, { mode: 'apply' });
      expect(result).toEqual({ ok: false, error: item.code });
      expect(await stateOf(live.dataDir, live.db)).toBe(before);
    }
  });

  it('a failure injected after delete and before commit rolls back; live data unchanged → restore_failed', async () => {
    const live = await seedFixture();
    const archive = await createBackup(live.dataDir, clock);
    live.store.setShowNeedsApproval(false);
    const before = await stateOf(live.dataDir, live.db);
    let sawArchiveValue = false;

    const result = await restoreBackup(live.db, live.dataDir, archive, {
      mode: 'apply',
      beforeCommit() {
        const row = live.db.prepare(`SELECT value FROM settings WHERE key = 'showNeedsApproval'`).get();
        sawArchiveValue = row?.['value'] === 'true';
        throw new Error('injected');
      },
    });

    expect(sawArchiveValue).toBe(true);
    expect(result).toEqual({ ok: false, error: 'restore_failed' });
    expect(live.store.loadSettings()).toEqual({ showNeedsApproval: false });
    expect(await stateOf(live.dataDir, live.db)).toBe(before);
    expect(await dotFiles(live.dataDir)).toEqual([]);
  });

  it('staging files are removed after success, failure and thrown error', async () => {
    const source = await seedFixture();
    const archive = await createBackup(source.dataDir, clock);
    const target = await makeData();
    let sawStaging = false;

    const dry = await restoreBackup(target.db, target.dataDir, archive, {
      mode: 'dry-run',
      afterValidate() {
        sawStaging = true;
      },
    });
    expect(dry.ok).toBe(true);
    expect(sawStaging).toBe(true);
    expect(await dotFiles(target.dataDir)).toEqual([]);

    const applied = await restoreBackup(target.db, target.dataDir, archive, { mode: 'apply' });
    expect(applied.ok).toBe(true);
    expect(await dotFiles(target.dataDir)).toEqual([]);

    const entries = mustRead(archive);
    const corrupted = sqliteEntry(entries);
    corrupted.fill(0, 100, Math.min(corrupted.length, 512));
    const broken = writeTar(replaceEntry(entries, 'wardboard.sqlite', corrupted));
    const failed = await restoreBackup(target.db, target.dataDir, broken, { mode: 'apply' });
    expect(failed).toEqual({ ok: false, error: 'corrupt_database' });
    expect(await dotFiles(target.dataDir)).toEqual([]);

    const other = await makeData();
    let sawDuringThrow = false;
    await expect(
      restoreBackup(other.db, other.dataDir, archive, {
        mode: 'apply',
        afterValidate() {
          sawDuringThrow = true;
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(sawDuringThrow).toBe(true);
    expect(await dotFiles(other.dataDir)).toEqual([]);
    expect(contentSignature(other.db)).not.toBe(contentSignature(source.db));
  });

  it('an empty photos directory is backed up with no photo entries', async () => {
    const { dataDir, db } = await makeData();
    await mkdir(path.join(dataDir, 'photos'));
    insertUser(db, 'admin-1', 'admin@example.test', 'admin');
    const entries = mustRead(await createBackup(dataDir, clock));
    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', 'wardboard.sqlite']);
    const manifest = asRecord(JSON.parse(entries[0]?.bytes.toString('utf8') ?? '') as unknown);
    expect(manifest.photos).toEqual([]);
  });

  it('a missing photos directory is backed up with no photo entries', async () => {
    const { dataDir, db } = await makeData();
    insertUser(db, 'admin-1', 'admin@example.test', 'admin');
    const entries = mustRead(await createBackup(dataDir, clock));
    expect(entries.some((entry) => entry.name.startsWith('photos/'))).toBe(false);
    const manifest = entries.find((entry) => entry.name === 'manifest.json');
    expect(manifest).toBeDefined();
    if (manifest === undefined) return;
    expect(asRecord(JSON.parse(manifest.bytes.toString('utf8')) as unknown).photos).toEqual([]);
  });

  it('a database with no Current gives hasCurrent false', async () => {
    const source = await makeData();
    insertUser(source.db, 'admin-1', 'admin@example.test', 'admin');
    const archive = await createBackup(source.dataDir, clock);
    const fresh = await makeData();
    const dry = await restoreBackup(fresh.db, fresh.dataDir, archive, { mode: 'dry-run' });
    expect(dry).toEqual({
      ok: true,
      summary: {
        createdAt: CLOCK_ISO,
        schemaVersion: serverSchemaVersion(),
        members: 0,
        proposals: 0,
        users: 1,
        photos: 0,
        hasCurrent: false,
      },
    });
  });
});
