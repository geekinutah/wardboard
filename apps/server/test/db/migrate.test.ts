import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, migrations, openDatabase, type Migration } from '../../src/db/index.ts';

const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

const EXPECTED_TABLES = [
  'approvals',
  'board_groups',
  'boards',
  'calling_affinities',
  'calling_assignments',
  'calling_groups',
  'calling_tags',
  'dugout_inclusions',
  'external_callings',
  'invitations',
  'member_tags',
  'members',
  'oversight',
  'placements',
  'positions',
  'schema_migrations',
  'settings',
  'tags',
  'users',
];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function memoryDb(): DatabaseSync {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

function fileDb(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), 'wardboard-t005-'));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, 'wardboard.sqlite'));
  databases.push(db);
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => {
      const name = row['name'];
      if (typeof name !== 'string') throw new Error('sqlite_master.name is not text');
      return name;
    });
}

function appliedIds(db: DatabaseSync): number[] {
  if (!tableNames(db).includes('schema_migrations')) return [];
  return db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => {
      const id = row['id'];
      if (typeof id !== 'number') throw new Error('schema_migrations.id is not a number');
      return id;
    });
}

describe('migrate', () => {
  it('migrate applies all migrations to an empty database', () => {
    const db = fileDb();
    expect(tableNames(db)).toEqual([]);

    migrate(db);

    expect(appliedIds(db)).toEqual(migrations.map((migration) => migration.id));
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
  });

  it('migrate is idempotent', () => {
    const db = fileDb();
    migrate(db);
    const before = appliedIds(db);
    expect(before).toEqual(migrations.map((migration) => migration.id));

    db.prepare(
      `INSERT INTO members (id, name, category, created_at, updated_at)
       VALUES ('member-ada', 'Ada Example', 'adult', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    expect(appliedIds(db)).toEqual(before);
    expect(db.prepare("SELECT name FROM members WHERE id = 'member-ada'").get()?.['name']).toBe(
      'Ada Example',
    );
  });

  it('migrate records applied_at from the injected clock', () => {
    const db = memoryDb();
    const stamp = '2001-02-03T04:05:06.000Z';
    migrate(db, migrations, () => new Date(stamp));

    expect(appliedIds(db)).toEqual(migrations.map((migration) => migration.id));
    const stored = db
      .prepare('SELECT applied_at FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => row['applied_at']);
    expect(stored).toEqual(migrations.map(() => stamp));
  });

  it('a failing migration rolls back completely', () => {
    const db = memoryDb();
    const failing: Migration = {
      id: 4,
      name: 'explode',
      up: 'CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY);\nNOT VALID SQL;',
    };

    expect(() => {
      migrate(db, [failing]);
    }).toThrow(/explode/);
    expect(tableNames(db)).not.toContain('should_not_exist');
    expect(appliedIds(db)).toEqual([]);
  });

  it('a failing migration mid-list leaves earlier migrations applied', () => {
    const db = memoryDb();
    const list: Migration[] = [
      { id: 1, name: 'kept', up: 'CREATE TABLE kept (id INTEGER PRIMARY KEY);' },
      {
        id: 2,
        name: 'second-fails',
        up: 'CREATE TABLE lost (id INTEGER PRIMARY KEY);\nNOT VALID SQL;',
      },
      { id: 3, name: 'never', up: 'CREATE TABLE never (id INTEGER PRIMARY KEY);' },
    ];

    expect(() => {
      migrate(db, list);
    }).toThrow(/second-fails/);
    expect(tableNames(db)).toContain('kept');
    expect(tableNames(db)).not.toContain('lost');
    expect(tableNames(db)).not.toContain('never');
    expect(appliedIds(db)).toEqual([1]);
  });

  it('migrate refuses an unknown applied migration', () => {
    const db = memoryDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (999, ?, ?)',
    ).run('future', '2020-01-01T00:00:00.000Z');

    const pending: Migration = {
      id: 1,
      name: 'one',
      up: 'CREATE TABLE should_not_apply (id INTEGER PRIMARY KEY);',
    };

    expect(() => {
      migrate(db, [pending]);
    }).toThrow(/999/);
    expect(tableNames(db)).not.toContain('should_not_apply');
    expect(appliedIds(db)).toEqual([999]);
  });

  it('migrate refuses a non-increasing migration list', () => {
    const duplicate = memoryDb();
    const duplicated: Migration[] = [
      { id: 1, name: 'first', up: 'CREATE TABLE first_step (id INTEGER PRIMARY KEY);' },
      { id: 1, name: 'dup', up: 'CREATE TABLE dup_step (id INTEGER PRIMARY KEY);' },
    ];
    expect(() => {
      migrate(duplicate, duplicated);
    }).toThrow(/strictly increasing/i);
    expect(tableNames(duplicate)).not.toContain('schema_migrations');
    expect(tableNames(duplicate)).not.toContain('first_step');
    expect(tableNames(duplicate)).not.toContain('dup_step');

    const reversedDb = memoryDb();
    const reversed: Migration[] = [
      { id: 2, name: 'two', up: 'CREATE TABLE two_step (id INTEGER PRIMARY KEY);' },
      { id: 1, name: 'one', up: 'CREATE TABLE one_step (id INTEGER PRIMARY KEY);' },
    ];
    expect(() => {
      migrate(reversedDb, reversed);
    }).toThrow(/strictly increasing/i);
    expect(tableNames(reversedDb)).not.toContain('schema_migrations');
    expect(tableNames(reversedDb)).not.toContain('two_step');
    expect(tableNames(reversedDb)).not.toContain('one_step');
  });
});

describe('openDatabase', () => {
  it('openDatabase enables foreign keys and WAL', () => {
    const db = fileDb();

    expect(db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1);
    expect(db.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal');
    expect(db.prepare('PRAGMA busy_timeout').get()?.['timeout']).toBe(5000);
  });
});
