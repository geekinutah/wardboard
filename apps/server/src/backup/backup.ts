import { createHash, randomBytes } from 'node:crypto';
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, migrations, openDatabase } from '../db/index.ts';
import { createPhotoStore } from '../photos/store.ts';
import { readTar, writeTar, type TarEntry } from './tar.ts';

export type BackupSummary = {
  createdAt: string;
  schemaVersion: number;
  members: number;
  proposals: number;
  users: number;
  photos: number;
  hasCurrent: boolean;
};

export type RestoreErrorCode =
  | 'invalid_archive'
  | 'corrupt_database'
  | 'incompatible_schema'
  | 'missing_photo'
  | 'no_admin'
  | 'restore_failed';

export type RestoreResult = { ok: true; summary: BackupSummary } | { ok: false; error: RestoreErrorCode };

export type RestoreOptions = {
  mode: 'dry-run' | 'apply';
  /** Runs after the replacement rows are staged in the transaction, before COMMIT. */
  beforeCommit?: () => void;
  /** Runs after the snapshot is validated and before any live mutation. A throw propagates. */
  afterValidate?: () => void;
};

const PHOTO_REF = /^[0-9a-f]{64}\.(jpg|png)$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type ManifestPhoto = { ref: string; size: number };

type Manifest = {
  createdAt: string;
  schemaVersion: number;
  photos: ManifestPhoto[];
};

type ArchivePhoto = ManifestPhoto & { bytes: Buffer };

type ParsedArchive = {
  manifest: Manifest;
  sqlite: Buffer;
  photos: ArchivePhoto[];
};

type Validated =
  | { ok: true; summary: BackupSummary }
  | { ok: false; error: RestoreErrorCode };

function serverSchemaVersion(): number {
  return migrations.reduce((highest, migration) => Math.max(highest, migration.id), 0);
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error('unsafe sql identifier');
  return `"${name}"`;
}

async function removeDbFiles(file: string): Promise<void> {
  await Promise.all([
    rm(file, { force: true }),
    rm(`${file}-wal`, { force: true }),
    rm(`${file}-shm`, { force: true }),
    rm(`${file}-journal`, { force: true }),
  ]);
}

function roundTripIso(value: string): boolean {
  if (!ISO_TIME.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function parseManifest(bytes: Buffer): Manifest | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (!exactKeys(value, ['format', 'formatVersion', 'createdAt', 'schemaVersion', 'photos'])) return null;
  if (value.format !== 'wardboard-backup' || value.formatVersion !== 1) return null;
  if (typeof value.createdAt !== 'string' || !roundTripIso(value.createdAt)) return null;
  if (typeof value.schemaVersion !== 'number' || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0) {
    return null;
  }
  if (!Array.isArray(value.photos)) return null;

  const photos: ManifestPhoto[] = [];
  for (const item of value.photos) {
    if (!isRecord(item) || !exactKeys(item, ['ref', 'size'])) return null;
    if (typeof item.ref !== 'string' || !PHOTO_REF.test(item.ref)) return null;
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) return null;
    photos.push({ ref: item.ref, size: item.size });
  }
  for (let index = 1; index < photos.length; index += 1) {
    const previous = photos[index - 1];
    const current = photos[index];
    if (previous === undefined || current === undefined || previous.ref >= current.ref) return null;
  }
  return { createdAt: value.createdAt, schemaVersion: value.schemaVersion, photos };
}

