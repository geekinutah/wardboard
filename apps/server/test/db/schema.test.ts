import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/db/index.ts';

const NOW = '2026-04-01T00:00:00.000Z';
const FORBIDDEN_MEMBER_COLUMN = /email|phone|address|birth|age|record|mrn|church_id/i;

const BOARD_TABLES = [
  'board_groups',
  'calling_groups',
  'calling_assignments',
  'positions',
  'placements',
  'oversight',
  'calling_tags',
  'calling_affinities',
  'dugout_inclusions',
  'approvals',
] as const;

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function memoryDb(): DatabaseSync {
  const db = openDatabase(':memory:');
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

function migratedDb(): DatabaseSync {
  const db = memoryDb();
  migrate(db);
  expect(tableNames(db)).toContain('members');
  return db;
}

function insertMember(db: DatabaseSync, id: string, name: string, note: string | null = null): void {
  db.prepare(
    `INSERT INTO members (id, name, category, note, created_at, updated_at)
     VALUES (?, ?, 'adult', ?, ?, ?)`,
  ).run(id, name, note, NOW, NOW);
}

function insertUser(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at)
     VALUES (?, ?, ?, 'admin', ?)`,
  ).run(id, `${id}.login`, 'Ada Example', NOW);
}

function insertTag(db: DatabaseSync, id: string, name: string): void {
  db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, name);
}

function insertCurrent(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO boards (id, kind, name, import_version, created_at, updated_at)
     VALUES (?, 'current', ?, '2026-04-01', ?, ?)`,
  ).run(id, id, NOW, NOW);
}

function insertBaseline(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO boards (id, kind, name, created_at, updated_at) VALUES (?, 'baseline', ?, ?, ?)`,
  ).run(id, id, NOW, NOW);
}

function insertProposal(db: DatabaseSync, id: string, baselineId: string): void {
  db.prepare(
    `INSERT INTO boards (
       id, kind, name, status, rationale, tab_order, baseline_board_id, created_at, updated_at
     ) VALUES (?, 'proposal', ?, 'draft', 'Fictional rationale', 1, ?, ?, ?)`,
  ).run(id, id, baselineId, NOW, NOW);
}

type Structure = {
  singleAssignmentId: string;
  listAssignmentId: string;
  singlePositionId: string;
  listPositionId: string;
  vacantPositionId: string;
  callingGroupId: string;
};

function insertStructure(
  db: DatabaseSync,
  boardId: string,
  memberId: string,
  userId: string,
  tagId: string,
): Structure {
  const groupId = `${boardId}-group`;
  const callingGroupId = `${boardId}-calling-group`;
  const nestedGroupId = `${boardId}-nested-group`;
  const singleAssignmentId = `${boardId}-single`;
  const listAssignmentId = `${boardId}-list`;
  const singlePositionId = `${boardId}-single-position`;
  const listPositionId = `${boardId}-list-position`;
  const vacantPositionId = `${boardId}-vacant-position`;

  db.prepare(
    `INSERT INTO board_groups (id, board_id, name, sort_order, visible)
     VALUES (?, ?, 'Relief Society', 0, 1)`,
  ).run(groupId, boardId);
  db.prepare(
    `INSERT INTO calling_groups (id, board_id, board_group_id, name, sort_order)
     VALUES (?, ?, ?, 'Presidency', 0)`,
  ).run(callingGroupId, boardId, groupId);
  db.prepare(
    `INSERT INTO calling_groups (id, board_id, parent_calling_group_id, name, sort_order)
     VALUES (?, ?, ?, 'Teachers class', 1)`,
  ).run(nestedGroupId, boardId, callingGroupId);
  db.prepare(
    `INSERT INTO calling_assignments (
       id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin
     ) VALUES (?, ?, ?, 'President', 'single', 0, 1, 1, 'standard')`,
  ).run(singleAssignmentId, boardId, callingGroupId);
  db.prepare(
    `INSERT INTO calling_assignments (
       id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin
     ) VALUES (?, ?, ?, 'Teachers', 'list', 1, 1, 0, 'custom')`,
  ).run(listAssignmentId, boardId, nestedGroupId);
  db.prepare(
    `INSERT INTO positions (id, board_id, assignment_id, lineage_id, sort_order)
     VALUES (?, ?, ?, 'lineage-president', 0)`,
  ).run(singlePositionId, boardId, singleAssignmentId);
  db.prepare(
    `INSERT INTO positions (id, board_id, assignment_id, lineage_id, sort_order)
     VALUES (?, ?, ?, 'lineage-teacher', 0)`,
  ).run(listPositionId, boardId, listAssignmentId);
  db.prepare(
    `INSERT INTO positions (id, board_id, assignment_id, lineage_id, sort_order)
     VALUES (?, ?, ?, 'lineage-teacher-vacant', 1)`,
  ).run(vacantPositionId, boardId, listAssignmentId);
  db.prepare(
    `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`${boardId}-placement`, boardId, singlePositionId, singleAssignmentId, memberId);
  db.prepare(
    `INSERT INTO oversight (id, board_id, position_id, target_board_group_id, fixed)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(`${boardId}-oversight`, boardId, singlePositionId, groupId);
  db.prepare(
    'INSERT INTO calling_tags (board_id, assignment_id, tag_id) VALUES (?, ?, ?)',
  ).run(boardId, singleAssignmentId, tagId);
  db.prepare(
    'INSERT INTO calling_affinities (board_id, assignment_id, tag_id) VALUES (?, ?, ?)',
  ).run(boardId, listAssignmentId, tagId);
  db.prepare('INSERT INTO dugout_inclusions (board_id, member_id) VALUES (?, ?)').run(
    boardId,
    memberId,
  );
  db.prepare(
    `INSERT INTO approvals (
       id, board_id, member_id, position_id, approver_user_id, approved_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`${boardId}-approval`, boardId, memberId, singlePositionId, userId, NOW);

  return {
    singleAssignmentId,
    listAssignmentId,
    singlePositionId,
    listPositionId,
    vacantPositionId,
    callingGroupId,
  };
}

