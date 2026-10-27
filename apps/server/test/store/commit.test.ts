import {
  boardId,
  createBoard,
  createProposal,
  memberId,
  moveToDugout,
  proposalId,
  sequentialIds,
  userId,
  type Board,
} from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store, StoreClock } from '../../src/index.ts';
import {
  FIXED_ISO,
  arrangementOf,
  boardCounts,
  cleanupStores,
  insertUser,
  openTempStore,
  placementByTitle,
  scalar,
  take,
  unwrap,
} from './helpers.ts';

afterEach(cleanupStores);

function steppingClock(stamps: readonly string[]): StoreClock {
  let index = 0;
  return () => {
    const stamp = stamps[Math.min(index, stamps.length - 1)] ?? stamps[0] ?? FIXED_ISO;
    index += 1;
    return new Date(stamp);
  };
}

function draftFromCurrent(store: Store): { proposalId: string; board: Board } {
  const proposal = take(
    store.createProposal(
      { name: 'Draft', rationale: null, source: { kind: 'current' } },
      sequentialIds('c'),
    ),
  );
  return { proposalId: proposal.id, board: proposal.board };
}

function dumpTables(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => {
      const name = row['name'];
      if (typeof name !== 'string') throw new Error('sqlite_master.name is not text');
      return name;
    });
  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    dump[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  }
  return dump;
}

