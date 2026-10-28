import { describe, expect, it } from 'vitest';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  addToDugout,
  createWard,
  dugout,
  outOfUnitMembers,
  placeInPosition,
  releaseCalling,
  type Member,
  type MemberId,
  type Ward,
} from '../../src/index.ts';
import { valueOf } from '../model/helpers.ts';
import { contextFor, expectOk, holdingsOf, memberNamed, positionNamed } from '../ops/helpers.ts';

const CHORISTER = ['Music', 'Chorister'] as const;
const TFH = ['Temple and Family History', 'Temple and Family History Consultant'] as const;

function memberOf(ward: Ward, id: MemberId): Member {
  const person = ward.members[id];
  if (person === undefined) {
    throw new Error(`missing member ${id}`);
  }
  return person;
}

function nameOf(ward: Ward, id: MemberId): string {
  return memberOf(ward, id).name;
}

describe('outOfUnitMembers', () => {
  it('outOfUnitMembers lists Hal Testwell and Kai Fictional with their outside callings', () => {
    const { ward } = buildFixtureWard();
    const hal = memberNamed(ward, 'Hal Testwell');
    const kai = memberNamed(ward, 'Kai Fictional');
    const snapshot = structuredClone(ward);

    const entries = outOfUnitMembers(ward);
    const again = outOfUnitMembers(ward);

    expect(Object.isFrozen(entries)).toBe(true);
    expect(ward).toEqual(snapshot);
    expect(again).toEqual(entries);
    expect(entries).toEqual([
      {
        memberId: hal,
        callings: [{ unit: 'Example Stake', title: 'Stake Family History Consultant' }],
      },
      {
        memberId: kai,
        callings: [{ unit: 'Example Stake', title: 'Stake Young Single Adult Adviser' }],
      },
    ]);
    expect(entries[0]?.callings).toEqual(memberOf(ward, hal).externalCallings);
    expect(entries[1]?.callings).toEqual(memberOf(ward, kai).externalCallings);
  });

  it('outOfUnitMembers skips removed members and ignores board state', () => {
    const { ward, current } = buildFixtureWard();
    const hal = memberNamed(ward, 'Hal Testwell');
    const kai = memberNamed(ward, 'Kai Fictional');
    const removedKai = valueOf(
      createWard({
        ...ward,
        members: {
          ...ward.members,
          [kai]: { ...memberOf(ward, kai), removedDate: '2026-03-01' },
        },
      }),
    );

    expect(outOfUnitMembers(removedKai).map((entry) => entry.memberId)).toEqual([hal]);

    const before = outOfUnitMembers(ward);
    const proposal = buildFixtureProposal(current, ward);
    const placed = expectOk(
      placeInPosition(proposal.board, contextFor(ward), {
        memberId: kai,
        from: null,
        to: positionNamed(proposal.board, ...CHORISTER),
      }),
    );

    expect(holdingsOf(placed, kai)).toEqual([positionNamed(placed, ...CHORISTER)]);
    expect(outOfUnitMembers(ward)).toEqual(before);
    expect(before.map((entry) => nameOf(ward, entry.memberId))).toEqual(['Hal Testwell', 'Kai Fictional']);
  });

  it('outOfUnitMembers returns an empty list for a ward with no outside callings', () => {
    const { ward } = buildFixtureWard();
    const emptied = valueOf(
      createWard({
        ...ward,
        members: Object.fromEntries(
          Object.values(ward.members).map((person) => [person.id, { ...person, externalCallings: [] }]),
        ),
      }),
    );

    expect(Object.values(emptied.members).every((person) => person.externalCallings.length === 0)).toBe(true);
    expect(Object.keys(emptied.members).length).toBeGreaterThan(0);
    expect(outOfUnitMembers(emptied)).toEqual([]);
  });

  it('a member with only outside callings is not in the automatic dugout', () => {
    const { ward, current } = buildFixtureWard();
    const names = dugout(current, ward).map((entry) => nameOf(ward, entry.memberId));

    expect(names).not.toContain('Kai Fictional');
    expect(names).toContain('Ivy Notreal');
  });

  it('an explicitly included out-of-unit member is in the dugout', () => {
    const { ward, current } = buildFixtureWard();
    const kai = memberNamed(ward, 'Kai Fictional');
    const proposal = buildFixtureProposal(current, ward);
    const included = expectOk(addToDugout(proposal.board, contextFor(ward), { memberId: kai }));
    const kaiEntries = dugout(included, ward).filter((entry) => entry.memberId === kai);

    expect(kaiEntries).toEqual([{ memberId: kai, explicit: true, callings: [] }]);
  });

  it("releasing Hal's ward calling keeps him out of the automatic dugout", () => {
    const { ward, current } = buildFixtureWard();
    const hal = memberNamed(ward, 'Hal Testwell');
    const proposal = buildFixtureProposal(current, ward);
    const temple = positionNamed(proposal.board, ...TFH);
    expect(proposal.board.placements[temple]).toBe(hal);

    const released = expectOk(
      releaseCalling(proposal.board, contextFor(ward), { memberId: hal, positionId: temple }),
    );

    expect(holdingsOf(released, hal)).toEqual([]);
    expect(dugout(released, ward).some((entry) => entry.memberId === hal)).toBe(false);
    expect(outOfUnitMembers(ward).some((entry) => entry.memberId === hal)).toBe(true);
  });
});
