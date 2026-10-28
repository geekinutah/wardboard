import { describe, expect, it } from 'vitest';
import {
  memberId,
  placeInPosition,
  secondCallingNotices,
  secondCallingNoticesWithOutside,
  type Board,
  type ExistingCalling,
  type ExternalCalling,
  type MemberId,
  type Ward,
} from '../../src/index.ts';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import { assignmentNamed, contextFor, expectOk, holdingsOf, memberNamed, positionNamed } from '../ops/helpers.ts';

const CHORISTER = ['Music', 'Chorister'] as const;
const SECRETARY = ['Sunday School Presidency', 'Secretary'] as const;
const TFH = ['Temple and Family History', 'Temple and Family History Consultant'] as const;

function keptCalling(board: Board, groupName: string, title: string, index = 0): ExistingCalling {
  const calling = assignmentNamed(board, groupName, title);
  const slot = positionNamed(board, groupName, title, index);
  return { positionId: slot, assignmentId: calling.id, title: calling.title };
}

function outsideOf(ward: Ward, id: MemberId): readonly ExternalCalling[] {
  const person = ward.members[id];
  if (person === undefined) {
    throw new Error(`missing member ${id}`);
  }
  return person.externalCallings;
}

describe('secondCallingNoticesWithOutside', () => {
  it('placing Kai into a vacant ward calling produces an outside-aware notice', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const kai = memberNamed(ward, 'Kai Fictional');
    const outside = outsideOf(ward, kai);
    expect(holdingsOf(proposal.board, kai)).toEqual([]);
    expect(outside).toEqual([{ unit: 'Example Stake', title: 'Stake Young Single Adult Adviser' }]);

    const after = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: kai,
        from: null,
        to: positionNamed(proposal.board, ...CHORISTER),
      }),
    );

    expect(secondCallingNoticesWithOutside(proposal.board, after, ward)).toEqual([
      { memberId: kai, countBefore: 1, countAfter: 2, existing: [], outside },
    ]);
  });

  it('the old secondCallingNotices still ignores outside callings', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const kai = memberNamed(ward, 'Kai Fictional');
    const after = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: kai,
        from: null,
        to: positionNamed(proposal.board, ...CHORISTER),
      }),
    );

    expect(secondCallingNotices(proposal.board, after)).toEqual([]);
  });

  it('moving Hal between ward positions does not notify', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const hal = memberNamed(ward, 'Hal Testwell');
    const temple = positionNamed(proposal.board, ...TFH);
    const chorister = positionNamed(proposal.board, ...CHORISTER);
    expect(holdingsOf(proposal.board, hal)).toEqual([temple]);
    expect(outsideOf(ward, hal)).toEqual([{ unit: 'Example Stake', title: 'Stake Family History Consultant' }]);
    expect(proposal.board.placements[chorister]).toBeUndefined();

    const after = expectOk(
      placeInPosition(proposal.board, contextFor(ward), { memberId: hal, from: temple, to: chorister }),
    );

    expect(holdingsOf(after, hal)).toEqual([chorister]);
    expect(secondCallingNoticesWithOutside(proposal.board, after, ward)).toEqual([]);
  });

  it('adding a second ward calling to Hal reports both kinds', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const hal = memberNamed(ward, 'Hal Testwell');
    const kept = keptCalling(proposal.board, ...TFH);
    expect(holdingsOf(proposal.board, hal)).toEqual([kept.positionId]);

    const after = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: hal,
        from: null,
        to: positionNamed(proposal.board, ...CHORISTER),
      }),
    );

    expect(secondCallingNoticesWithOutside(proposal.board, after, ward)).toEqual([
      {
        memberId: hal,
        countBefore: 2,
        countAfter: 3,
        existing: [kept],
        outside: [{ unit: 'Example Stake', title: 'Stake Family History Consultant' }],
      },
    ]);
  });

  it('a member with no callings anywhere gets no notice for their first calling', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const ivy = memberNamed(ward, 'Ivy Notreal');
    expect(holdingsOf(proposal.board, ivy)).toEqual([]);
    expect(outsideOf(ward, ivy)).toEqual([]);

    const after = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: ivy,
        from: null,
        to: positionNamed(proposal.board, ...CHORISTER),
      }),
    );

    expect(secondCallingNoticesWithOutside(proposal.board, after, ward)).toEqual([]);
  });

  it('unknown member ids count zero outside callings', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const unknown = memberId('m-not-in-ward');
    const keptPosition = positionNamed(proposal.board, ...CHORISTER);
    const addedPosition = positionNamed(proposal.board, ...SECRETARY);
    expect(ward.members[unknown]).toBeUndefined();
    expect(proposal.board.placements[keptPosition]).toBeUndefined();
    expect(proposal.board.placements[addedPosition]).toBeUndefined();

    const before: Board = {
      ...proposal.board,
      placements: { ...proposal.board.placements, [keptPosition]: unknown },
    };
    const after: Board = {
      ...proposal.board,
      placements: { ...proposal.board.placements, [keptPosition]: unknown, [addedPosition]: unknown },
    };
    const notices = secondCallingNoticesWithOutside(before, after, ward);
    const forUnknown = notices.filter((notice) => notice.memberId === unknown);

    expect(Array.isArray(notices)).toBe(true);
    expect(forUnknown.every((notice) => notice.outside.length === 0)).toBe(true);
    expect(notices).toEqual([
      {
        memberId: unknown,
        countBefore: 1,
        countAfter: 2,
        existing: [keptCalling(proposal.board, ...CHORISTER)],
        outside: [],
      },
    ]);
  });
});
