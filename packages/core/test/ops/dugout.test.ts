import { describe, expect, it } from 'vitest';
import {
  addToDugout,
  assignmentId,
  DUGOUT_ERROR_CODES,
  memberId,
  moveToDugout,
  positionId,
  releaseCalling,
  userId,
  type Approval,
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

// Fixture names used throughout. Deliberately no presidents or counselors:
// T-013 adds the presidency release rule to these operations later and must
// not have to rewrite these tests.
const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const NURSERY = ['Nursery', 'Nursery Leader'] as const;
const PRIMARY_TEACHERS = ['Primary Teachers', 'Primary Teacher'] as const;
const WARD_CLERK = ['Clerks and Secretaries (support roles)', 'Ward Clerk'] as const;

describe('dugout conventions', () => {
  it('operation-specific error codes are exported', () => {
    expect(DUGOUT_ERROR_CODES).toEqual(['not_placed', 'already_in_dugout']);
  });
});

describe('releaseCalling', () => {
  it('releasing a calling leaves its position vacant', () => {
    const { ward, board } = fixtureSetup();
    const dora = memberNamed(ward, 'Dora Placeholder');
    const clerk = positionNamed(board, ...WARD_CLERK);
    expect(board.placements[clerk]).toBe(dora);

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: dora, positionId: clerk }));

    expect(next.positions[clerk]).toEqual(board.positions[clerk]); // the slot persists
    expect(next.placements[clerk]).toBeUndefined(); // …and is now vacant
    expect(next.positions).toEqual(board.positions); // nothing is removed
    expect(holdingsOf(next, dora)).toEqual([]); // her only calling is gone
  });

  it('releasing one of several callings keeps the others', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const rsTeacher = positionNamed(board, ...RS_TEACHERS, 0);
    const nursery = positionNamed(board, ...NURSERY, 0);
    expect(holdingsOf(board, jo)).toEqual([rsTeacher, nursery].sort());

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: jo, positionId: rsTeacher }));

    expect(next.placements[rsTeacher]).toBeUndefined();
    expect(next.placements[nursery]).toBe(jo);
    expect(holdingsOf(next, jo)).toEqual([nursery]);
  });

  it('releasing does not add an explicit dugout inclusion', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const jo = memberNamed(ward, 'Jo Testwell');
    const kitsOnlyCalling = positionNamed(board, ...RS_TEACHERS, 1);
    expect(board.dugoutInclusions).toEqual([]);

    const kitReleased = expectOk(releaseCalling(board, contextFor(ward), { memberId: kit, positionId: kitsOnlyCalling }));
    const joReleased = expectOk(releaseCalling(board, contextFor(ward), { memberId: jo, positionId: positionNamed(board, ...RS_TEACHERS, 0) }));

    // Both were released, but never recorded as dugout actions.
    expect(kitReleased.placements[kitsOnlyCalling]).toBeUndefined();
    expect(kitReleased.dugoutInclusions).toEqual([]);
    expect(joReleased.dugoutInclusions).toEqual([]);
  });

  it('releasing keeps an existing explicit inclusion', () => {
    const { ward, board: fixture } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const kitsOnlyCalling = positionNamed(fixture, ...RS_TEACHERS, 1);
    const board = rebuild(fixture, ward, { dugoutInclusions: [kit] });

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: kit, positionId: kitsOnlyCalling }));

    expect(next.placements[kitsOnlyCalling]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([kit]);
  });

  it('releasing a list position keeps the list size', () => {
    const { ward, board } = fixtureSetup();
    const kit = memberNamed(ward, 'Kit Notreal');
    const kitPosition = positionNamed(board, ...RS_TEACHERS, 1);
    const rs = assignmentNamed(board, ...RS_TEACHERS).id;
    const list = positionsOf(board, rs);
    expect(list).toHaveLength(4);
    expect(list.filter((p) => board.placements[p.id] === undefined)).toHaveLength(1);

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: kit, positionId: kitPosition }));

    const nextList = positionsOf(next, rs);
    expect(nextList).toHaveLength(4);
    expect(nextList.filter((p) => next.placements[p.id] === undefined)).toHaveLength(2);
  });
});

