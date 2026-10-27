import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Board, MemberId, PositionId, Result } from '@wardboard/core';
import { expect } from 'vitest';
import { migrate, openDatabase } from '../../src/db/index.ts';
import { openStore, type Store, type StoreClock, type StoreResult } from '../../src/index.ts';

export const FIXED_ISO = '2026-06-15T08:30:00.000Z';

const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

export function fixedClock(): Date {
  return new Date(FIXED_ISO);
}

export function openTempStore(clock: StoreClock = fixedClock): { db: DatabaseSync; store: Store } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wardboard-t023-'));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, 'wardboard.sqlite'));
  databases.push(db);
  migrate(db);
  return { db, store: openStore(db, clock) };
}

export function cleanupStores(): void {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join('; '));
  }
  return result.value;
}

export function take<T>(result: StoreResult<T>): T {
  if (!result.ok) {
    expect.fail(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

export function scalar(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params);
  const count = row?.['n'];
  if (typeof count !== 'number') {
    throw new Error(`expected a count from ${sql}`);
  }
  return count;
}

export function insertUser(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO users (id, login, display_name, role, created_at)
     VALUES (?, ?, 'Ada Example', 'admin', ?)`,
  ).run(id, `${id}@example.test`, FIXED_ISO);
}

export const BOARD_TABLES = [
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

export function boardCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of BOARD_TABLES) {
    counts[table] = scalar(db, `SELECT COUNT(*) AS n FROM ${table}`);
  }
  return counts;
}

/** Board fields other than identity and version, for comparing independent copies. */
export function arrangementOf(board: Board): Omit<Board, 'id' | 'kind' | 'version'> {
  return {
    boardGroups: board.boardGroups,
    callingGroups: board.callingGroups,
    assignments: board.assignments,
    positions: board.positions,
    placements: board.placements,
    oversight: board.oversight,
    dugoutInclusions: board.dugoutInclusions,
    approvals: board.approvals,
  };
}

export function placementByTitle(
  board: Board,
  title: string,
): { positionId: PositionId; memberId: MemberId } {
  const assignment = Object.values(board.assignments).find((item) => item.title === title);
  if (assignment === undefined) {
    throw new Error(`no assignment titled ${title}`);
  }
  const position = Object.values(board.positions).find(
    (item) => item.assignmentId === assignment.id && Object.hasOwn(board.placements, item.id),
  );
  if (position === undefined) {
    throw new Error(`no occupant for ${title}`);
  }
  const member = board.placements[position.id];
  if (member === undefined) {
    throw new Error(`no occupant for ${title}`);
  }
  return { positionId: position.id, memberId: member };
}
