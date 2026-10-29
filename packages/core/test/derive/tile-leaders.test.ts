import { describe, expect, it } from 'vitest';
import { buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  assignmentId,
  boardGroupId,
  callingGroupId,
  lineageId,
  positionId,
  releaseCalling,
  wardOverview,
  type AssignmentId,
  type Board,
  type BoardGroup,
  type BoardGroupId,
  type BoardGroupKey,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type LeadershipRole,
  type OverviewLeader,
  type Position,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import { assignmentNamed, contextFor, expectOk, fixtureSetup, rebuild } from '../ops/helpers.ts';

const LEADER_KEYS = [
  'bishopric',
  'elders_quorum',
  'relief_society',
  'young_women',
  'primary',
  'sunday_school',
] as const satisfies readonly BoardGroupKey[];

const PRESIDENCY_TITLES = ['President', 'First Counselor', 'Second Counselor'] as const;

interface SeatSpec {
  readonly suffix: string;
  readonly title: string;
  readonly order: number;
  readonly leadershipRole: LeadershipRole | null;
  readonly prominent: boolean;
}

function boardGroupByKey(board: Board, key: BoardGroupKey): BoardGroup {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no board group with key ${key}`);
  }
  return found;
}

function leadersOf(board: Board, key: BoardGroupKey): readonly OverviewLeader[] {
  const group = boardGroupByKey(board, key);
  const tile = wardOverview(board, null).find((item) => item.boardGroupId === group.id);
  if (tile === undefined) {
    throw new Error(`no tile for ${key}`);
  }
  return tile.leaders;
}

function titlesOf(board: Board, key: BoardGroupKey): string[] {
  return leadersOf(board, key).map((leader) => leader.title);
}

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no calling group ${name}`);
  }
  return found;
}

function threeSeats(titlePrefix: string, prominent: boolean): readonly SeatSpec[] {
  return [
    { suffix: 'pres', title: `${titlePrefix}President`, order: 0, leadershipRole: 'president', prominent },
    { suffix: 'first', title: `${titlePrefix}First Counselor`, order: 1, leadershipRole: 'counselor', prominent },
    { suffix: 'second', title: `${titlePrefix}Second Counselor`, order: 2, leadershipRole: 'counselor', prominent },
  ];
}

function withSeats(
  board: Board,
  ward: Ward,
  groupId: CallingGroupId,
  idPrefix: string,
  seats: readonly SeatSpec[],
): Board {
  const assignments: Record<AssignmentId, CallingAssignment> = { ...board.assignments };
  const positions: Record<PositionId, Position> = { ...board.positions };
  for (const seat of seats) {
    const id = assignmentId(`${idPrefix}-${seat.suffix}`);
    const placed = positionId(`${idPrefix}-${seat.suffix}-pos`);
    assignments[id] = {
      id,
      groupId,
      title: seat.title,
      type: 'single',
      order: seat.order,
      enabled: true,
      prominent: seat.prominent,
      origin: 'standard',
      leadershipRole: seat.leadershipRole,
      callingTagIds: [],
      preferredMemberTagIds: [],
    };
    positions[placed] = {
      id: placed,
      assignmentId: id,
      lineageId: lineageId(`${idPrefix}-${seat.suffix}-ln`),
      order: 0,
    };
  }
  return rebuild(board, ward, { assignments, positions });
}

function withPresidency(
  board: Board,
  ward: Ward,
  spec: {
    readonly id: string;
    readonly name: string;
    readonly order: number;
    readonly parentId: BoardGroupId;
    readonly seats: readonly SeatSpec[];
  },
): Board {
  const groupId = callingGroupId(spec.id);
  const group: CallingGroup = {
    id: groupId,
    name: spec.name,
    order: spec.order,
    parent: { kind: 'boardGroup', id: spec.parentId },
    kind: 'presidency',
    key: null,
  };
  const withGroup = rebuild(board, ward, {
    callingGroups: { ...board.callingGroups, [groupId]: group },
  });
  return withSeats(withGroup, ward, groupId, spec.id, spec.seats);
}