describe('commitBoard', () => {
  it('commit applies a core operation result and bumps version', () => {
    const createdAt = '2026-06-15T08:30:00.000Z';
    const updatedAt = '2026-06-15T09:45:00.000Z';
    const { store } = openTempStore(
      steppingClock(['2026-06-15T08:00:00.000Z', createdAt, updatedAt]),
    );
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const { proposalId: id, board } = draftFromCurrent(store);
    const organ = placementByTitle(board, 'Organist');
    const moved = moveToDugout(
      board,
      { ward: store.loadWard(), ids: sequentialIds('mv') },
      { memberId: organ.memberId, from: organ.positionId },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) expect.fail(moved.error.message);

    const committed = take(store.commitBoard(moved.board, 0));

    expect(committed).toEqual({ ...moved.board, version: 1 });
    expect(store.loadBoard(board.id)).toEqual(committed);
    const loaded = store.loadProposal(proposalId(id));
    expect(loaded?.board).toEqual(committed);
    expect(loaded?.createdAt).toBe(createdAt);
    expect(loaded?.updatedAt).toBe(updatedAt);
  });

  it('stale expected version is rejected and nothing changes', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const { board } = draftFromCurrent(store);
    const loadedWard = store.loadWard();
    const organ = placementByTitle(board, 'Organist');
    const music = placementByTitle(board, 'Music Coordinator');
    const context = { ward: loadedWard, ids: sequentialIds('mv') };
    const firstMove = moveToDugout(board, context, { memberId: organ.memberId, from: organ.positionId });
    const secondMove = moveToDugout(board, context, {
      memberId: music.memberId,
      from: music.positionId,
    });
    if (!firstMove.ok) expect.fail(firstMove.error.message);
    if (!secondMove.ok) expect.fail(secondMove.error.message);

    const first = take(store.commitBoard(firstMove.board, 0));
    const counts = boardCounts(db);
    const snapshot = dumpTables(db);
    const second = store.commitBoard(secondMove.board, 0);

    expect(second.ok).toBe(false);
    if (second.ok) expect.fail('expected stale');
    expect(second.error.code).toBe('stale');
    if (second.error.code !== 'stale') expect.fail('expected stale');
    expect(second.error.currentVersion).toBe(1);
    expect(second.error.message.length).toBeGreaterThan(0);
    expect(store.loadBoard(board.id)).toEqual(first);
    expect(boardCounts(db)).toEqual(counts);
    expect(dumpTables(db)).toEqual(snapshot);
    expect(scalar(db, 'SELECT version AS n FROM boards WHERE id = ?', board.id)).toBe(1);
  });

  it('current, baseline and accepted proposal are not editable', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const currentBefore = store.loadCurrent();
    const refusedCurrent = store.commitBoard(current, current.version);
    expect(refusedCurrent.ok).toBe(false);
    if (refusedCurrent.ok) expect.fail('expected not_editable');
    expect(refusedCurrent.error.code).toBe('not_editable');
    expect(store.loadCurrent()).toEqual(currentBefore);

    const proposal = take(
      store.createProposal({ name: 'Draft', rationale: null, source: { kind: 'current' } }, sequentialIds('c')),
    );
    const baselineBefore = store.loadBoard(proposal.baseline.id);
    const refusedBaseline = store.commitBoard(proposal.baseline, proposal.baseline.version);
    expect(refusedBaseline.ok).toBe(false);
    if (refusedBaseline.ok) expect.fail('expected not_editable');
    expect(refusedBaseline.error.code).toBe('not_editable');
    expect(store.loadBoard(proposal.baseline.id)).toEqual(baselineBefore);

    insertUser(db, 'user-ada');
    const accepted = unwrap(
      createProposal(
        {
          id: proposalId('accepted-src'),
          name: 'Accepted source',
          rationale: null,
          status: 'accepted',
          accepted: { by: userId('user-ada'), at: FIXED_ISO, summary: 'Frozen summary' },
          baseline: { ...current, id: boardId('accepted-src-baseline'), kind: 'baseline' },
          board: { ...current, id: boardId('accepted-src-board'), kind: 'proposal' },
          tabOrder: 3,
          createdAt: FIXED_ISO,
          updatedAt: FIXED_ISO,
        },
        ward,
      ),
    );
    take(store.insertProposal(accepted));
    const acceptedBefore = store.loadProposal(accepted.id);
    const refusedAccepted = store.commitBoard(accepted.board, accepted.board.version);
    expect(refusedAccepted.ok).toBe(false);
    if (refusedAccepted.ok) expect.fail('expected not_editable');
    expect(refusedAccepted.error.code).toBe('not_editable');
    expect(store.loadProposal(accepted.id)).toEqual(acceptedBefore);
    expect(store.loadBoard(accepted.board.id)).toEqual(accepted.board);
  });

  it('unknown board is not_found', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const before = store.loadCurrent();

    const result = store.commitBoard({ ...current, id: boardId('missing-board') }, 0);

    expect(result.ok).toBe(false);
    if (result.ok) expect.fail('expected not_found');
    expect(result.error.code).toBe('not_found');
    expect(store.loadCurrent()).toEqual(before);
    expect(store.loadBoard(boardId('missing-board'))).toBeNull();
  });

  it('invalid board is rejected before writing', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const { board } = draftFromCurrent(store);
    const organ = placementByTitle(board, 'Organist');
    const next: Board = {
      ...board,
      placements: { ...board.placements, [organ.positionId]: memberId('missing-person') },
    };
    expect(createBoard(next, store.loadWard()).ok).toBe(false);
    const counts = boardCounts(db);

    const result = store.commitBoard(next, board.version);

    expect(result.ok).toBe(false);
    if (result.ok) expect.fail('expected invalid');
    expect(result.error.code).toBe('invalid');
    expect(store.loadBoard(board.id)).toEqual(board);
    expect(scalar(db, 'SELECT version AS n FROM boards WHERE id = ?', board.id)).toBe(board.version);
    expect(boardCounts(db)).toEqual(counts);
  });

  it('failure mid-transaction rolls back', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const { board } = draftFromCurrent(store);
    const organ = placementByTitle(board, 'Organist');
    const next: Board = {
      ...board,
      approvals: [
        {
          memberId: organ.memberId,
          positionId: organ.positionId,
          approvedBy: userId('ghost-user'),
          approvedAt: FIXED_ISO,
        },
      ],
    };
    expect(createBoard(next, store.loadWard()).ok).toBe(true);
    const counts = boardCounts(db);
    const version = scalar(db, 'SELECT version AS n FROM boards WHERE id = ?', board.id);
    const snapshot = dumpTables(db);

    const result = store.commitBoard(next, board.version);

    expect(result.ok).toBe(false);
    if (result.ok) expect.fail('expected invalid');
    expect(result.error.code).toBe('invalid');
    expect(boardCounts(db)).toEqual(counts);
    expect(scalar(db, 'SELECT version AS n FROM boards WHERE id = ?', board.id)).toBe(version);
    expect(dumpTables(db)).toEqual(snapshot);
    expect(store.loadBoard(board.id)).toEqual(board);
  });

  it('commit to a proposal leaves current, its baseline and other proposals untouched', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const ids = sequentialIds('keep');
    const alpha = take(
      store.createProposal({ name: 'Alpha', rationale: null, source: { kind: 'current' } }, ids),
    );
    const beta = take(
      store.createProposal({ name: 'Beta', rationale: 'other', source: { kind: 'current' } }, ids),
    );
    const currentBefore = store.loadCurrent();
    const baselineBefore = store.loadBoard(alpha.baseline.id);
    const betaBefore = store.loadProposal(beta.id);
    const wardBefore = store.loadWard();
    const organ = placementByTitle(alpha.board, 'Organist');
    const moved = moveToDugout(
      alpha.board,
      { ward: wardBefore, ids: sequentialIds('mv') },
      { memberId: organ.memberId, from: organ.positionId },
    );
    if (!moved.ok) expect.fail(moved.error.message);

    const committed = take(store.commitBoard(moved.board, 0));

    expect(store.loadCurrent()).toEqual(currentBefore);
    expect(store.loadBoard(alpha.baseline.id)).toEqual(baselineBefore);
    expect(store.loadProposal(beta.id)).toEqual(betaBefore);
    expect(store.loadWard()).toEqual(wardBefore);
    expect(store.loadBoard(alpha.board.id)).toEqual(committed);
    expect(arrangementOf(committed)).not.toEqual(arrangementOf(alpha.board));
  });

  it('non-proposal payload is not editable', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'commit' }));
    const { board } = draftFromCurrent(store);
    const member = Object.values(store.loadWard().members)[0];
    if (member === undefined) expect.fail('ward has no member');
    const next: Board = { ...board, kind: 'baseline', dugoutInclusions: [member.id] };
    const counts = boardCounts(db);

    const result = store.commitBoard(next, board.version);

    expect(result.ok).toBe(false);
    if (result.ok) expect.fail('expected not_editable');
    expect(result.error.code).toBe('not_editable');
    expect(store.loadBoard(board.id)).toEqual(board);
    expect(boardCounts(db)).toEqual(counts);
  });
});
