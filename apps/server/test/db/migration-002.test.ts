import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/db/index.ts';
import { initialMigration } from '../../src/db/migrations/001-initial.ts';

const NOW = '2026-04-01T00:00:00.000Z';
const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fileDb(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), 'wardboard-t023-mig-'));
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

function columnNames(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => {
    const name = row['name'];
    if (typeof name !== 'string') throw new Error('table_info.name is not text');
    return name;
  });
}

function insertBoardChain(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO boards (id, kind, name, created_at, updated_at) VALUES ('b', 'current', 'Current', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO board_groups (id, board_id, name, sort_order) VALUES ('g', 'b', 'Primary', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO calling_groups (id, board_id, board_group_id, name, sort_order)
     VALUES ('cg', 'b', 'g', 'Presidency', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO calling_assignments (
       id, board_id, calling_group_id, title, type, sort_order, origin
     ) VALUES ('a', 'b', 'cg', 'President', 'single', 0, 'standard')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, board_id, assignment_id, lineage_id, sort_order)
     VALUES ('p', 'b', 'a', 'ln', 0)`,
  ).run();
}

describe('migration 002', () => {
  it('002 keeps the table list', () => {
    const onlyInitial = fileDb();
    migrate(onlyInitial, [initialMigration]);
    const fullyMigrated = fileDb();
    migrate(fullyMigrated);

    expect(tableNames(fullyMigrated)).toEqual(tableNames(onlyInitial));
  });

  it('002 preserves existing oversight rows', () => {
    const db = fileDb();
    migrate(db, [initialMigration]);
    insertBoardChain(db);
    db.prepare(
      `INSERT INTO oversight (id, board_id, position_id, target_board_group_id, fixed)
       VALUES ('o', 'b', 'p', 'g', 1)`,
    ).run();

    migrate(db);

    expect(columnNames(db, 'oversight')).toEqual(
      expect.arrayContaining(['position_id', 'overseer', 'sort_order']),
    );
    const row = db
      .prepare(
        `SELECT id, board_id, position_id, target_board_group_id, target_calling_group_id, fixed, overseer, sort_order
         FROM oversight WHERE id = ?`,
      )
      .get('o');
    expect(row?.['id']).toBe('o');
    expect(row?.['board_id']).toBe('b');
    expect(row?.['position_id']).toBe('p');
    expect(row?.['target_board_group_id']).toBe('g');
    expect(row?.['target_calling_group_id']).toBeNull();
    expect(row?.['fixed']).toBe(1);
    expect(row?.['overseer']).toBeNull();
    expect(row?.['sort_order']).toBe(0);
  });

  it('oversight requires position or overseer', () => {
    const db = fileDb();
    migrate(db);
    insertBoardChain(db);

    expect(() => {
      db.prepare(
        `INSERT INTO oversight (id, board_id, target_board_group_id, fixed)
         VALUES ('neither', 'b', 'g', 0)`,
      ).run();
    }).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT id FROM oversight WHERE id = 'neither'").get()).toBeUndefined();

    db.prepare(
      `INSERT INTO oversight (id, board_id, target_board_group_id, fixed, overseer)
       VALUES ('bishop-row', 'b', 'g', 0, 'bishop')`,
    ).run();
    const stored = db.prepare('SELECT position_id, overseer FROM oversight WHERE id = ?').get('bishop-row');
    expect(stored?.['position_id']).toBeNull();
    expect(stored?.['overseer']).toBe('bishop');

    expect(() => {
      db.prepare(
        `INSERT INTO oversight (id, board_id, target_board_group_id, fixed, overseer)
         VALUES ('pope-row', 'b', 'g', 0, 'pope')`,
      ).run();
    }).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT id FROM oversight WHERE id = 'pope-row'").get()).toBeUndefined();
  });

  it('calling group kind and leadership role are constrained', () => {
    const db = fileDb();
    migrate(db);
    expect(columnNames(db, 'calling_groups')).toEqual(expect.arrayContaining(['kind', 'group_key']));
    expect(columnNames(db, 'calling_assignments')).toEqual(expect.arrayContaining(['leadership_role']));
    insertBoardChain(db);

    const kind = db.prepare('SELECT kind FROM calling_groups WHERE id = ?').get('cg')?.['kind'];
    expect(kind).toBe('other');

    expect(() => {
      db.prepare(
        `INSERT INTO calling_groups (id, board_id, board_group_id, name, sort_order, kind)
         VALUES ('bad-kind', 'b', 'g', 'Nope', 1, 'congregation')`,
      ).run();
    }).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT id FROM calling_groups WHERE id = 'bad-kind'").get()).toBeUndefined();

    const role = db.prepare('SELECT leadership_role FROM calling_assignments WHERE id = ?').get('a')?.[
      'leadership_role'
    ];
    expect(role).toBeNull();

    expect(() => {
      db.prepare(
        `INSERT INTO calling_assignments (
           id, board_id, calling_group_id, title, type, sort_order, origin, leadership_role
         ) VALUES ('bad-role', 'b', 'cg', 'Clerk', 'single', 1, 'custom', 'pope')`,
      ).run();
    }).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT id FROM calling_assignments WHERE id = 'bad-role'").get()).toBeUndefined();

    db.prepare(
      `INSERT INTO calling_assignments (
         id, board_id, calling_group_id, title, type, sort_order, origin, leadership_role
       ) VALUES ('good-role', 'b', 'cg', 'Secretary', 'single', 2, 'custom', 'secretary')`,
    ).run();
    expect(
      db.prepare('SELECT leadership_role FROM calling_assignments WHERE id = ?').get('good-role')?.[
        'leadership_role'
      ],
    ).toBe('secretary');
  });

  it('proposal_id is unique when present', () => {
    const db = fileDb();
    migrate(db);
    const index = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'boards_proposal_id'")
      .get();
    const sql = index?.['sql'];
    expect(typeof sql).toBe('string');
    expect(String(sql).toLowerCase()).toContain('unique');
    expect(String(sql).toLowerCase()).toContain('proposal_id is not null');

    db.prepare(
      `INSERT INTO boards (id, kind, name, created_at, updated_at, proposal_id)
       VALUES ('base-a', 'baseline', 'A', ?, ?, NULL)`,
    ).run(NOW, NOW);
    db.prepare(
      `INSERT INTO boards (id, kind, name, created_at, updated_at, proposal_id)
       VALUES ('base-b', 'baseline', 'B', ?, ?, NULL)`,
    ).run(NOW, NOW);
    expect(db.prepare("SELECT COUNT(*) AS n FROM boards WHERE proposal_id IS NULL").get()?.['n']).toBe(2);

    db.prepare(
      `INSERT INTO boards (id, kind, name, created_at, updated_at, proposal_id)
       VALUES ('prop-a', 'baseline', 'P', ?, ?, 'shared-proposal')`,
    ).run(NOW, NOW);
    expect(() => {
      db.prepare(
        `INSERT INTO boards (id, kind, name, created_at, updated_at, proposal_id)
         VALUES ('prop-b', 'baseline', 'Q', ?, ?, 'shared-proposal')`,
      ).run(NOW, NOW);
    }).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT id FROM boards WHERE id = 'prop-b'").get()).toBeUndefined();
  });
});
