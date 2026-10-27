import { describe, expect, it } from 'vitest';
import { buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  assignmentId,
  boardGroupId,
  boardId,
  callingCounts,
  callingGroupId,
  callingsOf,
  createBoard,
  createWard,
  dugout,
  memberId,
  positionId,
  rootBoardGroupOf,
  vacancies,
  vacancyCountsByBoardGroup,
  type Board,
  type BoardGroup,
  type BoardGroupId,
  type BoardGroupKey,
  type CallingGroup,
  type MemberId,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import {
  assignment,
  callingGroup,
  CG1,
  BG1,
  member,
  position,
  valueOf,
} from '../model/helpers.ts';
import { assignmentNamed, memberNamed, positionNamed, rebuild, SMALL, smallBoard, smallWard } from '../ops/helpers.ts';

/**
 * Record insertion order is the reverse of `items` when `shuffle` is set, so a
 * derive function that trusts object key order cannot pass.
 */
function recordOf<T extends { readonly id: string }>(items: readonly T[], shuffle = false): Record<string, T> {
  const ordered = shuffle ? items.slice().reverse() : items.slice();
  return Object.fromEntries(ordered.map((item) => [item.id, item]));
}

function wardWith(people: readonly ReturnType<typeof member>[] = []): Ward {
  return valueOf(
    createWard({
      members: Object.fromEntries(people.map((person) => [person.id, person])),
      tags: {},
    }),
  );
}

interface BoardParts {
  readonly id?: string;
  readonly boardGroups: readonly BoardGroup[];
  readonly callingGroups: readonly CallingGroup[];
  readonly assignments?: readonly ReturnType<typeof assignment>[];
  readonly positions?: readonly ReturnType<typeof position>[];
  readonly placements?: Board['placements'];
  readonly dugoutInclusions?: readonly MemberId[];
  readonly shuffle?: boolean;
}

function buildBoard(ward: Ward, parts: BoardParts): Board {
  const shuffle = parts.shuffle ?? false;
  return valueOf(
    createBoard(
      {
        id: boardId(parts.id ?? 'b-derived'),
        kind: 'current',
        version: 1,
        boardGroups: recordOf(parts.boardGroups, shuffle),
        callingGroups: recordOf(parts.callingGroups, shuffle),
        assignments: recordOf(parts.assignments ?? [], shuffle),
        positions: recordOf(parts.positions ?? [], shuffle),
        placements: parts.placements ?? {},
        oversight: [],
        dugoutInclusions: parts.dugoutInclusions ?? [],
        approvals: [],
      },
      ward,
    ),
  );
}

function boardGroup(id: string, order: number, visible = true): BoardGroup {
  return { id: boardGroupId(id), name: id, order, visible, key: null };
}

function groupByKey(board: Board, key: BoardGroupKey): BoardGroupId {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no board group ${key}`);
  }
  return found.id;
}

function at<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`missing ${what}`);
  }
  return item;
}

function placed(entries: readonly (readonly [PositionId, MemberId])[]): Board['placements'] {
  return Object.fromEntries(entries);
}

describe('vacancies', () => {
  it('vacancies lists unplaced positions of enabled assignments', () => {
    const ward = wardWith([member('m-1'), member('m-2'), member('m-3'), member('m-4')]);
    const list = assignment('a-list', { type: 'list', order: 0, title: 'Teachers' });
    const vacantSingle = assignment('a-single', { order: 1, title: 'Secretary' });
    const filledSingle = assignment('a-filled', { order: 2, title: 'President' });
    const positions = [
      position('p-1', 'a-list', { order: 0 }),
      position('p-2', 'a-list', { order: 1 }),
      position('p-3', 'a-list', { order: 2 }),
      position('p-4', 'a-list', { order: 3 }),
      position('p-single', 'a-single'),
      position('p-filled', 'a-filled'),
    ];
    const board = buildBoard(ward, {
      id: 'b-vacancies',
      boardGroups: [boardGroup('bg-1', 0)],
      callingGroups: [callingGroup('cg-1')],
      assignments: [list, vacantSingle, filledSingle],
      positions,
      placements: placed([
        [positionId('p-1'), memberId('m-1')],
        [positionId('p-2'), memberId('m-2')],
        [positionId('p-3'), memberId('m-3')],
        [positionId('p-filled'), memberId('m-4')],
      ]),
    });

    const found = vacancies(board);
    const listVacancies = found.filter((vacancy) => vacancy.assignmentId === assignmentId('a-list'));
    const singleVacancies = found.filter((vacancy) => vacancy.assignmentId === assignmentId('a-single'));
    expect(listVacancies).toHaveLength(1);
    expect(singleVacancies).toHaveLength(1);
    expect(found).toEqual([
      {
        positionId: positionId('p-4'),
        assignmentId: assignmentId('a-list'),
        callingGroupId: callingGroupId('cg-1'),
        boardGroupId: boardGroupId('bg-1'),
      },
      {
        positionId: positionId('p-single'),
        assignmentId: assignmentId('a-single'),
        callingGroupId: callingGroupId('cg-1'),
        boardGroupId: boardGroupId('bg-1'),
      },
    ]);
  });

  it('vacancies ignores disabled assignments', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const ids = vacancies(board).map((vacancy) => vacancy.positionId);

    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(SMALL.SD);
    expect(ids).not.toContain(SMALL.LDp);
    expect(new Set(ids)).toEqual(new Set([SMALL.L1a, SMALL.L1b, SMALL.S3]));
    expect(vacancies(board).some((vacancy) => vacancy.assignmentId === assignmentId('a-sd'))).toBe(false);
    expect(vacancies(board).some((vacancy) => vacancy.assignmentId === assignmentId('a-ld'))).toBe(false);
  });

  it('vacancies are ordered by board structure', () => {
    const ward = wardWith([member('m-1', { name: 'Ordered Member' })]);
    const bgM = boardGroupId('bg-m');
    const bgZ = boardGroupId('bg-z');
    const bgA = boardGroupId('bg-a');
    const boardGroups = [boardGroup('bg-m', 0), boardGroup('bg-z', 0), boardGroup('bg-a', 1)];
    const callingGroups = [
      callingGroup('cg-m', { parent: { kind: 'boardGroup', id: bgM }, order: 0, kind: 'other' }),
      callingGroup('cg-root', { parent: { kind: 'boardGroup', id: bgM }, order: 1, kind: 'committee' }),
      callingGroup('cg-child', {
        parent: { kind: 'callingGroup', id: callingGroupId('cg-root') },
        order: 0,
        kind: 'class',
      }),
      callingGroup('cg-a', { parent: { kind: 'boardGroup', id: bgM }, order: 2, kind: 'class' }),
      callingGroup('cg-b', { parent: { kind: 'boardGroup', id: bgM }, order: 2, kind: 'other' }),
      // Sorts before cg-m by id, so skipping the board-group id tiebreak would invert bg-m and bg-z.
      callingGroup('cg-aaa', { parent: { kind: 'boardGroup', id: bgZ }, order: 0, kind: 'other' }),
      callingGroup('cg-late', { parent: { kind: 'boardGroup', id: bgA }, order: 0, kind: 'other' }),
    ];
    const assignments = [
      assignment('as-m', { groupId: callingGroupId('cg-m'), order: 0, title: 'as-m' }),
      assignment('as-z', { groupId: callingGroupId('cg-m'), order: 0, title: 'as-z' }),
      assignment('as-aaa', { groupId: callingGroupId('cg-m'), order: 1, title: 'as-aaa' }),
      assignment('as-list', { groupId: callingGroupId('cg-m'), order: 2, type: 'list', title: 'as-list' }),
      assignment('as-root', { groupId: callingGroupId('cg-root'), order: 5, title: 'as-root' }),
      assignment('as-child', { groupId: callingGroupId('cg-child'), order: 0, title: 'as-child' }),
      // Assignment and position ids sort opposite the calling-group ids cg-a < cg-b.
      assignment('as-zzz', { groupId: callingGroupId('cg-a'), order: 0, title: 'as-zzz' }),
      assignment('as-aaa-b', { groupId: callingGroupId('cg-b'), order: 0, title: 'as-aaa-b' }),
      assignment('as-bg-z', { groupId: callingGroupId('cg-aaa'), order: 0, title: 'as-bg-z' }),
      assignment('as-bg-a', { groupId: callingGroupId('cg-late'), order: 0, title: 'as-bg-a' }),
    ];
    const positions = [
      position('p-as-m', 'as-m'),
      position('p-as-z', 'as-z'),
      position('p-as-aaa', 'as-aaa'),
      position('p-mmm', 'as-list', { order: 0 }),
      position('p-zzz', 'as-list', { order: 0 }),
      position('p-aaa', 'as-list', { order: 1 }),
      position('p-root', 'as-root'),
      position('p-child', 'as-child'),
      position('p-zzz-a', 'as-zzz'),
      position('p-aaa-b', 'as-aaa-b'),
      position('p-bg-z', 'as-bg-z'),
      position('p-bg-a', 'as-bg-a'),
    ];
    const expected: PositionId[] = positions.map((slot) => slot.id);
    const board = buildBoard(ward, {
      id: 'b-ordered',
      boardGroups,
      callingGroups,
      assignments,
      positions,
      shuffle: true,
    });

    expect(Object.values(board.positions).map((slot) => slot.id)).toEqual(expected.slice().reverse());
    expect(Object.values(board.positions).map((slot) => slot.id)).not.toEqual(expected);
    expect(vacancies(board).map((vacancy) => vacancy.positionId)).toEqual(expected);

    const listIds = new Set<PositionId>([positionId('p-mmm'), positionId('p-zzz'), positionId('p-aaa')]);
    const heldIds = expected.filter((id) => !listIds.has(id));
    const filled = buildBoard(ward, {
      id: 'b-ordered-filled',
      boardGroups,
      callingGroups,
      assignments,
      positions,
      shuffle: true,
      placements: placed(heldIds.map((id) => [id, memberId('m-1')])),
    });
    const held = callingsOf(filled, memberId('m-1'));
    expect(held.map((calling) => calling.positionId)).toEqual(heldIds);
    expect(held.find((calling) => calling.positionId === positionId('p-child'))?.boardGroupId).toBe(bgM);
    expect(held.find((calling) => calling.positionId === positionId('p-bg-a'))?.boardGroupId).toBe(bgA);
  });
});

describe('callings', () => {
  it('callingsOf returns every position a member holds', () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberNamed(ward, 'Jo Testwell');
    const callings = callingsOf(current, jo);

    expect(callings.map((calling) => calling.title)).toEqual(['Relief Society Teacher', 'Nursery Leader']);
    expect(callings.map((calling) => calling.positionId)).toEqual([
      positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher'),
      positionNamed(current, 'Nursery', 'Nursery Leader'),
    ]);
    const relief = at(callings, 0, 'Relief Society calling');
    const nursery = at(callings, 1, 'Nursery calling');
    expect(relief.boardGroupId).toBe(groupByKey(current, 'relief_society'));
    expect(nursery.boardGroupId).toBe(groupByKey(current, 'primary'));
    expect(rootBoardGroupOf(current, relief.callingGroupId)).toBe(groupByKey(current, 'relief_society'));
    expect(rootBoardGroupOf(current, nursery.callingGroupId)).toBe(groupByKey(current, 'primary'));
  });

  it('callingsOf is empty for an unplaced member', () => {
    const { ward, current } = buildFixtureWard();
    expect(callingsOf(current, memberNamed(ward, 'Ivy Notreal'))).toEqual([]);
  });

  it('callingCounts counts positions per member', () => {
    const { ward, current } = buildFixtureWard();
    const counts = callingCounts(current);

    expect(counts.get(memberNamed(ward, 'Jo Testwell'))).toBe(2);
    expect(counts.get(memberNamed(ward, 'Ada Fictional'))).toBe(1);
    for (const name of ['Ivy Notreal', 'Jay Storybook', 'Kai Fictional', 'Tai Demo']) {
      expect(counts.has(memberNamed(ward, name))).toBe(false);
    }
    expect([...counts.values()].some((count) => count === 0)).toBe(false);
  });
});

describe('dugout', () => {
  it('dugout includes members with no callings', () => {
    const { ward, current } = buildFixtureWard();
    const names = ['Ivy Notreal', 'Jay Storybook', 'Kai Fictional', 'Tai Demo'];
    const placedIds = new Set(Object.values(current.placements));
    const unplaced = Object.values(ward.members)
      .filter((person) => !placedIds.has(person.id))
      .map((person) => person.name)
      .sort();
    expect(unplaced).toEqual([...names].sort());

    const entries = dugout(current, ward);
    expect(entries.map((entry) => ward.members[entry.memberId]?.name)).toEqual(names);
    for (const entry of entries) {
      expect(entry.explicit).toBe(false);
      expect(entry.callings).toEqual([]);
    }
    expect(entries.some((entry) => entry.memberId === memberNamed(ward, 'Jo Testwell'))).toBe(false);
  });

  it('dugout includes explicit inclusions with remaining callings', () => {
    const { ward, current } = buildFixtureWard();
    const ada = memberNamed(ward, 'Ada Fictional');
    const board = rebuild(current, ward, { dugoutInclusions: [ada] });
    const entries = dugout(board, ward).filter((entry) => entry.memberId === ada);
    const bishop = assignmentNamed(board, 'Bishopric', 'Bishop');
    const entry = at(entries, 0, 'Ada dugout entry');

    expect(entries).toHaveLength(1);
    expect(entry.explicit).toBe(true);
    expect(entry.callings).toEqual([
      {
        positionId: positionNamed(board, 'Bishopric', 'Bishop'),
        assignmentId: bishop.id,
        title: 'Bishop',
        callingGroupId: bishop.groupId,
        boardGroupId: groupByKey(board, 'bishopric'),
      },
    ]);
  });

  it('dugout lists a member once when both automatic and explicit', () => {
    const { ward, current } = buildFixtureWard();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const board = rebuild(current, ward, { dugoutInclusions: [ivy] });
    const before = dugout(current, ward);
    const after = dugout(board, ward);
    const matches = after.filter((entry) => entry.memberId === ivy);

    expect(matches).toEqual([{ memberId: ivy, explicit: true, callings: [] }]);
    expect(after).toHaveLength(before.length);
  });

  it('removed members enter the dugout only explicitly', () => {
    const ward = smallWard();
    const removed = memberId('m-4');
    const automatic = memberId('m-3');
    const board = smallBoard(ward);

    expect(dugout(board, ward).map((entry) => entry.memberId)).toEqual([automatic]);
    expect(dugout(board, ward).some((entry) => entry.memberId === removed)).toBe(false);

    const included = smallBoard(ward, { dugoutInclusions: [removed] });
    expect(dugout(included, ward)).toEqual([
      { memberId: automatic, explicit: false, callings: [] },
      { memberId: removed, explicit: true, callings: [] },
    ]);
  });

  it('dugout is sorted by name case-insensitively', () => {
    const specs = [
      { id: 'm-ben', name: 'Ben' },
      { id: 'm-ada', name: 'ada' },
      { id: 'm-2', name: 'Ada' },
      { id: 'm-adam', name: 'Ádám' },
      { id: 'm-1', name: 'ADA' },
    ];
    const ward = wardWith(specs.map((spec) => member(spec.id, { name: spec.name })));
    const board = buildBoard(ward, { id: 'b-names', boardGroups: [], callingGroups: [] });
    const ids = dugout(board, ward).map((entry) => entry.memberId);

    expect(ids).toEqual([memberId('m-1'), memberId('m-2'), memberId('m-ada'), memberId('m-adam'), memberId('m-ben')]);

    const example = ['ada', 'Ben', 'Ádám'];
    const byBase = (left: string, right: string): number => left.localeCompare(right, 'en', { sensitivity: 'base' });
    expect([...example].sort(byBase)).toEqual(['ada', 'Ádám', 'Ben']);
    expect([...example].sort(byBase)).not.toEqual([...example].sort());

    const produced = ids.map((id) => {
      const person = ward.members[id];
      if (person === undefined) {
        throw new Error(`missing ${id}`);
      }
      return person.name;
    });
    expect(produced).toEqual(['ADA', 'Ada', 'ada', 'Ádám', 'Ben']);
    expect(produced).not.toEqual([...produced].sort());
  });
});

describe('vacancy counts', () => {
  it('vacancyCountsByBoardGroup covers every board group', () => {
    const { current } = buildFixtureWard();
    const counts = vacancyCountsByBoardGroup(current);
    const found = vacancies(current);

    expect(counts.size).toBe(Object.keys(current.boardGroups).length);
    for (const group of Object.values(current.boardGroups)) {
      expect(counts.get(group.id)).toBe(found.filter((vacancy) => vacancy.boardGroupId === group.id).length);
    }
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(found.length);

    const bishopric = Object.values(current.boardGroups).find((group) => group.key === 'bishopric');
    if (bishopric === undefined) {
      throw new Error('fixture is missing the bishopric board group');
    }
    expect(counts.get(bishopric.id)).toBe(0);
    expect(bishopric.visible).toBe(true);

    const hiddenVacant = boardGroup('bg-hidden', 2, false);
    const hiddenFull = boardGroup('bg-hidden-full', 3, false);
    const open = boardGroup('bg-open', 0, true);
    const full = boardGroup('bg-full', 1, true);
    const ward = wardWith([member('m-1')]);
    const hiddenBoard = buildBoard(ward, {
      id: 'b-counts',
      boardGroups: [open, full, hiddenVacant, hiddenFull],
      callingGroups: [
        callingGroup('cg-open', { parent: { kind: 'boardGroup', id: open.id } }),
        callingGroup('cg-full', { parent: { kind: 'boardGroup', id: full.id } }),
        callingGroup('cg-hidden', { parent: { kind: 'boardGroup', id: hiddenVacant.id } }),
        callingGroup('cg-hidden-full', { parent: { kind: 'boardGroup', id: hiddenFull.id } }),
      ],
      assignments: [
        assignment('a-open', { groupId: callingGroupId('cg-open'), order: 0 }),
        assignment('a-full', { groupId: callingGroupId('cg-full'), order: 0 }),
        assignment('a-hidden', { groupId: callingGroupId('cg-hidden'), order: 0 }),
        assignment('a-hidden-full', { groupId: callingGroupId('cg-hidden-full'), order: 0, enabled: false }),
      ],
      positions: [
        position('p-open', 'a-open'),
        position('p-full', 'a-full'),
        position('p-hidden', 'a-hidden'),
        position('p-hidden-full', 'a-hidden-full'),
      ],
      placements: placed([[positionId('p-full'), memberId('m-1')]]),
    });
    const hiddenCounts = vacancyCountsByBoardGroup(hiddenBoard);
    expect(hiddenCounts.size).toBe(4);
    expect(hiddenCounts.get(open.id)).toBe(1);
    expect(hiddenCounts.get(full.id)).toBe(0);
    expect(hiddenCounts.get(hiddenVacant.id)).toBe(1);
    expect(hiddenCounts.get(hiddenFull.id)).toBe(0);
    expect([...hiddenCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(vacancies(hiddenBoard).length);
  });
});

describe('root board group', () => {
  it('rootBoardGroupOf walks nested calling groups', () => {
    const ward = wardWith();
    const area = boardGroup('bg-area', 0);
    const committee = callingGroup('cg-committee', {
      parent: { kind: 'boardGroup', id: area.id },
      order: 0,
      kind: 'committee',
    });
    const classGroup = callingGroup('cg-class', {
      parent: { kind: 'callingGroup', id: committee.id },
      order: 0,
      kind: 'class',
    });
    const board = buildBoard(ward, {
      id: 'b-nested',
      boardGroups: [area],
      callingGroups: [committee, classGroup],
      assignments: [assignment('a-class', { groupId: classGroup.id, order: 0, title: 'Teacher' })],
      positions: [position('p-class', 'a-class')],
    });

    expect(committee.kind).not.toBe('presidency');
    expect(classGroup.kind).toBe('class');
    expect(rootBoardGroupOf(board, classGroup.id)).toBe(area.id);
    expect(rootBoardGroupOf(board, committee.id)).toBe(area.id);
    expect(vacancies(board).map((vacancy) => vacancy.boardGroupId)).toEqual([area.id]);
  });
});

describe('edges', () => {
  it('empty board and empty ward return empty results', () => {
    const ward = valueOf(createWard({ members: {}, tags: {} }));
    const board = buildBoard(ward, { id: 'b-empty', boardGroups: [], callingGroups: [] });

    expect(vacancies(board)).toEqual([]);
    expect(callingsOf(board, memberId('m-nobody'))).toEqual([]);
    expect([...callingCounts(board).entries()]).toEqual([]);
    expect(dugout(board, ward)).toEqual([]);
    expect([...vacancyCountsByBoardGroup(board).entries()]).toEqual([]);
  });

  it('a member placed in a disabled assignment still has a calling', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const occupant = memberId('m-3');
    const board = rebuild(base, ward, {
      placements: { ...base.placements, [SMALL.SD]: occupant },
    });

    expect(callingsOf(board, occupant)).toEqual([
      {
        positionId: SMALL.SD,
        assignmentId: assignmentId('a-sd'),
        title: 'Assignment a-sd',
        callingGroupId: CG1,
        boardGroupId: BG1,
      },
    ]);
    expect(callingCounts(board).get(occupant)).toBe(1);
    expect(vacancies(board).map((vacancy) => vacancy.positionId)).not.toContain(SMALL.SD);
    expect(dugout(board, ward)).toEqual([]);
  });

  it('nested calling groups three levels deep', () => {
    const ward = wardWith([member('m-1', { name: 'Nested Member' })]);
    const area = boardGroup('bg-deep', 0);
    const level1 = callingGroup('cg-1', { parent: { kind: 'boardGroup', id: area.id }, order: 0, kind: 'other' });
    const level2 = callingGroup('cg-2', { parent: { kind: 'callingGroup', id: level1.id }, order: 0, kind: 'committee' });
    const level3 = callingGroup('cg-3', { parent: { kind: 'callingGroup', id: level2.id }, order: 5, kind: 'class' });
    const sibling = callingGroup('cg-sib', { parent: { kind: 'callingGroup', id: level1.id }, order: 0, kind: 'other' });
    const board = buildBoard(ward, {
      id: 'b-deep',
      boardGroups: [area],
      callingGroups: [level1, level2, level3, sibling],
      assignments: [
        assignment('a-1', { groupId: level1.id, order: 9, title: 'Level 1' }),
        assignment('a-2', { groupId: level2.id, order: 0, title: 'Level 2' }),
        assignment('a-3', { groupId: level3.id, order: 0, type: 'list', title: 'Level 3' }),
        assignment('a-sib', { groupId: sibling.id, order: 0, title: 'Sibling' }),
      ],
      positions: [
        position('p-1', 'a-1'),
        position('p-2', 'a-2'),
        position('p-3a', 'a-3', { order: 0 }),
        position('p-3b', 'a-3', { order: 1 }),
        position('p-sib', 'a-sib'),
      ],
      placements: placed([
        [positionId('p-1'), memberId('m-1')],
        [positionId('p-2'), memberId('m-1')],
        [positionId('p-3b'), memberId('m-1')],
      ]),
    });

    expect(rootBoardGroupOf(board, level1.id)).toBe(area.id);
    expect(rootBoardGroupOf(board, level2.id)).toBe(area.id);
    expect(rootBoardGroupOf(board, level3.id)).toBe(area.id);
    expect(rootBoardGroupOf(board, sibling.id)).toBe(area.id);
    expect(callingsOf(board, memberId('m-1')).map((calling) => calling.positionId)).toEqual([
      positionId('p-1'),
      positionId('p-2'),
      positionId('p-3b'),
    ]);
    expect(callingsOf(board, memberId('m-1')).every((calling) => calling.boardGroupId === area.id)).toBe(true);
    expect(vacancies(board).map((vacancy) => vacancy.positionId)).toEqual([positionId('p-3a'), positionId('p-sib')]);
    expect(vacancies(board).every((vacancy) => vacancy.boardGroupId === area.id)).toBe(true);
  });
});

describe('purity', () => {
  it('derive functions do not mutate inputs', () => {
    const { ward, current } = buildFixtureWard();
    const reference = buildFixtureWard();
    const jo = memberNamed(ward, 'Jo Testwell');
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const kai = memberNamed(ward, 'Kai Fictional');
    const board = rebuild(current, ward, { dugoutInclusions: [kai, ivy] });
    const boardReference = rebuild(reference.current, reference.ward, { dugoutInclusions: [kai, ivy] });

    const firstJo = callingsOf(current, jo);
    const firstCalling = firstJo[0];
    if (firstCalling === undefined) {
      throw new Error('expected Jo Testwell to hold a calling');
    }
    const first = {
      vacancies: vacancies(current),
      callings: firstJo,
      counts: callingCounts(current),
      dugout: dugout(current, ward),
      byGroup: vacancyCountsByBoardGroup(current),
      root: rootBoardGroupOf(current, firstCalling.callingGroupId),
    };
    const secondJo = callingsOf(current, jo);
    const secondCalling = secondJo[0];
    if (secondCalling === undefined) {
      throw new Error('expected Jo Testwell to hold a calling');
    }
    expect(secondJo).toEqual(first.callings);
    expect(vacancies(current)).toEqual(first.vacancies);
    expect(callingCounts(current)).toEqual(first.counts);
    expect(dugout(current, ward)).toEqual(first.dugout);
    expect(vacancyCountsByBoardGroup(current)).toEqual(first.byGroup);
    expect(rootBoardGroupOf(current, secondCalling.callingGroupId)).toBe(first.root);

    expect(dugout(board, ward)).toEqual(dugout(boardReference, reference.ward));
    expect(vacancies(board)).toEqual(vacancies(boardReference));
    expect(board).toEqual(boardReference);
    expect(current).toEqual(reference.current);
    expect(ward).toEqual(reference.ward);
  });
});
