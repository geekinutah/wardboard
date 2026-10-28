import type { DatabaseSync } from 'node:sqlite';
import {
  approvePlacement,
  createProposal,
  placeInPosition,
  proposalId,
  sequentialIds,
  setCallingPreferences,
  setCallingTags,
  tagId,
  userId,
  type Board,
  type Member,
  type PositionId,
  type Proposal,
  type ProposalId,
  type Tag,
  type TagId,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store, StoreError, StoreResult } from '../../src/index.ts';
import { cleanupStores, FIXED_ISO, insertUser, openTempStore, scalar, take, unwrap } from './helpers.ts';

afterEach(cleanupStores);

const ACCEPTED_AT = '2026-05-02T10:00:00.000Z';

type Seeded = {
  db: DatabaseSync;
  store: Store;
  draftA: ProposalId;
  draftB: ProposalId;
  accepted: ProposalId;
  musical: TagId;
};

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

function requireProposal(store: Store, id: ProposalId): Proposal {
  const proposal = store.loadProposal(id);
  if (proposal === null) throw new Error(`missing proposal ${id}`);
  return proposal;
}

function boardMentions(board: Board, id: TagId): boolean {
  return Object.values(board.assignments).some(
    (item) => item.callingTagIds.includes(id) || item.preferredMemberTagIds.includes(id),
  );
}

/** Removes every use of `id` from a board's callings, through core edits. */
function withoutTagOnCallings(board: Board, ward: Ward, id: TagId): Board {
  let next = board;
  for (const assignment of Object.values(board.assignments)) {
    if (assignment.callingTagIds.includes(id)) {
      const edited = setCallingTags(
        next,
        ward,
        assignment.id,
        assignment.callingTagIds.filter((tag) => tag !== id),
      );
      if (!edited.ok) throw new Error(edited.error.message);
      next = edited.board;
    }
    if (assignment.preferredMemberTagIds.includes(id)) {
      const edited = setCallingPreferences(
        next,
        ward,
        assignment.id,
        assignment.preferredMemberTagIds.filter((tag) => tag !== id),
      );
      if (!edited.ok) throw new Error(edited.error.message);
      next = edited.board;
    }
  }
  return next;
}

/**
 * Current, Draft A (uses Musical), Draft B (Musical stripped from its working
 * board only), and an Accepted proposal. Every baseline still uses Musical.
 */
function seed(): Seeded {
  const { db, store } = openTempStore();
  const { ward, current } = buildFixtureWard();
  take(store.initialize({ ward, current, importVersion: 'delete-tag' }));
  const ids = sequentialIds('proposal');
  const draftA = take(
    store.createProposal({ name: 'Draft A', rationale: null, source: { kind: 'current' } }, ids),
  );
  const draftB = take(
    store.createProposal({ name: 'Draft B', rationale: null, source: { kind: 'current' } }, ids),
  );
  const musical = tagNamed(ward, 'Musical').id;
  const stripped = withoutTagOnCallings(draftB.board, ward, musical);
  take(store.commitBoard(stripped, draftB.board.version));

  insertUser(db, 'approver');
  const draft = buildFixtureProposal(current, ward, {
    id: proposalId('pr-accepted'),
    name: 'Accepted plan',
    tabOrder: 7,
  });
  const accepted = unwrap(
    createProposal(
      {
        ...draft,
        status: 'accepted',
        accepted: { by: userId('approver'), at: ACCEPTED_AT, summary: 'Frozen summary.' },
      },
      ward,
    ),
  );
  take(store.insertProposal(accepted));
  return { db, store, draftA: draftA.id, draftB: draftB.id, accepted: accepted.id, musical };
}

function snapshot(store: Store): unknown {
  return {
    ward: store.loadWard(),
    current: store.loadCurrent(),
    list: store.listProposals(),
    proposals: store.listProposals().map((item) => store.loadProposal(item.id)),
  };
}

function versionsById(store: Store): Record<string, number> {
  const versions: Record<string, number> = {};
  const current = store.loadCurrent();
  if (current !== null) versions[current.board.id] = current.board.version;
  for (const summary of store.listProposals()) {
    const proposal = requireProposal(store, summary.id);
    versions[proposal.board.id] = proposal.board.version;
    versions[proposal.baseline.id] = proposal.baseline.version;
  }
  return versions;
}

