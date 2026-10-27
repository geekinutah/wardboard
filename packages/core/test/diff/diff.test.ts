import { describe, expect, it } from 'vitest';
import {
  addAssignment,
  addListPosition,
  addToDugout,
  addToList,
  applyPresidencyRelease,
  assignmentId,
  createWard,
  diffBoards as diffBoardsFromRoot,
  lineageId,
  moveToDugout,
  placeInPosition,
  proposalDiff as proposalDiffFromRoot,
  releaseCalling,
  releaseOccupant,
  removeAssignment,
  removePosition,
  positionId,
  swap,
  type AssignmentId,
  type Board,
  type LineageId,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import { diffBoards, proposalDiff, type DiffPlacement, type DiffPosition } from '../../src/diff/index.ts';
import { deepFreeze } from '../../src/model/freeze.ts';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  assignmentNamed,
  contextFor,
  expectOk,
  fixtureSetup,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  rebuild,
} from '../ops/helpers.ts';

// Positions of the fixture proposal board (see src/fixtures/ward.ts).
const DEACONS = 'Deacons Quorum';
const DEACONS_ADVISER = [DEACONS, 'Deacons Quorum Adviser'] as const; // p-0028, Ted Madeup
const DEACONS_COUNSELOR = [DEACONS, 'Deacons Quorum First Counselor'] as const; // p-0027, vacant
const SS_COUNSELOR = ['Sunday School Presidency', 'First Counselor'] as const; // p-0047, vacant
const SS_SECRETARY = ['Sunday School Presidency', 'Secretary'] as const; // p-0048, vacant
const PRIMARY_SECRETARY = ['Primary Presidency', 'Secretary'] as const; // p-0039, vacant
const BISHOPRIC_FIRST = ['Bishopric', 'First Counselor'] as const; // p-0002, Ben Example
const BISHOPRIC_SECOND = ['Bishopric', 'Second Counselor'] as const; // p-0003, Cal Sample
const RS = 'Relief Society Presidency';
const RS_TEACHER = ['Relief Society Teachers', 'Relief Society Teacher'] as const; // p-0016 Jo, p-0017 Kit, p-0018 Lena, p-0019 vacant
const NURSERY = ['Nursery', 'Nursery Leader'] as const; // p-0044 Jo, p-0045 vacant
const PRIMARY_TEACHER = ['Primary Teachers', 'Primary Teacher'] as const; // p-0040 Bea, p-0041 Cy, p-0042-3 vacant
const GOSPEL_DOCTRINE = ['Gospel Doctrine', 'Gospel Doctrine Teacher'] as const; // p-0049 Ezra, p-0050 vacant
const OTHER_LIVESTREAM = ['Other Ward Callings', 'Livestream Coordinator'] as const; // p-0058, Liv Example
const TEACHERS_ADVISER = ['Teachers Quorum', 'Teachers Quorum Adviser'] as const; // p-0025, Sam Imaginary

function pid(board: Board, spec: readonly [string, string], index = 0): PositionId {
  return positionNamed(board, spec[0], spec[1], index);
}

function lineageOf(board: Board, id: PositionId) {
  const found = board.positions[id];
  if (found === undefined) {
    throw new Error(`no position ${id}`);
  }
  return found.lineageId;
}

/** Plain placement summary: `member@positionId`. */
function placed(entries: readonly DiffPlacement[]): string[] {
  return entries.map((entry) => `${entry.memberId}@${entry.positionId}`);
}

function positionIds(entries: readonly DiffPosition[]): string[] {
  return entries.map((entry) => entry.positionId);
}

/**
 * Rebuilds `board` with every position id and assignment id renamed (suffix
 * `-r`) while keeping every lineage, so cross-board matching by id finds nothing.
 */
function renameIds(board: Board, ward: Ward): Board {
  const pos = (id: PositionId): PositionId => positionId(`${id}-r`);
  const asg = (id: AssignmentId): AssignmentId => assignmentId(`${id}-r`);
  return rebuild(board, ward, {
    assignments: Object.fromEntries(Object.values(board.assignments).map((a) => [asg(a.id), { ...a, id: asg(a.id) }])),
    positions: Object.fromEntries(
      Object.values(board.positions).map((p) => [pos(p.id), { ...p, id: pos(p.id), assignmentId: asg(p.assignmentId) }]),
    ),
    placements: Object.fromEntries(Object.entries(board.placements).map(([id, m]) => [pos(positionId(id)), m])),
    approvals: board.approvals.map((a) => ({ ...a, positionId: pos(a.positionId) })),
  });
}