describe('moveToDugout', () => {
  it('moving to the dugout releases only that calling and records inclusion', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const rsTeacher = positionNamed(board, ...RS_TEACHERS, 0);
    const nursery = positionNamed(board, ...NURSERY, 0);

    const next = expectOk(moveToDugout(board, contextFor(ward), { memberId: jo, from: rsTeacher }));

    expect(next.placements[rsTeacher]).toBeUndefined();
    expect(next.placements[nursery]).toBe(jo);
    expect(holdingsOf(next, jo)).toEqual([nursery]);
    expect(next.dugoutInclusions).toEqual([jo]); // listed exactly once
  });

  it('moving to the dugout never duplicates an inclusion', () => {
    const { ward, board: fixture } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const nursery = positionNamed(fixture, ...NURSERY, 0);
    const board = rebuild(fixture, ward, { dugoutInclusions: [jo] });

    const next = expectOk(moveToDugout(board, contextFor(ward), { memberId: jo, from: nursery }));

    expect(next.placements[nursery]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([jo]); // still exactly one entry
  });

  it('moving the middle calling of a three-calling member to the dugout', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m1 = memberId('m-1');
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const next = expectOk(moveToDugout(board, contextFor(ward), { memberId: m1, from: SMALL.L1d }));

    expect(next.placements[SMALL.L1d]).toBeUndefined();
    expect(holdingsOf(next, m1)).toEqual([SMALL.S1, SMALL.S2].sort());
    expect(next.dugoutInclusions).toEqual([m1]);
    expect(positionsOf(next, SMALL.L1)).toHaveLength(4); // the list keeps its size
    expect(next.placements[SMALL.L1c]).toBe(memberId('m-2')); // others untouched
  });
});

describe('addToDugout', () => {
  it('add to dugout keeps every calling', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m1 = memberId('m-1');
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const next = expectOk(addToDugout(board, contextFor(ward), { memberId: m1 }));

    expect(next.placements).toEqual(board.placements); // no placement changed
    expect(holdingsOf(next, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());
    expect(next.dugoutInclusions).toEqual([m1]);
  });

  it('add to dugout of an included member is refused', () => {
    const { ward, board: fixture } = fixtureSetup();
    const gus = memberNamed(ward, 'Gus Demo');
    const board = rebuild(fixture, ward, { dugoutInclusions: [gus] });
    const snapshot = structuredClone(board);

    const error = expectError(addToDugout(board, contextFor(ward), { memberId: gus }));

    expect(error.code).toBe('already_in_dugout');
    expect(board).toEqual(snapshot); // refused: nothing changed
  });

  it('add to dugout accepts members with no calling and removed members', () => {
    const { ward, board: fixture } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    expect(holdingsOf(fixture, ivy)).toEqual([]);

    const wardSmall = smallWard();
    const small = smallBoard(wardSmall);
    const m3 = memberId('m-3');
    const m4 = memberId('m-4');
    expect(wardSmall.members[m4]?.removedDate).not.toBeNull();

    const noCalling = expectOk(addToDugout(fixture, contextFor(ward), { memberId: ivy }));
    const withM3 = expectOk(addToDugout(small, contextFor(wardSmall), { memberId: m3 }));
    const both = expectOk(addToDugout(withM3, contextFor(wardSmall), { memberId: m4 }));

    expect(noCalling.dugoutInclusions).toEqual([ivy]);
    expect(both.dugoutInclusions).toEqual([m3, m4]);
  });

  it('add to dugout preserves existing inclusion order and appends', () => {
    const { ward, board: fixture } = fixtureSetup();
    const jay = memberNamed(ward, 'Jay Storybook');
    const gus = memberNamed(ward, 'Gus Demo');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const withOthers = rebuild(fixture, ward, { dugoutInclusions: [jay, gus] });

    const next = expectOk(addToDugout(withOthers, contextFor(ward), { memberId: ivy }));

    expect(next.dugoutInclusions).toEqual([jay, gus, ivy]); // order preserved, appended
  });

  it('add to dugout from an empty inclusion list', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m2 = memberId('m-2');
    expect(board.dugoutInclusions).toEqual([]);

    const next = expectOk(addToDugout(board, contextFor(ward), { memberId: m2 }));

    expect(next.dugoutInclusions).toEqual([m2]);
    expect(next.placements).toEqual(board.placements);
  });
});