function vacantPositionId(board: Board, title: string): PositionId {
  const assignment = Object.values(board.assignments).find((item) => item.title === title);
  if (assignment === undefined) throw new Error(`no assignment ${title}`);
  const position = Object.values(board.positions).find(
    (item) => item.assignmentId === assignment.id && !Object.hasOwn(board.placements, item.id),
  );
  if (position === undefined) throw new Error(`no vacancy for ${title}`);
  return position.id;
}

describe('store deleteTag', () => {
  it('removes the tag from the ward, members, Current, a Draft, an Accepted proposal and their baselines in one write', () => {
    const { db, store, draftA, draftB, accepted, musical } = seed();
    const before = store.loadWard();
    const taggedBefore = Object.values(before.members).filter((member) => member.tagIds.includes(musical));
    expect(taggedBefore.length).toBeGreaterThan(0);
    const ivy = memberNamed(before, 'Ivy Notreal');
    const acceptedBefore = requireProposal(store, accepted);

    const result = take(store.deleteTag(musical));

    const ward = store.loadWard();
    expect(ward.tags[musical]).toBeUndefined();
    expect(Object.keys(ward.tags)).toHaveLength(Object.keys(before.tags).length - 1);
    expect(Object.values(ward.members).some((member) => member.tagIds.includes(musical))).toBe(false);
    expect(ward.members[ivy.id]?.tagIds).toEqual(ivy.tagIds.filter((tag) => tag !== musical));
    expect(result.ward).toEqual(ward);

    const current = store.loadCurrent();
    if (current === null) throw new Error('missing current');
    expect(boardMentions(current.board, musical)).toBe(false);
    for (const id of [draftA, draftB, accepted]) {
      const proposal = requireProposal(store, id);
      expect(boardMentions(proposal.board, musical)).toBe(false);
      expect(boardMentions(proposal.baseline, musical)).toBe(false);
    }
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM tags WHERE id = ?', musical)).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM member_tags WHERE tag_id = ?', musical)).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM calling_tags WHERE tag_id = ?', musical)).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM calling_affinities WHERE tag_id = ?', musical)).toBe(0);

    // Other tags on the same callings and members are untouched.
    const teaches = tagNamed(before, 'Teaches well').id;
    expect(ward.members[ivy.id]?.tagIds).toContain(teaches);
    expect(boardMentions(current.board, teaches)).toBe(true);

    const acceptedAfter = requireProposal(store, accepted);
    expect(acceptedAfter.status).toBe('accepted');
    expect(acceptedAfter.accepted).toEqual(acceptedBefore.accepted);
  });

  it('changed Current/working boards are returned at version+1; unchanged boards keep their version', () => {
    const { store, draftA, draftB, accepted, musical } = seed();
    const before = versionsById(store);
    const current = store.loadCurrent();
    if (current === null) throw new Error('missing current');
    const a = requireProposal(store, draftA);
    const b = requireProposal(store, draftB);
    const acc = requireProposal(store, accepted);
    expect(boardMentions(b.board, musical)).toBe(false);

    const result = take(store.deleteTag(musical));

    const changed = [current.board.id, a.board.id, acc.board.id];
    expect(result.boards.map((board) => board.id).sort()).toEqual([...changed].sort());
    for (const board of result.boards) {
      expect(board.version).toBe((before[board.id] ?? -1) + 1);
      expect(boardMentions(board, musical)).toBe(false);
      expect(store.loadBoard(board.id)).toEqual(board);
    }
    const after = versionsById(store);
    expect(after).toEqual({
      ...before,
      [current.board.id]: (before[current.board.id] ?? -1) + 1,
      [a.board.id]: (before[a.board.id] ?? -1) + 1,
      [acc.board.id]: (before[acc.board.id] ?? -1) + 1,
    });
    expect(after[b.board.id]).toBe(before[b.board.id]);
    expect(after[a.baseline.id]).toBe(before[a.baseline.id]);
    expect(after[b.baseline.id]).toBe(before[b.baseline.id]);
    expect(after[acc.baseline.id]).toBe(before[acc.baseline.id]);
    // An unchanged board is not rewritten.
    expect(store.loadBoard(b.board.id)).toEqual(b.board);
  });

  it('needsApproval and approvals are unchanged', () => {
    const { store, draftA, musical } = seed();
    const ward = store.loadWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const proposal = requireProposal(store, draftA);
    const position = vacantPositionId(proposal.board, 'Chorister');
    const placed = placeInPosition(
      proposal.board,
      { ward, ids: sequentialIds('place') },
      { memberId: cy.id, from: null, to: position },
    );
    if (!placed.ok) throw new Error(placed.error.message);
    const placedBoard = take(store.commitBoard(placed.board, proposal.board.version));
    const approved = approvePlacement(
      placedBoard,
      { ward, ids: sequentialIds('approve') },
      {
        baseline: proposal.baseline,
        memberId: cy.id,
        positionId: position,
        approvedBy: userId('approver'),
        approvedAt: FIXED_ISO,
      },
    );
    if (!approved.ok) throw new Error(approved.error.message);
    const approvedBoard = take(store.commitBoard(approved.board, placedBoard.version));
    expect(approvedBoard.approvals).toHaveLength(1);
    const flagsBefore = Object.values(store.loadWard().members).map((member) => [member.id, member.needsApproval]);

    const result = take(store.deleteTag(musical));

    const flagsAfter = Object.values(store.loadWard().members).map((member) => [member.id, member.needsApproval]);
    expect(flagsAfter).toEqual(flagsBefore);
    expect(store.loadWard().members[cy.id]?.needsApproval).toBe(true);
    const after = requireProposal(store, draftA);
    expect(after.board.version).toBe(approvedBoard.version + 1);
    expect(after.board.approvals).toEqual(approvedBoard.approvals);
    expect(after.board.placements).toEqual(approvedBoard.placements);
    expect(result.boards.find((board) => board.id === approvedBoard.id)?.approvals).toEqual(
      approvedBoard.approvals,
    );
  });

  it('unknown tag → not_found and nothing written', () => {
    const { store } = seed();
    const before = snapshot(store);

    expect(refusal(store.deleteTag(tagId('missing-tag'))).code).toBe('not_found');

    expect(snapshot(store)).toEqual(before);
  });

  it('a failure mid-transaction rolls back (ward still has the tag)', () => {
    const { db, store, musical } = seed();
    const before = snapshot(store);
    // A real SQLite trigger refuses the final tag-row delete, after the
    // member and board rewrites have run inside the same transaction.
    db.exec(`CREATE TRIGGER refuse_tag_delete BEFORE DELETE ON tags
             BEGIN SELECT RAISE(ABORT, 'tag delete refused'); END`);

    const result = store.deleteTag(musical);

    expect(result.ok).toBe(false);
    expect(snapshot(store)).toEqual(before);
    expect(store.loadWard().tags[musical]).toBeDefined();
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM member_tags WHERE tag_id = ?', musical)).toBeGreaterThan(0);
    expect(db.isTransaction).toBe(false);
  });
});

