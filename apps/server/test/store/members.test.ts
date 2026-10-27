import type { DatabaseSync } from 'node:sqlite';
import {
  approvePlacement,
  createWard,
  memberId,
  placeInPosition,
  sequentialIds,
  tagId,
  unapprovedPlacements,
  userId,
  type Board,
  type Member,
  type MemberId,
  type PositionId,
  type Proposal,
  type ProposalId,
  type Tag,
  type UserId,
  type Ward,
} from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/index.ts';
import { openStore, type Store, type StoreError, type StoreResult } from '../../src/index.ts';
import {
  arrangementOf,
  cleanupStores,
  fixedClock,
  FIXED_ISO,
  insertUser,
  openTempStore,
  take,
  unwrap,
} from './helpers.ts';

afterEach(cleanupStores);

function memberNamed(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((item) => item.name === name);
  if (member === undefined) throw new Error(`missing member ${name}`);
  return member;
}

function tagNamed(ward: Ward, name: string): Tag {
  const tag = Object.values(ward.tags).find((item) => item.name === name);
  if (tag === undefined) throw new Error(`missing tag ${name}`);
  return tag;
}

function refusal<T>(result: StoreResult<T>): StoreError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected refusal');
  return result.error;
}

function databaseFile(db: DatabaseSync): string {
  for (const row of db.prepare('PRAGMA database_list').all()) {
    if (row['name'] === 'main' && typeof row['file'] === 'string' && row['file'].length > 0) {
      return row['file'];
    }
  }
  throw new Error('database file is missing');
}

function vacantPositionId(board: Board, title: string): PositionId {
  const assignments = Object.values(board.assignments).filter((item) => item.title === title);
  for (const assignment of assignments) {
    const position = Object.values(board.positions).find(
      (item) => item.assignmentId === assignment.id && !Object.hasOwn(board.placements, item.id),
    );
    if (position !== undefined) return position.id;
  }
  throw new Error(`no vacancy for ${title}`);
}

function requireProposal(store: Store, id: ProposalId): Proposal {
  const proposal = store.loadProposal(id);
  if (proposal === null) throw new Error(`missing proposal ${id}`);
  return proposal;
}

function suggestAndApprove(
  store: Store,
  id: ProposalId,
  member: MemberId,
  title: string,
  approver: UserId,
): PositionId {
  const proposal = requireProposal(store, id);
  const ward = store.loadWard();
  const position = vacantPositionId(proposal.board, title);
  const placed = placeInPosition(
    proposal.board,
    { ward, ids: sequentialIds(`place-${proposal.board.id}`) },
    { memberId: member, from: null, to: position },
  );
  if (!placed.ok) throw new Error(placed.error.message);
  const placedBoard = take(store.commitBoard(placed.board, proposal.board.version));
  const approved = approvePlacement(
    placedBoard,
    { ward, ids: sequentialIds(`approve-${proposal.board.id}`) },
    {
      baseline: proposal.baseline,
      memberId: member,
      positionId: position,
      approvedBy: approver,
      approvedAt: FIXED_ISO,
    },
  );
  if (!approved.ok) throw new Error(approved.error.message);
  take(store.commitBoard(approved.board, placedBoard.version));
  return position;
}

function placeOnly(store: Store, id: ProposalId, member: MemberId, title: string): void {
  const proposal = requireProposal(store, id);
  const placed = placeInPosition(
    proposal.board,
    { ward: store.loadWard(), ids: sequentialIds(`only-${proposal.board.id}`) },
    { memberId: member, from: null, to: vacantPositionId(proposal.board, title) },
  );
  if (!placed.ok) throw new Error(placed.error.message);
  take(store.commitBoard(placed.board, proposal.board.version));
}

