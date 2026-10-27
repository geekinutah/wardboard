import { describe, expect, it } from 'vitest';
import {
  OCCUPIED_ERROR_CODES,
  memberId,
  occupiedDropOptions,
  positionId,
  releaseOccupant,
  swap,
  userId,
  type Approval,
  type Board,
  type BoardInput,
  type MemberId,
  type OperationError,
  type OperationResult,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import {
  contextFor,
  expectError,
  expectOk,
  fixtureSetup,
  holdingsOf,
  isDeeplyFrozen,
  positionNamed,
  positionsOf,
  rebuild,
  SMALL,
  smallBoard,
  smallWard,
} from './helpers.ts';

/**
 * smallBoard assignments have no leadership role. These tests must stay valid
 * once T-013 applies the presidency release rule to these operations.
 */

const APPROVED_AT = '2026-01-05T09:00:00Z';
const m1 = memberId('m-1');
const m2 = memberId('m-2');
const m3 = memberId('m-3');
const m4 = memberId('m-4');

function approval(member: MemberId, position: PositionId): Approval {
  return { memberId: member, positionId: position, approvedBy: userId('u-admin'), approvedAt: APPROVED_AT };
}

function proposal(
  placements: Board['placements'],
  extra: Partial<BoardInput> = {},
): { readonly ward: Ward; readonly board: Board } {
  const ward = smallWard();
  return { ward, board: smallBoard(ward, { ...extra, placements }) };
}

/** Runs a refusing attempt and proves the input board was not mutated. */
function refusal(board: Board, attempt: () => OperationResult): OperationError {
  const snapshot = structuredClone(board);
  const error = expectError(attempt());
  expect(board).toEqual(snapshot);
  return error;
}

describe('occupied error codes', () => {
  it('exports occupied error codes', () => {
    expect(OCCUPIED_ERROR_CODES).toEqual(['position_vacant', 'not_placed', 'assignment_disabled', 'already_in_list']);
  });
});

describe('swap', () => {
  it('swap exchanges two single placements', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m2 });

    const next = expectOk(swap(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(next).toEqual({ ...board, placements: { [SMALL.S1]: m2, [SMALL.S3]: m1 } });
  });

  it('swap from a list puts the displaced occupant in the same list position', () => {
    const { ward, board } = proposal({ [SMALL.L1c]: m2, [SMALL.S1]: m3 });

    const next = expectOk(swap(board, contextFor(ward), { memberId: m2, from: SMALL.L1c, to: SMALL.S1 }));

    expect(next.placements).toEqual({ [SMALL.L1c]: m3, [SMALL.S1]: m2 });
    expect(positionsOf(next, SMALL.L1)).toEqual(positionsOf(board, SMALL.L1));
    expect(next).toEqual({ ...board, placements: { [SMALL.L1c]: m3, [SMALL.S1]: m2 } });
  });

  it('swap refuses to duplicate a list member', () => {
    // m-2 holds L1c; m-1 holds S1 and another position in that same list (L1d).
    const ward = smallWard();
    const board = smallBoard(ward);

    const error = refusal(board, () => swap(board, contextFor(ward), { memberId: m2, from: SMALL.L1c, to: SMALL.S1 }));

    expect(error.code).toBe('already_in_list');
  });

  it('swap keeps every other calling', () => {
    const { ward, board } = proposal({
      [SMALL.S1]: m1,
      [SMALL.S2]: m1,
      [SMALL.S3]: m2,
      [SMALL.L1c]: m2,
    });

    const next = expectOk(swap(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(holdingsOf(next, m1)).toEqual([SMALL.S2, SMALL.S3].sort());
    expect(holdingsOf(next, m2)).toEqual([SMALL.L1c, SMALL.S1].sort());
    expect(next.positions).toEqual(board.positions);
  });

  it('swap clears both explicit dugout inclusions', () => {
    const { ward, board } = proposal(
      { [SMALL.S1]: m1, [SMALL.S3]: m3 },
      { dugoutInclusions: [m1, m2, m3] },
    );

    const next = expectOk(swap(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(next.dugoutInclusions).toEqual([m2]);
    expect(next.placements).toEqual({ [SMALL.S1]: m3, [SMALL.S3]: m1 });
  });

  it('swap requires both assignments to be enabled', () => {
    const ward = smallWard();
    const disabledSource = smallBoard(ward, { placements: { [SMALL.SD]: m1, [SMALL.S3]: m3 } });
    const disabledDestination = smallBoard(ward, { placements: { [SMALL.S1]: m1, [SMALL.SD]: m3 } });
    const disabledListSource = smallBoard(ward, { placements: { [SMALL.LDp]: m2, [SMALL.S3]: m3 } });

    const source = refusal(disabledSource, () =>
      swap(disabledSource, contextFor(ward), { memberId: m1, from: SMALL.SD, to: SMALL.S3 }),
    );
    const destination = refusal(disabledDestination, () =>
      swap(disabledDestination, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.SD }),
    );
    const listSource = refusal(disabledListSource, () =>
      swap(disabledListSource, contextFor(ward), { memberId: m2, from: SMALL.LDp, to: SMALL.S3 }),
    );

    expect([source.code, destination.code, listSource.code]).toEqual([
      'assignment_disabled',
      'assignment_disabled',
      'assignment_disabled',
    ]);
  });

  it('swap between two positions of the same member is impossible', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const error = refusal(board, () => swap(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S2 }));

    expect(error.code).toBe('invalid_operation');
  });

  it("swap refuses when the displaced occupant's only other calling is in the source list", () => {
    const { ward, board } = proposal({
      [SMALL.L1c]: m2,
      [SMALL.S1]: m1,
      [SMALL.L1d]: m1,
    });
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1].sort());

    const error = refusal(board, () => swap(board, contextFor(ward), { memberId: m2, from: SMALL.L1c, to: SMALL.S1 }));

    expect(error.code).toBe('already_in_list');
  });
});