function countByBoard(db: DatabaseSync, table: string, boardId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE board_id = ?`).get(boardId);
  const count = row?.['n'];
  if (typeof count !== 'number') throw new Error(`count failed for ${table}`);
  return count;
}

function snapshot(db: DatabaseSync, boardId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of BOARD_TABLES) {
    counts[table] = countByBoard(db, table, boardId);
  }
  return counts;
}

function boardKind(db: DatabaseSync, id: string): string | undefined {
  const kind = db.prepare('SELECT kind FROM boards WHERE id = ?').get(id)?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

describe('schema', () => {
  it('members table has no disallowed columns', () => {
    const db = migratedDb();
    const columns = db.prepare('PRAGMA table_info(members)').all();
    const names = columns.map((column) => {
      const name = column['name'];
      if (typeof name !== 'string') throw new Error('table_info.name is not text');
      return name;
    });

    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'photo_ref',
        'category',
        'gender',
        'note',
        'needs_approval',
        'removed_date',
      ]),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(FORBIDDEN_MEMBER_COLUMN);
    }
  });

  it('a position holds at most one placement', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertMember(db, 'member-bea', 'Bea Example');
    insertUser(db, 'user-ada');
    insertTag(db, 'tag-weekday', 'Weekday');
    insertCurrent(db, 'current');
    const structure = insertStructure(db, 'current', 'member-ada', 'user-ada', 'tag-weekday');

    expect(() => {
      db.prepare(
        `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
         VALUES ('placement-extra', 'current', ?, ?, 'member-bea')`,
      ).run(structure.singlePositionId, structure.singleAssignmentId);
    }).toThrow(/UNIQUE constraint failed: placements.position_id/);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM placements WHERE position_id = ?').get(
        structure.singlePositionId,
      )?.['n'],
    ).toBe(1);
  });

  it('a member may hold several different positions', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertUser(db, 'user-ada');
    insertTag(db, 'tag-weekday', 'Weekday');
    insertCurrent(db, 'current');
    const structure = insertStructure(db, 'current', 'member-ada', 'user-ada', 'tag-weekday');

    db.prepare(
      `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
       VALUES ('placement-list', 'current', ?, ?, 'member-ada')`,
    ).run(structure.listPositionId, structure.listAssignmentId);

    const rows = db
      .prepare('SELECT position_id FROM placements WHERE member_id = ? ORDER BY position_id')
      .all('member-ada');
    expect(rows.map((row) => row['position_id'])).toEqual(
      [structure.listPositionId, structure.singlePositionId].sort(),
    );
  });

  it('deleting a board cascades to its structures only', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertUser(db, 'user-ada');
    insertTag(db, 'tag-weekday', 'Weekday');
    insertCurrent(db, 'current');
    insertBaseline(db, 'baseline-a');
    insertBaseline(db, 'baseline-b');
    insertProposal(db, 'proposal-a', 'baseline-a');
    insertProposal(db, 'proposal-b', 'baseline-b');
    insertStructure(db, 'current', 'member-ada', 'user-ada', 'tag-weekday');
    const proposalA = insertStructure(db, 'proposal-a', 'member-ada', 'user-ada', 'tag-weekday');
    insertStructure(db, 'proposal-b', 'member-ada', 'user-ada', 'tag-weekday');

    expect(() => {
      db.prepare(
        `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
         VALUES ('placement-cross', 'proposal-b', ?, ?, 'member-ada')`,
      ).run(proposalA.vacantPositionId, 'proposal-b-list');
    }).toThrow(/FOREIGN KEY constraint failed/);

    const beforeCurrent = snapshot(db, 'current');
    const beforeB = snapshot(db, 'proposal-b');
    for (const table of BOARD_TABLES) {
      expect(beforeCurrent[table], table).toBeGreaterThan(0);
      expect(beforeB[table], table).toBeGreaterThan(0);
    }

    db.prepare("DELETE FROM boards WHERE id = 'proposal-a'").run();

    for (const table of BOARD_TABLES) {
      expect(countByBoard(db, table, 'proposal-a'), table).toBe(0);
    }
    expect(snapshot(db, 'current')).toEqual(beforeCurrent);
    expect(snapshot(db, 'proposal-b')).toEqual(beforeB);
    expect(boardKind(db, 'proposal-a')).toBeUndefined();
    expect(boardKind(db, 'current')).toBe('current');
    expect(boardKind(db, 'proposal-b')).toBe('proposal');
    expect(boardKind(db, 'baseline-a')).toBe('baseline');
    expect(boardKind(db, 'baseline-b')).toBe('baseline');
    expect(db.prepare("SELECT name FROM members WHERE id = 'member-ada'").get()?.['name']).toBe(
      'Ada Example',
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('only one current board', () => {
    const db = migratedDb();
    insertBaseline(db, 'baseline-a');
    insertBaseline(db, 'baseline-b');
    insertProposal(db, 'proposal-a', 'baseline-a');
    insertProposal(db, 'proposal-b', 'baseline-b');
    insertCurrent(db, 'current');

    expect(() => {
      insertCurrent(db, 'current-2');
    }).toThrow(/UNIQUE constraint failed/);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM boards WHERE kind = 'current'").get()?.['n'],
    ).toBe(1);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM boards WHERE kind = 'proposal'").get()?.['n'],
    ).toBe(2);
  });

  it('proposal status is draft or accepted', () => {
    const db = migratedDb();
    insertBaseline(db, 'baseline-a');
    db.prepare(
      `INSERT INTO boards (
         id, kind, name, status, baseline_board_id, created_at, updated_at
       ) VALUES ('proposal-draft', 'proposal', 'Draft', 'draft', 'baseline-a', ?, ?)`,
    ).run(NOW, NOW);
    db.prepare(
      `INSERT INTO boards (
         id, kind, name, status, baseline_board_id, created_at, updated_at
       ) VALUES ('proposal-accepted', 'proposal', 'Accepted', 'accepted', 'baseline-a', ?, ?)`,
    ).run(NOW, NOW);

    expect(() => {
      db.prepare(
        `INSERT INTO boards (
           id, kind, name, baseline_board_id, created_at, updated_at
         ) VALUES ('proposal-null', 'proposal', 'Missing status', 'baseline-a', ?, ?)`,
      ).run(NOW, NOW);
    }).toThrow(/CHECK constraint failed/);

    expect(db.prepare("SELECT status FROM boards WHERE id = 'proposal-draft'").get()?.['status']).toBe(
      'draft',
    );
    expect(
      db.prepare("SELECT status FROM boards WHERE id = 'proposal-accepted'").get()?.['status'],
    ).toBe('accepted');
    expect(db.prepare("SELECT id FROM boards WHERE id = 'proposal-null'").get()).toBeUndefined();
  });

  it('assignment type and origin are constrained', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertUser(db, 'user-ada');
    insertTag(db, 'tag-weekday', 'Weekday');
    insertCurrent(db, 'current');
    const structure = insertStructure(db, 'current', 'member-ada', 'user-ada', 'tag-weekday');

    expect(() => {
      db.prepare(
        `INSERT INTO calling_assignments (
           id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin
         ) VALUES ('bad-type', 'current', ?, 'Clerk', 'triple', 2, 1, 0, 'standard')`,
      ).run(structure.callingGroupId);
    }).toThrow(/CHECK constraint failed/);
    expect(() => {
      db.prepare(
        `INSERT INTO calling_assignments (
           id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin
         ) VALUES ('bad-origin', 'current', ?, 'Clerk', 'single', 3, 1, 0, 'x')`,
      ).run(structure.callingGroupId);
    }).toThrow(/CHECK constraint failed/);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM calling_assignments WHERE id IN ('bad-type', 'bad-origin')").get()
        ?.['n'],
    ).toBe(0);
  });

  it('member note length is bounded', () => {
    const db = migratedDb();
    const accepted = 'a'.repeat(280);
    insertMember(db, 'note-ok', 'Ada Example', accepted);

    expect(() => {
      insertMember(db, 'note-long', 'Bea Example', 'a'.repeat(281));
    }).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT note FROM members WHERE id = 'note-ok'").get()?.['note']).toBe(
      accepted,
    );
    expect(db.prepare("SELECT id FROM members WHERE id = 'note-long'").get()).toBeUndefined();
  });

  it('foreign keys are enforced', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertUser(db, 'user-ada');
    insertTag(db, 'tag-weekday', 'Weekday');
    insertCurrent(db, 'current');
    const structure = insertStructure(db, 'current', 'member-ada', 'user-ada', 'tag-weekday');

    expect(() => {
      db.prepare(
        `INSERT INTO placements (id, board_id, position_id, assignment_id, member_id)
         VALUES ('placement-missing', 'current', ?, ?, 'missing-member')`,
      ).run(structure.vacantPositionId, structure.listAssignmentId);
    }).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      db.prepare("SELECT id FROM placements WHERE id = 'placement-missing'").get(),
    ).toBeUndefined();
  });

  it('dugout inclusion is unique per board and member', () => {
    const db = migratedDb();
    insertMember(db, 'member-ada', 'Ada Example');
    insertCurrent(db, 'current');
    db.prepare(
      "INSERT INTO dugout_inclusions (board_id, member_id) VALUES ('current', 'member-ada')",
    ).run();

    expect(() => {
      db.prepare(
        "INSERT INTO dugout_inclusions (board_id, member_id) VALUES ('current', 'member-ada')",
      ).run();
    }).toThrow(/UNIQUE constraint failed: dugout_inclusions.board_id, dugout_inclusions.member_id/);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM dugout_inclusions WHERE board_id = 'current'").get()?.[
        'n'
      ],
    ).toBe(1);
  });
});