describe('member profile store', () => {
  it('updateMemberProfile persists name, note and tags; reload shows them; unknown member → not_found; unknown tag → invalid', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'profiles' }));
    const ada = memberNamed(ward, 'Ada Fictional');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const musical = tagNamed(ward, 'Musical');
    const spanish = tagNamed(ward, 'Spanish speaker');
    const beforeIvy = store.loadWard().members[ivy.id];

    const updated = take(
      store.updateMemberProfile(ada.id, {
        name: '  Ada Renamed  ',
        note: 'Brings the rolls.',
        tagIds: [spanish.id, musical.id],
      }),
    );
    expect(updated.members[ada.id]).toEqual({
      ...ward.members[ada.id],
      name: 'Ada Renamed',
      note: 'Brings the rolls.',
      tagIds: [spanish.id, musical.id],
    });
    expect(store.loadWard().members[ada.id]).toEqual(updated.members[ada.id]);
    expect(store.loadWard().members[ivy.id]).toEqual(beforeIvy);

    const maxNote = 'n'.repeat(280);
    const noted = take(store.updateMemberProfile(ada.id, { note: maxNote }));
    expect(noted.members[ada.id]?.note).toBe(maxNote);
    expect(store.loadWard().members[ada.id]?.tagIds).toEqual([spanish.id, musical.id]);

    const tooLong = store.updateMemberProfile(ada.id, { note: 'n'.repeat(281) });
    expect(refusal(tooLong).code).toBe('invalid');
    expect(store.loadWard().members[ada.id]?.note).toBe(maxNote);

    const cleared = take(store.updateMemberProfile(ada.id, { note: null, tagIds: [] }));
    expect(cleared.members[ada.id]).toMatchObject({
      name: 'Ada Renamed',
      note: null,
      tagIds: [],
      needsApproval: false,
    });
    expect(store.loadWard().members[ada.id]?.tagIds).toEqual([]);
    expect(store.loadWard().members[ada.id]?.note).toBeNull();

    const missing = store.updateMemberProfile(memberId('missing-member'), { name: 'Nope' });
    expect(refusal(missing).code).toBe('not_found');
    expect(store.loadWard().members[ada.id]?.name).toBe('Ada Renamed');

    const before = store.loadWard();
    const unknownTag = store.updateMemberProfile(ada.id, {
      name: 'Should Not Stick',
      tagIds: [tagId('missing-tag')],
    });
    expect(refusal(unknownTag).code).toBe('invalid');
    expect(store.loadWard()).toEqual(before);
  });

  it('edits a removed member', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    const ada = memberNamed(ward, 'Ada Fictional');
    const removed = unwrap(
      createWard({
        tags: ward.tags,
        members: { ...ward.members, [ada.id]: { ...ada, removedDate: '2026-03-04' } },
      }),
    );
    take(store.initialize({ ward: removed, current, importVersion: 'removed' }));

    const updated = take(
      store.updateMemberProfile(ada.id, { name: 'Ada Formerly', note: 'Moved away.', tagIds: [] }),
    );
    expect(updated.members[ada.id]).toMatchObject({
      name: 'Ada Formerly',
      note: 'Moved away.',
      tagIds: [],
      removedDate: '2026-03-04',
    });
    expect(store.loadWard().members[ada.id]).toEqual(updated.members[ada.id]);
  });

  it('createTag then duplicate name → invalid; renameTag persists', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'tags' }));
    const before = store.loadWard();
    const ids = sequentialIds('new-tag');

    const created = take(store.createTag('  Pond helper  ', ids));
    expect(created.ward.tags[created.tagId]).toEqual({ id: created.tagId, name: 'Pond helper' });
    expect(store.loadWard().tags[created.tagId]).toEqual({ id: created.tagId, name: 'Pond helper' });
    expect(Object.keys(store.loadWard().tags)).toHaveLength(Object.keys(before.tags).length + 1);

    const duplicate = store.createTag('pond helper', ids);
    expect(refusal(duplicate).code).toBe('invalid');
    const fixtureDuplicate = store.createTag('  musical  ', ids);
    expect(refusal(fixtureDuplicate).code).toBe('invalid');
    expect(Object.keys(store.loadWard().tags)).toHaveLength(Object.keys(before.tags).length + 1);
    expect(store.loadWard().tags[created.tagId]?.name).toBe('Pond helper');

    const clash = store.renameTag(created.tagId, 'Musical');
    expect(refusal(clash).code).toBe('invalid');
    expect(store.loadWard().tags[created.tagId]?.name).toBe('Pond helper');

    const renamed = take(store.renameTag(created.tagId, '  Lake helper  '));
    expect(renamed.tags[created.tagId]).toEqual({ id: created.tagId, name: 'Lake helper' });
    expect(store.loadWard().tags[created.tagId]?.name).toBe('Lake helper');

    const missing = store.renameTag(tagId('missing-tag'), 'Anything');
    expect(refusal(missing).code).toBe('not_found');
    expect(store.loadWard().tags[created.tagId]?.name).toBe('Lake helper');
  });

  it("setNeedsApproval(true) drops the member's approvals on Draft boards only and bumps only changed boards' versions", () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'approvals' }));
    insertUser(db, 'user-ada');
    const approver = userId('user-ada');
    const ids = sequentialIds('proposal');
    const cy = memberNamed(ward, 'Cy Mockup');
    const ada = memberNamed(ward, 'Ada Fictional');
    expect(cy.needsApproval).toBe(true);
    expect(ada.needsApproval).toBe(false);

    const make = (name: string): ProposalId =>
      take(store.createProposal({ name, rationale: null, source: { kind: 'current' } }, ids)).id;
    const approvedId = make('Draft approved');
    const placedId = make('Draft placed');
    const untouchedId = make('Draft untouched');
    const approvedLaterId = make('Draft approved later');
    const acceptedId = make('Accepted plan');

    take(store.setNeedsApproval(ada.id, true));
    const cyOnApproved = suggestAndApprove(store, approvedId, cy.id, 'Chorister', approver);
    suggestAndApprove(store, approvedId, ada.id, 'Secretary', approver);
    const cyOnLater = suggestAndApprove(store, approvedLaterId, cy.id, 'Chorister', approver);
    const cyOnAccepted = suggestAndApprove(store, acceptedId, cy.id, 'Chorister', approver);
    placeOnly(store, placedId, cy.id, 'Chorister');
    take(
      store.setProposalAcceptance(acceptedId, {
        by: approver,
        at: FIXED_ISO,
        summary: '[]',
      }),
    );

    take(store.setNeedsApproval(cy.id, false));
    const beforeApproved = requireProposal(store, approvedId);
    const beforePlaced = requireProposal(store, placedId);
    const beforeUntouched = requireProposal(store, untouchedId);
    const beforeLater = requireProposal(store, approvedLaterId);
    const beforeAccepted = requireProposal(store, acceptedId);
    const beforeCurrent = store.loadCurrent();
    expect(beforeApproved.board.approvals.some((item) => item.memberId === cy.id)).toBe(true);
    expect(beforeApproved.board.approvals.some((item) => item.memberId === ada.id)).toBe(true);
    expect(beforeAccepted.board.approvals.some((item) => item.memberId === cy.id)).toBe(true);
    expect(beforeAccepted.status).toBe('accepted');

    const result = take(store.setNeedsApproval(cy.id, true));

    expect(result.boards.map((board) => board.id)).toEqual([beforeApproved.board.id, beforeLater.board.id]);
    expect(result.ward.members[cy.id]?.needsApproval).toBe(true);
    expect(result.ward.members[ada.id]?.needsApproval).toBe(true);
    expect(store.loadWard()).toEqual(result.ward);

    const afterApproved = requireProposal(store, approvedId);
    const afterLater = requireProposal(store, approvedLaterId);
    expect(afterApproved.board.version).toBe(beforeApproved.board.version + 1);
    expect(afterLater.board.version).toBe(beforeLater.board.version + 1);
    expect(afterApproved.board.approvals).toEqual(
      beforeApproved.board.approvals.filter((item) => item.memberId !== cy.id),
    );
    expect(afterLater.board.approvals).toEqual([]);
    expect(afterApproved.board.approvals.some((item) => item.memberId === ada.id)).toBe(true);
    expect(arrangementOf({ ...afterApproved.board, approvals: beforeApproved.board.approvals })).toEqual(
      arrangementOf(beforeApproved.board),
    );
    expect(afterApproved.baseline).toEqual(beforeApproved.baseline);
    expect(afterLater.baseline).toEqual(beforeLater.baseline);
    expect(result.boards[0]).toEqual(afterApproved.board);
    expect(result.boards[1]).toEqual(afterLater.board);

    expect(requireProposal(store, placedId)).toEqual(beforePlaced);
    expect(requireProposal(store, untouchedId)).toEqual(beforeUntouched);
    expect(requireProposal(store, acceptedId)).toEqual(beforeAccepted);
    expect(store.loadCurrent()).toEqual(beforeCurrent);
    expect(store.loadBoard(beforeAccepted.baseline.id)).toEqual(beforeAccepted.baseline);
    expect(store.loadBoard(beforeAccepted.board.id)?.approvals).toEqual(beforeAccepted.board.approvals);

    const pending = unapprovedPlacements(afterApproved, result.ward);
    expect(pending).toEqual([
      { memberId: cy.id, positionId: cyOnApproved, approval: null },
    ]);
    expect(unapprovedPlacements(afterLater, result.ward)).toEqual([
      { memberId: cy.id, positionId: cyOnLater, approval: null },
    ]);
    expect(unapprovedPlacements(requireProposal(store, acceptedId), result.ward)).toEqual([]);
    expect(
      requireProposal(store, acceptedId).board.approvals.some(
        (item) => item.memberId === cy.id && item.positionId === cyOnAccepted,
      ),
    ).toBe(true);

    expect(store.setNeedsApproval(cy.id, true)).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'no change' },
    });
    expect(requireProposal(store, approvedId).board.version).toBe(afterApproved.board.version);
  });

  it('setNeedsApproval(false) changes no board; same value → invalid', () => {
    const { db, store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'clear-flag' }));
    insertUser(db, 'user-ada');
    const cy = memberNamed(ward, 'Cy Mockup');
    const created = take(
      store.createProposal(
        { name: 'Still approved', rationale: null, source: { kind: 'current' } },
        sequentialIds('clear'),
      ),
    );
    suggestAndApprove(store, created.id, cy.id, 'Chorister', userId('user-ada'));
    const before = requireProposal(store, created.id);
    const beforeCurrent = store.loadCurrent();
    expect(before.board.approvals).toHaveLength(1);

    const cleared = take(store.setNeedsApproval(cy.id, false));
    expect(cleared.boards).toEqual([]);
    expect(cleared.ward.members[cy.id]?.needsApproval).toBe(false);
    expect(requireProposal(store, created.id)).toEqual(before);
    expect(store.loadCurrent()).toEqual(beforeCurrent);
    expect(store.loadWard().members[cy.id]?.needsApproval).toBe(false);

    expect(store.setNeedsApproval(cy.id, false)).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'no change' },
    });
    expect(requireProposal(store, created.id)).toEqual(before);
    expect(store.loadBoard(before.board.id)?.version).toBe(before.board.version);
  });

  it('setNeedsApproval with no proposals updates the flag and leaves Current unchanged', () => {
    const { store } = openTempStore();
    const { ward, current } = buildFixtureWard();
    take(store.initialize({ ward, current, importVersion: 'no-proposals' }));
    const ada = memberNamed(ward, 'Ada Fictional');
    const beforeCurrent = store.loadCurrent();
    const beforeWard = store.loadWard();

    const result = take(store.setNeedsApproval(ada.id, true));
    expect(result.boards).toEqual([]);
    expect(result.ward.members[ada.id]?.needsApproval).toBe(true);
    expect(store.loadWard().members[ada.id]?.needsApproval).toBe(true);
    for (const member of Object.values(beforeWard.members)) {
      if (member.id === ada.id) continue;
      expect(store.loadWard().members[member.id]).toEqual(member);
    }
    expect(store.loadCurrent()).toEqual(beforeCurrent);
    expect(store.listProposals()).toEqual([]);

    expect(store.setNeedsApproval(ada.id, true)).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'no change' },
    });
    expect(refusal(store.setNeedsApproval(memberId('missing-member'), false)).code).toBe('not_found');
    expect(store.loadCurrent()).toEqual(beforeCurrent);
  });

  it('settings default false; set persists across reopen', () => {
    const { db, store } = openTempStore();
    expect(store.loadSettings()).toEqual({ showNeedsApproval: false });
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'showNeedsApproval'`).get()).toBeUndefined();

    store.setShowNeedsApproval(true);
    expect(store.loadSettings()).toEqual({ showNeedsApproval: true });
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'showNeedsApproval'`).get()).toEqual({
      value: 'true',
    });

    const file = databaseFile(db);
    const again = openDatabase(file);
    try {
      expect(openStore(again, fixedClock).loadSettings()).toEqual({ showNeedsApproval: true });
    } finally {
      again.close();
    }

    store.setShowNeedsApproval(false);
    expect(store.loadSettings()).toEqual({ showNeedsApproval: false });
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'showNeedsApproval'`).get()).toEqual({
      value: 'false',
    });
    const third = openDatabase(file);
    try {
      expect(openStore(third, fixedClock).loadSettings()).toEqual({ showNeedsApproval: false });
    } finally {
      third.close();
    }
  });
});