describe('releaseOccupant', () => {
  it('release occupant places the member and vacates the source', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m2 });

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(next).toEqual({ ...board, placements: { [SMALL.S3]: m1 } });
    expect(holdingsOf(next, m2)).toEqual([]);
    expect(next.positions[SMALL.S1]).toEqual(board.positions[SMALL.S1]);
  });

  it('release occupant from the dugout', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1 }, { dugoutInclusions: [m3] });

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m3, from: null, to: SMALL.S1 }));

    expect(next.placements).toEqual({ [SMALL.S1]: m3 });
    expect(holdingsOf(next, m1)).toEqual([]);
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('displaced member with no remaining calling gets no explicit inclusion', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m3 }, { dugoutInclusions: [m2] });

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(holdingsOf(next, m3)).toEqual([]);
    expect(next.dugoutInclusions).toEqual([m2]);
    expect(next.placements).toEqual({ [SMALL.S3]: m1 });
  });

  it('displaced member keeps their other callings', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m2, from: SMALL.L1c, to: SMALL.S1 }));

    expect(holdingsOf(next, m1)).toEqual([SMALL.L1d, SMALL.S2].sort());
    expect(holdingsOf(next, m2)).toEqual([SMALL.S1]);
    expect(next.placements[SMALL.L1c]).toBeUndefined();
  });

  it("release occupant leaves the displaced member's existing inclusion alone", () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m3 }, { dugoutInclusions: [m1, m3] });

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(holdingsOf(next, m3)).toEqual([]);
    expect(next.dugoutInclusions).toEqual([m3]);
    expect(next.placements[SMALL.S3]).toBe(m1);
  });

  it('release occupant may move out of a disabled assignment', () => {
    const { ward, board } = proposal({ [SMALL.SD]: m1, [SMALL.S3]: m3 });
    const source = board.positions[SMALL.SD];
    if (source === undefined) {
      throw new Error('missing disabled single');
    }
    expect(board.assignments[source.assignmentId]?.enabled).toBe(false);

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m1, from: SMALL.SD, to: SMALL.S3 }));

    expect(next).toEqual({ ...board, placements: { [SMALL.S3]: m1 } });

    const blocked = proposal({ [SMALL.S1]: m1, [SMALL.SD]: m3 });
    const ontoDisabled = refusal(blocked.board, () =>
      releaseOccupant(blocked.board, contextFor(blocked.ward), { memberId: m1, from: SMALL.S1, to: SMALL.SD }),
    );
    expect(ontoDisabled.code).toBe('assignment_disabled');
  });

  it('release occupant accepts a removed member', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1 });
    expect(ward.members[m4]?.removedDate).toBe('2026-01-02');

    const released = expectOk(releaseOccupant(board, contextFor(ward), { memberId: m4, from: null, to: SMALL.S1 }));

    expect(released.placements).toEqual({ [SMALL.S1]: m4 });
    expect(holdingsOf(released, m1)).toEqual([]);

    const swapping = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m4 });
    const swapped = expectOk(swap(swapping.board, contextFor(swapping.ward), { memberId: m4, from: SMALL.S3, to: SMALL.S1 }));

    expect(swapped.placements).toEqual({ [SMALL.S1]: m4, [SMALL.S3]: m1 });
  });
});

