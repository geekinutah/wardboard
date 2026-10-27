import { describe, expect, it } from 'vitest';
import {
  assignmentId,
  boardGroupId,
  boardId,
  createBoard,
  memberId,
  ONE_CALLING_GUIDANCE,
  placeInPosition,
  positionId,
  secondCallingNotices,
  type Board,
  type ExistingCalling,
  type MemberId,
  type PositionId,
} from '../../src/index.ts';
import { assignment, callingGroup, position, valueOf, wardOf } from '../model/helpers.ts';
import {
  assignmentNamed,
  contextFor,
  expectOk,
  fixtureSetup,
  holdingsOf,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  rebuild,
  SMALL,
  smallBoard,
  smallWard,
} from '../ops/helpers.ts';

const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const NURSERY = ['Nursery', 'Nursery Leader'] as const;
const CHORISTER = ['Music', 'Chorister'] as const;
const DEACONS_FIRST = ['Deacons Quorum', 'Deacons Quorum First Counselor'] as const;
const ORGANIST = ['Music', 'Organist'] as const;
const BISHOP = ['Bishopric', 'Bishop'] as const;
const BISHOP_FIRST = ['Bishopric', 'First Counselor'] as const;

function keptCalling(board: Board, groupName: string, title: string, index = 0): ExistingCalling {
  const calling = assignmentNamed(board, groupName, title);
  const slot = positionNamed(board, groupName, title, index);
  return { positionId: slot, assignmentId: calling.id, title: calling.title };
}

function omitPlacement(board: Board, position: PositionId): Board['placements'] {
  const placements: Record<PositionId, MemberId> = {};
  for (const [id, member] of Object.entries(board.placements)) {
    if (id !== position) {
      placements[positionId(id)] = member;
    }
  }
  return placements;
}

/** Parent calling sorts before its nested child even though the child's position id is earlier. */
function nestedTwoCallingBoard(ward: ReturnType<typeof smallWard>): Board {
  const parent = callingGroup('cg-parent', { order: 0 });
  const child = callingGroup('cg-child', { order: 0, parent: { kind: 'callingGroup', id: parent.id } });
  const parentAssignment = assignment('a-parent', { groupId: parent.id, order: 9, title: 'Parent Calling' });
  const childAssignment = assignment('a-child', { groupId: child.id, order: 0, title: 'Child Calling' });
  const added = assignment('a-new', { groupId: parent.id, order: 0, title: 'Added Calling' });
  const keptParent = position('p-z', 'a-parent');
  const keptChild = position('p-a', 'a-child');
  const destination = position('p-m', 'a-new');
  return smallBoard(ward, {
    callingGroups: { [parent.id]: parent, [child.id]: child },
    assignments: {
      [parentAssignment.id]: parentAssignment,
      [childAssignment.id]: childAssignment,
      [added.id]: added,
    },
    positions: {
      [keptParent.id]: keptParent,
      [keptChild.id]: keptChild,
      [destination.id]: destination,
    },
    placements: {
      [keptParent.id]: memberId('m-1'),
      [keptChild.id]: memberId('m-1'),
    },
  });
}

