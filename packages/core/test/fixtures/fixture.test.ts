import { describe, expect, it } from 'vitest';
import {
  BOARD_GROUP_KEYS,
  createBoard,
  createWard,
  proposalId,
  type Board,
  type MemberId,
  type PositionId,
} from '../../src/index.ts';
import { buildFixtureProposal, buildFixtureWard, FIXTURE_MEMBER_NAMES } from '../../src/fixtures/index.ts';

function callingCounts(board: Board): Map<MemberId, number> {
  const counts = new Map<MemberId, number>();
  for (const memberId of Object.values(board.placements)) {
    counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  }
  return counts;
}

function positionsOf(board: Board, assignment: string): PositionId[] {
  return Object.values(board.positions)
    .filter((p) => p.assignmentId === assignment)
    .map((p) => p.id);
}

describe('fixture ward', () => {
  it('fixture ward is deterministic', () => {
    expect(buildFixtureWard()).toEqual(buildFixtureWard());
  });

  it('fixture ward validates', () => {
    const { ward, current } = buildFixtureWard();

    const wardResult = createWard(ward);
    const boardResult = createBoard(current, ward);

    expect(wardResult).toEqual({ ok: true, value: ward });
    expect(boardResult).toEqual({ ok: true, value: current });
    expect(current.kind).toBe('current');
    expect(Object.isFrozen(current.placements)).toBe(true);
  });

  it('fixture covers the required scenarios', () => {
    const { ward, current } = buildFixtureWard();
    const members = Object.values(ward.members);
    const counts = callingCounts(current);
    const assignments = Object.values(current.assignments);
    const groups = Object.values(current.callingGroups);

    expect(members.length).toBeGreaterThanOrEqual(35);
    expect(members.length).toBeLessThanOrEqual(50);
    expect(members.some((m) => m.needsApproval)).toBe(true);
    expect([...counts.values()].some((n) => n === 2)).toBe(true);
    expect(members.filter((m) => !counts.has(m.id)).length).toBeGreaterThanOrEqual(3);
    expect(members.some((m) => m.category === 'adult')).toBe(true);
    expect(members.some((m) => m.category === 'youth')).toBe(true);
    expect(members.every((m) => m.removedDate === null)).toBe(true);
    expect(members.some((m) => m.tagIds.length > 0)).toBe(true);

    const listWithVacancy = assignments.some((a) => {
      const positions = positionsOf(current, a.id);
      const filled = positions.filter((p) => current.placements[p] !== undefined).length;
      return a.type === 'list' && filled > 0 && filled < positions.length;
    });
    expect(listWithVacancy).toBe(true);
    const vacantSingle = assignments.some(
      (a) => a.type === 'single' && positionsOf(current, a.id).every((p) => current.placements[p] === undefined),
    );
    expect(vacantSingle).toBe(true);
    expect(assignments.some((a) => a.origin === 'custom')).toBe(true);

    expect(Object.values(current.boardGroups).map((g) => g.key).sort()).toEqual([...BOARD_GROUP_KEYS].sort());
    const groupKeys = groups.map((g) => g.key);
    expect(groupKeys).toContain('priests_quorum');
    expect(groupKeys).toContain('elders_quorum_presidency');

    const priests = groups.find((g) => g.key === 'priests_quorum');
    expect(current.oversight.filter((o) => o.fixed)).toEqual([
      { overseer: 'bishop', target: { kind: 'callingGroup', id: priests?.id }, fixed: true },
    ]);

    const memberTags = new Set(members.flatMap((m) => m.tagIds));
    expect(assignments.some((a) => a.preferredMemberTagIds.some((t) => memberTags.has(t)))).toBe(true);
    expect(assignments.some((a) => a.callingTagIds.length > 0)).toBe(true);
  });

  it('fixture seeds the bishopric and the proposed default oversight', () => {
    const { current } = buildFixtureWard();
    const groupByKey = (key: string) => Object.values(current.callingGroups).find((g) => g.key === key)?.id;
    const boardGroupByKey = (key: string) => Object.values(current.boardGroups).find((g) => g.key === key)?.id;
    const bishopric = groupByKey('bishopric');
    const leaders = Object.values(current.assignments)
      .filter((a) => a.groupId === bishopric)
      .map((a) => [a.title, a.type, a.leadershipRole]);

    expect(leaders).toEqual([
      ['Bishop', 'single', 'president'],
      ['First Counselor', 'single', 'counselor'],
      ['Second Counselor', 'single', 'counselor'],
    ]);
    expect(Object.values(current.assignments).map((a) => a.title)).toEqual(
      expect.arrayContaining(['Ward Clerk', 'Executive Secretary']),
    );
    expect(current.oversight).toEqual(
      expect.arrayContaining([
        { overseer: 'first_counselor', target: { kind: 'callingGroup', id: groupByKey('teachers_quorum') }, fixed: false },
        { overseer: 'first_counselor', target: { kind: 'boardGroup', id: boardGroupByKey('sunday_school') }, fixed: false },
        { overseer: 'second_counselor', target: { kind: 'callingGroup', id: groupByKey('deacons_quorum') }, fixed: false },
        { overseer: 'second_counselor', target: { kind: 'boardGroup', id: boardGroupByKey('primary') }, fixed: false },
      ]),
    );
    expect(current.oversight).toHaveLength(5);
  });

  it('fixture has a Relief Society teachers list of four with three filled', () => {
    const { current } = buildFixtureWard();
    const teachers = Object.values(current.assignments).find((a) => a.title === 'Relief Society Teacher');
    const positions = positionsOf(current, teachers?.id ?? '');

    expect(teachers?.type).toBe('list');
    expect(positions).toHaveLength(4);
    expect(positions.filter((p) => current.placements[p] !== undefined)).toHaveLength(3);
  });

  it('fixture names are fictional', () => {
    const { ward } = buildFixtureWard();
    const names = Object.values(ward.members).map((m) => m.name);

    expect(FIXTURE_MEMBER_NAMES.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(FIXTURE_MEMBER_NAMES).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('fixture proposal', () => {
  it('fixture proposal is an independent copy', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);

    expect(proposal.status).toBe('draft');
    expect(proposal.accepted).toBeNull();
    expect(proposal.baseline.kind).toBe('baseline');
    expect(proposal.board.kind).toBe('proposal');
    expect(new Set([proposal.baseline.id, proposal.board.id, current.id]).size).toBe(3);
    expect({ ...proposal.baseline, id: current.id, kind: current.kind }).toEqual(current);
    expect({ ...proposal.board, id: current.id, kind: current.kind }).toEqual(current);
    expect(proposal.board.placements).not.toBe(current.placements);
    expect(proposal.baseline.placements).not.toBe(proposal.board.placements);

    const positionId = Object.keys(proposal.board.placements)[0] as PositionId;
    const original = current.placements[positionId];
    expect(() => {
      (proposal.board.placements as Record<string, string>)[positionId] = 'm-other';
    }).toThrow(TypeError);
    expect(current.placements[positionId]).toBe(original);
  });

  it('fixture proposal is deterministic and accepts overrides', () => {
    const { ward, current } = buildFixtureWard();

    expect(buildFixtureProposal(current, ward)).toEqual(buildFixtureProposal(current, ward));

    const second = buildFixtureProposal(current, ward, { id: proposalId('pr-0002'), name: 'Option B', tabOrder: 1 });
    const first = buildFixtureProposal(current, ward);
    expect(second.name).toBe('Option B');
    expect(second.tabOrder).toBe(1);
    expect(second.board.id).not.toBe(first.board.id);
    expect(second.baseline.id).not.toBe(first.baseline.id);
  });
});
