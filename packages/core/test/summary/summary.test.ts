import { describe, expect, it } from 'vitest';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  SUMMARY_GROUP_KEYS,
  acceptedSummary,
  addListPosition,
  boardGroupId,
  callingGroupId,
  clearOversight,
  createProposal,
  createWard,
  overseerOf,
  placeInPosition,
  proposalDiff,
  releaseCalling,
  removePosition,
  setOversight,
  summaryAllText,
  summaryText,
  swap,
  type Board,
  type BoardGroup,
  type CallingGroup,
  type Proposal,
  type SummaryGroup,
  type Ward,
} from '../../src/index.ts';
import { assignmentNamed, contextFor, expectOk, memberNamed, positionNamed } from '../ops/helpers.ts';

const STAKE_HEADING = 'Elders Quorum presidency \u2014 for the stake presidency';

function started(): { ward: Ward; proposal: Proposal; board: Board } {
  const { ward, current } = buildFixtureWard();
  const proposal = buildFixtureProposal(current, ward);
  return { ward, proposal, board: proposal.board };
}

function withBoard(proposal: Proposal, ward: Ward, board: Board): Proposal {
  const result = createProposal({ ...proposal, board }, ward);
  if (!result.ok) {
    throw new Error(`proposal invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no calling group ${name}`);
  }
  return found;
}

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

function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

describe('overseerOf', () => {
  it('overseerOf resolves the target, its ancestors, then the bishop', () => {
    const { board } = started();
    const primaryClass = callingGroupNamed(board, 'Primary Teachers');
    const primary = boardGroupByKey(board, 'primary');
    const teachers = callingGroupByKey(board, 'teachers_quorum');
    const reliefSociety = boardGroupByKey(board, 'relief_society');
    const reliefClass = callingGroupNamed(board, 'Relief Society Teachers');
    const priests = callingGroupByKey(board, 'priests_quorum');

    expect(overseerOf(board, { kind: 'callingGroup', id: primaryClass.id })).toBe('second_counselor');
    expect(overseerOf(board, { kind: 'boardGroup', id: primary.id })).toBe('second_counselor');
    expect(overseerOf(board, { kind: 'callingGroup', id: teachers.id })).toBe('first_counselor');
    expect(overseerOf(board, { kind: 'boardGroup', id: reliefSociety.id })).toBe('bishop');
    expect(overseerOf(board, { kind: 'callingGroup', id: reliefClass.id })).toBe('bishop');
    expect(overseerOf(board, { kind: 'callingGroup', id: priests.id })).toBe('bishop');
  });

  it('overseerOf throws for a missing target', () => {
    const { board } = started();

    expect(() => overseerOf(board, { kind: 'callingGroup', id: callingGroupId('cg-missing') })).toThrow(TypeError);
    expect(() => overseerOf(board, { kind: 'boardGroup', id: boardGroupId('bg-missing') })).toThrow(TypeError);
  });
});