/** Rebuilds `board` with the given positions' lineages replaced; ids are kept. */
function relineage(board: Board, ward: Ward, ids: readonly PositionId[]): Board {
  const fresh = (id: PositionId): LineageId => lineageId(`fresh-${id}`);
  return rebuild(board, ward, {
    positions: Object.fromEntries(
      Object.values(board.positions).map((p) => [p.id, ids.includes(p.id) ? { ...p, lineageId: fresh(p.id) } : p]),
    ),
  });
}

const renamedId = (id: PositionId): PositionId => positionId(`${id}-r`);

function sameList(entries: readonly DiffPlacement[]): string[] {
  return entries.map((entry) => entry.title);
}

describe('net diff', () => {
  it('a fresh proposal has an empty diff', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const result = proposalDiff(proposal);
    expect(result.callings).toEqual([]);
    expect(result.releases).toEqual([]);
    expect(result.addedPositions).toEqual([]);
    expect(result.removedPositions).toEqual([]);
    expect(Object.keys(proposal.baseline.placements).length).toBeGreaterThan(40);
  });

  it('moving a member to a vacancy is one calling and one release', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ted = memberNamed(ward, 'Ted Madeup');
    const source = pid(board, DEACONS_ADVISER);
    const destination = pid(board, DEACONS_COUNSELOR);
    const moved = expectOk(placeInPosition(board, contextFor(ward), { memberId: ted, from: source, to: destination }));
    const result = diffBoards(baseline, moved);
    expect(result.releases).toEqual([
      {
        memberId: ted,
        positionId: source,
        lineageId: lineageOf(baseline, source),
        assignmentId: baseline.positions[source]?.assignmentId,
        title: 'Deacons Quorum Adviser',
      },
    ]);
    expect(result.callings).toEqual([
      {
        memberId: ted,
        positionId: destination,
        lineageId: lineageOf(moved, destination),
        assignmentId: moved.positions[destination]?.assignmentId,
        title: 'Deacons Quorum First Counselor',
      },
    ]);
    expect(result.addedPositions).toEqual([]);
    expect(result.removedPositions).toEqual([]);
  });

  it('several experimental moves reduce to the net change', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ted = memberNamed(ward, 'Ted Madeup');
    const ctx = contextFor(ward);
    const source = pid(board, DEACONS_ADVISER);
    const v1 = pid(board, DEACONS_COUNSELOR);
    const v2 = pid(board, SS_COUNSELOR);
    const v3 = pid(board, SS_SECRETARY);
    let next = expectOk(placeInPosition(board, ctx, { memberId: ted, from: source, to: v1 }));
    next = expectOk(placeInPosition(next, ctx, { memberId: ted, from: v1, to: v2 }));
    next = expectOk(placeInPosition(next, ctx, { memberId: ted, from: v2, to: v3 }));
    const result = diffBoards(baseline, next);
    expect(placed(result.releases)).toEqual([`${ted}@${source}`]);
    expect(placed(result.callings)).toEqual([`${ted}@${v3}`]);
    expect(result.callings[0]?.title).toBe('Secretary');
  });

  it('moving back cancels the change', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ted = memberNamed(ward, 'Ted Madeup');
    const ctx = contextFor(ward);
    const source = pid(board, DEACONS_ADVISER);
    const v1 = pid(board, DEACONS_COUNSELOR);
    const away = expectOk(placeInPosition(board, ctx, { memberId: ted, from: source, to: v1 }));
    expect(diffBoards(baseline, away).callings).toHaveLength(1);
    const back = expectOk(placeInPosition(away, ctx, { memberId: ted, from: v1, to: source }));
    expect(diffBoards(baseline, back)).toEqual({ callings: [], releases: [], addedPositions: [], removedPositions: [] });
  });

  it('a swap is two callings and two releases', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ben = memberNamed(ward, 'Ben Example');
    const cal = memberNamed(ward, 'Cal Sample');
    const first = pid(board, BISHOPRIC_FIRST);
    const second = pid(board, BISHOPRIC_SECOND);
    const swapped = expectOk(swap(board, contextFor(ward), { memberId: ben, from: first, to: second }));
    const result = diffBoards(baseline, swapped);
    expect(placed(result.callings)).toEqual([`${cal}@${first}`, `${ben}@${second}`]);
    expect(placed(result.releases)).toEqual([`${ben}@${first}`, `${cal}@${second}`]);
    expect(result.addedPositions).toEqual([]);
    expect(result.removedPositions).toEqual([]);
  });

  it('releasing one of several callings is only that release', () => {
    const { ward, baseline, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const teacher = pid(board, RS_TEACHER, 0);
    expect(board.placements[pid(board, NURSERY, 0)]).toBe(jo);
    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: jo, positionId: teacher }));
    const result = diffBoards(baseline, released);
    expect(placed(result.releases)).toEqual([`${jo}@${teacher}`]);
    expect(result.callings).toEqual([]);
  });

  it('presidency release lists each released counselor and secretary', () => {
    const { ward, baseline, board } = fixtureSetup();
    const faye = memberNamed(ward, 'Faye Pretend');
    const president = pid(board, [RS, 'President']);
    // Releasing the president through an op applies the cascade; the explicit
    // rule helper is run too, to show the result is stable under it.
    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: faye, positionId: president }));
    const cascaded = rebuild(released, ward, applyPresidencyRelease(board, released));
    const result = diffBoards(baseline, cascaded);
    expect(placed(result.releases)).toEqual([
      `${faye}@${president}`,
      `${memberNamed(ward, 'Gwen Imaginary')}@${pid(board, [RS, 'First Counselor'])}`,
      `${memberNamed(ward, 'Hana Madeup')}@${pid(board, [RS, 'Second Counselor'])}`,
      `${memberNamed(ward, 'Iris Demo')}@${pid(board, [RS, 'Secretary'])}`,
    ]);
    expect(result.callings).toEqual([]);
  });

  it('moving within the same list is not a change', () => {
    const { ward, baseline, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const lena = memberNamed(ward, 'Lena Storybook');
    const ctx = contextFor(ward);
    const lenaBefore = pid(board, RS_TEACHER, 2);
    const jos = pid(board, RS_TEACHER, 0);
    expect(board.placements[lenaBefore]).toBe(lena);
    // Free the lowest position, free Lena's, then re-add her: she lands lower in the same list.
    let next = expectOk(releaseCalling(board, ctx, { memberId: jo, positionId: jos }));
    next = expectOk(releaseCalling(next, ctx, { memberId: lena, positionId: lenaBefore }));
    next = expectOk(addToList(next, ctx, { memberId: lena, from: null, assignmentId: assignmentNamed(board, RS_TEACHER[0], RS_TEACHER[1]).id }));
    const lenaAfter = Object.entries(next.placements).find(([, occupant]) => occupant === lena)?.[0];
    expect(lenaAfter).toBe(jos);
    expect(lenaAfter).not.toBe(lenaBefore);
    const result = diffBoards(baseline, next);
    expect(placed(result.releases)).toEqual([`${jo}@${jos}`]);
    expect(result.callings).toEqual([]);
  });

  it('adding beyond a list\'s positions is an added position and a calling', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jay = memberNamed(ward, 'Jay Storybook');
    const ctx = contextFor(ward);
    const list = assignmentNamed(board, GOSPEL_DOCTRINE[0], GOSPEL_DOCTRINE[1]).id;
    let next = expectOk(addListPosition(board, ctx, { assignmentId: list }));
    next = expectOk(addToList(next, ctx, { memberId: ivy, from: null, assignmentId: list })); // the existing vacancy
    next = expectOk(addToList(next, ctx, { memberId: jay, from: null, assignmentId: list })); // the extra position
    const extra = Object.values(next.positions).find((candidate) => !(candidate.id in board.positions));
    expect(extra).toBeDefined();
    const result = diffBoards(baseline, next);
    expect(positionIds(result.addedPositions)).toEqual([extra?.id]);
    expect(result.addedPositions[0]?.lineageId).toBe(extra?.lineageId);
    expect(result.addedPositions[0]?.title).toBe('Gospel Doctrine Teacher');
    expect(placed(result.callings)).toEqual([`${ivy}@${pid(board, GOSPEL_DOCTRINE, 1)}`, `${jay}@${extra?.id ?? ''}`]);
    expect(result.releases).toEqual([]);
    expect(result.removedPositions).toEqual([]);
  });

  it('adding a vacant list position is only an added position', () => {
    const { ward, baseline, board } = fixtureSetup();
    const list = assignmentNamed(board, GOSPEL_DOCTRINE[0], GOSPEL_DOCTRINE[1]).id;
    const next = expectOk(addListPosition(board, contextFor(ward), { assignmentId: list }));
    const result = diffBoards(baseline, next);
    expect(result.addedPositions).toHaveLength(1);
    expect(result.callings).toEqual([]);
    expect(result.releases).toEqual([]);
    expect(result.removedPositions).toEqual([]);
  });

  it('trimming an occupied position is a removed position and a release', () => {
    const { ward, baseline, board } = fixtureSetup();
    const cy = memberNamed(ward, 'Cy Mockup');
    const trimmed = pid(board, PRIMARY_TEACHER, 1);
    expect(board.placements[trimmed]).toBe(cy);
    const next = expectOk(removePosition(board, contextFor(ward), { positionId: trimmed }));
    const result = diffBoards(baseline, next);
    expect(positionIds(result.removedPositions)).toEqual([trimmed]);
    expect(result.removedPositions[0]).toEqual({
      positionId: trimmed,
      lineageId: lineageOf(baseline, trimmed),
      assignmentId: baseline.positions[trimmed]?.assignmentId,
      title: 'Primary Teacher',
    });
    expect(placed(result.releases)).toEqual([`${cy}@${trimmed}`]);
    expect(result.callings).toEqual([]);
    expect(result.addedPositions).toEqual([]);
  });

  it('removing an assignment lists each of its positions and releases', () => {
    const { ward, baseline, board } = fixtureSetup();
    const list = assignmentNamed(board, RS_TEACHER[0], RS_TEACHER[1]);
    const next = expectOk(removeAssignment(board, contextFor(ward), { assignmentId: list.id }));
    const result = diffBoards(baseline, next);
    expect(positionIds(result.removedPositions)).toEqual([0, 1, 2, 3].map((index) => pid(board, RS_TEACHER, index)));
    expect(placed(result.releases)).toEqual(
      ['Jo Testwell', 'Kit Notreal', 'Lena Storybook'].map(
        (name, index) => `${memberNamed(ward, name)}@${pid(board, RS_TEACHER, index)}`,
      ),
    );
    expect(sameList(result.releases)).toEqual(['Relief Society Teacher', 'Relief Society Teacher', 'Relief Society Teacher']);
    expect(result.callings).toEqual([]);
    expect(result.addedPositions).toEqual([]);
    // Jo still holds the Nursery calling on both boards, so it is not part of the diff.
    expect(result.releases.some((entry) => entry.title === 'Nursery Leader')).toBe(false);
  });

  it('an added assignment\'s placements are callings', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const jay = memberNamed(ward, 'Jay Storybook');
    const ctx = contextFor(ward);
    const groupId = assignmentNamed(board, OTHER_LIVESTREAM[0], OTHER_LIVESTREAM[1]).groupId;
    let next = expectOk(addAssignment(board, ctx, { groupId, title: 'Photographer', type: 'list', positionCount: 2 }));
    const added = Object.values(next.assignments).find((candidate) => !(candidate.id in board.assignments));
    expect(added?.title).toBe('Photographer');
    next = expectOk(addToList(next, ctx, { memberId: ivy, from: null, assignmentId: assignmentId(added?.id ?? '') }));
    next = expectOk(addToList(next, ctx, { memberId: jay, from: null, assignmentId: assignmentId(added?.id ?? '') }));
    const result = diffBoards(baseline, next);
    expect(result.addedPositions).toHaveLength(2);
    expect(result.callings.map((entry) => [entry.memberId, entry.title])).toEqual([
      [ivy, 'Photographer'],
      [jay, 'Photographer'],
    ]);
    expect(result.releases).toEqual([]);
    expect(result.removedPositions).toEqual([]);
  });

  it('oversight and dugout changes produce no diff', () => {
    const { ward, baseline, board } = fixtureSetup();
    const swapped = board.oversight.map((entry) =>
      entry.fixed ? entry : { ...entry, overseer: entry.overseer === 'first_counselor' ? ('second_counselor' as const) : ('first_counselor' as const) },
    );
    const reassigned = rebuild(board, ward, { oversight: swapped });
    expect(reassigned.oversight).not.toEqual(board.oversight);
    const ctx = contextFor(ward);
    const included = expectOk(addToDugout(reassigned, ctx, { memberId: memberNamed(ward, 'Ivy Notreal') }));
    expect(included.dugoutInclusions).toHaveLength(1);
    const empty = { callings: [], releases: [], addedPositions: [], removedPositions: [] };
    expect(diffBoards(baseline, reassigned)).toEqual(empty);
    expect(diffBoards(baseline, included)).toEqual(empty);
  });

  it('a removed member\'s placements still diff normally', () => {
    const { ward, baseline, board } = fixtureSetup();
    const cy = memberNamed(ward, 'Cy Mockup');
    const trimmed = pid(board, PRIMARY_TEACHER, 1);
    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: cy, positionId: trimmed }));
    const expected = diffBoards(baseline, next);
    expect(placed(expected.releases)).toEqual([`${cy}@${trimmed}`]);

    const removedWard = createWard({
      members: Object.fromEntries(
        Object.values(ward.members).map((person) => [person.id, person.id === cy ? { ...person, removedDate: '2026-02-01' } : person]),
      ),
      tags: ward.tags,
    });
    if (!removedWard.ok) {
      throw new Error(`ward invalid: ${JSON.stringify(removedWard.errors)}`);
    }
    const removedBaseline = rebuild(baseline, removedWard.value, {});
    const removedNext = rebuild(next, removedWard.value, {});
    expect(removedWard.value.members[cy]?.removedDate).toBe('2026-02-01');
    expect(diffBoards(removedBaseline, removedNext)).toEqual(expected);
  });

  it('entries are in structural order with titles', () => {
    const { ward, baseline, board } = fixtureSetup();
    const liv = memberNamed(ward, 'Liv Example');
    const sam = memberNamed(ward, 'Sam Imaginary');
    const ctx = contextFor(ward);
    const deaconsCounselor = pid(board, DEACONS_COUNSELOR);
    const primarySecretary = pid(board, PRIMARY_SECRETARY);
    const livFrom = pid(board, OTHER_LIVESTREAM);
    const samFrom = pid(board, TEACHERS_ADVISER);
    // Moved in the opposite order to the result they must come back in.
    let next = expectOk(placeInPosition(board, ctx, { memberId: liv, from: livFrom, to: deaconsCounselor }));
    next = expectOk(placeInPosition(next, ctx, { memberId: sam, from: samFrom, to: primarySecretary }));
    // Rename the assignments on `to` only: callings carry `to`'s titles, releases `from`'s.
    const renamed = rebuild(next, ward, {
      assignments: Object.fromEntries(
        Object.entries(next.assignments).map(([key, value]) => [key, { ...value, title: `${value.title} (renamed)` }]),
      ),
    });
    const result = diffBoards(baseline, renamed);
    expect(placed(result.callings)).toEqual([`${liv}@${deaconsCounselor}`, `${sam}@${primarySecretary}`]);
    expect(result.callings.map((entry) => entry.title)).toEqual([
      'Deacons Quorum First Counselor (renamed)',
      'Secretary (renamed)',
    ]);
    expect(placed(result.releases)).toEqual([`${sam}@${samFrom}`, `${liv}@${livFrom}`]);
    expect(result.releases.map((entry) => entry.title)).toEqual(['Teachers Quorum Adviser', 'Livestream Coordinator']);

    // Reverse direction: the same boards compared the other way swap the roles.
    const reverse = diffBoards(renamed, baseline);
    expect(placed(reverse.callings)).toEqual([`${sam}@${samFrom}`, `${liv}@${livFrom}`]);
    expect(placed(reverse.releases)).toEqual([`${liv}@${deaconsCounselor}`, `${sam}@${primarySecretary}`]);
  });

  it('the diff does not mutate its inputs and is frozen', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ted = memberNamed(ward, 'Ted Madeup');
    const moved = expectOk(
      placeInPosition(board, contextFor(ward), { memberId: ted, from: pid(board, DEACONS_ADVISER), to: pid(board, DEACONS_COUNSELOR) }),
    );
    const trimmed = expectOk(removePosition(moved, contextFor(ward), { positionId: pid(board, PRIMARY_TEACHER, 1) }));
    deepFreeze(baseline);
    deepFreeze(trimmed);
    const before = JSON.stringify([baseline, trimmed]);
    const result = diffBoards(baseline, trimmed);
    expect(result.callings.length).toBeGreaterThan(0);
    expect(result.removedPositions.length).toBeGreaterThan(0);
    expect(JSON.stringify([baseline, trimmed])).toBe(before);
    expect(isDeeplyFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.callings)).toBe(true);
    expect(Object.isFrozen(result.callings[0])).toBe(true);
  });

  it('moving a member to the dugout is exactly one release', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ted = memberNamed(ward, 'Ted Madeup');
    const source = pid(board, DEACONS_ADVISER);
    const next = expectOk(moveToDugout(board, contextFor(ward), { memberId: ted, from: source }));
    expect(next.dugoutInclusions).toContain(ted);
    expect(diffBoards(baseline, next)).toEqual({
      callings: [],
      releases: [
        {
          memberId: ted,
          positionId: source,
          lineageId: lineageOf(baseline, source),
          assignmentId: baseline.positions[source]?.assignmentId,
          title: 'Deacons Quorum Adviser',
        },
      ],
      addedPositions: [],
      removedPositions: [],
    });
  });

  describe('position identity is lineage, not position or assignment id', () => {
    const empty = { callings: [], releases: [], addedPositions: [], removedPositions: [] };

    it('an unchanged arrangement with renamed position and assignment ids has an empty diff', () => {
      const { ward, baseline, board } = fixtureSetup();
      const renamed = renameIds(board, ward);
      const sharedIds = Object.keys(renamed.positions).filter((id) => id in baseline.positions);
      const sharedAssignments = Object.keys(renamed.assignments).filter((id) => id in baseline.assignments);
      expect(sharedIds).toEqual([]);
      expect(sharedAssignments).toEqual([]);
      expect(Object.keys(renamed.placements)).toHaveLength(Object.keys(baseline.placements).length);
      expect(diffBoards(baseline, renamed)).toEqual(empty);
      expect(diffBoards(renamed, baseline)).toEqual(empty);
    });

    it('single positions match by lineage across renamed ids', () => {
      const { ward, baseline, board } = fixtureSetup();
      const ted = memberNamed(ward, 'Ted Madeup');
      const source = pid(board, DEACONS_ADVISER);
      const destination = pid(board, DEACONS_COUNSELOR);
      const renamed = renameIds(board, ward);
      const moved = expectOk(
        placeInPosition(renamed, contextFor(ward), { memberId: ted, from: renamedId(source), to: renamedId(destination) }),
      );
      const result = diffBoards(baseline, moved);
      expect(placed(result.releases)).toEqual([`${ted}@${source}`]);
      expect(result.releases[0]?.assignmentId).toBe(baseline.positions[source]?.assignmentId);
      expect(placed(result.callings)).toEqual([`${ted}@${renamedId(destination)}`]);
      expect(result.callings[0]?.lineageId).toBe(lineageOf(baseline, destination));
      expect(result.callings[0]?.assignmentId).toBe(moved.positions[renamedId(destination)]?.assignmentId);
      expect(result.addedPositions).toEqual([]);
      expect(result.removedPositions).toEqual([]);
    });

    it('a reused position id with a different lineage is a removed and an added position', () => {
      const { ward, baseline, board } = fixtureSetup();
      const ted = memberNamed(ward, 'Ted Madeup');
      const adviser = pid(board, DEACONS_ADVISER);
      const vacant = pid(board, DEACONS_COUNSELOR);
      expect(board.placements[adviser]).toBe(ted);
      expect(board.placements[vacant]).toBeUndefined();
      const next = relineage(board, ward, [adviser, vacant]);
      const result = diffBoards(baseline, next);
      // Structural order: the First Counselor sorts before the Adviser.
      expect(result.removedPositions).toEqual([
        { positionId: vacant, lineageId: lineageOf(baseline, vacant), assignmentId: baseline.positions[vacant]?.assignmentId, title: 'Deacons Quorum First Counselor' },
        { positionId: adviser, lineageId: lineageOf(baseline, adviser), assignmentId: baseline.positions[adviser]?.assignmentId, title: 'Deacons Quorum Adviser' },
      ]);
      expect(result.addedPositions).toEqual([
        { positionId: vacant, lineageId: lineageId(`fresh-${vacant}`), assignmentId: next.positions[vacant]?.assignmentId, title: 'Deacons Quorum First Counselor' },
        { positionId: adviser, lineageId: lineageId(`fresh-${adviser}`), assignmentId: next.positions[adviser]?.assignmentId, title: 'Deacons Quorum Adviser' },
      ]);
      // The occupied one is also a release of the old calling and a calling to the new one.
      expect(result.releases).toEqual([
        { memberId: ted, positionId: adviser, lineageId: lineageOf(baseline, adviser), assignmentId: baseline.positions[adviser]?.assignmentId, title: 'Deacons Quorum Adviser' },
      ]);
      expect(result.callings).toEqual([
        { memberId: ted, positionId: adviser, lineageId: lineageId(`fresh-${adviser}`), assignmentId: next.positions[adviser]?.assignmentId, title: 'Deacons Quorum Adviser' },
      ]);
    });

    it('a list with renamed ids but shared lineages is the same calling', () => {
      const { ward, baseline, board } = fixtureSetup();
      const jo = memberNamed(ward, 'Jo Testwell');
      const lena = memberNamed(ward, 'Lena Storybook');
      const ctx = contextFor(ward);
      const renamed = renameIds(board, ward);
      const jos = renamedId(pid(board, RS_TEACHER, 0));
      const lenaBefore = renamedId(pid(board, RS_TEACHER, 2));
      const listId = assignmentNamed(renamed, RS_TEACHER[0], RS_TEACHER[1]).id;
      expect(listId in baseline.assignments).toBe(false);
      let next = expectOk(releaseCalling(renamed, ctx, { memberId: jo, positionId: jos }));
      next = expectOk(releaseCalling(next, ctx, { memberId: lena, positionId: lenaBefore }));
      next = expectOk(addToList(next, ctx, { memberId: lena, from: null, assignmentId: listId }));
      expect(next.placements[jos]).toBe(lena);
      const result = diffBoards(baseline, next);
      expect(placed(result.releases)).toEqual([`${jo}@${pid(board, RS_TEACHER, 0)}`]);
      expect(result.callings).toEqual([]);
      expect(result.addedPositions).toEqual([]);
      expect(result.removedPositions).toEqual([]);
    });

    it('a list reusing an assignment id but sharing no lineage is a different calling', () => {
      const { ward, baseline, board } = fixtureSetup();
      const list = assignmentNamed(board, RS_TEACHER[0], RS_TEACHER[1]);
      const ids = [0, 1, 2, 3].map((index) => pid(board, RS_TEACHER, index));
      const next = relineage(board, ward, ids);
      expect(next.assignments[list.id]).toBeDefined();
      const result = diffBoards(baseline, next);
      const holders = ['Jo Testwell', 'Kit Notreal', 'Lena Storybook'].map(
        (name, index) => `${memberNamed(ward, name)}@${ids[index] ?? ''}`,
      );
      expect(positionIds(result.removedPositions)).toEqual(ids);
      expect(positionIds(result.addedPositions)).toEqual(ids);
      expect(result.addedPositions.map((entry) => entry.lineageId)).toEqual(ids.map((id) => lineageId(`fresh-${id}`)));
      expect(placed(result.releases)).toEqual(holders);
      expect(placed(result.callings)).toEqual(holders);
      expect(result.callings.every((entry) => entry.assignmentId === list.id)).toBe(true);
    });
  });

  it('is exported from the package root', () => {
    expect(typeof diffBoardsFromRoot).toBe('function');
    expect(typeof proposalDiffFromRoot).toBe('function');
  });

  describe('edge cases', () => {
    it('two boards with no positions have an empty diff', () => {
      const { ward, baseline, board } = fixtureSetup();
      const bare = { assignments: {}, positions: {}, placements: {}, approvals: [] };
      const emptyFrom = rebuild(baseline, ward, bare);
      const emptyTo = rebuild(board, ward, bare);
      expect(Object.keys(emptyFrom.positions)).toHaveLength(0);
      expect(diffBoards(emptyFrom, emptyTo)).toEqual({ callings: [], releases: [], addedPositions: [], removedPositions: [] });
    });

    it('a member placed on `to` who is absent from `from` entirely is a calling only', () => {
      const { ward, baseline, board } = fixtureSetup();
      const kai = memberNamed(ward, 'Kai Fictional');
      expect(Object.values(baseline.placements)).not.toContain(kai);
      const target = pid(board, SS_COUNSELOR);
      const next = expectOk(placeInPosition(board, contextFor(ward), { memberId: kai, from: null, to: target }));
      const result = diffBoards(baseline, next);
      expect(placed(result.callings)).toEqual([`${kai}@${target}`]);
      expect(result.releases).toEqual([]);
    });

    it('a duplicate list holding is reported once, against the higher-order position', () => {
      const { ward, baseline, board } = fixtureSetup();
      const kai = memberNamed(ward, 'Kai Fictional');
      const youth = ['Youth Sunday School', 'Youth Sunday School Teacher'] as const;
      const youthLow = pid(board, youth, 0);
      const youthHigh = pid(board, youth, 1);
      // Hand-built, bypassing createBoard (which rejects it): ops prevent a member twice in one list.
      const oneHolding: Board = { ...baseline, placements: { ...baseline.placements, [youthLow]: kai } };
      const twoHoldings: Board = { ...board, placements: { ...board.placements, [youthLow]: kai, [youthHigh]: kai } };
      const result = diffBoards(oneHolding, twoHoldings);
      expect(placed(result.callings)).toEqual([`${kai}@${youthHigh}`]);
      expect(result.releases).toEqual([]);
      const reverse = diffBoards(twoHoldings, oneHolding);
      expect(placed(reverse.releases)).toEqual([`${kai}@${youthHigh}`]);
      expect(reverse.callings).toEqual([]);
    });

    it('proposalDiff equals diffBoards of its baseline and board', () => {
      const { ward, current } = buildFixtureWard();
      const proposal = buildFixtureProposal(current, ward);
      const ted = memberNamed(ward, 'Ted Madeup');
      const moved = expectOk(
        placeInPosition(proposal.board, contextFor(ward), {
          memberId: ted,
          from: pid(proposal.board, DEACONS_ADVISER),
          to: pid(proposal.board, DEACONS_COUNSELOR),
        }),
      );
      const edited = { ...proposal, board: moved };
      const result = proposalDiff(edited);
      expect(result).toEqual(diffBoards(edited.baseline, edited.board));
      expect(result.callings).toHaveLength(1);
    });

    it('a list added in the proposal corresponds to nothing on the baseline', () => {
      const { ward, baseline, board } = fixtureSetup();
      const ivy = memberNamed(ward, 'Ivy Notreal');
      const ctx = contextFor(ward);
      const groupId = assignmentNamed(board, GOSPEL_DOCTRINE[0], GOSPEL_DOCTRINE[1]).groupId;
      let next = expectOk(addAssignment(board, ctx, { groupId, title: 'Greeter', type: 'list', positionCount: 1 }));
      const added = Object.values(next.assignments).find((candidate) => candidate.title === 'Greeter');
      next = expectOk(addToList(next, ctx, { memberId: ivy, from: null, assignmentId: assignmentId(added?.id ?? '') }));
      expect(placed(diffBoards(baseline, next).callings)).toHaveLength(1);
    });

    it('releaseOccupant displaces the previous occupant', () => {
      const { ward, baseline, board } = fixtureSetup();
      const ted = memberNamed(ward, 'Ted Madeup');
      const cal = memberNamed(ward, 'Cal Sample');
      const from = pid(board, DEACONS_ADVISER);
      const to = pid(board, BISHOPRIC_SECOND);
      const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: ted, from, to }));
      const result = diffBoards(baseline, next);
      expect(placed(result.callings)).toEqual([`${ted}@${to}`]);
      expect(placed(result.releases)).toEqual([`${cal}@${to}`, `${ted}@${from}`]);
    });
  });
});
