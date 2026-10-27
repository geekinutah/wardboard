import {
  approvePlacement,
  createBoard,
  createProposal,
  createWard,
  placeInPosition,
  positionId,
  removePosition,
  sequentialIds,
  unapprovedPlacements,
  userId,
  type Board,
  type Member,
  type MemberId,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { describe, expect, it } from 'vitest';
import { checkAcceptance } from '../../src/proposals/index.ts';

function memberByName(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((item) => item.name === name);
  if (member === undefined) throw new Error(`missing member ${name}`);
  return member;
}

function holding(board: Board, member: MemberId): PositionId {
  const found = Object.entries(board.placements).find(([, occupant]) => occupant === member);
  if (found === undefined) throw new Error(`member ${member} is not placed`);
  const [id] = found;
  return positionId(id);
}

function vacantPosition(board: Board, title: string): PositionId {
  const assignment = Object.values(board.assignments).find((item) => item.title === title);
  if (assignment === undefined) throw new Error(`missing assignment ${title}`);
  const vacant = Object.values(board.positions).find(
    (position) => position.assignmentId === assignment.id && !Object.hasOwn(board.placements, position.id),
  );
  if (vacant === undefined) throw new Error(`no vacant ${title}`);
  return vacant.id;
}

function vacantListPosition(board: Board, title: string): PositionId {
  const assignment = Object.values(board.assignments).find((item) => item.title === title && item.type === 'list');
  if (assignment === undefined) throw new Error(`missing list ${title}`);
  const vacant = Object.values(board.positions).find(
    (position) => position.assignmentId === assignment.id && !Object.hasOwn(board.placements, position.id),
  );
  if (vacant === undefined) throw new Error(`no vacant ${title}`);
  return vacant.id;
}

function unwrapBoard(result: { ok: true; value: Board } | { ok: false; errors: readonly { message: string }[] }): Board {
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

function apply(result: { ok: true; board: Board } | { ok: false; error: { message: string } }): Board {
  if (!result.ok) throw new Error(result.error.message);
  return result.board;
}

function withBoard(proposal: Proposal, ward: Ward, board: Board): Proposal {
  const result = createProposal({ ...proposal, board }, ward);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
  return result.value;
}

function withRemoved(ward: Ward, names: readonly string[]): Ward {
  const removed = new Set(names.map((name) => memberByName(ward, name).id));
  return unwrapBoardish(
    createWard({
      tags: ward.tags,
      members: Object.fromEntries(
        Object.values(ward.members).map((member) => [
          member.id,
          removed.has(member.id) ? { ...member, removedDate: '2026-02-01' } : member,
        ]),
      ),
    }),
  );
}

function unwrapBoardish(result: { ok: true; value: Ward } | { ok: false; errors: readonly { message: string }[] }): Ward {
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

/** A position whose lineage has left Current, built with removePosition rather than a raw row. */
function currentWithout(current: Board, ward: Ward, removedId: PositionId): Board {
  const editable = unwrapBoard(createBoard({ ...current, kind: 'proposal' }, ward));
  const trimmed = apply(removePosition(editable, { ward, ids: sequentialIds('trim') }, { positionId: removedId }));
  return unwrapBoard(createBoard({ ...trimmed, id: current.id, kind: 'current', version: current.version }, ward));
}

function place(
  proposal: Proposal,
  ward: Ward,
  member: MemberId,
  from: PositionId,
  to: PositionId,
): Proposal {
  const board = apply(
    placeInPosition(proposal.board, { ward, ids: sequentialIds('place') }, { memberId: member, from, to }),
  );
  return withBoard(proposal, ward, board);
}

describe('acceptance checks', () => {
  it('eligible draft → ok', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);

    expect(checkAcceptance(proposal, current, ward)).toEqual({ ok: true });
  });

  it('removed member placed → removed_items', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const removed = withRemoved(ward, ['Ada Fictional']);

    expect(checkAcceptance(proposal, current, removed)).toEqual({
      ok: false,
      code: 'removed_items',
      message: '1 removed member',
    });
  });

  it('removed position → removed_items', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const slot = vacantListPosition(current, 'Elders Quorum Instructor');
    const latest = currentWithout(current, ward, slot);

    expect(checkAcceptance(proposal, latest, ward)).toEqual({
      ok: false,
      code: 'removed_items',
      message: '1 removed position',
    });
  });

  it('unapproved needs-approval placement → unapproved_placements; approved → ok', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const cy = memberByName(ward, 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const chorister = vacantPosition(proposal.board, 'Chorister');
    const placed = place(proposal, ward, cy.id, holding(proposal.board, cy.id), chorister);

    expect(checkAcceptance(placed, current, ward)).toEqual({
      ok: false,
      code: 'unapproved_placements',
      message: '1 unapproved placement',
    });

    const approvedBoard = apply(
      approvePlacement(
        placed.board,
        { ward, ids: sequentialIds('approve') },
        {
          baseline: placed.baseline,
          memberId: cy.id,
          positionId: chorister,
          approvedBy: userId('u-editor'),
          approvedAt: '2026-03-01T15:04:05.000Z',
        },
      ),
    );
    const approved = withBoard(placed, ward, approvedBoard);

    expect(checkAcceptance(approved, current, ward)).toEqual({ ok: true });
  });

  it('both problems → removed_items first', () => {
    const { ward, current } = buildFixtureWard();
    const started = buildFixtureProposal(current, ward);
    const cy = memberByName(ward, 'Cy Mockup');
    const chorister = vacantPosition(started.board, 'Chorister');
    const placed = place(started, ward, cy.id, holding(started.board, cy.id), chorister);
    const removed = withRemoved(ward, ['Ada Fictional', 'Ben Example']);
    const latest = currentWithout(current, removed, vacantListPosition(current, 'Elders Quorum Instructor'));

    expect(unapprovedPlacements(placed, removed).length).toBeGreaterThan(0);
    expect(checkAcceptance(placed, latest, removed)).toEqual({
      ok: false,
      code: 'removed_items',
      message: '2 removed members, 1 removed position',
    });
  });
});