function emptyBoard(): Board {
  return valueOf(
    createBoard(
      {
        id: boardId('b-empty'),
        kind: 'proposal',
        version: 0,
        boardGroups: {},
        callingGroups: {},
        assignments: {},
        positions: {},
        placements: {},
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      wardOf(),
    ),
  );
}

describe('secondCallingNotices', () => {
  it('exports the handbook one-calling guidance', () => {
    expect(ONE_CALLING_GUIDANCE).toEqual({
      source: 'General Handbook 30.1.1',
      text: 'A member generally serves in only one calling at a time.',
    });
  });

  it('placing a member with a calling into a second one is reported', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const kept = keptCalling(board, ...RS_TEACHERS, 1);
    expect(holdingsOf(board, kit)).toEqual([kept.positionId]);

    const after = expectOk(placeInPosition(board, contextFor(ward), { memberId: kit, from: null, to: positionNamed(board, ...CHORISTER) }));

    expect(secondCallingNotices(board, after)).toEqual([
      { memberId: kit, countBefore: 1, countAfter: 2, existing: [kept] },
    ]);
  });

  it('a member with no calling placed once is not reported', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    expect(holdingsOf(board, ivy)).toEqual([]);

    const after = expectOk(
      placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: positionNamed(board, ...DEACONS_FIRST) }),
    );

    expect(secondCallingNotices(board, after)).toEqual([]);
  });

  it('moving a member between callings is not reported', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const source = positionNamed(board, ...RS_TEACHERS, 1);
    expect(holdingsOf(board, kit)).toEqual([source]);

    const after = expectOk(placeInPosition(board, contextFor(ward), { memberId: kit, from: source, to: positionNamed(board, ...CHORISTER) }));

    expect(holdingsOf(after, kit)).toHaveLength(1);
    expect(secondCallingNotices(board, after)).toEqual([]);
  });

  it('moving a two-calling member is not reported', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const nursery = positionNamed(board, ...NURSERY);
    expect(holdingsOf(board, jo)).toHaveLength(2);

    const after = expectOk(placeInPosition(board, contextFor(ward), { memberId: jo, from: nursery, to: positionNamed(board, ...CHORISTER) }));

    expect(holdingsOf(after, jo)).toHaveLength(2);
    expect(secondCallingNotices(board, after)).toEqual([]);
  });

  it('a third calling is reported with both existing callings', () => {
    const ward = smallWard();
    const before = nestedTwoCallingBoard(ward);
    const member = memberId('m-1');
    expect(holdingsOf(before, member)).toHaveLength(2);

    const after = expectOk(placeInPosition(before, contextFor(ward), { memberId: member, from: null, to: positionId('p-m') }));

    expect(secondCallingNotices(before, after)).toEqual([
      {
        memberId: member,
        countBefore: 2,
        countAfter: 3,
        existing: [
          { positionId: positionId('p-z'), assignmentId: assignmentId('a-parent'), title: 'Parent Calling' },
          { positionId: positionId('p-a'), assignmentId: assignmentId('a-child'), title: 'Child Calling' },
        ],
      },
    ]);
  });

  it('swaps are not reported', () => {
    const { ward, board } = fixtureSetup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const ben = memberNamed(ward, 'Ben Example');
    const bishop = positionNamed(board, ...BISHOP);
    const first = positionNamed(board, ...BISHOP_FIRST);
    expect(board.placements[bishop]).toBe(ada);
    expect(board.placements[first]).toBe(ben);

    const after = rebuild(board, ward, {
      placements: { ...board.placements, [bishop]: ben, [first]: ada },
    });

    expect(holdingsOf(after, ada)).toEqual([first]);
    expect(holdingsOf(after, ben)).toEqual([bishop]);
    expect(secondCallingNotices(board, after)).toEqual([]);
  });

  it('releases are not reported', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const nursery = positionNamed(board, ...NURSERY);
    expect(holdingsOf(board, jo)).toHaveLength(2);

    const after = rebuild(board, ward, { placements: omitPlacement(board, nursery) });

    expect(holdingsOf(after, jo)).toHaveLength(1);
    expect(secondCallingNotices(board, after)).toEqual([]);
  });

  it('release occupant reports only the incoming member', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const gus = memberNamed(ward, 'Gus Demo');
    const organist = positionNamed(board, ...ORGANIST);
    const kept = keptCalling(board, ...RS_TEACHERS, 1);
    expect(board.placements[organist]).toBe(gus);
    expect(holdingsOf(board, kit)).toEqual([kept.positionId]);
    expect(holdingsOf(board, gus)).toEqual([organist]);

    const after = rebuild(board, ward, { placements: { ...board.placements, [organist]: kit } });

    expect(holdingsOf(after, gus)).toEqual([]);
    expect(secondCallingNotices(board, after)).toEqual([
      { memberId: kit, countBefore: 1, countAfter: 2, existing: [kept] },
    ]);
  });

  it('several members can be reported at once', () => {
    const ward = smallWard();
    const first = memberId('m-1');
    const later = memberId('m-4');
    const once = memberId('m-2');
    const earlyGroup = boardGroupId('bg-z');
    const lateGroup = boardGroupId('bg-a');
    const earlyCalling = callingGroup('cg-z', { order: 0, parent: { kind: 'boardGroup', id: earlyGroup } });
    const lateCalling = callingGroup('cg-a', { order: 0, parent: { kind: 'boardGroup', id: lateGroup } });
    const firstCalling = assignment('a-z', { groupId: earlyCalling.id, order: 0, title: 'First Group Calling' });
    const secondCalling = assignment('a-a', { groupId: lateCalling.id, order: 0, title: 'Second Group Calling' });
    const addedCalling = assignment('a-add', { groupId: earlyCalling.id, order: 1, title: 'Added Calling' });
    const keptCallingForLater = assignment('a-kept', { groupId: lateCalling.id, order: 1, title: 'Kept Calling' });
    const gainedCalling = assignment('a-new', { groupId: lateCalling.id, order: 2, title: 'New Calling' });
    const onceCalling = assignment('a-once', { groupId: earlyCalling.id, order: 2, title: 'Once Calling' });
    const keptEarly = position('p-z', 'a-z');
    const keptLate = position('p-a', 'a-a');
    const added = position('p-add', 'a-add');
    const keptLater = position('p-kept', 'a-kept');
    const gained = position('p-new', 'a-new');
    const placedOnce = position('p-once', 'a-once');
    const structure = {
      boardGroups: {
        [earlyGroup]: { id: earlyGroup, name: 'Early', order: 0, visible: true, key: null },
        [lateGroup]: { id: lateGroup, name: 'Late', order: 1, visible: true, key: null },
      },
      callingGroups: { [earlyCalling.id]: earlyCalling, [lateCalling.id]: lateCalling },
      assignments: {
        [firstCalling.id]: firstCalling,
        [secondCalling.id]: secondCalling,
        [addedCalling.id]: addedCalling,
        [keptCallingForLater.id]: keptCallingForLater,
        [gainedCalling.id]: gainedCalling,
        [onceCalling.id]: onceCalling,
      },
      positions: {
        [keptEarly.id]: keptEarly,
        [keptLate.id]: keptLate,
        [added.id]: added,
        [keptLater.id]: keptLater,
        [gained.id]: gained,
        [placedOnce.id]: placedOnce,
      },
    };
    const before = smallBoard(ward, {
      ...structure,
      placements: {
        [keptEarly.id]: first,
        [keptLate.id]: first,
        [keptLater.id]: later,
      },
    });
    // Insertion order sees m-4 before m-1. Notices must still be ordered by member id.
    // p-a sorts before p-z by id, but its board group order is later.
    const after = rebuild(before, ward, {
      ...structure,
      placements: {
        [gained.id]: later,
        [keptLater.id]: later,
        [placedOnce.id]: once,
        [added.id]: first,
        [keptEarly.id]: first,
        [keptLate.id]: first,
      },
    });

    expect(secondCallingNotices(before, after)).toEqual([
      {
        memberId: first,
        countBefore: 2,
        countAfter: 3,
        existing: [
          { positionId: keptEarly.id, assignmentId: firstCalling.id, title: 'First Group Calling' },
          { positionId: keptLate.id, assignmentId: secondCalling.id, title: 'Second Group Calling' },
        ],
      },
      {
        memberId: later,
        countBefore: 1,
        countAfter: 2,
        existing: [{ positionId: keptLater.id, assignmentId: keptCallingForLater.id, title: 'Kept Calling' }],
      },
    ]);
  });

  it('existing excludes callings released by the same operation', () => {
    const ward = smallWard();
    const member = memberId('m-1');
    const before = smallBoard(ward, { placements: { [SMALL.S1]: member } });
    const after = rebuild(before, ward, {
      placements: { [SMALL.S3]: member, [SMALL.L1c]: member },
    });

    expect(secondCallingNotices(before, after)).toEqual([
      { memberId: member, countBefore: 1, countAfter: 2, existing: [] },
    ]);
  });

  it('disabled assignment positions count', () => {
    const ward = smallWard();
    const member = memberId('m-2');
    const before = smallBoard(ward, { placements: { [SMALL.SD]: member } });
    expect(before.assignments[assignmentId('a-sd')]?.enabled).toBe(false);

    const after = expectOk(placeInPosition(before, contextFor(ward), { memberId: member, from: null, to: SMALL.S3 }));

    expect(secondCallingNotices(before, after)).toEqual([
      {
        memberId: member,
        countBefore: 1,
        countAfter: 2,
        existing: [{ positionId: SMALL.SD, assignmentId: assignmentId('a-sd'), title: 'Assignment a-sd' }],
      },
    ]);
  });

  it('different boards are refused', () => {
    const { current, board } = fixtureSetup();
    expect(current.id).not.toBe(board.id);

    expect(() => secondCallingNotices(current, board)).toThrow(TypeError);
  });

  it('inputs are not mutated', () => {
    const ward = smallWard();
    const member = memberId('m-1');
    const before = smallBoard(ward, {
      placements: {
        [SMALL.L1d]: member,
        [SMALL.S1]: member,
      },
    });
    const after = expectOk(placeInPosition(before, contextFor(ward), { memberId: member, from: null, to: SMALL.S3 }));
    const beforeSnapshot = structuredClone(before);
    const afterSnapshot = structuredClone(after);

    const first = secondCallingNotices(before, after);
    const second = secondCallingNotices(before, after);

    expect(first).toEqual(second);
    expect(before).toEqual(beforeSnapshot);
    expect(after).toEqual(afterSnapshot);
    expect(isDeeplyFrozen(before)).toBe(true);
    expect(isDeeplyFrozen(after)).toBe(true);
  });

  it('identical boards report nothing', () => {
    const { ward, board } = fixtureSetup();
    expect(holdingsOf(board, memberNamed(ward, 'Jo Testwell'))).toHaveLength(2);

    expect(secondCallingNotices(board, board)).toEqual([]);
  });

  it('empty boards report nothing', () => {
    const before = emptyBoard();
    const after = emptyBoard();
    expect(before).not.toBe(after);
    expect(Object.keys(before.placements)).toEqual([]);

    expect(secondCallingNotices(before, after)).toEqual([]);
  });

  it('a removed member placed into a second calling is still reported', () => {
    const ward = smallWard();
    const removed = memberId('m-4');
    expect(ward.members[removed]?.removedDate).not.toBeNull();
    const before = smallBoard(ward, { placements: { [SMALL.S1]: removed } });

    const after = expectOk(placeInPosition(before, contextFor(ward), { memberId: removed, from: null, to: SMALL.S3 }));

    expect(secondCallingNotices(before, after)).toEqual([
      {
        memberId: removed,
        countBefore: 1,
        countAfter: 2,
        existing: [{ positionId: SMALL.S1, assignmentId: assignmentId('a-s1'), title: 'Assignment a-s1' }],
      },
    ]);
  });
});
