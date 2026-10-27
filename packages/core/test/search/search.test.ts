import { describe, expect, it } from 'vitest';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import { deepFreeze } from '../../src/model/freeze.ts';
import {
  addAssignment,
  addCallingGroup,
  addToDugout,
  createWard,
  filterMatches,
  placeInPosition,
  search,
  setBoardGroupVisible,
  type Board,
  type BoardGroup,
  type CallingGroup,
  type CallingGroupId,
  type MemberId,
  type TagId,
  type Ward,
} from '../../src/index.ts';
import { member, valueOf } from '../model/helpers.ts';
import {
  assignmentNamed,
  contextFor,
  expectOk,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  rebuild,
} from '../ops/helpers.ts';

const EMPTY = { people: [], callings: [], tags: [], groups: [] };

function tagNamed(ward: Ward, name: string): TagId {
  const found = Object.values(ward.tags).find((tag) => tag.name === name);
  if (found === undefined) {
    throw new Error(`no tag ${name}`);
  }
  return found.id;
}

function memberNames(ward: Ward, ids: readonly MemberId[]): string[] {
  return ids.map((id) => {
    const person = ward.members[id];
    if (person === undefined) {
      throw new Error(`missing member ${id}`);
    }
    return person.name;
  });
}

function peopleNames(ward: Ward, people: readonly { memberId: MemberId }[]): string[] {
  return memberNames(ward, people.map((person) => person.memberId));
}

function markRemoved(ward: Ward, ...ids: readonly MemberId[]): Ward {
  return valueOf(
    createWard({
      ...ward,
      members: Object.fromEntries(
        Object.values(ward.members).map((person) => [
          person.id,
          ids.includes(person.id) ? { ...person, removedDate: '2026-02-01' } : person,
        ]),
      ),
    }),
  );
}

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no calling group ${name}`);
  }
  return found;
}

function boardGroupNamed(board: Board, name: string): BoardGroup {
  const found = Object.values(board.boardGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no board group ${name}`);
  }
  return found;
}

function callingGroupName(board: Board, id: CallingGroupId): string {
  const group = board.callingGroups[id];
  if (group === undefined) {
    throw new Error(`missing calling group ${id}`);
  }
  return group.name;
}

function setEnabled(board: Board, ward: Ward, groupName: string, title: string, enabled: boolean): Board {
  const current = assignmentNamed(board, groupName, title);
  return rebuild(board, ward, {
    assignments: { ...board.assignments, [current.id]: { ...current, enabled } },
  });
}

function placement(board: Board, groupName: string, title: string, index = 0): {
  boardId: Board['id'];
  positionId: ReturnType<typeof positionNamed>;
  assignmentId: ReturnType<typeof assignmentNamed>['id'];
  title: string;
} {
  const assignment = assignmentNamed(board, groupName, title);
  return {
    boardId: board.id,
    positionId: positionNamed(board, groupName, title, index),
    assignmentId: assignment.id,
    title: assignment.title,
  };
}

