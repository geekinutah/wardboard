import { describe, expect, it } from 'vitest';
import {
  boardGroupId,
  callingGroupId,
  clearOversight,
  diffBoards,
  OVERSIGHT_ERROR_CODES,
  setOversight,
  userId,
  type Board,
  type BoardGroup,
  type CallingGroup,
  type OperationResult,
  type OversightTarget,
} from '../../src/index.ts';
import { contextFor, expectOk, fixtureSetup, isDeeplyFrozen, positionNamed, rebuild } from './helpers.ts';

function callingGroupByKey(board: Board, key: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no calling group ${key}`);
  }
  return found;
}

function boardGroupByKey(board: Board, key: string): BoardGroup {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no board group ${key}`);
  }
  return found;
}

function boardTarget(board: Board, key: string): OversightTarget {
  return { kind: 'boardGroup', id: boardGroupByKey(board, key).id };
}

function callingTarget(board: Board, key: string): OversightTarget {
  return { kind: 'callingGroup', id: callingGroupByKey(board, key).id };
}

describe('oversight error codes', () => {
  it('operation-specific error codes are exported', () => {
    expect(OVERSIGHT_ERROR_CODES).toEqual(['fixed_oversight']);
  });
});

describe('setOversight and clearOversight', () => {
  it('setOversight replaces the existing overseer of a target', () => {
    const { ward, board } = fixtureSetup();
    const target = boardTarget(board, 'primary');
    const index = board.oversight.findIndex((entry) => entry.target.kind === target.kind && entry.target.id === target.id);
    expect(board.oversight[index]?.overseer).toBe('second_counselor');

    const next = expectOk(setOversight(board, contextFor(ward), { target, overseer: 'first_counselor' }));

    expect(next.oversight).toHaveLength(board.oversight.length);
    expect(next.oversight[index]).toEqual({ overseer: 'first_counselor', target, fixed: false });
    expect(next.oversight.filter((entry) => entry.target.kind === target.kind && entry.target.id === target.id)).toEqual([
      { overseer: 'first_counselor', target, fixed: false },
    ]);
    const unchanged = next.oversight.filter((_, entryIndex) => entryIndex !== index);
    const original = board.oversight.filter((_, entryIndex) => entryIndex !== index);
    expect(unchanged).toEqual(original);
    expect(isDeeplyFrozen(next)).toBe(true);

    const again = expectOk(setOversight(next, contextFor(ward), { target, overseer: 'first_counselor' }));
    expect(again).toEqual(next);
  });

  it('setOversight adds an entry for an unassigned target', () => {
    const { ward, board } = fixtureSetup();
    const target = boardTarget(board, 'relief_society');
    expect(board.oversight.some((entry) => entry.target.kind === target.kind && entry.target.id === target.id)).toBe(false);

    const next = expectOk(setOversight(board, contextFor(ward), { target, overseer: 'first_counselor' }));

    expect(next.oversight).toHaveLength(board.oversight.length + 1);
    expect(next.oversight.slice(0, -1)).toEqual([...board.oversight]);
    expect(next.oversight.at(-1)).toEqual({ overseer: 'first_counselor', target, fixed: false });
  });

  it('clearOversight removes the entry', () => {
    const { ward, board } = fixtureSetup();
    const target = boardTarget(board, 'primary');
    expect(board.oversight.some((entry) => entry.target.kind === target.kind && entry.target.id === target.id)).toBe(true);

    const next = expectOk(clearOversight(board, contextFor(ward), { target }));

    expect(next.oversight.some((entry) => entry.target.kind === target.kind && entry.target.id === target.id)).toBe(false);
    expect(next.oversight).toHaveLength(board.oversight.length - 1);
    expect(next.oversight).toEqual(board.oversight.filter((entry) => entry.target.id !== target.id));

    const again = expectOk(clearOversight(next, contextFor(ward), { target }));
    expect(again).toEqual(next);
  });

  it('the priests quorum cannot be reassigned or cleared', () => {
    const { ward, board } = fixtureSetup();
    const target = callingTarget(board, 'priests_quorum');
    const snapshot = structuredClone(board);

    const reassigned = setOversight(board, contextFor(ward), { target, overseer: 'first_counselor' });
    const cleared = clearOversight(board, contextFor(ward), { target });

    expect(reassigned.ok).toBe(false);
    expect(cleared.ok).toBe(false);
    if (!reassigned.ok && !cleared.ok) {
      expect(reassigned.error.code).toBe('fixed_oversight');
      expect(cleared.error.code).toBe('fixed_oversight');
      expect(reassigned.error.message).not.toBe('');
      expect(cleared.error.message).not.toBe('');
    }
    expect(board).toEqual(snapshot);
  });

  it('oversight ops refuse Current and baseline boards', () => {
    const { ward, current, baseline } = fixtureSetup();
    const target = boardTarget(current, 'primary');

    for (const locked of [current, baseline]) {
      const reassigned = setOversight(locked, contextFor(ward), { target, overseer: 'bishop' });
      const cleared = clearOversight(locked, contextFor(ward), { target });
      expect(reassigned.ok).toBe(false);
      expect(cleared.ok).toBe(false);
      if (!reassigned.ok && !cleared.ok) {
        expect(reassigned.error.code).toBe('board_not_editable');
        expect(cleared.error.code).toBe('board_not_editable');
      }
    }
  });

  it('oversight ops refuse a missing target', () => {
    const { ward, board } = fixtureSetup();
    const missingGroup = { kind: 'callingGroup', id: callingGroupId('cg-missing') } as const;
    const missingBoardGroup = { kind: 'boardGroup', id: boardGroupId('bg-missing') } as const;

    const reassigned = setOversight(board, contextFor(ward), { target: missingGroup, overseer: 'bishop' });
    const cleared = clearOversight(board, contextFor(ward), { target: missingBoardGroup });

    expect(reassigned.ok).toBe(false);
    expect(cleared.ok).toBe(false);
    if (!reassigned.ok && !cleared.ok) {
      expect(reassigned.error.code).toBe('not_found');
      expect(cleared.error.code).toBe('not_found');
    }
  });

  it('setOversight refuses an unknown overseer', () => {
    const { ward, board } = fixtureSetup();
    const target = boardTarget(board, 'primary');

    const result: OperationResult = setOversight(board, contextFor(ward), {
      target,
      overseer: 'clerk' as unknown as 'bishop',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_operation');
    }
  });

  it('reassigning oversight produces no diff and leaves placements untouched', () => {
    const { ward, board: fixture } = fixtureSetup();
    const position = positionNamed(fixture, 'Primary Teachers', 'Primary Teacher', 0);
    const member = fixture.placements[position];
    if (member === undefined) {
      throw new Error('expected Primary Teacher 0 to be occupied');
    }
    const board = rebuild(fixture, ward, {
      approvals: [{ memberId: member, positionId: position, approvedBy: userId('u-admin'), approvedAt: '2026-01-05T09:00:00Z' }],
    });
    const primary = boardTarget(board, 'primary');
    const teachers = callingTarget(board, 'teachers_quorum');

    const reassigned = expectOk(setOversight(board, contextFor(ward), { target: primary, overseer: 'first_counselor' }));
    const cleared = expectOk(clearOversight(reassigned, contextFor(ward), { target: teachers }));

    expect(reassigned.oversight).not.toEqual(board.oversight);
    expect(cleared.oversight.some((entry) => entry.target.kind === teachers.kind && entry.target.id === teachers.id)).toBe(false);
    for (const next of [reassigned, cleared]) {
      expect(diffBoards(board, next)).toEqual({ callings: [], releases: [], addedPositions: [], removedPositions: [] });
      expect(next.placements).toEqual(board.placements);
      expect(next.dugoutInclusions).toEqual(board.dugoutInclusions);
      expect(next.approvals).toEqual(board.approvals);
      expect(next.id).toBe(board.id);
      expect(next.kind).toBe(board.kind);
      expect(next.version).toBe(board.version);
    }
  });
});