describe('all dugout operations', () => {
  it('the member must hold the position', () => {
    const { ward, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const kitsPosition = positionNamed(board, ...RS_TEACHERS, 1);
    const vacant = positionNamed(board, ...RS_TEACHERS, 3);
    expect(board.placements[kitsPosition]).not.toBe(ivy);
    expect(board.placements[vacant]).toBeUndefined();
    const snapshot = structuredClone(board);

    const codes = [
      expectError(releaseCalling(board, contextFor(ward), { memberId: ivy, positionId: kitsPosition })),
      expectError(releaseCalling(board, contextFor(ward), { memberId: ivy, positionId: vacant })),
      expectError(moveToDugout(board, contextFor(ward), { memberId: ivy, from: kitsPosition })),
      expectError(moveToDugout(board, contextFor(ward), { memberId: ivy, from: vacant })),
    ].map((error) => error.code);

    expect(codes).toEqual(Array<string>(4).fill('not_placed'));
    expect(board).toEqual(snapshot); // nobody else's slot was touched
  });

  it('releasing or moving from a disabled assignment is allowed', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const m3 = memberId('m-3');
    expect(base.assignments[assignmentId('a-sd')]).toMatchObject({ enabled: false });
    const board = rebuild(base, ward, { placements: { ...base.placements, [SMALL.SD]: m3 } });
    expect(board.placements[SMALL.SD]).toBe(m3);

    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: m3, positionId: SMALL.SD }));
    const moved = expectOk(moveToDugout(board, contextFor(ward), { memberId: m3, from: SMALL.SD }));

    expect(released.placements[SMALL.SD]).toBeUndefined();
    expect(released.dugoutInclusions).toEqual([]);
    expect(moved.placements[SMALL.SD]).toBeUndefined();
    expect(moved.dugoutInclusions).toEqual([m3]);
  });

  it('stale approvals are dropped and others kept', () => {
    const { ward, board: fixture } = fixtureSetup();
    const cy = memberNamed(ward, 'Cy Mockup');
    const bea = memberNamed(ward, 'Bea Placeholder');
    const cyPosition = positionNamed(fixture, ...PRIMARY_TEACHERS, 1);
    const beaPosition = positionNamed(fixture, ...PRIMARY_TEACHERS, 0);
    const board = rebuild(fixture, ward, { approvals: [approval(bea, beaPosition), approval(cy, cyPosition)] });

    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: cy, positionId: cyPosition }));
    const moved = expectOk(moveToDugout(board, contextFor(ward), { memberId: cy, from: cyPosition }));

    expect(released.approvals).toEqual([approval(bea, beaPosition)]);
    expect(moved.approvals).toEqual([approval(bea, beaPosition)]);
  });

  it('operations refuse non-proposal boards', () => {
    const { ward, current, baseline } = fixtureSetup();
    const dora = memberNamed(ward, 'Dora Placeholder');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const clerk = positionNamed(current, ...WARD_CLERK);

    const codes = [current, baseline].flatMap((board) => [
      expectError(releaseCalling(board, contextFor(ward), { memberId: dora, positionId: clerk })).code,
      expectError(moveToDugout(board, contextFor(ward), { memberId: dora, from: clerk })).code,
      expectError(addToDugout(board, contextFor(ward), { memberId: ivy })).code,
    ]);

    expect(codes).toEqual(Array<string>(6).fill('board_not_editable'));
  });

  it('unknown ids are refused', () => {
    const { ward, board } = fixtureSetup();
    const dora = memberNamed(ward, 'Dora Placeholder');
    const ghost = memberId('m-ghost');
    const clerk = positionNamed(board, ...WARD_CLERK);
    const missing = positionId('p-missing');
    const ctx = contextFor(ward);

    const errors = [
      releaseCalling(board, ctx, { memberId: ghost, positionId: clerk }),
      releaseCalling(board, ctx, { memberId: dora, positionId: missing }),
      moveToDugout(board, ctx, { memberId: ghost, from: clerk }),
      moveToDugout(board, ctx, { memberId: dora, from: missing }),
      addToDugout(board, ctx, { memberId: ghost }),
    ].map((result) => expectError(result).code);

    expect(errors).toEqual(Array<string>(5).fill('not_found'));
  });

  it('version, id and kind are unchanged', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const m1 = memberId('m-1');
    const m2 = memberId('m-2');
    const m3 = memberId('m-3');

    const results = [
      expectOk(releaseCalling(board, contextFor(ward), { memberId: m1, positionId: SMALL.S2 })),
      expectOk(moveToDugout(board, contextFor(ward), { memberId: m2, from: SMALL.L1c })),
      expectOk(addToDugout(board, contextFor(ward), { memberId: m3 })),
    ];

    for (const next of results) {
      expect({ id: next.id, kind: next.kind, version: next.version }).toEqual({ id: 'b-small', kind: 'proposal', version: 7 });
    }
  });

  it('results are frozen and inputs untouched', () => {
    const { ward, board } = fixtureSetup();
    const snapshot = structuredClone(board);
    const dora = memberNamed(ward, 'Dora Placeholder');
    const jo = memberNamed(ward, 'Jo Testwell');
    const gus = memberNamed(ward, 'Gus Demo');
    const clerk = positionNamed(board, ...WARD_CLERK);
    const nursery = positionNamed(board, ...NURSERY, 0);

    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: dora, positionId: clerk }));
    const moved = expectOk(moveToDugout(board, contextFor(ward), { memberId: jo, from: nursery }));
    const added = expectOk(addToDugout(board, contextFor(ward), { memberId: gus }));
    const refused = expectError(releaseCalling(board, contextFor(ward), { memberId: gus, positionId: clerk }));

    expect(refused.code).toBe('not_placed');
    expect(board).toEqual(snapshot);
    expect([released, moved, added].every(isDeeplyFrozen)).toBe(true);
  });
});