describe('occupied drops', () => {
  it('vacant destination is refused', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1 });

    const swapped = refusal(board, () => swap(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));
    const released = refusal(board, () =>
      releaseOccupant(board, contextFor(ward), { memberId: m1, from: SMALL.S1, to: SMALL.S3 }),
    );
    const fromDugout = refusal(board, () =>
      releaseOccupant(board, contextFor(ward), { memberId: m2, from: null, to: SMALL.S3 }),
    );

    expect([swapped.code, released.code, fromDugout.code]).toEqual(['position_vacant', 'position_vacant', 'position_vacant']);
  });

  it('list destination is refused', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const ctx = contextFor(ward);

    const codes = [SMALL.L1c, SMALL.L1b].flatMap((to) => [
      refusal(board, () => swap(board, ctx, { memberId: m1, from: SMALL.S1, to })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S2, to })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m3, from: null, to })).code,
    ]);

    expect(codes).toEqual(Array<string>(6).fill('invalid_operation'));
  });

  it('dropping onto yourself is refused', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const ctx = contextFor(ward);

    const codes = [
      refusal(board, () => swap(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S2 })).code,
      refusal(board, () => swap(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S1 })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S2 })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S1 })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m1, from: null, to: SMALL.S1 })).code,
    ];

    expect(codes).toEqual(Array<string>(5).fill('invalid_operation'));
  });

  it('from must be held by the member', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const ctx = contextFor(ward);

    const codes = [
      refusal(board, () => swap(board, ctx, { memberId: m3, from: SMALL.S1, to: SMALL.S2 })).code,
      refusal(board, () => swap(board, ctx, { memberId: m3, from: SMALL.S3, to: SMALL.S1 })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m3, from: SMALL.S1, to: SMALL.S2 })).code,
      refusal(board, () => releaseOccupant(board, ctx, { memberId: m1, from: SMALL.L1c, to: SMALL.S2 })).code,
    ];

    expect(codes).toEqual(Array<string>(4).fill('not_placed'));
  });

  it('operations refuse non-proposal boards', () => {
    // Music callings are not a presidency, so this check does not depend on counselor release.
    const { ward, current, baseline } = fixtureSetup();

    const codes = [current, baseline].flatMap((board) => {
      const from = positionNamed(board, 'Music', 'Organist');
      const to = positionNamed(board, 'Music', 'Music Coordinator');
      const member = board.placements[from];
      if (member === undefined) {
        throw new Error('fixture organist is vacant');
      }
      const ctx = contextFor(ward);
      return [
        refusal(board, () => swap(board, ctx, { memberId: member, from, to })).code,
        refusal(board, () => releaseOccupant(board, ctx, { memberId: member, from, to })).code,
      ];
    });

    expect(codes).toEqual(Array<string>(4).fill('board_not_editable'));
  });

  it('unknown ids are refused', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const ctx = contextFor(ward);
    const ghost = memberId('m-ghost');
    const missing = positionId('p-missing');
    const snapshot = structuredClone(board);

    const codes = [
      swap(board, ctx, { memberId: ghost, from: SMALL.S1, to: SMALL.S2 }),
      swap(board, ctx, { memberId: m1, from: missing, to: SMALL.S2 }),
      swap(board, ctx, { memberId: m1, from: SMALL.S1, to: missing }),
      releaseOccupant(board, ctx, { memberId: ghost, from: SMALL.S1, to: SMALL.S2 }),
      releaseOccupant(board, ctx, { memberId: ghost, from: null, to: SMALL.S1 }),
      releaseOccupant(board, ctx, { memberId: m1, from: missing, to: SMALL.S2 }),
      releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S1, to: missing }),
      releaseOccupant(board, ctx, { memberId: m3, from: null, to: missing }),
    ].map((result) => expectError(result).code);

    expect(codes).toEqual(Array<string>(8).fill('not_found'));
    expect(board).toEqual(snapshot);
  });

  it('stale approvals are dropped and others kept', () => {
    const kept = approval(m1, SMALL.S2);
    const unrelated = approval(m3, SMALL.L1c);
    const { ward, board } = proposal(
      { [SMALL.S1]: m1, [SMALL.S2]: m1, [SMALL.S3]: m2, [SMALL.L1c]: m3 },
      { approvals: [approval(m1, SMALL.S1), kept, approval(m2, SMALL.S3), unrelated] },
    );
    const ctx = contextFor(ward);

    const swapped = expectOk(swap(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));
    const released = expectOk(releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));

    expect(swapped.approvals).toEqual([kept, unrelated]);
    expect(released.approvals).toEqual([kept, unrelated]);
    expect(swapped.placements).toEqual({ [SMALL.S1]: m2, [SMALL.S2]: m1, [SMALL.S3]: m1, [SMALL.L1c]: m3 });
    expect(released.placements).toEqual({ [SMALL.S2]: m1, [SMALL.S3]: m1, [SMALL.L1c]: m3 });
  });

  it('occupiedDropOptions lists the operations that would succeed', () => {
    const ward = smallWard();
    const board = smallBoard(ward, { placements: { [SMALL.S1]: m1, [SMALL.S3]: m3 } });
    const ctx = contextFor(ward);
    const snapshot = structuredClone(board);

    expect(occupiedDropOptions(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 })).toEqual([
      'swap',
      'release_occupant',
    ]);
    expect(occupiedDropOptions(board, ctx, { memberId: m2, from: null, to: SMALL.S1 })).toEqual(['release_occupant']);

    const listed = smallBoard(ward);
    expect(occupiedDropOptions(listed, ctx, { memberId: m2, from: SMALL.L1c, to: SMALL.S1 })).toEqual(['release_occupant']);
    expect(occupiedDropOptions(listed, ctx, { memberId: m2, from: SMALL.L1c, to: SMALL.S3 })).toEqual([]);

    const current = rebuild(board, ward, { kind: 'current' });
    expect(occupiedDropOptions(current, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 })).toEqual([]);
    expect(board).toEqual(snapshot);
  });

  it('version, id and kind are unchanged', () => {
    const ward = smallWard();
    const board = smallBoard(ward, { placements: { [SMALL.S1]: m1, [SMALL.S3]: m2 } });
    const ctx = contextFor(ward);

    const results = [
      expectOk(swap(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 })),
      expectOk(releaseOccupant(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 })),
    ];

    for (const next of results) {
      expect({ id: next.id, kind: next.kind, version: next.version }).toEqual({
        id: board.id,
        kind: board.kind,
        version: board.version,
      });
    }
    expect(board.version).toBe(7);
  });

  it('results are frozen and inputs untouched', () => {
    const { ward, board } = proposal({ [SMALL.S1]: m1, [SMALL.S3]: m2, [SMALL.L1c]: m3 });
    const snapshot = structuredClone(board);
    const ctx = contextFor(ward);

    const swapped = expectOk(swap(board, ctx, { memberId: m1, from: SMALL.S1, to: SMALL.S3 }));
    const released = expectOk(releaseOccupant(board, ctx, { memberId: m3, from: SMALL.L1c, to: SMALL.S1 }));

    expect(board).toEqual(snapshot);
    expect(swapped).not.toBe(board);
    expect(released).not.toBe(board);
    expect([swapped, released].every(isDeeplyFrozen)).toBe(true);
  });
});
