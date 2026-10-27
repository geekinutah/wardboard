import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  proposalId,
  tagId,
  userId,
  type Board,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_ISO,
  cleanupStores,
  insertUser,
  openTempStore,
  scalar,
  take,
  unwrap,
} from './helpers.ts';

afterEach(cleanupStores);

function mappedWardAndBoard(): { ward: Ward; current: Board } {
  const zebra = tagId('tag-z');
  const apple = tagId('tag-a');
  const removed = memberId('m-zeta');
  const approved = memberId('m-alpha');
  const hidden = boardGroupId('bg-hidden');
  const presidency = callingGroupId('cg-pres');
  const priests = callingGroupId('cg-priests');
  const president = assignmentId('a-president');
  const teachers = assignmentId('a-list');
  const presidentPosition = positionId('p-president');
  const late = positionId('p-late');
  const early = positionId('p-early');

  const ward = unwrap(
    createWard({
      tags: {
        [zebra]: { id: zebra, name: 'Zebra' },
        [apple]: { id: apple, name: 'Apple' },
      },
      members: {
        [removed]: {
          id: removed,
          name: 'Zed Removed',
          category: 'adult',
          photoRef: null,
          note: null,
          tagIds: [],
          needsApproval: false,
          removedDate: '2026-02-02',
          externalCallings: [],
        },
        [approved]: {
          id: approved,
          name: 'Ann Approved',
          category: 'youth',
          photoRef: 'photo-ann',
          note: 'Brings a keyboard.',
          tagIds: [zebra, apple],
          needsApproval: true,
          removedDate: null,
          externalCallings: [
            { unit: 'Second Unit', title: 'Second Title' },
            { unit: 'First Unit', title: 'First Title' },
          ],
        },
      },
    }),
  );

  const current = unwrap(
    createBoard(
      {
        id: boardId('board-rich'),
        kind: 'current',
        version: 4,
        boardGroups: {
          [hidden]: { id: hidden, name: 'Hidden Primary', order: 3, visible: false, key: 'primary' },
        },
        callingGroups: {
          [presidency]: {
            id: presidency,
            name: 'Primary Presidency',
            order: 2,
            parent: { kind: 'boardGroup', id: hidden },
            kind: 'presidency',
            key: 'primary_presidency',
          },
          [priests]: {
            id: priests,
            name: 'Priests Quorum',
            order: 0,
            parent: { kind: 'callingGroup', id: presidency },
            kind: 'quorum',
            key: 'priests_quorum',
          },
        },
        assignments: {
          [president]: {
            id: president,
            groupId: presidency,
            title: 'President',
            type: 'single',
            order: 0,
            enabled: true,
            prominent: true,
            origin: 'standard',
            leadershipRole: 'president',
            callingTagIds: [],
            preferredMemberTagIds: [],
          },
          [teachers]: {
            id: teachers,
            groupId: priests,
            title: 'Custom Teachers',
            type: 'list',
            order: 4,
            enabled: false,
            prominent: false,
            origin: 'custom',
            leadershipRole: 'secretary',
            callingTagIds: [zebra, apple],
            preferredMemberTagIds: [apple, zebra],
          },
        },
        positions: {
          [presidentPosition]: {
            id: presidentPosition,
            assignmentId: president,
            lineageId: lineageId('ln-president'),
            order: 0,
          },
          [late]: { id: late, assignmentId: teachers, lineageId: lineageId('ln-late'), order: 2 },
          [early]: { id: early, assignmentId: teachers, lineageId: lineageId('ln-early'), order: 0 },
        },
        placements: {
          [presidentPosition]: removed,
          [late]: approved,
        },
        oversight: [
          {
            overseer: 'second_counselor',
            target: { kind: 'boardGroup', id: hidden },
            fixed: false,
          },
          {
            overseer: 'bishop',
            target: { kind: 'callingGroup', id: priests },
            fixed: true,
          },
        ],
        dugoutInclusions: [removed, approved],
        approvals: [
          {
            memberId: approved,
            positionId: late,
            approvedBy: userId('user-ada'),
            approvedAt: FIXED_ISO,
          },
        ],
      },
      ward,
    ),
  );

  return { ward, current };
}

