import type { DatabaseSync } from 'node:sqlite';
import {
  assignmentId,
  boardGroupId,
  memberId,
  positionId,
  sequentialIds,
  userId,
  type Board,
  type CallingAssignment,
  type MemberId,
  type Position,
  type Ward,
} from '@wardboard/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applyImport, planImport, type ImportPlan, type ImportResolution } from '../../src/import/index.ts';
import type { Store, StoreResult } from '../../src/index.ts';
import { cleanupStores, insertUser, openTempStore } from '../store/helpers.ts';
import { IMPORTED_AT, REPORT_DATE, buildCurrent, bundle, importClock, person, row, tag } from './helpers.ts';

afterEach(() => {
  cleanupStores();
});

type Resolutions = Readonly<Record<string, ImportResolution>>;
type Bundle = ReturnType<typeof bundle>;

function prepare(
  input: Parameters<typeof buildCurrent>[0],
  options?: { user?: string; importVersion?: string },
): { db: DatabaseSync; store: Store } {
  const opened = openTempStore(importClock);
  if (options?.user !== undefined) insertUser(opened.db, options.user);
  const built = buildCurrent(input);
  const initialized = opened.store.initialize({
    ward: built.ward,
    current: built.current,
    importVersion: options?.importVersion ?? 'fixture',
  });
  if (!initialized.ok) {
    throw new Error(`${initialized.error.code}: ${initialized.error.message}`);
  }
  return opened;
}

function currentBoard(store: Store): Board {
  const current = store.loadCurrent();
  if (current === null) throw new Error('current board is missing');
  return current.board;
}

function planFor(
  store: Store,
  imported: Bundle,
  previousFingerprints?: ImportPlan['fingerprints'],
): ImportPlan {
  return planImport({
    bundle: imported,
    ward: store.loadWard(),
    current: currentBoard(store),
    ...(previousFingerprints === undefined ? {} : { previousFingerprints }),
  });
}

function applyFor(
  store: Store,
  imported: Bundle,
  resolutions: Resolutions,
  expectedVersion?: number,
  previousFingerprints?: ImportPlan['fingerprints'],
): { plan: ImportPlan; applied: ReturnType<typeof applyImport> } {
  const plan = planFor(store, imported, previousFingerprints);
  const version = expectedVersion ?? currentBoard(store).version;
  const applied = applyImport({
    plan,
    resolutions,
    expectedVersion: version,
    ids: sequentialIds('new'),
    clock: importClock,
  });
  return { plan, applied };
}

function commitFor(
  store: Store,
  imported: Bundle,
  resolutions: Resolutions,
  expectedVersion?: number,
): {
  plan: ImportPlan;
  applied: Extract<ReturnType<typeof applyImport>, { ok: true }>;
  ward: Ward;
  record: NonNullable<ReturnType<Store['loadCurrent']>>;
} {
  const version = expectedVersion ?? currentBoard(store).version;
  const { plan, applied } = applyFor(store, imported, resolutions, version);
  if (!applied.ok) {
    const detail = applied.error === 'stale' ? ` ${String(applied.currentVersion)}` : '';
    throw new Error(`${applied.error}${detail}`);
  }
  const replaced: StoreResult<{ ward: Ward; current: NonNullable<ReturnType<Store['loadCurrent']>> }> =
    store.replaceCurrent({
      ward: applied.ward,
      current: applied.current,
      expectedVersion: version,
      importVersion: applied.importVersion,
      importedAt: applied.importedAt,
    });
  if (!replaced.ok) throw new Error(`${replaced.error.code}: ${replaced.error.message}`);
  const record = store.loadCurrent();
  if (record === null) throw new Error('current board is missing after replace');
  return { plan, applied, ward: store.loadWard(), record };
}

function snapshot(store: Store): {
  ward: Ward;
  current: NonNullable<ReturnType<Store['loadCurrent']>>;
  proposals: unknown[];
} {
  const current = store.loadCurrent();
  if (current === null) throw new Error('current board is missing');
  return {
    ward: store.loadWard(),
    current,
    proposals: store.listProposals().map((item) => store.loadProposal(item.id)),
  };
}