describe('store tagUsage', () => {
  it('tagUsage counts members once and preferences/tags over Current + working boards, not baselines', () => {
    const { store, musical } = seed();
    const ward = store.loadWard();
    const members = Object.values(ward.members).filter((member) => member.tagIds.includes(musical)).length;
    expect(members).toBe(4);

    // Per fixture board: Organist has Musical as a calling tag and a preference,
    // Chorister has it as a preference. Current, Draft A and the Accepted
    // working board count; Draft B's working board was stripped; baselines do not count.
    expect(take(store.tagUsage(musical))).toEqual({ members: 4, callingPreferences: 6, callingTags: 3 });

    const newMoveIn = tagNamed(ward, 'New move-in').id;
    expect(take(store.tagUsage(newMoveIn))).toEqual({ members: 1, callingPreferences: 0, callingTags: 0 });

    expect(refusal(store.tagUsage(tagId('missing-tag'))).code).toBe('not_found');
  });
});

describe('store listProposals acceptedAt', () => {
  it('listProposals includes acceptedAt (null for Draft, the stored time for Accepted)', () => {
    const { store, draftA, draftB, accepted } = seed();

    const byId = new Map(store.listProposals().map((item) => [item.id, item]));

    expect(byId.get(draftA)?.acceptedAt).toBeNull();
    expect(byId.get(draftB)?.acceptedAt).toBeNull();
    expect(byId.get(accepted)?.acceptedAt).toBe(ACCEPTED_AT);
    expect(byId.get(accepted)?.status).toBe('accepted');
  });
});
