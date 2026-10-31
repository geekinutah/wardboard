import { describe, expect, it } from 'vitest';
import {
  addToList,
  assignmentId,
  BOARD_NOT_EDITABLE,
  checkEditable,
  dropStaleApprovals,
  finalizeBoard,
  INVALID_OPERATION,
  memberId,
  MOVE_ERROR_CODES,
  NOT_FOUND,
  placeInPosition,
  positionId,
  SHARED_OPERATION_ERROR_CODES,
  userId,
  type Approval,
  type Board,
  type MemberId,
  type PositionId,
} from '../../src/index.ts';
import {
  assignmentNamed,
  contextFor,
  expectError,
  expectOk,
  fixtureSetup,
  holdingsOf,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  positionsOf,
  rebuild,
  SMALL,
  smallBoard,
  smallWard,
} from './helpers.ts';

const APPROVED_AT = '2026-01-05T09:00:00Z';

function approval(member: MemberId, position: PositionId): Approval {
  return { memberId: member, positionId: position, approvedBy: userId('u-admin'), approvedAt: APPROVED_AT };
}

/** Placements that differ between two boards, as `position: [before, after]`. */
function placementChanges(before: Board, after: Board): Record<string, [string | undefined, string | undefined]> {
  const keys = new Set([...Object.keys(before.placements), ...Object.keys(after.placements)]);
  const changes: Record<string, [string | undefined, string | undefined]> = {};
  for (const key of keys) {
    const was = before.placements[positionId(key)] as string | undefined;
    const now = after.placements[positionId(key)] as string | undefined;
    if (was !== now) {
      changes[key] = [was, now];
    }
  }
  return changes;
}

// Fixture names used throughout.
const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const PRIMARY_TEACHERS = ['Primary Teachers', 'Primary Teacher'] as const;
const NURSERY = ['Nursery', 'Nursery Leader'] as const;
const PRIMARY_SECRETARY = ['Primary Presidency', 'Secretary'] as const;
const DEACONS_FIRST = ['Deacons Quorum', 'Deacons Quorum First Counselor'] as const;
const CHORISTER = ['Music', 'Chorister'] as const;
const ORGANIST = ['Music', 'Organist'] as const;

describe('operation conventions', () => {
  it('error code lists are exported', () => {
    expect(SHARED_OPERATION_ERROR_CODES).toEqual(['board_not_editable', 'not_found', 'invalid_operation']);
    expect([BOARD_NOT_EDITABLE, NOT_FOUND, INVALID_OPERATION]).toEqual(['board_not_editable', 'not_found', 'invalid_operation']);
    expect(MOVE_ERROR_CODES).toEqual([
      'position_occupied',
      'already_in_list',
      'not_placed',
      'assignment_disabled',
      'wrong_assignment_type',
      'gender_mismatch',
    ]);
  });

  it('checkEditable accepts only proposal boards', () => {
    const { current, baseline, board } = fixtureSetup();

    expect(checkEditable(board)).toBeNull();
    expect(checkEditable(current)?.code).toBe('board_not_editable');
    expect(checkEditable(baseline)?.code).toBe('board_not_editable');
  });

  it('finalizeBoard throws on an invalid board', () => {
    const { ward, board } = fixtureSetup();
    const dangling = { ...board, placements: { ...board.placements, [positionId('p-missing')]: memberNamed(ward, 'Ivy Notreal') } };

    expect(() => finalizeBoard(dangling, ward)).toThrow(/p-missing/);
  });

  it('finalizeBoard returns a validated, frozen copy of a valid board', () => {
    const { ward, board } = fixtureSetup();
    const input = { ...board, placements: { ...board.placements } };

    const result = finalizeBoard(input, ward);

    expect(result).toEqual(board);
    expect(result).not.toBe(input);
    expect(isDeeplyFrozen(result)).toBe(true);
  });

  it('dropStaleApprovals keeps only approvals matching a placement', () => {
    const { ward, board } = fixtureSetup();
    const cy = memberNamed(ward, 'Cy Mockup');
    const bea = memberNamed(ward, 'Bea Placeholder');
    const beaPosition = positionNamed(board, ...PRIMARY_TEACHERS, 0);
    const cyPosition = positionNamed(board, ...PRIMARY_TEACHERS, 1);
    const vacant = positionNamed(board, ...PRIMARY_TEACHERS, 2);
    const input = {
      ...board,
      approvals: [approval(bea, beaPosition), approval(cy, beaPosition), approval(cy, vacant), approval(cy, cyPosition)],
    };

    expect(dropStaleApprovals(input).approvals).toEqual([approval(bea, beaPosition), approval(cy, cyPosition)]);
  });
});

