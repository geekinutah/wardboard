import { expect } from 'vitest';
import {
  assignmentId,
  boardId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  sequentialIds,
  type AssignmentId,
  type Board,
  type BoardInput,
  type CallingAssignment,
  type MemberId,
  type OperationContext,
  type OperationError,
  type OperationResult,
  type Position,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import { assignment, BG1, callingGroup, CG1, member } from '../model/helpers.ts';

/** Fresh ids for operations; deterministic per call. */
export function contextFor(ward: Ward, prefix = 'gen'): OperationContext {
  return { ward, ids: sequentialIds(prefix) };
}

export interface FixtureSetup {
  readonly ward: Ward;
  readonly current: Board;
  readonly baseline: Board;
  /** The Draft proposal's editable board. */
  readonly board: Board;
}

export function fixtureSetup(): FixtureSetup {
  const { ward, current } = buildFixtureWard();
  const proposal = buildFixtureProposal(current, ward);
  return { ward, current, baseline: proposal.baseline, board: proposal.board };
}

/** Rebuilds `board` with `changes` applied, through `createBoard` (so it is valid and frozen). */
export function rebuild(board: Board, ward: Ward, changes: Partial<BoardInput>): Board {
  const result = createBoard({ ...board, ...changes }, ward);
  if (!result.ok) {
    throw new Error(`test board invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((m) => m.name === name);
  if (found === undefined) {
    throw new Error(`no fixture member named ${name}`);
  }
  return found.id;
}

/** The assignment titled `title` inside the calling group named `groupName`. */
export function assignmentNamed(board: Board, groupName: string, title: string): CallingAssignment {
  const group = Object.values(board.callingGroups).find((g) => g.name === groupName);
  const found = Object.values(board.assignments).find((a) => a.groupId === group?.id && a.title === title);
  if (found === undefined) {
    throw new Error(`no assignment ${groupName} / ${title}`);
  }
  return found;
}

/** Positions of an assignment, by `order` then id. */
export function positionsOf(board: Board, id: AssignmentId): Position[] {
  return Object.values(board.positions)
    .filter((p) => p.assignmentId === id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The position id at `index` (by order) of the named assignment. */
export function positionNamed(board: Board, groupName: string, title: string, index = 0): PositionId {
  const found = positionsOf(board, assignmentNamed(board, groupName, title).id)[index];
  if (found === undefined) {
    throw new Error(`no position ${String(index)} in ${groupName} / ${title}`);
  }
  return found.id;
}

/** Positions occupied by `member`, sorted by id. */
export function holdingsOf(board: Board, id: MemberId): PositionId[] {
  return Object.entries(board.placements)
    .filter(([, occupant]) => occupant === id)
    .map(([position]) => positionId(position))
    .sort();
}

export function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`expected the operation to succeed: ${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

export function expectError(result: OperationResult): OperationError {
  if (result.ok) {
    throw new Error('expected the operation to fail, but it succeeded');
  }
  expect(result.error.message).not.toBe('');
  return result.error;
}

export function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

// ---------------------------------------------------------------------------
// A small hand-built proposal board
// ---------------------------------------------------------------------------

export const SMALL = {
  /** Enabled singles; S1 and S2 occupied by m-1, S3 vacant. */
  S1: positionId('p-s1'),
  S2: positionId('p-s2'),
  S3: positionId('p-s3'),
  /** Disabled single (vacant). */
  SD: positionId('p-sd'),
  /** List L1: positions out of id order. c (order 0) m-2; b (order 1) vacant; d (order 2) m-1; a (order 3) vacant. */
  L1: assignmentId('a-l1'),
  L1a: positionId('p-l1-a'),
  L1b: positionId('p-l1-b'),
  L1c: positionId('p-l1-c'),
  L1d: positionId('p-l1-d'),
  /** List with zero positions. */
  L0: assignmentId('a-l0'),
  /** Disabled list with one vacancy. */
  LD: assignmentId('a-ld'),
  LDp: positionId('p-ld'),
  /** Single assignments, for wrong-type checks. */
  AS3: assignmentId('a-s3'),
} as const;

/** Members m-1 .. m-4; m-4 is removed from Current. */
export function smallWard(): Ward {
  const result = createWard({
    members: Object.fromEntries(
      [member('m-1'), member('m-2'), member('m-3'), member('m-4', { removedDate: '2026-01-02' })].map((m) => [m.id, m]),
    ),
    tags: {},
  });
  if (!result.ok) {
    throw new Error(`small ward invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function pos(id: PositionId, assignment: string, order: number): Position {
  return { id, assignmentId: assignmentId(assignment), lineageId: lineageId(`ln-${id}`), order };
}

/**
 * m-1 holds three callings: S1, L1 (position d) and S2, in board order.
 * m-2 holds L1 position c. m-3 and m-4 hold nothing.
 */
export function smallBoard(ward: Ward, changes: Partial<BoardInput> = {}): Board {
  const assignments = [
    assignment('a-s1', { order: 0 }),
    assignment('a-l1', { order: 1, type: 'list' }),
    assignment('a-s2', { order: 2 }),
    assignment('a-s3', { order: 3 }),
    assignment('a-sd', { order: 4, enabled: false }),
    assignment('a-l0', { order: 5, type: 'list' }),
    assignment('a-ld', { order: 6, type: 'list', enabled: false }),
  ];
  const positions = [
    pos(SMALL.S1, 'a-s1', 0),
    pos(SMALL.L1a, 'a-l1', 3),
    pos(SMALL.L1b, 'a-l1', 1),
    pos(SMALL.L1c, 'a-l1', 0),
    pos(SMALL.L1d, 'a-l1', 2),
    pos(SMALL.S2, 'a-s2', 0),
    pos(SMALL.S3, 'a-s3', 0),
    pos(SMALL.SD, 'a-sd', 0),
    pos(SMALL.LDp, 'a-ld', 0),
  ];
  const input: BoardInput = {
    id: boardId('b-small'),
    kind: 'proposal',
    version: 7,
    boardGroups: { [BG1]: { id: BG1, name: 'Group', order: 0, visible: true, key: null } },
    callingGroups: { [CG1]: callingGroup('cg-1') },
    assignments: Object.fromEntries(assignments.map((a) => [a.id, a])),
    positions: Object.fromEntries(positions.map((p) => [p.id, p])),
    placements: {
      [SMALL.S1]: memberId('m-1'),
      [SMALL.L1d]: memberId('m-1'),
      [SMALL.S2]: memberId('m-1'),
      [SMALL.L1c]: memberId('m-2'),
    },
    oversight: [],
    dugoutInclusions: [],
    approvals: [],
    ...changes,
  };
  const result = createBoard(input, ward);
  if (!result.ok) {
    throw new Error(`small board invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}