describe('search', () => {
  it('partial case-insensitive name match', () => {
    const { ward, current } = buildFixtureWard();
    const found = search({ query: 'ren no', boards: [current] }, ward);
    expect(peopleNames(ward, found.people)).toEqual(['Wren Notreal']);
    expect(found.people[0]?.matchedOn).toEqual(['name']);

    const jose = member('m-jose', { name: 'José García' });
    const accentWard = valueOf(createWard({ members: { [jose.id]: jose }, tags: {} }));
    const accent = search({ query: 'jose', boards: [] }, accentWard);
    expect(accent.people.map((person) => person.memberId)).toEqual([jose.id]);
    expect(accent.people[0]?.matchedOn).toEqual(['name']);
    expect(search({ query: '  GARCIA ', boards: [] }, accentWard).people).toHaveLength(1);
  });

  it('a person result lists every placement and dugout state on scoped boards', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const jo = memberNamed(ward, 'Jo Testwell');
    const edited = expectOk(addToDugout(proposal.board, contextFor(ward), { memberId: jo }));
    const boards = [edited, current];
    const found = search({ query: 'jo testwell', boards }, ward);

    expect(found.people).toHaveLength(1);
    expect(found.people[0]?.memberId).toBe(jo);
    expect(found.people[0]?.placements).toEqual([
      placement(edited, 'Relief Society Teachers', 'Relief Society Teacher'),
      placement(edited, 'Nursery', 'Nursery Leader'),
      placement(current, 'Relief Society Teachers', 'Relief Society Teacher'),
      placement(current, 'Nursery', 'Nursery Leader'),
    ]);
    expect(found.people[0]?.dugout).toEqual([{ boardId: edited.id, explicit: true }]);

    const jay = search({ query: 'jay storybook', boards }, ward);
    expect(jay.people).toHaveLength(1);
    expect(jay.people[0]?.placements).toEqual([]);
    expect(jay.people[0]?.dugout).toEqual([
      { boardId: edited.id, explicit: false },
      { boardId: current.id, explicit: false },
    ]);
  });

  it('a person matches on a tag name', () => {
    const { ward, current } = buildFixtureWard();
    const found = search({ query: 'teaches', boards: [current] }, ward);
    expect(peopleNames(ward, found.people)).toEqual([
      'Bea Placeholder',
      'Ezra Imaginary',
      'Ivy Notreal',
      'Jo Testwell',
      'Quinn Mockup',
    ]);
    expect(found.people.map((person) => person.matchedOn)).toEqual([['tag'], ['tag'], ['tag'], ['tag'], ['tag']]);
  });

  it('a person matches on an external calling title or unit', () => {
    const { ward, current } = buildFixtureWard();
    const history = search({ query: 'family history', boards: [current] }, ward);
    expect(peopleNames(ward, history.people)).toEqual(['Hal Testwell']);
    expect(history.people[0]?.matchedOn).toEqual(['external_calling']);

    const stake = search({ query: 'example stake', boards: [current] }, ward);
    expect(peopleNames(ward, stake.people)).toEqual(['Hal Testwell', 'Kai Fictional']);
    expect(stake.people.map((person) => person.matchedOn)).toEqual([['external_calling'], ['external_calling']]);
  });

  it('note bodies are never searched', () => {
    const { ward, current } = buildFixtureWard();
    expect(search({ query: 'travels', boards: [current] }, ward).people).toEqual([]);
    expect(peopleNames(ward, search({ query: 'jay storybook', boards: [current] }, ward).people)).toEqual(['Jay Storybook']);
  });

  it('removed members never appear', () => {
    const { ward, current } = buildFixtureWard();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jo = memberNamed(ward, 'Jo Testwell');
    const removedWard = markRemoved(ward, ivy, jo);

    expect(search({ query: 'ivy notreal', boards: [current] }, removedWard).people).toEqual([]);
    expect(search({ query: 'jo testwell', boards: [current] }, removedWard).people).toEqual([]);
    expect(peopleNames(removedWard, search({ query: 'notreal', boards: [current] }, removedWard).people)).toEqual([
      'Kit Notreal',
      'Wren Notreal',
    ]);

    const musical = search({ query: 'musical', boards: [current] }, removedWard).tags;
    expect(musical).toHaveLength(1);
    expect(memberNames(removedWard, musical[0]?.memberIds ?? [])).toEqual(['Flo Madeup', 'Gus Demo', 'Tai Demo']);
    expect(musical[0]?.memberIds).not.toContain(ivy);

    const highlighted = filterMatches(current, removedWard, { tagIds: [tagNamed(removedWard, 'Teaches well')] });
    expect(memberNames(removedWard, highlighted.memberIds)).toEqual(['Bea Placeholder', 'Ezra Imaginary', 'Quinn Mockup']);
    expect(highlighted.memberIds).not.toContain(ivy);
    expect(highlighted.memberIds).not.toContain(jo);
    expect(highlighted.positionIds).not.toContain(positionNamed(current, 'Nursery', 'Nursery Leader'));
    expect(highlighted.positionIds).not.toContain(positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher'));
    expect(highlighted.positionIds).toContain(positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor'));

    const filtered = search({
      query: '',
      boards: [current],
      filters: { tagIds: [tagNamed(removedWard, 'Musical')] },
    }, removedWard);
    expect(peopleNames(removedWard, filtered.people)).toEqual(['Flo Madeup', 'Gus Demo', 'Tai Demo']);
  });

  it('a removed occupant is flagged in calling results', () => {
    const { ward, current } = buildFixtureWard();
    const jo = memberNamed(ward, 'Jo Testwell');
    const removedWard = markRemoved(ward, jo);
    const nursery = search({ query: 'nursery leader', boards: [current] }, removedWard);
    expect(nursery.callings).toHaveLength(1);
    expect(nursery.callings[0]?.vacantCount).toBe(1);
    expect(nursery.callings[0]?.positions).toEqual([
      {
        positionId: positionNamed(current, 'Nursery', 'Nursery Leader', 0),
        occupantId: jo,
        occupantRemoved: true,
      },
      {
        positionId: positionNamed(current, 'Nursery', 'Nursery Leader', 1),
        occupantId: null,
        occupantRemoved: false,
      },
    ]);

    const teachers = search({ query: 'relief society teacher', boards: [current] }, removedWard);
    expect(teachers.callings).toHaveLength(1);
    const byPosition = new Map(teachers.callings[0]?.positions.map((position) => [position.positionId, position]));
    expect(byPosition.get(positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher', 0))).toEqual({
      positionId: positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher', 0),
      occupantId: jo,
      occupantRemoved: true,
    });
    expect(byPosition.get(positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher', 1))?.occupantRemoved).toBe(false);
    expect(byPosition.get(positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher', 2))?.occupantRemoved).toBe(false);
    expect(search({ query: 'jo testwell', boards: [current] }, removedWard).people).toEqual([]);
  });

  it('finds vacant callings', () => {
    const { ward, current } = buildFixtureWard();
    const chorister = search({ query: 'chorister', boards: [current] }, ward);
    expect(chorister.callings).toHaveLength(1);
    const calling = chorister.callings[0];
    const assignment = assignmentNamed(current, 'Music', 'Chorister');
    expect(calling).toMatchObject({
      boardId: current.id,
      assignmentId: assignment.id,
      title: 'Chorister',
      origin: 'standard',
      callingGroupId: assignment.groupId,
      vacantCount: 1,
    });
    expect(calling?.positions).toEqual([
      {
        positionId: positionNamed(current, 'Music', 'Chorister'),
        occupantId: null,
        occupantRemoved: false,
      },
    ]);

    const quinn = memberNamed(ward, 'Quinn Mockup');
    const instructor = search({ query: 'elders quorum instructor', boards: [current] }, ward);
    expect(instructor.callings).toHaveLength(1);
    expect(instructor.callings[0]?.vacantCount).toBeGreaterThanOrEqual(1);
    expect(instructor.callings[0]?.positions).toEqual([
      {
        positionId: positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 0),
        occupantId: quinn,
        occupantRemoved: false,
      },
      {
        positionId: positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 1),
        occupantId: null,
        occupantRemoved: false,
      },
    ]);
  });

  it('finds custom assignments', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const music = callingGroupNamed(proposal.board, 'Music');
    const next = expectOk(
      addAssignment(proposal.board, contextFor(ward, 'lib'), {
        groupId: music.id,
        title: 'Fictional Librarian',
        type: 'single',
        positionCount: 1,
      }),
    );
    expect(search({ query: 'fictional librarian', boards: [current] }, ward).callings).toEqual([]);
    const found = search({ query: 'fictional librarian', boards: [next] }, ward);
    expect(found.callings).toHaveLength(1);
    expect(found.callings[0]).toMatchObject({
      boardId: next.id,
      title: 'Fictional Librarian',
      origin: 'custom',
      vacantCount: 1,
    });
    expect(found.callings[0]?.positions).toHaveLength(1);
    expect(found.callings[0]?.positions[0]).toMatchObject({ occupantId: null, occupantRemoved: false });
  });

  it('disabled unoccupied assignments are not returned', () => {
    const { ward, current } = buildFixtureWard();
    const quinn = memberNamed(ward, 'Quinn Mockup');
    const gus = memberNamed(ward, 'Gus Demo');
    const disabledInstructor = setEnabled(current, ward, 'Elders Quorum Instructors', 'Elders Quorum Instructor', false);
    const instructor = search({ query: 'elders quorum instructor', boards: [disabledInstructor] }, ward);
    expect(instructor.callings).toHaveLength(1);
    expect(instructor.callings[0]?.vacantCount).toBe(0);
    expect(instructor.callings[0]?.positions).toEqual([
      {
        positionId: positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 0),
        occupantId: quinn,
        occupantRemoved: false,
      },
      {
        positionId: positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 1),
        occupantId: null,
        occupantRemoved: false,
      },
    ]);
    expect(
      search({ query: 'elders quorum instructor', boards: [disabledInstructor], filters: { vacant: true } }, ward).callings,
    ).toEqual([]);

    const disabledOrganist = setEnabled(current, ward, 'Music', 'Organist', false);
    const organist = search({ query: 'organist', boards: [disabledOrganist] }, ward);
    expect(organist.callings).toHaveLength(1);
    expect(organist.callings[0]).toMatchObject({
      title: 'Organist',
      vacantCount: 0,
      positions: [
        {
          positionId: positionNamed(current, 'Music', 'Organist'),
          occupantId: gus,
          occupantRemoved: false,
        },
      ],
    });

    const disabledChorister = setEnabled(current, ward, 'Music', 'Chorister', false);
    expect(search({ query: 'chorister', boards: [disabledChorister] }, ward).callings).toEqual([]);
    expect(search({ query: 'chorister', boards: [current] }, ward).callings).toHaveLength(1);
  });

  it('finds board groups and calling groups, including hidden ones', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const enabledMusic = search({ query: 'music', boards: [current] }, ward).groups;
    expect(enabledMusic).toEqual([
      {
        boardId: current.id,
        kind: 'callingGroup',
        id: callingGroupNamed(current, 'Music').id,
        name: 'Music',
        positionCount: 3,
        vacantCount: 1,
      },
    ]);

    const withoutChorister = setEnabled(current, ward, 'Music', 'Chorister', false);
    expect(search({ query: 'music', boards: [withoutChorister] }, ward).groups).toEqual([
      {
        boardId: withoutChorister.id,
        kind: 'callingGroup',
        id: callingGroupNamed(withoutChorister, 'Music').id,
        name: 'Music',
        positionCount: 2,
        vacantCount: 0,
      },
    ]);

    const music = callingGroupNamed(proposal.board, 'Music');
    const withBells = expectOk(
      addCallingGroup(proposal.board, contextFor(ward, 'bell'), {
        parent: { kind: 'callingGroup', id: music.id },
        name: 'Bells',
        kind: 'committee',
      }),
    );
    const bells = callingGroupNamed(withBells, 'Bells');
    const nested = expectOk(
      addAssignment(withBells, contextFor(ward, 'ringer'), {
        groupId: bells.id,
        title: 'Bell Ringer',
        type: 'single',
        positionCount: 1,
      }),
    );
    expect(search({ query: 'music', boards: [nested] }, ward).groups).toEqual([
      {
        boardId: nested.id,
        kind: 'callingGroup',
        id: music.id,
        name: 'Music',
        positionCount: 4,
        vacantCount: 2,
      },
    ]);
    expect(search({ query: 'bells', boards: [nested] }, ward).groups).toEqual([
      {
        boardId: nested.id,
        kind: 'callingGroup',
        id: bells.id,
        name: 'Bells',
        positionCount: 1,
        vacantCount: 1,
      },
    ]);

    const sunday = boardGroupNamed(proposal.board, 'Sunday School');
    const hidden = expectOk(
      setBoardGroupVisible(proposal.board, contextFor(ward), { boardGroupId: sunday.id, visible: false }),
    );
    expect(boardGroupNamed(hidden, 'Sunday School').visible).toBe(false);
    expect(search({ query: 'sunday school', boards: [hidden] }, ward).groups).toEqual([
      {
        boardId: hidden.id,
        kind: 'boardGroup',
        id: sunday.id,
        name: 'Sunday School',
        positionCount: 7,
        vacantCount: 5,
      },
      {
        boardId: hidden.id,
        kind: 'callingGroup',
        id: callingGroupNamed(hidden, 'Sunday School Presidency').id,
        name: 'Sunday School Presidency',
        positionCount: 3,
        vacantCount: 2,
      },
      {
        boardId: hidden.id,
        kind: 'callingGroup',
        id: callingGroupNamed(hidden, 'Youth Sunday School').id,
        name: 'Youth Sunday School',
        positionCount: 2,
        vacantCount: 2,
      },
    ]);
    expect(search({ query: 'gospel doctrine', boards: [hidden] }, ward).groups).toEqual([
      {
        boardId: hidden.id,
        kind: 'callingGroup',
        id: callingGroupNamed(hidden, 'Gospel Doctrine').id,
        name: 'Gospel Doctrine',
        positionCount: 2,
        vacantCount: 1,
      },
    ]);
  });

  it('tag results list non-removed members by name', () => {
    const { ward, current } = buildFixtureWard();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const removedWard = markRemoved(ward, ivy);
    const tags = search({ query: 'teaches', boards: [current] }, removedWard).tags;
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe('Teaches well');
    expect(memberNames(removedWard, tags[0]?.memberIds ?? [])).toEqual([
      'Bea Placeholder',
      'Ezra Imaginary',
      'Jo Testwell',
      'Quinn Mockup',
    ]);
    expect(tags[0]?.memberIds).not.toContain(ivy);
  });

  it('scope limits per-board results', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const one = search({ query: 'ward clerk', boards: [current] }, ward);
    expect(one.callings.map((calling) => calling.boardId)).toEqual([current.id]);
    expect(one.people).toEqual([]);

    const two = search({ query: 'ward clerk', boards: [current, proposal.board] }, ward);
    expect(two.callings.map((calling) => calling.boardId)).toEqual([current.id, proposal.board.id]);
    expect(two.people).toEqual([]);

    const flipped = search({ query: 'ward clerk', boards: [proposal.board, current] }, ward);
    expect(flipped.callings.map((calling) => calling.boardId)).toEqual([proposal.board.id, current.id]);

    const ada = search({ query: 'ada fi', boards: [proposal.board, current] }, ward);
    expect(ada.people).toHaveLength(1);
    expect(ada.people[0]?.placements.map((row) => row.boardId)).toEqual([proposal.board.id, current.id]);
    expect(ada.people[0]?.placements.map((row) => row.title)).toEqual(['Bishop', 'Bishop']);
    expect(ada.people[0]?.dugout).toEqual([]);
  });

  it('empty query without filters returns nothing', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    expect(search({ query: '', boards: [current] }, ward)).toEqual(EMPTY);
    expect(search({ query: '', boards: [current, proposal.board] }, ward)).toEqual(EMPTY);
  });

  it('filters combine with AND for people', () => {
    const { ward, current } = buildFixtureWard();
    const musical = tagNamed(ward, 'Musical');
    const teaches = tagNamed(ward, 'Teaches well');
    const both = search({
      query: '',
      boards: [current],
      filters: { category: 'adult', tagIds: [musical, teaches] },
    }, ward);
    expect(peopleNames(ward, both.people)).toEqual(['Ivy Notreal']);
    expect(both.callings).toEqual([]);
    expect(both.tags).toEqual([]);
    expect(both.groups).toEqual([]);

    const youth = search({
      query: '',
      boards: [current],
      filters: { category: 'youth', tagIds: [musical] },
    }, ward);
    expect(peopleNames(ward, youth.people)).toEqual(['Tai Demo']);
  });

  it('no-calling filter uses every scoped board', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jay = memberNamed(ward, 'Jay Storybook');
    const ada = memberNamed(ward, 'Ada Fictional');
    const placed = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: ivy,
        from: null,
        to: positionNamed(proposal.board, 'Music', 'Chorister'),
      }),
    );

    const ids = (boards: readonly Board[]): MemberId[] =>
      search({ query: '', boards, filters: { noCalling: true } }, ward).people.map((person) => person.memberId);

    expect(ids([current])).toContain(ivy);
    expect(ids([current])).toContain(jay);
    expect(ids([current])).not.toContain(ada);
    expect(ids([placed])).not.toContain(ivy);
    expect(ids([placed])).toContain(jay);
    expect(ids([current, placed])).not.toContain(ivy);
    expect(ids([current, placed])).toContain(jay);
    expect(ids([placed, current])).not.toContain(ivy);
    expect(search({ query: '', boards: [current], filters: { noCalling: true } }, ward).callings).toEqual([]);

    expect(search({ query: 'ivy', boards: [current, placed], filters: { noCalling: true } }, ward).people).toEqual([]);
    expect(peopleNames(ward, search({ query: 'ivy', boards: [current], filters: { noCalling: true } }, ward).people)).toEqual([
      'Ivy Notreal',
    ]);

    const broad = search({ query: 'a', boards: [current], filters: { noCalling: true } }, ward);
    expect(broad.people.some((person) => person.memberId === ivy)).toBe(true);
    expect(broad.people.some((person) => person.memberId === ada)).toBe(false);
    expect(broad.callings.some((calling) => calling.title === 'Ward Clerk' && calling.vacantCount === 0)).toBe(true);

    expect(filterMatches(current, ward, { noCalling: true }).memberIds).toContain(ivy);
    expect(filterMatches(placed, ward, { noCalling: true }).memberIds).not.toContain(ivy);
  });

  it('vacant filter keeps only callings with vacancies and leaves people unfiltered', () => {
    const { ward, current } = buildFixtureWard();
    const open = search({ query: 'a', boards: [current] }, ward);
    const filtered = search({ query: 'a', boards: [current], filters: { vacant: true } }, ward);
    expect(open.people.length).toBeGreaterThan(0);
    expect(filtered.people.map((person) => person.memberId)).toEqual(open.people.map((person) => person.memberId));
    expect(filtered.callings.length).toBeGreaterThan(0);
    expect(filtered.callings.every((calling) => calling.vacantCount >= 1)).toBe(true);
    const filled = open.callings.filter((calling) => calling.vacantCount === 0);
    expect(filled.length).toBeGreaterThan(0);
    expect(open.callings.some((calling) => calling.title === 'Ward Clerk' && calling.vacantCount === 0)).toBe(true);
    expect(filtered.callings.some((calling) => calling.title === 'Ward Clerk')).toBe(false);
    expect(filtered.callings.map((calling) => calling.assignmentId)).toEqual(
      open.callings.filter((calling) => calling.vacantCount >= 1).map((calling) => calling.assignmentId),
    );

    const secretaries = search({ query: 'secretary', boards: [current], filters: { vacant: true } }, ward);
    expect(secretaries.callings.map((calling) => `${callingGroupName(current, calling.callingGroupId)} / ${calling.title}`)).toEqual([
      'Young Women Presidency / Secretary',
      'Primary Presidency / Secretary',
      'Sunday School Presidency / Secretary',
    ]);
    expect(secretaries.people.map((person) => person.memberId)).toEqual(
      search({ query: 'secretary', boards: [current] }, ward).people.map((person) => person.memberId),
    );
  });

  it('any active filter empties tags and groups', () => {
    const { ward, current } = buildFixtureWard();
    const baseline = search({ query: 'music', boards: [current] }, ward);
    expect(baseline.tags.map((tag) => tag.name)).toEqual(['Musical']);
    expect(baseline.groups.map((group) => group.name)).toEqual(['Music']);

    const filters = [
      { vacant: true },
      { noCalling: true },
      { category: 'adult' as const },
      { tagIds: [tagNamed(ward, 'Musical')] },
    ];
    for (const filter of filters) {
      const results = search({ query: 'music', boards: [current], filters: filter }, ward);
      expect(results.tags).toEqual([]);
      expect(results.groups).toEqual([]);
    }

    const inactive = search({
      query: 'music',
      boards: [current],
      filters: { vacant: false, noCalling: false, tagIds: [] },
    }, ward);
    expect(inactive.tags.map((tag) => tag.name)).toEqual(['Musical']);
    expect(inactive.groups.map((group) => group.name)).toEqual(['Music']);
  });

  it('filterMatches highlights the union of vacancies and matching members\' positions', () => {
    const { ward, current } = buildFixtureWard();
    const bea = memberNamed(ward, 'Bea Placeholder');
    const removedWard = markRemoved(ward, bea);
    const teaches = tagNamed(removedWard, 'Teaches well');
    const onlyVacant = filterMatches(current, removedWard, { vacant: true });
    expect(onlyVacant.memberIds).toEqual([]);
    expect(onlyVacant.positionIds.length).toBeGreaterThan(0);

    const highlighted = filterMatches(current, removedWard, { tagIds: [teaches], vacant: true });
    expect(memberNames(removedWard, highlighted.memberIds)).toEqual([
      'Ezra Imaginary',
      'Ivy Notreal',
      'Jo Testwell',
      'Quinn Mockup',
    ]);
    expect(highlighted.memberIds).not.toContain(bea);

    const quinnPos = positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 0);
    const quinnVacant = positionNamed(current, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 1);
    const joRs = positionNamed(current, 'Relief Society Teachers', 'Relief Society Teacher', 0);
    const joNursery = positionNamed(current, 'Nursery', 'Nursery Leader', 0);
    const beaPos = positionNamed(current, 'Primary Teachers', 'Primary Teacher', 0);
    const cyPos = positionNamed(current, 'Primary Teachers', 'Primary Teacher', 1);
    const primaryVacant = positionNamed(current, 'Primary Teachers', 'Primary Teacher', 2);
    const chorister = positionNamed(current, 'Music', 'Chorister');
    const bishop = positionNamed(current, 'Bishopric', 'Bishop');
    const ids = highlighted.positionIds;

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(quinnPos);
    expect(ids).toContain(quinnVacant);
    expect(ids).toContain(joRs);
    expect(ids).toContain(joNursery);
    expect(ids).toContain(chorister);
    expect(ids).toContain(primaryVacant);
    expect(ids).not.toContain(beaPos);
    expect(ids).not.toContain(cyPos);
    expect(ids).not.toContain(bishop);
    expect(ids.indexOf(quinnPos)).toBeLessThan(ids.indexOf(quinnVacant));
    expect(ids.indexOf(quinnVacant)).toBeLessThan(ids.indexOf(joRs));
    expect(ids.indexOf(joRs)).toBeLessThan(ids.indexOf(joNursery));
    expect(ids.indexOf(joNursery)).toBeLessThan(ids.indexOf(chorister));

    expect(filterMatches(current, ward, {})).toEqual({ memberIds: [], positionIds: [] });
    expect(filterMatches(current, ward, { vacant: false, noCalling: false, tagIds: [] })).toEqual({
      memberIds: [],
      positionIds: [],
    });
    const membersOnly = filterMatches(current, removedWard, { tagIds: [teaches] });
    expect(membersOnly.positionIds).toContain(joRs);
    expect(membersOnly.positionIds).not.toContain(chorister);
    expect(membersOnly.positionIds).not.toContain(beaPos);
  });

  it('search never mutates inputs and results are frozen', () => {
    const { ward, current } = buildFixtureWard();
    expect(isDeeplyFrozen(ward)).toBe(true);
    expect(isDeeplyFrozen(current)).toBe(true);
    const filters = { tagIds: [tagNamed(ward, 'Musical')], vacant: true };
    const input = { query: '  Musical ', boards: [current], filters };
    const wardSnapshot = structuredClone(ward);
    const boardSnapshot = structuredClone(current);
    const inputSnapshot = structuredClone(input);
    const frozenWard = deepFreeze(structuredClone(ward));
    const frozenBoard = deepFreeze(structuredClone(current));
    expect(() => search({ query: 'ren no', boards: [frozenBoard] }, frozenWard)).not.toThrow();

    const results = search(input, ward);
    expect(ward).toEqual(wardSnapshot);
    expect(current).toEqual(boardSnapshot);
    expect(input).toEqual(inputSnapshot);
    expect(isDeeplyFrozen(results)).toBe(true);
    expect(results.people.length).toBeGreaterThan(0);
    const sample = results.people[0] ?? {
      memberId: memberNamed(ward, 'Ada Fictional'),
      matchedOn: [],
      placements: [],
      dugout: [],
    };
    expect(() => {
      results.people.push(sample);
    }).toThrow(TypeError);

    const highlights = filterMatches(current, ward, { vacant: true, tagIds: [tagNamed(ward, 'Teaches well')] });
    expect(current).toEqual(boardSnapshot);
    expect(isDeeplyFrozen(highlights)).toBe(true);
    expect(highlights.memberIds.length).toBeGreaterThan(0);
    expect(() => {
      (highlights.positionIds as unknown as string[]).push('extra');
    }).toThrow(TypeError);
  });

  it('is exported from the package root', () => {
    expect(typeof search).toBe('function');
    expect(typeof filterMatches).toBe('function');
  });

  it('a whitespace-only query behaves as empty', () => {
    const { ward, current } = buildFixtureWard();
    expect(search({ query: ' \n\t  ', boards: [current] }, ward)).toEqual(search({ query: '', boards: [current] }, ward));
    expect(search({ query: '', boards: [current] }, ward)).toEqual(EMPTY);
    const blank = search({ query: ' \n\t  ', boards: [current], filters: { vacant: true } }, ward);
    const empty = search({ query: '', boards: [current], filters: { vacant: true } }, ward);
    expect(blank).toEqual(empty);
    expect(blank.people).toEqual([]);
    expect(blank.tags).toEqual([]);
    expect(blank.groups).toEqual([]);
    expect(blank.callings.length).toBeGreaterThan(0);
    expect(blank.callings.every((calling) => calling.vacantCount >= 1)).toBe(true);
  });

  it('a query matching nothing gives four empty lists', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    expect(search({ query: 'zzzznomatch', boards: [current, proposal.board] }, ward)).toEqual(EMPTY);
  });

  it('an empty boards array still returns matching people and tags, with empty placements', () => {
    const { ward } = buildFixtureWard();
    const results = search({ query: 'musical', boards: [] }, ward);
    expect(peopleNames(ward, results.people)).toEqual(['Flo Madeup', 'Gus Demo', 'Ivy Notreal', 'Tai Demo']);
    expect(results.people.every((person) => person.placements.length === 0 && person.dugout.length === 0)).toBe(true);
    expect(results.people.every((person) => person.matchedOn.length === 1 && person.matchedOn[0] === 'tag')).toBe(true);
    expect(results.tags.map((tag) => tag.name)).toEqual(['Musical']);
    expect(memberNames(ward, results.tags[0]?.memberIds ?? [])).toEqual(['Flo Madeup', 'Gus Demo', 'Ivy Notreal', 'Tai Demo']);
    expect(results.callings).toEqual([]);
    expect(results.groups).toEqual([]);
  });

  it('tagIds: [] is not an active filter', () => {
    const { ward, current } = buildFixtureWard();
    const plain = search({ query: 'music', boards: [current] }, ward);
    const withEmpty = search({ query: 'music', boards: [current], filters: { tagIds: [] } }, ward);
    expect(withEmpty).toEqual(plain);
    expect(withEmpty.tags.length).toBeGreaterThan(0);
    expect(withEmpty.groups.length).toBeGreaterThan(0);
    expect(search({ query: '   ', boards: [current], filters: { tagIds: [] } }, ward)).toEqual(EMPTY);
  });

  it("a query that matches a person both by name and by tag reports matchedOn: ['name', 'tag'] once, in that order", () => {
    const { ward, current } = buildFixtureWard();
    const results = search({ query: 'well', boards: [current] }, ward);
    expect(peopleNames(ward, results.people)).toEqual([
      'Bea Placeholder',
      'Ezra Imaginary',
      'Hal Testwell',
      'Ivy Notreal',
      'Jo Testwell',
      'Quinn Mockup',
      'Vera Testwell',
    ]);
    const byName = new Map(
      results.people.map((person) => {
        const name = ward.members[person.memberId]?.name;
        if (name === undefined) {
          throw new Error(`missing member ${person.memberId}`);
        }
        return [name, person.matchedOn] as const;
      }),
    );
    expect(byName.get('Jo Testwell')).toEqual(['name', 'tag']);
    expect(byName.get('Hal Testwell')).toEqual(['name']);
    expect(byName.get('Bea Placeholder')).toEqual(['tag']);
    expect(byName.get('Vera Testwell')).toEqual(['name']);
  });
});