describe('placeInPosition', () => {
  it('move from a calling to a vacant single leaves the source vacant', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const source = positionNamed(board, ...RS_TEACHERS, 1);
    const destination = positionNamed(board, ...PRIMARY_SECRETARY);
    expect(board.placements[source]).toBe(kit);

    const next = expectOk(placeInPosition(board, contextFor(ward), { memberId: kit, from: source, to: destination }));

    expect(next.positions[source]).toEqual(board.positions[source]);
    expect(placementChanges(board, next)).toEqual({ [source]: [kit, undefined], [destination]: [undefined, kit] });
    expect(next.positions).toEqual(board.positions);
  });

  it('moving releases only the source calling', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const rs = positionNamed(board, ...RS_TEACHERS, 0);
    const nursery = positionNamed(board, ...NURSERY, 0);
    const chorister = positionNamed(board, ...CHORISTER);
    expect(holdingsOf(board, jo)).toEqual([rs, nursery].sort());

    const next = expectOk(placeInPosition(board, contextFor(ward), { memberId: jo, from: nursery, to: chorister }));

    expect(holdingsOf(next, jo)).toEqual([rs, chorister].sort());
    expect(placementChanges(board, next)).toEqual({ [nursery]: [jo, undefined], [chorister]: [undefined, jo] });
  });

  it('place from the dugout fills a vacancy', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const deacons = positionNamed(board, ...DEACONS_FIRST);

    const next = expectOk(placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: deacons }));

    expect(next).toEqual({ ...board, placements: { ...board.placements, [deacons]: ivy } });
  });

  it('placing clears explicit dugout inclusion', () => {
    const { ward, board: fixture } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jay = memberNamed(ward, 'Jay Storybook');
    const gus = memberNamed(ward, 'Gus Demo');
    const board = rebuild(fixture, ward, { dugoutInclusions: [jay, ivy, gus] });

    const fromDugout = expectOk(
      placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: positionNamed(board, ...DEACONS_FIRST) }),
    );
    const fromCalling = expectOk(
      placeInPosition(board, contextFor(ward), {
        memberId: gus,
        from: positionNamed(board, ...ORGANIST),
        to: positionNamed(board, ...CHORISTER),
      }),
    );

    expect(fromDugout.dugoutInclusions).toEqual([jay, gus]);
    expect(fromCalling.dugoutInclusions).toEqual([jay, ivy]);
  });

  it('placing into an occupied single is refused', () => {
    const { ward, board } = fixtureSetup();
    const snapshot = structuredClone(board);
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const kit = memberNamed(ward, 'Kit Notreal');

    const fromDugout = expectError(
      placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: positionNamed(board, ...ORGANIST) }),
    );
    const fromCalling = expectError(
      placeInPosition(board, contextFor(ward), {
        memberId: kit,
        from: positionNamed(board, ...RS_TEACHERS, 1),
        to: positionNamed(board, ...ORGANIST),
      }),
    );

    expect(fromDugout.code).toBe('position_occupied');
    expect(fromCalling.code).toBe('position_occupied');
    expect(board).toEqual(snapshot);
  });

  it('placing into a list position via placeInPosition is refused', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const vacantListPosition = positionNamed(board, ...RS_TEACHERS, 3);
    expect(board.placements[vacantListPosition]).toBeUndefined();

    const error = expectError(placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: vacantListPosition }));

    expect(error.code).toBe('invalid_operation');
  });

  it('from must be held by the member', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const kitsPosition = positionNamed(board, ...RS_TEACHERS, 1);
    const vacant = positionNamed(board, ...RS_TEACHERS, 3);
    const to = positionNamed(board, ...DEACONS_FIRST);

    const someoneElses = expectError(placeInPosition(board, contextFor(ward), { memberId: ivy, from: kitsPosition, to }));
    const vacantSource = expectError(placeInPosition(board, contextFor(ward), { memberId: ivy, from: vacant, to }));
    const listSomeoneElses = expectError(
      addToList(board, contextFor(ward), {
        memberId: ivy,
        from: kitsPosition,
        assignmentId: assignmentNamed(board, ...PRIMARY_TEACHERS).id,
      }),
    );

    expect([someoneElses.code, vacantSource.code, listSomeoneElses.code]).toEqual(['not_placed', 'not_placed', 'not_placed']);
  });

  it('same source and destination is refused', () => {
    const { ward, board: fixture } = fixtureSetup();
    const gus = memberNamed(ward, 'Gus Demo');
    const organist = positionNamed(fixture, ...ORGANIST);
    const board = rebuild(fixture, ward, { dugoutInclusions: [gus] });

    const error = expectError(placeInPosition(board, contextFor(ward), { memberId: gus, from: organist, to: organist }));

    expect(error.code).toBe('invalid_operation');
  });

  it('placeInPosition into a disabled single is refused', () => {
    const ward = smallWard();
    const board = smallBoard(ward);

    const error = expectError(placeInPosition(board, contextFor(ward), { memberId: memberId('m-3'), from: null, to: SMALL.SD }));

    expect(error.code).toBe('assignment_disabled');
  });

  it('member with three callings moving out of the middle one keeps the other two', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m1 = memberId('m-1');
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const next = expectOk(placeInPosition(board, contextFor(ward), { memberId: m1, from: SMALL.L1d, to: SMALL.S3 }));

    expect(holdingsOf(next, m1)).toEqual([SMALL.S1, SMALL.S2, SMALL.S3].sort());
    expect(next.positions[SMALL.L1d]).toEqual(board.positions[SMALL.L1d]);
    expect(next.placements[SMALL.L1d]).toBeUndefined();
  });
});