describe('acceptedSummary', () => {
  it('a fresh proposal has an empty summary', () => {
    const { ward, proposal } = started();

    expect(acceptedSummary(proposal, ward)).toEqual([]);
    expect(summaryAllText(acceptedSummary(proposal, ward))).toBe('No suggested callings or releases.');
    expect(summaryAllText([])).toBe('No suggested callings or releases.');
  });

  it('Primary and Sunday School changes group under their counselors', () => {
    const { ward, proposal } = started();
    const liv = memberNamed(ward, 'Liv Example');
    const bea = memberNamed(ward, 'Bea Placeholder');
    const sundaySchool = positionNamed(proposal.board, 'Sunday School Presidency', 'First Counselor');
    const primaryTeacher = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const placed = expectOk(placeInPosition(proposal.board, contextFor(ward), { memberId: liv, from: null, to: sundaySchool }));
    const released = expectOk(releaseCalling(placed, contextFor(ward), { memberId: bea, positionId: primaryTeacher }));
    const summary = acceptedSummary(withBoard(proposal, ward, released), ward);

    expect(summary.map((group) => group.key)).toEqual(['first_counselor', 'second_counselor']);
    expect(summary.map((group) => group.heading)).toEqual(['First Counselor', 'Second Counselor']);
    expect(summary[0]?.callings.map((line) => line.text)).toEqual([
      'Liv Example \u2014 Sunday School \u00b7 Sunday School Presidency \u00b7 First Counselor',
    ]);
    expect(summary[0]?.releases).toEqual([]);
    expect(summary[1]?.callings).toEqual([]);
    expect(summary[1]?.releases.map((line) => line.text)).toEqual([
      'Bea Placeholder \u2014 Primary \u00b7 Primary Teachers \u00b7 Primary Teacher',
    ]);
  });

  it('Relief Society and unassigned areas group under the bishop', () => {
    const { ward, proposal } = started();
    const kit = memberNamed(ward, 'Kit Notreal');
    const gus = memberNamed(ward, 'Gus Demo');
    const teacher = positionNamed(proposal.board, 'Relief Society Teachers', 'Relief Society Teacher', 1);
    const organist = positionNamed(proposal.board, 'Music', 'Organist');
    const releasedKit = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: kit, positionId: teacher }));
    const releasedGus = expectOk(releaseCalling(releasedKit, contextFor(ward), { memberId: gus, positionId: organist }));
    const summary = acceptedSummary(withBoard(proposal, ward, releasedGus), ward);

    expect(summary.map((group) => group.key)).toEqual(['bishop']);
    expect(summary[0]?.heading).toBe('Bishop');
    expect(summary[0]?.callings).toEqual([]);
    expect(summary[0]?.releases.map((line) => line.text)).toEqual([
      'Kit Notreal \u2014 Relief Society \u00b7 Relief Society Teachers \u00b7 Relief Society Teacher',
      'Gus Demo \u2014 Ward-wide Callings \u00b7 Music \u00b7 Organist',
    ]);
  });

  it('Elders Quorum presidency changes go to the stake presidency group', () => {
    const { ward, proposal } = started();
    const pete = memberNamed(ward, 'Pete Placeholder');
    const secretary = positionNamed(proposal.board, 'Elders Quorum Presidency', 'Secretary');
    const released = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: pete, positionId: secretary }));
    const summary = acceptedSummary(withBoard(proposal, ward, released), ward);

    expect(summary).toHaveLength(1);
    expect(summary[0]?.key).toBe('eq_presidency_stake');
    expect(summary[0]?.heading).toBe(STAKE_HEADING);
    expect(summary[0]?.releases.map((line) => line.text)).toEqual([
      'Pete Placeholder \u2014 Elders Quorum \u00b7 Elders Quorum Presidency \u00b7 Secretary',
    ]);
  });

  it('other Elders Quorum callings go to the Elders Quorum president group', () => {
    const { ward, proposal } = started();
    const quinn = memberNamed(ward, 'Quinn Mockup');
    const instructor = positionNamed(proposal.board, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 0);
    const released = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: quinn, positionId: instructor }));
    const summary = acceptedSummary(withBoard(proposal, ward, released), ward);

    expect(summary.map((group) => group.key)).toEqual(['eq_president']);
    expect(summary[0]?.heading).toBe('Elders Quorum president');
    expect(summary[0]?.releases.map((line) => line.text)).toEqual([
      'Quinn Mockup \u2014 Elders Quorum \u00b7 Elders Quorum Instructors \u00b7 Elders Quorum Instructor',
    ]);
  });

  it('reassigned oversight regroups the summary', () => {
    const { ward, proposal } = started();
    const primary = boardGroupByKey(proposal.board, 'primary');
    const target = { kind: 'boardGroup', id: primary.id } as const;
    expect(overseerOf(proposal.baseline, target)).toBe('second_counselor');

    const reassigned = expectOk(setOversight(proposal.board, contextFor(ward), { target, overseer: 'first_counselor' }));
    const liv = memberNamed(ward, 'Liv Example');
    const secretary = positionNamed(reassigned, 'Primary Presidency', 'Secretary');
    const placed = expectOk(placeInPosition(reassigned, contextFor(ward), { memberId: liv, from: null, to: secretary }));
    const summary = acceptedSummary(withBoard(proposal, ward, placed), ward);

    expect(overseerOf(proposal.baseline, target)).toBe('second_counselor');
    expect(summary.map((group) => group.key)).toEqual(['first_counselor']);
    expect(summary[0]?.heading).toBe('First Counselor');
    expect(summary[0]?.callings.map((line) => line.text)).toEqual([
      'Liv Example \u2014 Primary \u00b7 Primary Presidency \u00b7 Secretary',
    ]);
    expect(summary[0]?.releases).toEqual([]);
  });

  it('a release of a trimmed position classifies by the baseline', () => {
    const { ward, proposal } = started();
    const primary = boardGroupByKey(proposal.board, 'primary');
    const target = { kind: 'boardGroup', id: primary.id } as const;
    const bea = memberNamed(ward, 'Bea Placeholder');
    const teacher = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const reassigned = expectOk(setOversight(proposal.board, contextFor(ward), { target, overseer: 'first_counselor' }));
    const removed = expectOk(removePosition(reassigned, contextFor(ward), { positionId: teacher }));
    expect(removed.positions[teacher]).toBeUndefined();
    const summary = acceptedSummary(withBoard(proposal, ward, removed), ward);

    expect(summary.map((group) => group.key)).toEqual(['second_counselor']);
    expect(summary[0]?.releases.map((line) => line.text)).toEqual([
      'Bea Placeholder \u2014 Primary \u00b7 Primary Teachers \u00b7 Primary Teacher',
    ]);
    expect(summary[0]?.releases[0]?.memberId).toBe(bea);
    expect(summary[0]?.releases[0]?.positionId).toBe(teacher);
  });

  it('a move between areas puts the release and calling in different groups', () => {
    const { ward, proposal } = started();
    const bea = memberNamed(ward, 'Bea Placeholder');
    const from = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const to = positionNamed(proposal.board, 'Sunday School Presidency', 'First Counselor');
    const moved = expectOk(placeInPosition(proposal.board, contextFor(ward), { memberId: bea, from, to }));
    const summary = acceptedSummary(withBoard(proposal, ward, moved), ward);

    expect(summary.map((group) => group.key)).toEqual(['first_counselor', 'second_counselor']);
    expect(summary[0]?.callings.map((line) => ({ memberId: line.memberId, text: line.text }))).toEqual([
      {
        memberId: bea,
        text: 'Bea Placeholder \u2014 Sunday School \u00b7 Sunday School Presidency \u00b7 First Counselor',
      },
    ]);
    expect(summary[1]?.releases.map((line) => ({ memberId: line.memberId, text: line.text }))).toEqual([
      {
        memberId: bea,
        text: 'Bea Placeholder \u2014 Primary \u00b7 Primary Teachers \u00b7 Primary Teacher',
      },
    ]);
  });

  it('groups appear in fixed order and empty groups are omitted', () => {
    const { ward, proposal } = started();
    const quinn = memberNamed(ward, 'Quinn Mockup');
    const bea = memberNamed(ward, 'Bea Placeholder');
    const kit = memberNamed(ward, 'Kit Notreal');
    const instructor = positionNamed(proposal.board, 'Elders Quorum Instructors', 'Elders Quorum Instructor', 0);
    const teacher = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const relief = positionNamed(proposal.board, 'Relief Society Teachers', 'Relief Society Teacher', 1);
    const withoutQuinn = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: quinn, positionId: instructor }));
    const withoutBea = expectOk(releaseCalling(withoutQuinn, contextFor(ward), { memberId: bea, positionId: teacher }));
    const withoutKit = expectOk(releaseCalling(withoutBea, contextFor(ward), { memberId: kit, positionId: relief }));
    const summary = acceptedSummary(withBoard(proposal, ward, withoutKit), ward);

    expect(summary.map((group) => group.key)).toEqual(['bishop', 'second_counselor', 'eq_president']);
    expect(summary.map((group) => group.key)).not.toContain('first_counselor');
    expect(summary.map((group) => group.key)).not.toContain('eq_presidency_stake');
    expect(SUMMARY_GROUP_KEYS).toEqual(['bishop', 'first_counselor', 'second_counselor', 'eq_presidency_stake', 'eq_president']);
  });

  it('summary line text and block text are exact', () => {
    const { ward, proposal } = started();
    const ben = memberNamed(ward, 'Ben Example');
    const dora = memberNamed(ward, 'Dora Placeholder');
    const first = positionNamed(proposal.board, 'Bishopric', 'First Counselor');
    const second = positionNamed(proposal.board, 'Bishopric', 'Second Counselor');
    const clerk = positionNamed(proposal.board, 'Clerks and Secretaries (support roles)', 'Ward Clerk');
    const swapped = expectOk(swap(proposal.board, contextFor(ward), { memberId: ben, from: first, to: second }));
    const released = expectOk(releaseCalling(swapped, contextFor(ward), { memberId: dora, positionId: clerk }));
    const summary = acceptedSummary(withBoard(proposal, ward, released), ward);
    const group = summary[0];
    if (group === undefined) {
      throw new Error('expected the bishop group');
    }

    expect(summary.map((item) => item.key)).toEqual(['bishop']);
    expect(summaryText(group)).toBe(
      [
        'Bishop',
        'Callings:',
        '- Cal Sample \u2014 Bishopric \u00b7 First Counselor',
        '- Ben Example \u2014 Bishopric \u00b7 Second Counselor',
        'Releases:',
        '- Ben Example \u2014 Bishopric \u00b7 First Counselor',
        '- Cal Sample \u2014 Bishopric \u00b7 Second Counselor',
        '- Dora Placeholder \u2014 Bishopric \u00b7 Clerks and Secretaries (support roles) \u00b7 Ward Clerk',
      ].join('\n'),
    );
    expect(summaryText(group).endsWith('\n')).toBe(false);
  });

  it('summaryAllText joins groups with a blank line', () => {
    const { ward, proposal } = started();
    const bea = memberNamed(ward, 'Bea Placeholder');
    const kit = memberNamed(ward, 'Kit Notreal');
    const teacher = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const relief = positionNamed(proposal.board, 'Relief Society Teachers', 'Relief Society Teacher', 1);
    const withoutBea = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: bea, positionId: teacher }));
    const withoutKit = expectOk(releaseCalling(withoutBea, contextFor(ward), { memberId: kit, positionId: relief }));
    const summary = acceptedSummary(withBoard(proposal, ward, withoutKit), ward);

    expect(summaryAllText(summary)).toBe(
      [
        'Bishop',
        'Releases:',
        '- Kit Notreal \u2014 Relief Society \u00b7 Relief Society Teachers \u00b7 Relief Society Teacher',
        '',
        'Second Counselor',
        'Releases:',
        '- Bea Placeholder \u2014 Primary \u00b7 Primary Teachers \u00b7 Primary Teacher',
      ].join('\n'),
    );
  });

  it('summary does not mutate inputs and is frozen', () => {
    const { ward, proposal } = started();
    const bea = memberNamed(ward, 'Bea Placeholder');
    const teacher = positionNamed(proposal.board, 'Primary Teachers', 'Primary Teacher', 0);
    const released = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: bea, positionId: teacher }));
    const edited = withBoard(proposal, ward, released);
    const proposalJson = JSON.stringify(edited);
    const wardJson = JSON.stringify(ward);

    const summary = acceptedSummary(edited, ward);
    const text = summaryText(summary[0] as SummaryGroup);
    const all = summaryAllText(summary);

    expect(JSON.stringify(edited)).toBe(proposalJson);
    expect(JSON.stringify(ward)).toBe(wardJson);
    expect(isDeeplyFrozen(summary)).toBe(true);
    expect(text.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(0);
    expect(() => {
      (summary as SummaryGroup[]).push(summary[0] as SummaryGroup);
    }).toThrow(TypeError);
    const group = summary[0];
    if (group === undefined) {
      throw new Error('expected a group');
    }
    expect(() => {
      (group.callings as SummaryGroup['callings'][number][]).push(group.callings[0] as SummaryGroup['callings'][number]);
    }).toThrow(TypeError);
    expect(() => {
      (group.releases as SummaryGroup['releases'][number][]).push(group.releases[0] as SummaryGroup['releases'][number]);
    }).toThrow(TypeError);
  });

  it('is exported from the package root', () => {
    expect(setOversight).toEqual(expect.any(Function));
    expect(clearOversight).toEqual(expect.any(Function));
    expect(overseerOf).toEqual(expect.any(Function));
    expect(acceptedSummary).toEqual(expect.any(Function));
    expect(summaryText).toEqual(expect.any(Function));
    expect(summaryAllText).toEqual(expect.any(Function));
    expect(SUMMARY_GROUP_KEYS).toEqual(['bishop', 'first_counselor', 'second_counselor', 'eq_presidency_stake', 'eq_president']);
  });

  it('position additions alone are not a summary', () => {
    const { ward, proposal } = started();
    const youth = assignmentNamed(proposal.board, 'Youth Sunday School', 'Youth Sunday School Teacher');
    const added = expectOk(addListPosition(proposal.board, contextFor(ward), { assignmentId: youth.id }));
    const edited = withBoard(proposal, ward, added);
    const diff = proposalDiff(edited);

    expect(diff.addedPositions.length).toBeGreaterThan(0);
    expect(diff.callings).toEqual([]);
    expect(diff.releases).toEqual([]);
    expect(acceptedSummary(edited, ward)).toEqual([]);
  });

  it('a presidency release cascade lists every released member under the right group', () => {
    const { ward, proposal } = started();
    const max = memberNamed(ward, 'Max Fictional');
    const president = positionNamed(proposal.board, 'Elders Quorum Presidency', 'President');
    const released = expectOk(releaseCalling(proposal.board, contextFor(ward), { memberId: max, positionId: president }));
    const summary = acceptedSummary(withBoard(proposal, ward, released), ward);

    expect(summary).toHaveLength(1);
    expect(summary[0]?.key).toBe('eq_presidency_stake');
    expect(summary[0]?.heading).toBe(STAKE_HEADING);
    expect(summary[0]?.callings).toEqual([]);
    expect(summary[0]?.releases.map((line) => line.text)).toEqual([
      'Max Fictional \u2014 Elders Quorum \u00b7 Elders Quorum Presidency \u00b7 President',
      'Ned Example \u2014 Elders Quorum \u00b7 Elders Quorum Presidency \u00b7 First Counselor',
      'Otto Sample \u2014 Elders Quorum \u00b7 Elders Quorum Presidency \u00b7 Second Counselor',
      'Pete Placeholder \u2014 Elders Quorum \u00b7 Elders Quorum Presidency \u00b7 Secretary',
    ]);
  });

  it('a renamed ward member is shown under the shared name', () => {
    const { ward, proposal } = started();
    const ben = memberNamed(ward, 'Ben Example');
    const cal = memberNamed(ward, 'Cal Sample');
    const first = positionNamed(proposal.board, 'Bishopric', 'First Counselor');
    const second = positionNamed(proposal.board, 'Bishopric', 'Second Counselor');
    const swapped = expectOk(swap(proposal.board, contextFor(ward), { memberId: ben, from: first, to: second }));
    const edited = withBoard(proposal, ward, swapped);
    const renamed = createWard({
      tags: ward.tags,
      members: {
        ...ward.members,
        [cal]: { ...ward.members[cal], name: 'Cal Renamed' },
      },
    });
    if (!renamed.ok) {
      throw new Error(`renamed ward invalid: ${JSON.stringify(renamed.errors)}`);
    }

    const summary = acceptedSummary(edited, renamed.value);
    const texts = summary.flatMap((group) => [...group.callings, ...group.releases].map((line) => line.text));
    expect(texts).toEqual([
      'Cal Renamed \u2014 Bishopric \u00b7 First Counselor',
      'Ben Example \u2014 Bishopric \u00b7 Second Counselor',
      'Ben Example \u2014 Bishopric \u00b7 First Counselor',
      'Cal Renamed \u2014 Bishopric \u00b7 Second Counselor',
    ]);
    expect(summary.flatMap((group) => [...group.callings, ...group.releases].map((line) => line.name))).toEqual([
      'Cal Renamed',
      'Ben Example',
      'Ben Example',
      'Cal Renamed',
    ]);

    const original = acceptedSummary(edited, ward);
    expect(original.flatMap((group) => [...group.callings, ...group.releases].map((line) => line.name))).toContain('Cal Sample');
    expect(ward.members[cal]?.name).toBe('Cal Sample');
  });
});
