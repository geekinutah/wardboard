import { describe, expect, it } from 'vitest';
import type { Board, PositionId, Proposal, Ward } from '@wardboard/core';
import { buildBoard, buildProposal, buildWard, type OrgSpec } from '../summary/fixtures.ts';
import { acceptBlockReasons, formatAcceptedDate, sortHistory } from './acceptance.ts';

interface Scenario {
  readonly ward: Ward;
  readonly current: Board;
  readonly proposal: Proposal;
}

const NAMES = ['Ann Alpha', 'Bob Beta', 'Cid C'];

function alphaSpec(occupants: readonly [string | null, string | null, string | null]): OrgSpec[] {
  return [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'single', occupants: [occupants[0]] },
            { title: 'Alpha Two', type: 'single', occupants: [occupants[1]] },
            { title: 'Alpha Three', type: 'single', occupants: [occupants[2]] },
          ],
        },
      ],
    },
  ];
}

const BETA: OrgSpec = {
  name: 'Beta',
  groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta One', type: 'single', occupants: [null] }] }],
};

interface Options {
  /** Ann (holds Alpha One in the proposal) is removed from the ward. */
  readonly removedMember?: boolean;
  /** Beta One exists in the baseline and proposal but not in Current. */
  readonly removedPosition?: boolean;
  /** Bob and Cid need approval; Bob is unapproved, Cid approved. */
  readonly needsApproval?: boolean;
}

function scenario(options: Options): Scenario {
  const baseWard = buildWard(NAMES);
  const proposalSpec = [...alphaSpec(['Ann Alpha', 'Bob Beta', 'Cid C']), BETA];
  const baselineSpec = [...alphaSpec(['Ann Alpha', null, null]), BETA];
  const currentSpec = options.removedPosition === true ? alphaSpec(['Ann Alpha', null, null]) : baselineSpec;

  const byName = (name: string) => {
    const member = Object.values(baseWard.members).find((m) => m.name === name);
    if (member === undefined) throw new Error(`no ${name}`);
    return member;
  };
  const members = { ...baseWard.members };
  if (options.removedMember === true) {
    const ann = byName('Ann Alpha');
    members[ann.id] = { ...ann, removedDate: '2026-10-24' };
  }
  if (options.needsApproval === true) {
    for (const name of ['Bob Beta', 'Cid C']) {
      const m = byName(name);
      members[m.id] = { ...m, needsApproval: true };
    }
  }
  const ward: Ward = { ...baseWard, members };

  const current = buildBoard(currentSpec, { kind: 'current', id: 'b-current' }, ward);
  const baseline = buildBoard(baselineSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
  const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
  let proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });

  if (options.needsApproval === true) {
    const cid = byName('Cid C');
    const cidPosition = Object.entries(board.placements).find(([, memberId]) => memberId === cid.id)?.[0];
    if (cidPosition === undefined) throw new Error('Cid not placed');
    proposal = {
      ...proposal,
      board: {
        ...proposal.board,
        approvals: [
          { memberId: cid.id, positionId: cidPosition as PositionId, approvedBy: 'u-0001' as never, approvedAt: '2026-10-25T12:00:00Z' },
        ],
      },
    };
  }
  return { ward, current, proposal };
}

describe('acceptBlockReasons', () => {
  it('eligible draft → no reasons', () => {
    const { proposal, current, ward } = scenario({});
    expect(acceptBlockReasons(proposal, current, ward)).toEqual([]);
  });

  it('removed member placed → "{name} is no longer in the ward"', () => {
    const { proposal, current, ward } = scenario({ removedMember: true });
    expect(acceptBlockReasons(proposal, current, ward)).toEqual(['Ann Alpha is no longer in the ward']);
  });

  it('removed position → "{org} · {title} no longer exists in Current"', () => {
    const { proposal, current, ward } = scenario({ removedPosition: true });
    expect(acceptBlockReasons(proposal, current, ward)).toEqual(['Beta · Beta One no longer exists in Current']);
  });

  it('unapproved needs-approval placement listed after removal reasons; approved one is not', () => {
    const { proposal, current, ward } = scenario({ removedMember: true, removedPosition: true, needsApproval: true });
    expect(acceptBlockReasons(proposal, current, ward)).toEqual([
      'Ann Alpha is no longer in the ward',
      'Beta · Beta One no longer exists in Current',
      'Bob Beta needs approval as Alpha · Alpha Two',
    ]);
  });

  it('an accepted proposal has no reasons', () => {
    const { proposal, current, ward } = scenario({ removedMember: true, needsApproval: true });
    const accepted: Proposal = {
      ...proposal,
      status: 'accepted',
      accepted: { by: 'u-0001' as never, at: '2026-10-26T18:00:00Z', summary: '' },
    };
    expect(acceptBlockReasons(accepted, current, ward)).toEqual([]);
  });
});

describe('formatAcceptedDate', () => {
  it('formatAcceptedDate formats in UTC and returns null for junk', () => {
    expect(formatAcceptedDate('2026-10-26T18:00:00Z')).toBe('Oct 26, 2026');
    expect(formatAcceptedDate('2026-10-26T23:59:59Z')).toBe('Oct 26, 2026');
    expect(formatAcceptedDate('2026-01-01T00:00:00Z')).toBe('Jan 1, 2026');
    expect(formatAcceptedDate('not a date')).toBeNull();
    expect(formatAcceptedDate('')).toBeNull();
  });
});

describe('sortHistory', () => {
  it('sortHistory newest first, ties by name, input not mutated', () => {
    const input = [
      { id: 'a', name: 'Zed', acceptedAt: '2026-04-03T18:00:00Z' },
      { id: 'b', name: 'Beta', acceptedAt: '2026-10-26T18:00:00Z' },
      { id: 'c', name: 'Alpha', acceptedAt: '2026-10-26T18:00:00Z' },
      { id: 'd', name: 'Mid', acceptedAt: '2026-07-12T18:00:00Z' },
    ];
    const copy = input.map((entry) => ({ ...entry }));
    const sorted = sortHistory(input);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(copy);
  });
});