describe('addToList', () => {
  it('addToList fills the lowest vacant position first', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    // L1 vacancies: p-l1-b (order 1) and p-l1-a (order 3); id order would pick p-l1-a.
    const next = expectOk(addToList(board, contextFor(ward), { memberId: memberId('m-3'), from: null, assignmentId: SMALL.L1 }));

    expect(placementChanges(board, next)).toEqual({ [SMALL.L1b]: [undefined, 'm-3'] });
    expect(next.positions).toEqual(board.positions);
  });

  it('addToList breaks equal-order ties by position id', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const board = rebuild(base, ward, {
      positions: {
        ...base.positions,
        [SMALL.L1a]: { ...base.positions[SMALL.L1a], order: 1 },
      },
    });

    const next = expectOk(addToList(board, contextFor(ward), { memberId: memberId('m-3'), from: null, assignmentId: SMALL.L1 }));

    expect(placementChanges(board, next)).toEqual({ [SMALL.L1a]: [undefined, 'm-3'] });
  });

  it('addToList fills the fixture Primary teacher vacancy at the lowest order', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const primary = assignmentNamed(board, ...PRIMARY_TEACHERS);

    const next = expectOk(addToList(board, contextFor(ward), { memberId: ivy, from: null, assignmentId: primary.id }));

    expect(placementChanges(board, next)).toEqual({ [positionNamed(board, ...PRIMARY_TEACHERS, 2)]: [undefined, ivy] });
  });

  it('addToList creates an extra position when the list is full', () => {
    const { ward, board: fixture } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jay = memberNamed(ward, 'Jay Storybook');
    const rs = assignmentNamed(fixture, ...RS_TEACHERS);
    const full = expectOk(addToList(fixture, contextFor(ward, 'unused'), { memberId: ivy, from: null, assignmentId: rs.id }));
    expect(positionsOf(full, rs.id)).toHaveLength(4);
    expect(positionsOf(full, rs.id).every((p) => p.id in full.placements)).toBe(true);
    const generated: string[] = [];
    const ids = contextFor(ward, 'gen').ids;
    const ctx = {
      ward,
      ids: () => {
        const id = ids();
        generated.push(id);
        return id;
      },
    };

    const next = expectOk(addToList(full, ctx, { memberId: jay, from: null, assignmentId: rs.id }));

    expect(generated).toEqual(['gen-0001', 'gen-0002']);
    const positions = positionsOf(next, rs.id);
    expect(positions).toHaveLength(5);
    expect(positions[4]).toEqual({ id: 'gen-0001', assignmentId: rs.id, lineageId: 'gen-0002', order: 4 });
    expect(placementChanges(full, next)).toEqual({ 'gen-0001': [undefined, jay] });
    expect(Object.keys(next.positions)).toHaveLength(Object.keys(full.positions).length + 1);
  });

  it('addToList creates the first position of an empty list', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    expect(positionsOf(board, SMALL.L0)).toEqual([]);

    const next = expectOk(addToList(board, contextFor(ward), { memberId: memberId('m-3'), from: null, assignmentId: SMALL.L0 }));

    expect(positionsOf(next, SMALL.L0)).toEqual([{ id: 'gen-0001', assignmentId: SMALL.L0, lineageId: 'gen-0002', order: 0 }]);
    expect(placementChanges(board, next)).toEqual({ 'gen-0001': [undefined, 'm-3'] });
  });

  it('addToList throws when the id generator reuses an existing id', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const reused = [SMALL.S1, 'ln-fresh'];
    const ctx = { ward, ids: () => reused.shift() ?? 'exhausted' };

    expect(() => addToList(board, ctx, { memberId: memberId('m-3'), from: null, assignmentId: SMALL.L0 })).toThrow(/p-s1/);
    expect(board.positions[SMALL.S1]?.assignmentId).toBe('a-s1');
  });

  it('addToList refuses a member already in the list', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const jo = memberNamed(ward, 'Jo Testwell');
    const rs = assignmentNamed(board, ...RS_TEACHERS).id;
    const kitsPosition = positionNamed(board, ...RS_TEACHERS, 1);
    const josNursery = positionNamed(board, ...NURSERY, 0);

    const fromDugout = expectError(addToList(board, contextFor(ward), { memberId: kit, from: null, assignmentId: rs }));
    const fromSameList = expectError(addToList(board, contextFor(ward), { memberId: kit, from: kitsPosition, assignmentId: rs }));
    const fromOtherCalling = expectError(addToList(board, contextFor(ward), { memberId: jo, from: josNursery, assignmentId: rs }));

    expect([fromDugout.code, fromSameList.code, fromOtherCalling.code]).toEqual([
      'already_in_list',
      'already_in_list',
      'already_in_list',
    ]);
  });

  it('addToList moves from another calling', () => {
    const { ward, board } = fixtureSetup();
    const gus = memberNamed(ward, 'Gus Demo');
    const organist = positionNamed(board, ...ORGANIST);
    const primary = assignmentNamed(board, ...PRIMARY_TEACHERS).id;

    const next = expectOk(addToList(board, contextFor(ward), { memberId: gus, from: organist, assignmentId: primary }));

    expect(placementChanges(board, next)).toEqual({
      [organist]: [gus, undefined],
      [positionNamed(board, ...PRIMARY_TEACHERS, 2)]: [undefined, gus],
    });
    expect(next.positions[organist]).toEqual(board.positions[organist]);
  });

  it('addToList with from in a different list vacates that list position', () => {
    const { ward, board: fixture } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const kitsPosition = positionNamed(fixture, ...RS_TEACHERS, 1);
    const primary = assignmentNamed(fixture, ...PRIMARY_TEACHERS).id;
    const board = rebuild(fixture, ward, { dugoutInclusions: [kit] });

    const next = expectOk(addToList(board, contextFor(ward), { memberId: kit, from: kitsPosition, assignmentId: primary }));

    expect(placementChanges(board, next)).toEqual({
      [kitsPosition]: [kit, undefined],
      [positionNamed(board, ...PRIMARY_TEACHERS, 2)]: [undefined, kit],
    });
    expect(positionsOf(next, assignmentNamed(next, ...RS_TEACHERS).id)).toHaveLength(4);
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('disabled or wrong-type assignments are refused', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m3 = memberId('m-3');

    const disabled = expectError(addToList(board, contextFor(ward), { memberId: m3, from: null, assignmentId: SMALL.LD }));
    const single = expectError(addToList(board, contextFor(ward), { memberId: m3, from: null, assignmentId: SMALL.AS3 }));

    expect(disabled.code).toBe('assignment_disabled');
    expect(single.code).toBe('wrong_assignment_type');
  });
});

