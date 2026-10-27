import {
  boardId,
  createProposal,
  moveToDugout,
  proposalId,
  sequentialIds,
  userId,
  type Board,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_ISO,
  arrangementOf,
  cleanupStores,
  insertUser,
  openTempStore,
  placementByTitle,
  take,
  unwrap,
} from './helpers.ts';

afterEach(cleanupStores);

function proposalWith(
  current: Board,
  ward: Ward,
  spec: { id: string; name: string; tabOrder: number; boardId: string; baselineId: string },
): Proposal {
  return unwrap(
    createProposal(
      {
        id: proposalId(spec.id),
        name: spec.name,
        rationale: null,
        status: 'draft',
        accepted: null,
        baseline: { ...current, id: boardId(spec.baselineId), kind: 'baseline', version: 0 },
        board: { ...current, id: boardId(spec.boardId), kind: 'proposal', version: 0 },
        tabOrder: spec.tabOrder,
        createdAt: FIXED_ISO,
        updatedAt: FIXED_ISO,
      },
      ward,
    ),
  );
}

describe('proposals', () => {
  it('start from current snapshots baseline and board', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const ids = sequentialIds('p');

    const first = take(
      store.createProposal({ name: 'Alpha', rationale: 'Because', source: { kind: 'current' } }, ids),
    );
    const second = take(
      store.createProposal({ name: 'Beta', rationale: null, source: { kind: 'current' } }, ids),
    );

    expect(first.id).toBe('p-0001');
    expect(first.baseline.id).toBe('p-0001-baseline');
    expect(first.board.id).toBe('p-0001-board');
    expect(first.baseline.kind).toBe('baseline');
    expect(first.board.kind).toBe('proposal');
    expect(first.baseline.version).toBe(0);
    expect(first.board.version).toBe(0);
    expect(first.status).toBe('draft');
    expect(first.accepted).toBeNull();
    expect(first.tabOrder).toBe(0);
    expect(first.rationale).toBe('Because');
    expect(first.createdAt).toBe(FIXED_ISO);
    expect(first.updatedAt).toBe(FIXED_ISO);
    expect(arrangementOf(first.baseline)).toEqual(arrangementOf(current));
    expect(arrangementOf(first.board)).toEqual(arrangementOf(current));
    expect(first.baseline.id).not.toBe(current.id);
    expect(first.board.id).not.toBe(current.id);

    expect(second.id).toBe('p-0002');
    expect(second.tabOrder).toBe(1);
    expect(second.rationale).toBeNull();
    expect(arrangementOf(second.baseline)).toEqual(arrangementOf(current));
    expect(arrangementOf(second.board)).toEqual(arrangementOf(current));
    expect(store.loadProposal(first.id)).toEqual(first);
    expect(store.loadProposal(second.id)).toEqual(second);
    expect(store.loadCurrent()?.board).toEqual(current);
  });

  it('duplicate keeps the source baseline and copies the source board', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const ids = sequentialIds('prop');
    const created = take(
      store.createProposal({ name: 'Alpha', rationale: 'first', source: { kind: 'current' } }, ids),
    );
    const organ = placementByTitle(created.board, 'Organist');
    const moved = moveToDugout(
      created.board,
      { ward: store.loadWard(), ids: sequentialIds('mv') },
      { memberId: organ.memberId, from: organ.positionId },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) expect.fail(moved.error.message);
    const committed = take(store.commitBoard(moved.board, 0));
    const source = store.loadProposal(created.id);
    if (source === null) expect.fail('source proposal missing');

    const duplicate = take(
      store.createProposal(
        { name: 'Beta', rationale: null, source: { kind: 'proposal', id: source.id } },
        ids,
      ),
    );

    expect(duplicate.status).toBe('draft');
    expect(duplicate.accepted).toBeNull();
    expect(duplicate.board.version).toBe(0);
    expect(duplicate.baseline.version).toBe(0);
    expect(duplicate.baseline.kind).toBe('baseline');
    expect(duplicate.board.kind).toBe('proposal');
    expect(duplicate.baseline.id).toBe(`${duplicate.id}-baseline`);
    expect(duplicate.board.id).toBe(`${duplicate.id}-board`);
    expect(arrangementOf(duplicate.board)).toEqual(arrangementOf(committed));
    expect(arrangementOf(duplicate.baseline)).toEqual(arrangementOf(source.baseline));
    expect(arrangementOf(duplicate.baseline)).not.toEqual(arrangementOf(duplicate.board));
    const loadedCurrent = store.loadCurrent();
    if (loadedCurrent === null) expect.fail('current missing');
    expect(arrangementOf(duplicate.board)).not.toEqual(arrangementOf(loadedCurrent.board));
    expect(store.loadProposal(source.id)).toEqual(source);
  });

  it('duplicate of a duplicate keeps the original baseline', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const ids = sequentialIds('chain');
    const created = take(
      store.createProposal({ name: 'Alpha', rationale: null, source: { kind: 'current' } }, ids),
    );
    const organ = placementByTitle(created.board, 'Organist');
    const moved = moveToDugout(
      created.board,
      { ward: store.loadWard(), ids: sequentialIds('mv') },
      { memberId: organ.memberId, from: organ.positionId },
    );
    if (!moved.ok) expect.fail(moved.error.message);
    take(store.commitBoard(moved.board, 0));
    const alpha = store.loadProposal(created.id);
    if (alpha === null) expect.fail('alpha missing');
    const beta = take(
      store.createProposal({ name: 'Beta', rationale: null, source: { kind: 'proposal', id: alpha.id } }, ids),
    );
    const gamma = take(
      store.createProposal({ name: 'Gamma', rationale: null, source: { kind: 'proposal', id: beta.id } }, ids),
    );

    expect(arrangementOf(gamma.baseline)).toEqual(arrangementOf(alpha.baseline));
    expect(arrangementOf(gamma.board)).toEqual(arrangementOf(beta.board));
    expect(arrangementOf(gamma.baseline)).not.toEqual(arrangementOf(gamma.board));
    expect(gamma.status).toBe('draft');
    expect(gamma.accepted).toBeNull();
    expect(gamma.baseline.version).toBe(0);
    expect(gamma.board.version).toBe(0);
  });

  it('duplicate drops working-board approvals and keeps the baseline', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    insertUser(db, 'user-ada');
    const organ = placementByTitle(current, 'Organist');
    const approval = {
      memberId: organ.memberId,
      positionId: organ.positionId,
      approvedBy: userId('user-ada'),
      approvedAt: FIXED_ISO,
    };
    const source = unwrap(
      createProposal(
        {
          id: proposalId('src-approvals'),
          name: 'Has approval',
          rationale: null,
          status: 'draft',
          accepted: null,
          baseline: {
            ...current,
            id: boardId('src-approvals-baseline'),
            kind: 'baseline',
            version: 0,
            approvals: [approval],
          },
          board: {
            ...current,
            id: boardId('src-approvals-board'),
            kind: 'proposal',
            version: 0,
            approvals: [approval],
          },
          tabOrder: 0,
          createdAt: FIXED_ISO,
          updatedAt: FIXED_ISO,
        },
        ward,
      ),
    );
    expect(source.board.approvals).toEqual([approval]);
    expect(source.baseline.approvals).toEqual([approval]);
    take(store.insertProposal(source));

    const duplicate = take(
      store.createProposal(
        { name: 'Copy', rationale: null, source: { kind: 'proposal', id: source.id } },
        sequentialIds('dup'),
      ),
    );

    expect(duplicate.board.approvals).toEqual([]);
    const loaded = store.loadProposal(source.id);
    if (loaded === null) expect.fail('source proposal missing');
    expect(loaded.board.approvals).toEqual(source.board.approvals);
    expect(arrangementOf(duplicate.baseline)).toEqual(arrangementOf(loaded.baseline));
    expect(duplicate.baseline.approvals).toEqual(loaded.baseline.approvals);
  });

  it('duplicate of accepted is draft', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    insertUser(db, 'user-ada');
    const draft = unwrap(
      createProposal(
        {
          ...buildAcceptedShape(current, ward),
          status: 'accepted',
          accepted: { by: userId('user-ada'), at: FIXED_ISO, summary: 'Frozen summary' },
        },
        ward,
      ),
    );
    take(store.insertProposal(draft));

    const copy = take(
      store.createProposal(
        { name: 'From accepted', rationale: 'copy', source: { kind: 'proposal', id: draft.id } },
        sequentialIds('dup'),
      ),
    );

    expect(copy.status).toBe('draft');
    expect(copy.accepted).toBeNull();
    expect(arrangementOf(copy.board)).toEqual(arrangementOf(draft.board));
    expect(arrangementOf(copy.baseline)).toEqual(arrangementOf(draft.baseline));
    expect(store.loadProposal(draft.id)?.status).toBe('accepted');
  });

  it('create without current is no_current; unknown source is not_found; blank name is invalid', () => {
    const { store } = openTempStore();
    const ids = sequentialIds('err');

    const noCurrent = store.createProposal(
      { name: 'Nope', rationale: null, source: { kind: 'current' } },
      ids,
    );
    expect(noCurrent.ok).toBe(false);
    if (noCurrent.ok) expect.fail('expected no_current');
    expect(noCurrent.error.code).toBe('no_current');
    expect(store.loadCurrent()).toBeNull();
    expect(store.listProposals()).toEqual([]);

    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const missing = store.createProposal(
      { name: 'Nope', rationale: null, source: { kind: 'proposal', id: proposalId('missing') } },
      ids,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) expect.fail('expected not_found');
    expect(missing.error.code).toBe('not_found');
    expect(store.listProposals()).toEqual([]);

    const blank = store.createProposal(
      { name: '   ', rationale: null, source: { kind: 'current' } },
      ids,
    );
    expect(blank.ok).toBe(false);
    if (blank.ok) expect.fail('expected invalid');
    expect(blank.error.code).toBe('invalid');
    expect(store.listProposals()).toEqual([]);

    const created = take(
      store.createProposal({ name: 'Kept', rationale: null, source: { kind: 'current' } }, sequentialIds('ok')),
    );
    expect(created.tabOrder).toBe(0);
    expect(store.listProposals()).toHaveLength(1);
  });

  it('listProposals orders by tabOrder then id', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'fixture' }));
    const inserted = [
      proposalWith(current, ward, {
        id: 'm',
        name: 'Mae',
        tabOrder: 1,
        boardId: 'a-board',
        baselineId: 'a-base',
      }),
      proposalWith(current, ward, {
        id: 'a',
        name: 'Ada',
        tabOrder: 1,
        boardId: 'm-board',
        baselineId: 'm-base',
      }),
      proposalWith(current, ward, {
        id: 'z',
        name: 'Zed',
        tabOrder: 0,
        boardId: 'b-board',
        baselineId: 'b-base',
      }),
    ];
    for (const proposal of inserted) {
      take(store.insertProposal(proposal));
    }

    expect(store.listProposals()).toEqual([
      {
        id: proposalId('z'),
        name: 'Zed',
        status: 'draft',
        tabOrder: 0,
        boardId: boardId('b-board'),
        version: 0,
        updatedAt: FIXED_ISO,
      },
      {
        id: proposalId('a'),
        name: 'Ada',
        status: 'draft',
        tabOrder: 1,
        boardId: boardId('m-board'),
        version: 0,
        updatedAt: FIXED_ISO,
      },
      {
        id: proposalId('m'),
        name: 'Mae',
        status: 'draft',
        tabOrder: 1,
        boardId: boardId('a-board'),
        version: 0,
        updatedAt: FIXED_ISO,
      },
    ]);
  });
});

function buildAcceptedShape(current: Board, ward: Ward): Proposal {
  return unwrap(
    createProposal(
      {
        id: proposalId('accepted-src'),
        name: 'Accepted source',
        rationale: 'ready',
        status: 'draft',
        accepted: null,
        baseline: { ...current, id: boardId('accepted-src-baseline'), kind: 'baseline' },
        board: { ...current, id: boardId('accepted-src-board'), kind: 'proposal' },
        tabOrder: 4,
        createdAt: FIXED_ISO,
        updatedAt: FIXED_ISO,
      },
      ward,
    ),
  );
}