function member(ward: Ward, id: string): Ward['members'][MemberId] {
  const found = ward.members[memberId(id)];
  if (found === undefined) throw new Error(`missing member ${id}`);
  return found;
}

function titled(board: Board, title: string): CallingAssignment[] {
  return Object.values(board.assignments).filter((item) => item.title === title);
}

function positionsOf(board: Board, assignmentId: string): Position[] {
  return Object.values(board.positions)
    .filter((item) => item.assignmentId === assignmentId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function placedIds(board: Board, positions: readonly Position[]): (MemberId | undefined)[] {
  return positions.map((item) => board.placements[item.id]);
}

const bishopric = {
  id: 'bg-bishopric',
  name: 'Bishopric',
  key: 'bishopric' as const,
  callingGroups: [
    {
      id: 'cg-bishopric',
      name: 'Bishopric',
      assignments: [
        {
          id: 'as-bishop',
          title: 'Bishop',
          positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop', memberId: 'mem-stanley' }],
        },
      ],
    },
  ],
};

describe('import plan and replace', () => {
  it('an exact unique match keeps the note and reuses the id', () => {
    const { store } = prepare(
      {
        tags: [tag('tag-clerk', 'Clerk')],
        members: [
          person('mem-stanley', 'Stanley, Zed', {
            note: 'Keep this note',
            photoRef: 'photo-stanley',
            needsApproval: true,
            tagIds: [tag('tag-clerk', 'Clerk').id],
            externalCallings: [{ unit: 'Old Unit', title: 'Old Calling' }],
          }),
        ],
        groups: [bishopric],
        dugout: ['mem-stanley'],
        oversight: [
          {
            overseer: 'bishop',
            target: { kind: 'boardGroup', id: boardGroupId('bg-bishopric') },
            fixed: false,
          },
        ],
        approvals: [
          {
            memberId: memberId('mem-stanley'),
            positionId: positionId('pos-bishop'),
            approvedBy: userId('user-ada'),
            approvedAt: IMPORTED_AT,
          },
        ],
      },
      { user: 'user-ada' },
    );
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Stanley,  Zed' }])],
      externalCallings: [
        { section: 'stake', name: 'Stanley,  Zed', calling: 'Stake Clerk', servingUnit: null },
        {
          section: 'serving-outside-unit',
          name: 'Stanley,  Zed',
          calling: 'Missionary',
          servingUnit: 'Maple Stake',
        },
        {
          section: 'living-outside-unit',
          name: 'Stanley,  Zed',
          calling: 'Temple Worker',
          servingUnit: null,
        },
      ],
    });
    const { plan, applied, ward, record } = commitFor(store, imported, {});
    const kept = member(ward, 'mem-stanley');
    expect(kept.note).toBe('Keep this note');
    expect(kept.photoRef).toBe('photo-stanley');
    expect(kept.needsApproval).toBe(true);
    expect(kept.tagIds).toEqual([tag('tag-clerk', 'Clerk').id]);
    expect(kept.name).toBe('Stanley,  Zed');
    expect(kept.removedDate).toBeNull();
    expect(kept.category).toBe('adult');
    expect(kept.externalCallings).toEqual([
      { unit: 'Stake', title: 'Stake Clerk' },
      { unit: 'Maple Stake', title: 'Missionary' },
      { unit: 'Living outside of Unit', title: 'Temple Worker' },
    ]);
    expect(plan.absent).toEqual([]);
    expect(record.board.placements[positionId('pos-bishop')]).toBe(memberId('mem-stanley'));
    expect(record.board.approvals).toEqual([
      {
        memberId: memberId('mem-stanley'),
        positionId: positionId('pos-bishop'),
        approvedBy: userId('user-ada'),
        approvedAt: IMPORTED_AT,
      },
    ]);
    expect(record.board.dugoutInclusions).toEqual([memberId('mem-stanley')]);
    expect(record.board.oversight).toEqual([
      {
        overseer: 'bishop',
        target: { kind: 'boardGroup', id: boardGroupId('bg-bishopric') },
        fixed: false,
      },
    ]);
    expect(record.board.version).toBe(1);
    expect(record.importVersion).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/);
    expect(record.importedAt).toBe(IMPORTED_AT);
    expect(applied.matched).toBe(1);
    expect(applied.created).toBe(0);
    expect(applied.removed).toBe(0);
    expect(plan.matchedPositions).toBe(1);
    expect(plan.keptPositions).toBe(0);
  });

  it('an unchosen namesake is removed without taking the note', () => {
    const { store } = prepare({
      members: [
        person('mem-a', 'Pike, Ada', { note: 'note-a' }),
        person('mem-b', 'Pike, Ada', { note: 'note-b' }),
      ],
      groups: [
        {
          ...bishopric,
          callingGroups: [
            {
              id: 'cg-bishopric',
              name: 'Bishopric',
              assignments: [
                {
                  id: 'as-bishop',
                  title: 'Bishop',
                  positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Pike, Ada' }])],
    });
    const { applied, ward, record } = commitFor(store, imported, {
      'pike, ada': { action: 'new', category: 'adult' },
    });
    expect(member(ward, 'mem-a').removedDate).toBe(REPORT_DATE);
    expect(member(ward, 'mem-b').removedDate).toBe(REPORT_DATE);
    expect(member(ward, 'mem-a').note).toBe('note-a');
    expect(member(ward, 'mem-b').note).toBe('note-b');
    const created = Object.values(ward.members).filter((item) => item.id !== 'mem-a' && item.id !== 'mem-b');
    expect(created).toHaveLength(1);
    expect(created[0]?.note).toBeNull();
    expect(created[0]?.tagIds).toEqual([]);
    expect(created[0]?.photoRef).toBeNull();
    expect(record.board.placements[positionId('pos-bishop')]).toBe(created[0]?.id);
    expect(applied.created).toBe(1);
    expect(applied.removed).toBe(2);
    expect(Object.keys(ward.members)).toHaveLength(3);
  });

  it('a chosen namesake keeps the note', () => {
    const { store } = prepare({
      members: [
        person('mem-a', 'Pike, Ada', { note: 'note-a' }),
        person('mem-b', 'Pike, Ada', { note: 'note-b' }),
      ],
      groups: [
        {
          id: 'bg-bishopric',
          name: 'Bishopric',
          key: 'bishopric' as const,
          callingGroups: [
            {
              id: 'cg-bishopric',
              name: 'Bishopric',
              assignments: [
                {
                  id: 'as-bishop',
                  title: 'Bishop',
                  positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const { plan, applied, ward, record } = commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Pike, Ada' }])],
      }),
      { 'pike, ada': { action: 'match', memberId: 'mem-b' } },
    );
    const namesake = plan.decisions.find((decision) => decision.key === 'pike, ada');
    expect(namesake).toMatchObject({ kind: 'ambiguous', reason: 'namesake' });
    expect(member(ward, 'mem-b').note).toBe('note-b');
    expect(member(ward, 'mem-b').removedDate).toBeNull();
    expect(member(ward, 'mem-a').removedDate).toBe(REPORT_DATE);
    expect(record.board.placements[positionId('pos-bishop')]).toBe(memberId('mem-b'));
    expect(applied.matched).toBe(1);
    expect(applied.created).toBe(0);
    expect(applied.removed).toBe(1);
    expect(Object.keys(ward.members)).toHaveLength(2);
  });

  it('a returning member stays removed until confirmed', () => {
    const { store } = prepare({
      members: [person('mem-una', 'Una, Wren', { removedDate: '2026-01-01', note: 'stay-note' })],
      groups: [bishopricWith('mem-una')],
    });
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Una, Wren' }])],
    });
    const refused = applyFor(store, imported, {});
    expect(refused.plan.returning).toEqual([{ key: 'una, wren', memberId: 'mem-una' }]);
    expect(refused.applied).toEqual({ ok: false, error: 'unresolved' });
    expect(member(store.loadWard(), 'mem-una').removedDate).toBe('2026-01-01');

    const { ward, record } = commitFor(store, imported, {
      'una, wren': { action: 'match', memberId: 'mem-una', confirmReturn: true },
    });
    expect(member(ward, 'mem-una').removedDate).toBeNull();
    expect(member(ward, 'mem-una').note).toBe('stay-note');
    expect(record.board.placements[positionId('pos-bishop')]).toBe(memberId('mem-una'));
  });

  it('declining a return creates a new member', () => {
    const { store } = prepare({
      members: [person('mem-una', 'Una, Wren', { removedDate: '2026-01-01', note: 'stay-note' })],
      groups: [bishopricWith('mem-una')],
    });
    const { applied, ward, record } = commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Una, Wren' }])],
      }),
      { 'una, wren': { action: 'new', category: 'youth' } },
    );
    expect(member(ward, 'mem-una').removedDate).toBe('2026-01-01');
    expect(member(ward, 'mem-una').note).toBe('stay-note');
    const created = Object.values(ward.members).filter((item) => item.id !== 'mem-una');
    expect(created).toHaveLength(1);
    expect(created[0]?.note).toBeNull();
    expect(created[0]?.category).toBe('youth');
    expect(record.board.placements[positionId('pos-bishop')]).toBe(created[0]?.id);
    expect(applied.created).toBe(1);
    expect(applied.matched).toBe(0);
    expect(applied.removed).toBe(0);
  });

  it('an earlier removed date is kept', () => {
    const { store } = prepare({
      members: [
        person('mem-early', 'Early, Eve', { removedDate: '2026-01-02' }),
        person('mem-open', 'Open, Otto'),
      ],
      groups: [bishopricWith(null)],
    });
    const { applied, ward } = commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'New, Nora' }])],
      }),
      { 'new, nora': { action: 'new', category: 'adult' } },
    );
    expect(member(ward, 'mem-early').removedDate).toBe('2026-01-02');
    expect(member(ward, 'mem-open').removedDate).toBe(REPORT_DATE);
    expect(applied.removed).toBe(1);
  });

  it('a conflict vacates the seat and does not remove the member', () => {
    const { store } = prepare({
      members: [
        person('mem-gus', 'Westdale, Gus', {
          note: 'keep-gus',
          externalCallings: [{ unit: 'Old Stake', title: 'Old Calling' }],
        }),
      ],
      groups: [bishopricWith('mem-gus')],
    });
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Westdale, Gus' }])],
      candidates: [{ name: 'Westdale, Gus', category: 'youth' }],
    });
    const refused = applyFor(store, imported, { 'westdale, gus': { action: 'match', memberId: 'mem-gus' } });
    expect(refused.plan.needsCategory).toContain('westdale, gus');
    expect(refused.applied).toEqual({ ok: false, error: 'unresolved' });
    expect(member(store.loadWard(), 'mem-gus').removedDate).toBeNull();

    const { applied, ward, record } = commitFor(store, imported, {
      'westdale, gus': { action: 'new', category: 'adult' },
    });
    const kept = member(ward, 'mem-gus');
    expect(kept.removedDate).toBeNull();
    expect(kept.note).toBe('keep-gus');
    expect(kept.category).toBe('adult');
    expect(kept.externalCallings).toEqual([{ unit: 'Old Stake', title: 'Old Calling' }]);
    expect(record.board.placements[positionId('pos-bishop')]).toBeUndefined();
    const created = Object.values(ward.members).filter((item) => item.id !== 'mem-gus');
    expect(created).toHaveLength(1);
    expect(created[0]?.id).not.toBe(memberId('mem-gus'));
    expect(created[0]?.note).toBeNull();
    expect(applied.removed).toBe(0);
    expect(applied.created).toBe(1);
  });

  it('a new calling holder needs a category', () => {
    const { store } = prepare({ members: [], groups: [bishopricWith(null)] });
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'New, Nora' }])],
    });
    const refused = applyFor(store, imported, {});
    expect(refused.plan.needsCategory).toContain('new, nora');
    expect(refused.applied).toEqual({ ok: false, error: 'unresolved' });
    expect(Object.keys(store.loadWard().members)).toHaveLength(0);

    const { ward, record } = commitFor(store, imported, {
      'new, nora': { action: 'new', category: 'youth' },
    });
    const created = Object.values(ward.members);
    expect(created).toHaveLength(1);
    expect(created[0]?.category).toBe('youth');
    expect(JSON.stringify(ward).includes('age')).toBe(false);
    expect(JSON.stringify(ward).includes('birth')).toBe(false);
    expect(record.board.placements[positionId('pos-bishop')]).toBe(created[0]?.id);
  });

  it('a youth candidate stores youth and no age', () => {
    const { store } = prepare({ members: [], groups: [bishopricWith(null)] });
    const { plan, ward } = commitFor(
      store,
      bundle({ candidates: [{ name: 'Youth, Yara', category: 'youth' }] }),
      {},
    );
    expect(plan.needsCategory).not.toContain('youth, yara');
    const created = Object.values(ward.members);
    expect(created).toHaveLength(1);
    expect(created[0]?.category).toBe('youth');
    expect(created[0]?.name).toBe('Youth, Yara');
    const json = JSON.stringify(ward);
    expect(json.includes('age')).toBe(false);
    expect(json.includes('birth')).toBe(false);
  });

  it('a vacant report row keeps the position and clears the occupant', () => {
    const { store } = prepare({
      members: [person('mem-stanley', 'Stanley, Zed')],
      groups: [bishopric],
    });
    const { record } = commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: null }])],
      }),
      {},
    );
    const position = record.board.positions[positionId('pos-bishop')];
    expect(position?.lineageId).toBe('lin-bishop');
    expect(record.board.placements[positionId('pos-bishop')]).toBeUndefined();
    expect(Object.values(record.board.positions)).toHaveLength(1);
  });

  it('a custom position absent from the report is kept and vacated', () => {
    const { store } = prepare({
      members: [person('mem-stanley', 'Stanley, Zed'), person('mem-editor', 'Editor, Eve')],
      groups: [
        {
          id: 'bg-bishopric',
          name: 'Bishopric',
          key: 'bishopric' as const,
          callingGroups: [
            {
              id: 'cg-bishopric',
              name: 'Bishopric',
              assignments: [
                {
                  id: 'as-bishop',
                  title: 'Bishop',
                  positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop', memberId: 'mem-stanley' }],
                },
                {
                  id: 'as-news',
                  title: 'Newsletter Editor',
                  origin: 'custom' as const,
                  positions: [{ id: 'pos-news', lineageId: 'lin-news', memberId: 'mem-editor' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const { record } = commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Stanley, Zed' }])],
      }),
      {},
    );
    const custom = record.board.assignments[assignmentId('as-news')];
    expect(custom?.origin).toBe('custom');
    expect(custom?.title).toBe('Newsletter Editor');
    expect(record.board.positions[positionId('pos-news')]?.lineageId).toBe('lin-news');
    expect(record.board.placements[positionId('pos-news')]).toBeUndefined();
    expect(record.board.placements[positionId('pos-bishop')]).toBe(memberId('mem-stanley'));
  });

  it('an unfamiliar title adds one single position', () => {
    const { store } = prepare({
      members: [person('mem-stanley', 'Stanley, Zed')],
      groups: [bishopric],
    });
    const { plan, record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Bishopric', 'Bishopric', [{ title: 'Ward Clerk', occupant: 'Clerk, Cora' }]),
        ],
      }),
      { 'clerk, cora': { action: 'new', category: 'adult' } },
    );
    const added = titled(record.board, 'Ward Clerk');
    expect(added).toHaveLength(1);
    expect(added[0]?.type).toBe('single');
    expect(added[0]?.origin).toBe('standard');
    expect(added[0]?.leadershipRole).toBeNull();
    expect(added[0]?.groupId).toBe('cg-bishopric');
    const positions = positionsOf(record.board, added[0]?.id ?? '');
    expect(positions).toHaveLength(1);
    expect(record.board.positions[positionId('pos-bishop')]?.lineageId).toBe('lin-bishop');
    expect(positions[0]?.lineageId).not.toBe('lin-bishop');
    expect(plan.unfamiliar).toEqual([
      { organization: 'Bishopric', group: 'Bishopric', title: 'Ward Clerk', vacant: false },
    ]);
    expect(plan.keptPositions).toBe(1);
    expect(plan.matchedPositions).toBe(0);
  });

  it('two new rows of one title add a list', () => {
    const { store } = prepare({ members: [], groups: [bishopricWith(null)] });
    const { record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Bishopric', 'Bishopric', [
            { title: 'Teacher', occupant: 'One, Amy' },
            { title: 'Teacher', occupant: 'Two, Bea' },
          ]),
        ],
      }),
      {
        'one, amy': { action: 'new', category: 'adult' },
        'two, bea': { action: 'new', category: 'adult' },
      },
    );
    const lists = titled(record.board, 'Teacher');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.type).toBe('list');
    const positions = positionsOf(record.board, lists[0]?.id ?? '');
    expect(positions).toHaveLength(2);
    const occupants = placedIds(record.board, positions);
    expect(occupants[0]).toBeDefined();
    expect(occupants[1]).toBeDefined();
    expect(occupants[0]).not.toBe(occupants[1]);
    expect(titled(record.board, 'Teacher').filter((item) => item.type === 'single')).toHaveLength(0);
  });

  it('a repeated name fills only the first list row', () => {
    const { store } = prepare({
      members: [],
      groups: [
        {
          id: 'bg-wide',
          name: 'Ward Wide',
          key: 'ward_wide' as const,
          callingGroups: [{ id: 'cg-mission', name: 'Ward Missionaries' }],
        },
      ],
    });
    const { record, ward } = commitFor(
      store,
      bundle({
        organizations: [
          row('Ward Missionaries', 'Ward Missionaries', [
            { title: 'Ward Missionary', occupant: 'Wrenford, Una' },
            { title: 'Ward Missionary', occupant: 'Wrenford, Una' },
            { title: 'Mission Leader', occupant: 'Wrenford, Una' },
          ]),
        ],
      }),
      { 'wrenford, una': { action: 'new', category: 'adult' } },
    );
    const lists = titled(record.board, 'Ward Missionary');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.type).toBe('list');
    const positions = positionsOf(record.board, lists[0]?.id ?? '');
    expect(positions).toHaveLength(2);
    const una = Object.values(ward.members).find((item) => item.name === 'Wrenford, Una');
    if (una === undefined) throw new Error('missing Wrenford, Una');
    expect(record.board.placements[positions[0]?.id ?? positionId('missing')]).toBe(una.id);
    expect(record.board.placements[positions[1]?.id ?? positionId('missing')]).toBeUndefined();
    const leader = titled(record.board, 'Mission Leader');
    expect(leader).toHaveLength(1);
    expect(leader[0]?.type).toBe('single');
    const leaderPositions = positionsOf(record.board, leader[0]?.id ?? '');
    expect(leaderPositions).toHaveLength(1);
    expect(record.board.placements[leaderPositions[0]?.id ?? positionId('missing')]).toBe(una.id);
    expect(Object.values(ward.members).filter((item) => item.name === 'Wrenford, Una')).toHaveLength(1);
  });

  it('a single assignment is not widened', () => {
    const { store } = prepare({
      members: [person('mem-amy', 'Amy, One'), person('mem-bea', 'Bea, Two')],
      groups: [bishopricWith('mem-amy')],
    });
    const { record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Bishopric', 'Bishopric', [
            { title: 'Bishop', occupant: 'Amy, One' },
            { title: 'Bishop', occupant: 'Bea, Two' },
          ]),
        ],
      }),
      {},
    );
    const single = record.board.assignments[assignmentId('as-bishop')];
    expect(single?.type).toBe('single');
    expect(single?.title).toBe('Bishop');
    expect(positionsOf(record.board, 'as-bishop')).toHaveLength(1);
    expect(record.board.placements[positionId('pos-bishop')]).toBe(memberId('mem-amy'));
    const extras = titled(record.board, 'Bishop').filter((item) => item.id !== 'as-bishop');
    expect(extras).toHaveLength(1);
    expect(extras[0]?.type).toBe('list');
    const extraPositions = positionsOf(record.board, extras[0]?.id ?? '');
    expect(extraPositions).toHaveLength(1);
    expect(record.board.placements[extraPositions[0]?.id ?? positionId('missing')]).toBe(memberId('mem-bea'));
  });

  it('aaronic report rows use the aaronic board group', () => {
    const { store } = prepare({
      members: [],
      groups: [
        {
          id: 'bg-aaronic',
          name: 'Young Men / Aaronic Priesthood',
          key: 'aaronic_priesthood',
        },
      ],
    });
    const { record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Aaronic Priesthood Quorums', 'Deacons Quorum', [
            { title: 'Deacons Quorum President', occupant: 'Young, Nate' },
          ]),
        ],
      }),
      { 'young, nate': { action: 'new', category: 'youth' } },
    );
    expect(Object.values(record.board.boardGroups)).toHaveLength(1);
    expect(Object.values(record.board.boardGroups)[0]?.key).toBe('aaronic_priesthood');
    expect(Object.values(record.board.boardGroups)[0]?.name).toBe('Young Men / Aaronic Priesthood');
    const calling = Object.values(record.board.callingGroups);
    expect(calling).toHaveLength(1);
    expect(calling[0]?.parent).toEqual({ kind: 'boardGroup', id: 'bg-aaronic' });
    expect(calling[0]?.name).toBe('Deacons Quorum');
    expect(calling[0]?.key).toBeNull();
  });

  it('a key-mapped organization fills the existing assignment', () => {
    const { store } = prepare({
      members: [person('mem-brielle', 'Northwood, Brielle')],
      groups: [
        {
          id: 'bg-wide',
          name: 'Ward-wide Callings',
          key: 'ward_wide' as const,
          callingGroups: [
            {
              id: 'cg-music',
              name: 'Music',
              assignments: [
                {
                  id: 'as-coord',
                  title: 'Music Coordinator',
                  positions: [{ id: 'pos-coord', lineageId: 'lin-coord' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const { plan, record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Other Callings', 'Music', [{ title: 'Music Coordinator', occupant: 'Northwood, Brielle' }]),
        ],
      }),
      {},
    );
    const assignments = titled(record.board, 'Music Coordinator');
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.id).toBe('as-coord');
    expect(assignments[0]?.type).toBe('single');
    expect(positionsOf(record.board, 'as-coord')).toHaveLength(1);
    expect(record.board.placements[positionId('pos-coord')]).toBe(memberId('mem-brielle'));
    expect(plan.unfamiliar).toEqual([]);
    expect(plan.matchedPositions).toBe(1);
    expect(plan.keptPositions).toBe(0);
  });

  it('a key-mapped list fills before it appends', () => {
    const { store } = prepare({
      members: [person('mem-brielle', 'Northwood, Brielle'), person('mem-cora', 'Lark, Cora')],
      groups: [
        {
          id: 'bg-wide',
          name: 'Ward-wide Callings',
          key: 'ward_wide' as const,
          callingGroups: [
            {
              id: 'cg-music',
              name: 'Music',
              assignments: [
                {
                  id: 'as-coord',
                  title: 'Music Coordinator',
                  type: 'list' as const,
                  positions: [{ id: 'pos-coord', lineageId: 'lin-coord' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const { plan, record } = commitFor(
      store,
      bundle({
        organizations: [
          row('Other Callings', 'Music', [
            { title: 'Music Coordinator', occupant: 'Northwood, Brielle' },
            { title: 'Music Coordinator', occupant: 'Lark, Cora' },
          ]),
        ],
      }),
      {},
    );
    const assignments = titled(record.board, 'Music Coordinator');
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.id).toBe('as-coord');
    expect(assignments[0]?.type).toBe('list');
    const positions = positionsOf(record.board, 'as-coord');
    expect(positions).toHaveLength(2);
    expect(positions[0]?.id).toBe(positionId('pos-coord'));
    expect(record.board.placements[positionId('pos-coord')]).toBe(memberId('mem-brielle'));
    expect(record.board.placements[positions[1]?.id ?? positionId('missing')]).toBe(memberId('mem-cora'));
    expect(plan.unfamiliar).toEqual([
      { organization: 'Other Callings', group: 'Music', title: 'Music Coordinator', vacant: false },
    ]);
    expect(plan.matchedPositions).toBe(1);
    expect(plan.keptPositions).toBe(0);
  });

  it('proposals are untouched', () => {
    const { db, store } = prepare({
      members: [person('mem-amy', 'Amy, One'), person('mem-bea', 'Bea, Two')],
      groups: [bishopricWith('mem-amy')],
    });
    const created = store.createProposal(
      { name: 'Move Amy', rationale: 'Because', source: { kind: 'current' } },
      sequentialIds('prop'),
    );
    if (!created.ok) throw new Error(created.error.message);
    const position = Object.values(created.value.board.positions)[0];
    if (position === undefined) throw new Error('proposal position is missing');
    const committed = store.commitBoard(
      { ...created.value.board, placements: { [position.id]: memberId('mem-bea') } },
      0,
    );
    if (!committed.ok) throw new Error(committed.error.message);
    insertUser(db, 'user-ada');
    const accepted = store.setProposalAcceptance(created.value.id, {
      by: userId('user-ada'),
      at: IMPORTED_AT,
      summary: 'Accepted the move',
    });
    if (!accepted.ok) throw new Error(accepted.error.message);
    const before = store.loadProposal(created.value.id);
    commitFor(
      store,
      bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: null }])],
      }),
      {},
    );
    expect(store.loadProposal(created.value.id)).toEqual(before);
  });

  it('a stale version writes nothing', () => {
    const { store } = prepare({
      members: [person('mem-amy', 'Amy, One')],
      groups: [bishopricWith('mem-amy')],
    });
    const created = store.createProposal(
      { name: 'Leave Amy', rationale: null, source: { kind: 'current' } },
      sequentialIds('prop'),
    );
    if (!created.ok) throw new Error(created.error.message);
    const before = snapshot(store);
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: null }])],
    });
    const refused = applyFor(store, imported, {}, 4);
    expect(refused.applied).toEqual({ ok: false, error: 'stale', currentVersion: 0 });
    expect(snapshot(store)).toEqual(before);

    const ready = applyFor(store, imported, {}, 0);
    if (!ready.applied.ok) throw new Error(ready.applied.error);
    const replaced = store.replaceCurrent({
      ward: ready.applied.ward,
      current: ready.applied.current,
      expectedVersion: 4,
      importVersion: ready.applied.importVersion,
      importedAt: ready.applied.importedAt,
    });
    expect(replaced.ok).toBe(false);
    if (replaced.ok) throw new Error('expected a stale replace');
    expect(replaced.error.code).toBe('stale');
    if (replaced.error.code !== 'stale') throw new Error('expected a stale replace');
    expect(replaced.error.currentVersion).toBe(0);
    expect(snapshot(store)).toEqual(before);
    expect(store.loadProposal(created.value.id)).toEqual(before.proposals[0]);
  });

  it('duplicate and disagreeing reports are refused', () => {
    const { store } = prepare({
      members: [person('mem-amy', 'Amy, One')],
      groups: [bishopricWith('mem-amy')],
    });
    const imported = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Amy, One' }])],
    });
    const before = snapshot(store);
    const first = planFor(store, imported);
    const duplicated = applyFor(store, imported, {}, 0, first.fingerprints);
    expect(duplicated.plan.duplicates).toEqual(['organizations', 'without-callings', 'out-of-unit']);
    expect(duplicated.applied).toEqual({ ok: false, error: 'duplicate_report' });
    expect(snapshot(store)).toEqual(before);

    const odd = bundle({
      organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: 'Amy, One' }])],
      withoutDate: '2026-01-01',
    });
    const disagreed = applyFor(store, odd, {});
    expect(disagreed.plan.inconsistentReports).toBe(true);
    expect(disagreed.applied).toEqual({ ok: false, error: 'inconsistent_reports' });
    expect(snapshot(store)).toEqual(before);

    const oddPlan = planFor(store, odd);
    const duplicateFirst = applyFor(store, odd, {}, 0, oddPlan.fingerprints);
    expect(duplicateFirst.applied).toEqual({ ok: false, error: 'duplicate_report' });
    expect(snapshot(store)).toEqual(before);
  });
});

function bishopricWith(occupant: string | null) {
  return {
    id: 'bg-bishopric',
    name: 'Bishopric',
    key: 'bishopric' as const,
    callingGroups: [
      {
        id: 'cg-bishopric',
        name: 'Bishopric',
        assignments: [
          {
            id: 'as-bishop',
            title: 'Bishop',
            positions: [
              {
                id: 'pos-bishop',
                lineageId: 'lin-bishop',
                ...(occupant === null ? {} : { memberId: occupant }),
              },
            ],
          },
        ],
      },
    ],
  };
}

