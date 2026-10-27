import { describe, expect, it } from 'vitest';
import {
  createBoard, createWard, lineageId, positionId,
  type Board, type MemberId, type PositionId, type Proposal, type Ward,
} from '../../src/index.ts';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/ward.ts';
import { acceptanceEligibility, removedState } from '../../src/rules/removed.ts';
import { valueOf } from '../model/helpers.ts';
import { isDeeplyFrozen, memberNamed, positionNamed } from '../ops/helpers.ts';

function setup() {
  const { ward, current } = buildFixtureWard();
  return { ward, current, proposal: buildFixtureProposal(current, ward) };
}

function removed(ward: Ward, ...ids: readonly MemberId[]): Ward {
  return valueOf(createWard({ ...ward, members: Object.fromEntries(Object.values(ward.members).map(
    (member) => [member.id, { ...member, removedDate: ids.includes(member.id) ? '2026-02-01' : member.removedDate }],
  )) }));
}

function without(board: Board, ward: Ward, ...ids: readonly PositionId[]): Board {
  return valueOf(createBoard({ ...board,
    assignments: Object.fromEntries(Object.values(board.assignments).filter((assignment) => assignment.type !== 'single'
      || !Object.values(board.positions).some((slot) => slot.assignmentId === assignment.id && ids.includes(slot.id)))
      .map((assignment) => [assignment.id, assignment])),
    positions: Object.fromEntries(Object.values(board.positions).filter((slot) => !ids.includes(slot.id)).map((slot) => [slot.id, slot])),
    placements: Object.fromEntries(Object.entries(board.placements).filter(([id]) => !ids.includes(positionId(id)))),
  }, ward));
}

function withBoard(proposal: Proposal, board: Board): Proposal {
  return { ...proposal, board };
}