describe('both operations', () => {
  it('operations refuse non-proposal boards', () => {
    const { ward, current, baseline } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');

    const codes = [current, baseline].flatMap((board) => [
      expectError(placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: positionNamed(board, ...DEACONS_FIRST) }))
        .code,
      expectError(
        addToList(board, contextFor(ward), { memberId: ivy, from: null, assignmentId: assignmentNamed(board, ...PRIMARY_TEACHERS).id }),
      ).code,
    ]);

    expect(codes).toEqual(Array<string>(4).fill('board_not_editable'));
  });

  it('unknown ids are refused', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const ghost = memberId('m-ghost');
    const missing = positionId('p-missing');
    const deacons = positionNamed(board, ...DEACONS_FIRST);
    const primary = assignmentNamed(board, ...PRIMARY_TEACHERS).id;
    const ctx = contextFor(ward);

    const errors = [
      placeInPosition(board, ctx, { memberId: ghost, from: null, to: deacons }),
      placeInPosition(board, ctx, { memberId: ivy, from: null, to: missing }),
      placeInPosition(board, ctx, { memberId: ivy, from: missing, to: deacons }),
      addToList(board, ctx, { memberId: ghost, from: null, assignmentId: primary }),
      addToList(board, ctx, { memberId: ivy, from: null, assignmentId: assignmentId('a-missing') }),
      addToList(board, ctx, { memberId: ivy, from: missing, assignmentId: primary }),
    ].map((result) => expectError(result).code);

    expect(errors).toEqual(Array<string>(6).fill('not_found'));
  });

  it('stale approvals are dropped', () => {
    const { ward, board: fixture } = fixtureSetup();
    const cy = memberNamed(ward, 'Cy Mockup');
    const bea = memberNamed(ward, 'Bea Placeholder');
    const beaPosition = positionNamed(fixture, ...PRIMARY_TEACHERS, 0);
    const cyPosition = positionNamed(fixture, ...PRIMARY_TEACHERS, 1);
    const board = rebuild(fixture, ward, { approvals: [approval(bea, beaPosition), approval(cy, cyPosition)] });

    const placed = expectOk(
      placeInPosition(board, contextFor(ward), { memberId: cy, from: cyPosition, to: positionNamed(board, ...CHORISTER) }),
    );
    const listed = expectOk(
      addToList(board, contextFor(ward), { memberId: cy, from: cyPosition, assignmentId: assignmentNamed(board, ...RS_TEACHERS).id }),
    );

    expect(placed.approvals).toEqual([approval(bea, beaPosition)]);
    expect(listed.approvals).toEqual([approval(bea, beaPosition)]);
  });

  it('version, id and kind are unchanged', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m3 = memberId('m-3');

    const results = [
      expectOk(placeInPosition(board, contextFor(ward), { memberId: m3, from: null, to: SMALL.S3 })),
      expectOk(addToList(board, contextFor(ward), { memberId: m3, from: null, assignmentId: SMALL.L0 })),
    ];

    for (const next of results) {
      expect({ id: next.id, kind: next.kind, version: next.version }).toEqual({ id: 'b-small', kind: 'proposal', version: 7 });
    }
  });

  it('results are frozen and inputs untouched', () => {
    const { ward, board } = fixtureSetup();
    const snapshot = structuredClone(board);
    const gus = memberNamed(ward, 'Gus Demo');
    const organist = positionNamed(board, ...ORGANIST);

    const placed = expectOk(placeInPosition(board, contextFor(ward), { memberId: gus, from: organist, to: positionNamed(board, ...CHORISTER) }));
    const listed = expectOk(
      addToList(board, contextFor(ward), { memberId: gus, from: organist, assignmentId: assignmentNamed(board, ...RS_TEACHERS).id }),
    );
    const extended = expectOk(
      addToList(listed, contextFor(ward), {
        memberId: memberNamed(ward, 'Jay Storybook'),
        from: null,
        assignmentId: assignmentNamed(board, ...RS_TEACHERS).id,
      }),
    );

    expect(board).toEqual(snapshot);
    expect([placed, listed, extended].every(isDeeplyFrozen)).toBe(true);
    expect(positionsOf(extended, assignmentNamed(board, ...RS_TEACHERS).id)).toHaveLength(5);
  });

  it('removed members can be placed', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const removed = memberId('m-4');
    expect(ward.members[removed]?.removedDate).not.toBeNull();

    const placed = expectOk(placeInPosition(board, contextFor(ward), { memberId: removed, from: null, to: SMALL.S3 }));
    const listed = expectOk(addToList(board, contextFor(ward), { memberId: removed, from: null, assignmentId: SMALL.L1 }));

    expect(placed.placements[SMALL.S3]).toBe(removed);
    expect(listed.placements[SMALL.L1b]).toBe(removed);
  });
});