function kept<Id extends string, Value>(
  record: Readonly<Record<Id, Value>>,
  drop: ReadonlySet<string>,
): Record<Id, Value> {
  const next = {} as Record<Id, Value>;
  for (const [key, value] of Object.entries(record) as [Id, Value][]) {
    if (!drop.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function withoutCallingGroup(board: Board, ward: Ward, name: string): Board {
  const group = callingGroupNamed(board, name);
  const dropAssignments = new Set<string>(
    Object.values(board.assignments)
      .filter((assignment) => assignment.groupId === group.id)
      .map((assignment) => assignment.id),
  );
  const dropPositions = new Set<string>(
    Object.values(board.positions)
      .filter((position) => dropAssignments.has(position.assignmentId))
      .map((position) => position.id),
  );
  return rebuild(board, ward, {
    callingGroups: kept(board.callingGroups, new Set([group.id])),
    assignments: kept(board.assignments, dropAssignments),
    positions: kept(board.positions, dropPositions),
    placements: kept(board.placements, dropPositions),
  });
}

describe('tile leaders', () => {
  it('the six presidency tiles show president and two counselors', () => {
    const { ward, current } = buildFixtureWard();
    // The fixture Sunday School presidency has no second counselor seat.
    const sundaySchool = callingGroupNamed(current, 'Sunday School Presidency');
    const board = withSeats(current, ward, sundaySchool.id, 't110-ss', [
      {
        suffix: 'second',
        title: 'Second Counselor',
        order: 3,
        leadershipRole: 'counselor',
        prominent: false,
      },
    ]);
    const expected: Record<(typeof LEADER_KEYS)[number], readonly string[]> = {
      bishopric: ['Bishop', 'First Counselor', 'Second Counselor'],
      elders_quorum: [...PRESIDENCY_TITLES],
      relief_society: [...PRESIDENCY_TITLES],
      young_women: [...PRESIDENCY_TITLES],
      primary: [...PRESIDENCY_TITLES],
      sunday_school: [...PRESIDENCY_TITLES],
    };
    for (const key of LEADER_KEYS) {
      expect(titlesOf(board, key)).toEqual(expected[key]);
    }
  });

  it('the Aaronic tile has no leaders', () => {
    const { ward, current } = buildFixtureWard();
    expect(assignmentNamed(current, 'Teachers Quorum', 'Teachers Quorum President').leadershipRole).toBe('president');
    expect(assignmentNamed(current, 'Deacons Quorum', 'Deacons Quorum President').leadershipRole).toBe('president');
    expect(titlesOf(current, 'aaronic_priesthood')).toEqual([]);

    // A presidency on this tile still does not show: the key filter is what excludes it.
    const aaronic = boardGroupByKey(current, 'aaronic_priesthood');
    const withPresidencyGroup = withPresidency(current, ward, {
      id: 'cg-t110-aaronic',
      name: `${aaronic.name} Presidency`,
      order: 0,
      parentId: aaronic.id,
      seats: threeSeats('Aaronic ', true),
    });
    expect(titlesOf(withPresidencyGroup, 'aaronic_priesthood')).toEqual([]);
  });

  it('ward-wide and custom tiles have no leaders', () => {
    const { ward, current } = buildFixtureWard();
    expect(assignmentNamed(current, 'Music', 'Music Coordinator').prominent).toBe(true);
    expect(titlesOf(current, 'ward_wide')).toEqual([]);

    const wardWide = boardGroupByKey(current, 'ward_wide');
    const withWardWidePresidency = withPresidency(current, ward, {
      id: 'cg-t110-ward-wide',
      name: `${wardWide.name} Presidency`,
      order: 0,
      parentId: wardWide.id,
      seats: threeSeats('Ward ', true),
    });
    expect(titlesOf(withWardWidePresidency, 'ward_wide')).toEqual([]);

    const customId = boardGroupId('bg-t110-custom');
    const withCustomGroup = rebuild(current, ward, {
      boardGroups: {
        ...current.boardGroups,
        [customId]: { id: customId, name: 'Activities', order: 40, visible: true, key: null },
      },
    });
    const withCustomPresidency = withPresidency(withCustomGroup, ward, {
      id: 'cg-t110-activities',
      name: 'Activities Presidency',
      order: 0,
      parentId: customId,
      seats: threeSeats('Activities ', true),
    });
    const custom = wardOverview(withCustomPresidency, null).find((tile) => tile.boardGroupId === customId);
    expect(custom).toBeDefined();
    expect(custom?.leaders).toEqual([]);
  });

  it('class presidencies are never leaders', () => {
    const { ward, current } = buildFixtureWard();
    const youngWomen = boardGroupByKey(current, 'young_women');
    const board = withPresidency(current, ward, {
      id: 'cg-t110-yw-class',
      name: 'Young Women Class Presidency',
      order: 5,
      parentId: youngWomen.id,
      seats: threeSeats('Class ', true),
    });
    expect(titlesOf(board, 'young_women')).toEqual([...PRESIDENCY_TITLES]);
  });

  it('the presidency is found by name before order', () => {
    const { ward, current } = buildFixtureWard();
    const youngWomen = boardGroupByKey(current, 'young_women');
    const main = callingGroupNamed(current, 'Young Women Presidency');
    const reordered = rebuild(current, ward, {
      callingGroups: {
        ...current.callingGroups,
        [main.id]: { ...main, name: '  young women presidency  ', order: 9 },
      },
    });
    const board = withPresidency(reordered, ward, {
      id: 'cg-t110-yw-class-first',
      name: 'Young Women Class Presidency',
      order: 0,
      parentId: youngWomen.id,
      seats: threeSeats('Class ', true),
    });
    expect(titlesOf(board, 'young_women')).toEqual([...PRESIDENCY_TITLES]);
  });

  it('a vacant counselor still gets a circle', () => {
    const { ward, board } = fixtureSetup();
    const counselor = assignmentNamed(board, 'Relief Society Presidency', 'Second Counselor');
    const unprominent = rebuild(board, ward, {
      assignments: {
        ...board.assignments,
        [counselor.id]: { ...counselor, prominent: false },
      },
    });
    const before = leadersOf(unprominent, 'relief_society');
    expect(before.map((leader) => leader.title)).toEqual([...PRESIDENCY_TITLES]);
    const seat = before.find((leader) => leader.positionId === positionIdFor(unprominent, counselor.id));
    if (seat === undefined || seat.memberId === null) {
      throw new Error('expected an occupied second counselor');
    }
    const released = expectOk(
      releaseCalling(unprominent, contextFor(ward), { memberId: seat.memberId, positionId: seat.positionId }),
    );
    const after = leadersOf(released, 'relief_society');
    expect(after.map((leader) => leader.title)).toEqual([...PRESIDENCY_TITLES]);
    expect(after.find((leader) => leader.positionId === seat.positionId)?.memberId).toBeNull();
    expect(after.filter((leader) => leader.memberId === null)).toHaveLength(1);
  });

  it('no presidency group means no leaders', () => {
    const { ward, current } = buildFixtureWard();
    const instructors = callingGroupNamed(current, 'Elders Quorum Instructors');
    const withGreeter = withSeats(current, ward, instructors.id, 't110-greeter', [
      { suffix: 'seat', title: 'Greeter', order: 0, leadershipRole: null, prominent: true },
    ]);
    const stripped = withoutCallingGroup(withGreeter, ward, 'Elders Quorum Presidency');
    expect(titlesOf(stripped, 'elders_quorum')).toEqual([]);
  });

  it('prominent no longer matters', () => {
    const { ward, current } = buildFixtureWard();
    const before = wardOverview(current, null);
    const quorumPresident = assignmentNamed(current, 'Teachers Quorum', 'Teachers Quorum President');
    const counselor = assignmentNamed(current, 'Primary Presidency', 'First Counselor');
    expect(quorumPresident.prominent).toBe(true);
    expect(counselor.prominent).toBe(true);
    const flipped = rebuild(current, ward, {
      assignments: {
        ...current.assignments,
        [quorumPresident.id]: { ...quorumPresident, prominent: false },
        [counselor.id]: { ...counselor, prominent: false },
      },
    });
    expect(wardOverview(flipped, null)).toEqual(before);
  });
});

function positionIdFor(board: Board, assignment: AssignmentId): PositionId {
  const found = Object.values(board.positions).find((position) => position.assignmentId === assignment);
  if (found === undefined) {
    throw new Error(`no position for ${assignment}`);
  }
  return found.id;
}