function parseArchive(input: Uint8Array): { ok: true; value: ParsedArchive } | { ok: false } {
  const read = readTar(input);
  if (!read.ok) return { ok: false };
  const manifestEntry = read.entries[0];
  const sqliteEntry = read.entries[1];
  if (manifestEntry?.name !== 'manifest.json' || sqliteEntry?.name !== 'wardboard.sqlite') return { ok: false };
  const manifest = parseManifest(manifestEntry.bytes);
  if (manifest === null || read.entries.length !== manifest.photos.length + 2) return { ok: false };

  const photos: ArchivePhoto[] = [];
  for (let index = 0; index < manifest.photos.length; index += 1) {
    const spec = manifest.photos[index];
    const entry = read.entries[index + 2];
    if (spec === undefined || entry === undefined) return { ok: false };
    if (entry.name !== `photos/${spec.ref}` || entry.bytes.byteLength !== spec.size) return { ok: false };
    const hash = createHash('sha256').update(entry.bytes).digest('hex');
    if (spec.ref.slice(0, 64) !== hash) return { ok: false };
    photos.push({ ref: spec.ref, size: spec.size, bytes: entry.bytes });
  }
  return { ok: true, value: { manifest, sqlite: sqliteEntry.bytes, photos } };
}

async function listPhotos(dataDir: string): Promise<ArchivePhoto[]> {
  const directory = path.join(dataDir, 'photos');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error: unknown) {
    if (isEnoent(error)) return [];
    throw error;
  }

  const photos: ArchivePhoto[] = [];
  for (const name of names) {
    if (!PHOTO_REF.test(name)) continue;
    const full = path.join(directory, name);
    if (!(await lstat(full)).isFile()) continue;
    const bytes = await readFile(full);
    photos.push({ ref: name, size: bytes.byteLength, bytes });
  }
  photos.sort((left, right) => (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0));
  return photos;
}

function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(id) AS id FROM schema_migrations').get();
  const id = asInt(row?.['id']);
  if (id === null || id < 0) throw new Error('schema version missing');
  return id;
}

function schemaOfFile(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return readSchemaVersion(db);
  } finally {
    db.close();
  }
}

export async function createBackup(dataDir: string, clock: () => Date): Promise<Buffer> {
  const createdAt = clock().toISOString();
  const snapshot = path.join(dataDir, `.backup-${randomBytes(16).toString('hex')}.sqlite`);
  const live = openDatabase(databasePath(dataDir));
  try {
    // VACUUM INTO writes a committed snapshot. The live file and its WAL are never copied.
    live.prepare('VACUUM INTO ?').run(snapshot);
    const sqlite = await readFile(snapshot);
    const schemaVersion = schemaOfFile(snapshot);
    const photos = await listPhotos(dataDir);
    const manifest = {
      format: 'wardboard-backup',
      formatVersion: 1,
      createdAt,
      schemaVersion,
      photos: photos.map((photo) => ({ ref: photo.ref, size: photo.size })),
    };
    const entries: TarEntry[] = [
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'wardboard.sqlite', bytes: sqlite },
      ...photos.map((photo) => ({ name: `photos/${photo.ref}`, bytes: photo.bytes })),
    ];
    return writeTar(entries);
  } finally {
    live.close();
    await removeDbFiles(snapshot);
  }
}

function integrityOk(db: DatabaseSync): boolean {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    return rows.length === 1 && rows[0]?.['integrity_check'] === 'ok';
  } catch {
    return false;
  }
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get();
  const value = asInt(row?.['n']);
  if (value === null || value < 0) throw new Error('expected a count');
  return value;
}

function validateSnapshot(staging: string, parsed: ParsedArchive): Validated {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(staging, { readOnly: true });
  } catch {
    return { ok: false, error: 'corrupt_database' };
  }
  try {
    if (!integrityOk(db)) return { ok: false, error: 'corrupt_database' };
    let applied: number;
    try {
      applied = readSchemaVersion(db);
    } catch {
      return { ok: false, error: 'incompatible_schema' };
    }
    if (applied !== parsed.manifest.schemaVersion || applied !== serverSchemaVersion()) {
      return { ok: false, error: 'incompatible_schema' };
    }

    const present = new Set(parsed.photos.map((photo) => photo.ref));
    const refs = db.prepare('SELECT photo_ref FROM members WHERE photo_ref IS NOT NULL').all();
    for (const row of refs) {
      const ref = row['photo_ref'];
      if (typeof ref !== 'string' || !present.has(ref)) return { ok: false, error: 'missing_photo' };
    }

    const admins = count(db, `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND revoked_at IS NULL`);
    if (admins < 1) return { ok: false, error: 'no_admin' };

    return {
      ok: true,
      summary: {
        createdAt: parsed.manifest.createdAt,
        schemaVersion: parsed.manifest.schemaVersion,
        members: count(db, 'SELECT COUNT(*) AS n FROM members'),
        proposals: count(db, `SELECT COUNT(*) AS n FROM boards WHERE kind = 'proposal'`),
        users: count(db, 'SELECT COUNT(*) AS n FROM users'),
        photos: parsed.photos.length,
        hasCurrent: count(db, `SELECT COUNT(*) AS n FROM boards WHERE kind = 'current'`) > 0,
      },
    };
  } finally {
    db.close();
  }
}

function applicationTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all();
  const names: string[] = [];
  for (const row of rows) {
    const name = row['name'];
    if (typeof name !== 'string') throw new Error('table name is not text');
    names.push(name);
  }
  return names;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA main.table_info(${quoteIdent(table)})`).all();
  const names: string[] = [];
  for (const row of rows) {
    const name = row['name'];
    if (typeof name !== 'string') throw new Error('column name is not text');
    names.push(name);
  }
  if (names.length === 0) throw new Error('table has no columns');
  return names;
}

function applySnapshot(
  db: DatabaseSync,
  staging: string,
  beforeCommit: (() => void) | undefined,
): { ok: true } | { ok: false; error: 'restore_failed' } {
  let attached = false;
  try {
    db.prepare('ATTACH DATABASE ? AS restore_src').run(staging);
    attached = true;
    db.exec('BEGIN IMMEDIATE');
    db.exec('PRAGMA defer_foreign_keys = ON');
    const tables = applicationTables(db);
    for (const table of tables) {
      db.exec(`DELETE FROM main.${quoteIdent(table)}`);
    }
    for (const table of tables) {
      const list = columnNames(db, table).map((column) => quoteIdent(column)).join(', ');
      db.exec(
        `INSERT INTO main.${quoteIdent(table)} (${list}) SELECT ${list} FROM restore_src.${quoteIdent(table)}`,
      );
    }
    beforeCommit?.();
    db.exec('COMMIT');
    return { ok: true };
  } catch {
    if (db.isTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError: unknown) {
        throw rollbackError instanceof Error ? rollbackError : new Error('rollback failed');
      }
    }
    return { ok: false, error: 'restore_failed' };
  } finally {
    if (attached) {
      try {
        db.exec('DETACH DATABASE restore_src');
      } catch {
        // Detach runs after commit or rollback and must not replace that result.
      }
    }
  }
}

async function copyPhotos(dataDir: string, photos: readonly ArchivePhoto[]): Promise<void> {
  const store = createPhotoStore(dataDir);
  for (const photo of photos) {
    const ext = PHOTO_REF.exec(photo.ref)?.[1];
    if (ext !== 'jpg' && ext !== 'png') throw new Error('photo extension');
    const stored = await store.put(photo.bytes, ext);
    if (stored !== photo.ref) throw new Error('photo ref mismatch');
  }
}

export async function restoreBackup(
  db: DatabaseSync,
  dataDir: string,
  archive: Uint8Array,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const parsed = parseArchive(archive);
  if (!parsed.ok) return { ok: false, error: 'invalid_archive' };

  const staging = path.join(dataDir, `.restore-${randomBytes(16).toString('hex')}.sqlite`);
  try {
    await writeFile(staging, parsed.value.sqlite, { flag: 'wx' });
    const validated = validateSnapshot(staging, parsed.value);
    if (!validated.ok) return validated;
    options.afterValidate?.();
    if (options.mode === 'dry-run') return { ok: true, summary: validated.summary };
    try {
      await copyPhotos(dataDir, parsed.value.photos);
    } catch {
      return { ok: false, error: 'restore_failed' };
    }
    const applied = applySnapshot(db, staging, options.beforeCommit);
    if (!applied.ok) return applied;
    return { ok: true, summary: validated.summary };
  } finally {
    await removeDbFiles(staging);
  }
}