describe('board store round trip', () => {
  it('empty store has no current and no proposals', () => {
    const { store } = openTempStore();

    expect(store.loadCurrent()).toBeNull();
    expect(store.listProposals()).toEqual([]);
    expect(store.loadBoard(boardId('missing'))).toBeNull();
    expect(store.loadProposal(proposalId('missing'))).toBeNull();
    expect(store.loadWard()).toEqual({ members: {}, tags: {} });
  });

  it('fixture ward and current round-trip deep-equal', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();

    take(store.initialize({ ward, current, importVersion: 'fixture' }));

    expect(store.loadWard()).toEqual(ward);
    expect(store.loadCurrent()?.board).toEqual(current);
  });

  it('every mapped field survives', () => {
    const { db, store } = openTempStore();
    insertUser(db, 'user-ada');
    const { ward, current } = mappedWardAndBoard();

    take(store.initialize({ ward, current, importVersion: 'mapped' }));

    expect(store.loadWard()).toEqual(ward);
    expect(store.loadCurrent()?.board).toEqual(current);
  });

  it('proposal sharing ids with its baseline round-trips', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const proposal = buildFixtureProposal(current, ward);

    take(store.insertProposal(proposal));

    expect(store.loadProposal(proposal.id)).toEqual(proposal);
    expect(store.loadBoard(proposal.baseline.id)).toEqual(proposal.baseline);
    expect(store.loadBoard(proposal.board.id)).toEqual(proposal.board);
    expect(db.prepare('SELECT name FROM boards WHERE id = ?').get(proposal.baseline.id)?.['name']).toBe(
      `${proposal.name} (baseline)`,
    );
    const proposalRow = db
      .prepare('SELECT proposal_id, kind, baseline_board_id, name FROM boards WHERE id = ?')
      .get(proposal.board.id);
    expect(proposalRow?.['proposal_id']).toBe(proposal.id);
    expect(proposalRow?.['kind']).toBe('proposal');
    expect(proposalRow?.['baseline_board_id']).toBe(proposal.baseline.id);
    expect(proposalRow?.['name']).toBe(proposal.name);
  });

  it('initialize refuses a second time', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'v1' }));
    const loadedWard = store.loadWard();
    const loadedCurrent = store.loadCurrent();

    const again = store.initialize({
      ward,
      current: { ...current, version: 99 },
      importVersion: 'v2',
    });

    expect(again.ok).toBe(false);
    if (again.ok) expect.fail('expected already_initialized');
    expect(again.error.code).toBe('already_initialized');
    expect(store.loadWard()).toEqual(loadedWard);
    expect(store.loadCurrent()).toEqual(loadedCurrent);
  });

  it('initialize rejects invalid input and writes nothing', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    const occupied = Object.entries(current.placements)[0];
    if (occupied === undefined) throw new Error('fixture current has no placement');
    const [rawPosition] = occupied;
    const broken: Board = {
      ...current,
      placements: { ...current.placements, [positionId(rawPosition)]: memberId('missing-member') },
    };
    expect(createBoard(broken, ward).ok).toBe(false);

    const result = store.initialize({ ward, current: broken, importVersion: 'bad' });

    expect(result.ok).toBe(false);
    if (result.ok) expect.fail('expected invalid');
    expect(result.error.code).toBe('invalid');
    expect(store.loadCurrent()).toBeNull();
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM members')).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM boards')).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM tags')).toBe(0);
  });

  it('importedAt and importVersion are recorded', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();

    take(store.initialize({ ward, current, importVersion: 'rev-9' }));

    expect(store.loadCurrent()).toMatchObject({ importVersion: 'rev-9', importedAt: FIXED_ISO });
    const row = db
      .prepare(
        "SELECT name, import_version, created_at, updated_at FROM boards WHERE kind = 'current'",
      )
      .get();
    expect(row?.['name']).toBe('Current');
    expect(row?.['import_version']).toBe('rev-9');
    expect(row?.['created_at']).toBe(FIXED_ISO);
    expect(row?.['updated_at']).toBe(FIXED_ISO);
  });
});