describe('removed state and acceptance eligibility', () => {
  it('a fresh proposal has no removed state and is eligible', () => {
    const { ward, current, proposal } = setup();
    expect(removedState(proposal, current, ward)).toEqual({ members: [], positions: [] });
    expect(acceptanceEligibility(proposal, current, ward)).toEqual({ eligible: true, reasons: [] });
  });

  it('a placed removed member is flagged with every position they hold', () => {
    const { ward, current, proposal } = setup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const rs = positionNamed(proposal.board, 'Relief Society Teachers', 'Relief Society Teacher');
    const nursery = positionNamed(proposal.board, 'Nursery', 'Nursery Leader');
    expect(removedState(proposal, current, removed(ward, jo))).toEqual({
      members: [{ memberId: jo, positionIds: [rs, nursery] }], positions: [],
    });
  });

  it('an unplaced removed member is not flagged', () => {
    const { ward, current, proposal } = setup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const changed = removed(ward, ivy);
    const board = valueOf(createBoard({ ...proposal.board, dugoutInclusions: [ivy] }, changed));
    expect(removedState(withBoard(proposal, board), current, changed)).toEqual({ members: [], positions: [] });
  });

  it('a position whose lineage left Current is flagged', () => {
    const { ward, current, proposal } = setup();
    const slot = positionNamed(current, 'Nursery', 'Nursery Leader');
    expect(removedState(proposal, without(current, ward, slot), ward)).toEqual({ members: [], positions: [slot] });
  });

  it('a position added in the proposal is never flagged', () => {
    const { ward, current, proposal } = setup();
    const original = proposal.board.positions[positionNamed(current, 'Nursery', 'Nursery Leader')];
    if (!original) throw new Error('missing fixture position');
    const id = positionId('p-extra');
    const board = valueOf(createBoard({ ...proposal.board, positions: {
      ...proposal.board.positions, [id]: { ...original, id, lineageId: lineageId('ln-extra'), order: 99 },
    } }, ward));
    expect(removedState(withBoard(proposal, board), current, ward)).toEqual({ members: [], positions: [] });
  });

  it('a vacant removed position is still flagged', () => {
    const { ward, current, proposal } = setup();
    const slot = positionNamed(current, 'Music', 'Chorister');
    expect(proposal.board.placements[slot]).toBeUndefined();
    expect(removedState(proposal, without(current, ward, slot), ward).positions).toEqual([slot]);
  });

  it('removed member on removed position appears in both lists', () => {
    const { ward, current, proposal } = setup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const slot = positionNamed(current, 'Bishopric', 'Bishop');
    const changed = removed(ward, ada);
    expect(removedState(proposal, without(current, changed, slot), changed)).toEqual({
      members: [{ memberId: ada, positionIds: [slot] }], positions: [slot],
    });
  });

  it('eligibility lists every reason', () => {
    const { ward, current, proposal } = setup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const ben = memberNamed(ward, 'Ben Example');
    const bishop = positionNamed(current, 'Bishopric', 'Bishop');
    const counselor = positionNamed(current, 'Bishopric', 'First Counselor');
    const changed = removed(ward, ben, ada);
    expect(acceptanceEligibility(proposal, without(current, changed, bishop), changed)).toEqual({
      eligible: false, reasons: [
        { kind: 'removed_member', memberId: ada, positionIds: [bishop] },
        { kind: 'removed_member', memberId: ben, positionIds: [counselor] },
        { kind: 'removed_position', positionId: bishop },
      ],
    });
  });

  it('ordinary edits restore eligibility', () => {
    const { ward, current, proposal } = setup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const bishop = positionNamed(current, 'Bishopric', 'Bishop');
    const chorister = positionNamed(current, 'Music', 'Chorister');
    const changed = removed(ward, ada);
    const latest = without(current, changed, chorister);
    expect(acceptanceEligibility(proposal, latest, changed).eligible).toBe(false);
    const trimmed = without(proposal.board, changed, chorister);
    const board = valueOf(createBoard({ ...trimmed, placements: Object.fromEntries(
      Object.entries(trimmed.placements).filter(([id]) => id !== bishop),
    ) }, changed));
    expect(acceptanceEligibility(withBoard(proposal, board), latest, changed)).toEqual({ eligible: true, reasons: [] });
  });

  it('removed state does not alter the proposal', () => {
    const { ward, current, proposal } = setup();
    const changed = removed(ward, memberNamed(ward, 'Jo Testwell'));
    const before = structuredClone({ proposal, current, ward: changed });
    const state = removedState(proposal, current, changed);
    const eligibility = acceptanceEligibility(proposal, current, changed);
    expect({ proposal, current, ward: changed }).toEqual(before);
    expect(isDeeplyFrozen(proposal)).toBe(true);
    expect(isDeeplyFrozen(state)).toBe(true);
    expect(isDeeplyFrozen(eligibility)).toBe(true);
  });

  it('current must be a current board', () => {
    const { ward, proposal } = setup();
    for (const current of [proposal.baseline, proposal.board]) {
      expect(() => removedState(proposal, current, ward)).toThrow(TypeError);
      expect(() => acceptanceEligibility(proposal, current, ward)).toThrow(TypeError);
    }
  });

  it('members are ordered by name', () => {
    const { ward, current, proposal } = setup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const ben = memberNamed(ward, 'Ben Example');
    const cal = memberNamed(ward, 'Cal Sample');
    const changed = valueOf(createWard({ ...ward, members: Object.fromEntries(Object.values(ward.members).map(
      (member) => [member.id, { ...member, name: member.id === ada ? 'Zulu' : member.id === ben ? 'écho' : member.id === cal ? 'ECHO' : member.name }],
    )) }));
    expect(removedState(proposal, current, removed(changed, cal, ada, ben)).members.map((entry) => entry.memberId)).toEqual([ben, cal, ada]);
  });

  it('an empty proposal board is eligible', () => {
    const { ward, current, proposal } = setup();
    const board = valueOf(createBoard({ ...proposal.board, boardGroups: {}, callingGroups: {}, assignments: {},
      positions: {}, placements: {}, oversight: [], dugoutInclusions: [], approvals: [],
    }, ward));
    expect(removedState(withBoard(proposal, board), current, ward)).toEqual({ members: [], positions: [] });
    expect(acceptanceEligibility(withBoard(proposal, board), current, ward).eligible).toBe(true);
  });

  it('baseline and Current identical except for one position', () => {
    const { ward, current, proposal } = setup();
    const slot = positionNamed(current, 'Nursery', 'Nursery Leader', 1);
    const latest = without(current, ward, slot);
    expect(Object.keys(latest.positions)).toHaveLength(Object.keys(proposal.baseline.positions).length - 1);
    expect(latest.placements).toEqual(proposal.baseline.placements);
    expect(removedState(proposal, latest, ward).positions).toEqual([slot]);
  });

  it('a restored member is not flagged', () => {
    const { ward, current, proposal } = setup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const changed = removed(ward, ada);
    expect(removedState(proposal, current, changed).members).toHaveLength(1);
    const restored = valueOf(createWard({ ...changed, members: Object.fromEntries(Object.values(changed.members).map(
      (member) => [member.id, { ...member, removedDate: null }],
    )) }));
    expect(removedState(proposal, current, restored).members).toEqual([]);
    expect(acceptanceEligibility(proposal, current, restored).eligible).toBe(true);
  });

  it('lineage matching ignores board-local position ids', () => {
    const { ward, current, proposal } = setup();
    const old = positionNamed(current, 'Nursery', 'Nursery Leader', 1);
    const slot = current.positions[old];
    if (!slot) throw new Error('missing fixture position');
    const id = positionId('p-rekeyed');
    const positions = { ...without(current, ward, old).positions, [id]: { ...slot, id } };
    const rekeyedCurrent = valueOf(createBoard({ ...current, positions }, ward));
    expect(removedState(proposal, rekeyedCurrent, ward).positions).toEqual([]);
    const board = valueOf(createBoard({ ...proposal.board, positions }, ward));
    expect(removedState(withBoard(proposal, board), without(current, ward, old), ward).positions).toEqual([id]);
  });

  it('positions follow proposal structural order rather than insertion order or id', () => {
    const { ward, current, proposal } = setup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const changed = removed(ward, jo);
    const rs = positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher');
    const nursery = positionNamed(current, 'Nursery', 'Nursery Leader');
    const board = valueOf(createBoard({ ...proposal.board, boardGroups: Object.fromEntries(
      Object.values(proposal.board.boardGroups).map((group) => [group.id, { ...group, order: 20 - group.order }]),
    ) }, changed));
    const latest = without(current, changed, rs, nursery);
    const state = removedState(withBoard(proposal, board), latest, changed);
    expect(state).toEqual({ members: [{ memberId: jo, positionIds: [nursery, rs] }], positions: [nursery, rs] });
  });
});
