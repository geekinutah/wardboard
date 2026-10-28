import { describe, expect, it } from 'vitest';
import type { Member, Ward } from '@wardboard/core';
import { buildBoard, buildProposal, buildWard, type OrgSpec } from './fixtures.ts';
import { summaryRows } from './rows.ts';

/** A structural ward copy with `name`'s member given a non-null `removedDate`. */
function wardWithRemovedMember(ward: Ward, name: string, removedDate = '2026-10-24'): Ward {
  const member: Member | undefined = Object.values(ward.members).find((m) => m.name === name);
  if (member === undefined) {
    throw new Error(`no member named ${name}`);
  }
  return {
    ...ward,
    members: {
      ...ward.members,
      [member.id]: { ...member, removedDate },
    },
  };
}

describe('summaryRows', () => {
  it('unchanged proposal → all sections empty, divergence total 0', () => {
    const spec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: ['Ann Alpha'] },
              { title: 'Alpha Aide', type: 'list', occupants: ['Bob Beta', 'Cid C'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C']);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.callings).toEqual([]);
    expect(rows.releases).toEqual([]);
    expect(rows.added).toEqual([]);
    expect(rows.trimmed).toEqual([]);
    expect(rows.vacancySections).toEqual([]);
    expect(rows.divergence.added).toEqual([]);
    expect(rows.divergence.removed).toEqual([]);
    expect(rows.divergence.members).toEqual([]);
    expect(rows.divergence.total).toBe(0);
  });

  it('a move produces one calling and one release with name, org and title', () => {
    const baselineSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: ['Ann Alpha'] },
              { title: 'Alpha Vice', type: 'single', occupants: ['Bob Beta'] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta Lead', type: 'single', occupants: [null] }] }],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: [null] },
              { title: 'Alpha Vice', type: 'single', occupants: ['Bob Beta'] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta Lead', type: 'single', occupants: ['Ann Alpha'] }] }],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta']);
    const current = buildBoard(baselineSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baselineSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.callings).toEqual([{ name: 'Ann Alpha', org: 'Beta', title: 'Beta Lead' }]);
    expect(rows.releases).toEqual([{ name: 'Ann Alpha', org: 'Alpha', title: 'Alpha Chair' }]);
  });

  it('added and trimmed positions list org and title in core order', () => {
    const baselineSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          { name: 'Alpha Group', assignments: [{ title: 'Alpha Aide', type: 'list', occupants: ['Ann Alpha', null] }] },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta Aide', type: 'list', occupants: [null] }] }],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Aide', type: 'list', occupants: ['Ann Alpha', null] },
              { title: 'Alpha Extra', type: 'list', occupants: [null, null] },
            ],
          },
        ],
      },
      {
        name: 'Gamma',
        groups: [{ name: 'Gamma Group', assignments: [{ title: 'Gamma Lead', type: 'single', occupants: [null] }] }],
      },
    ];
    const ward = buildWard(['Ann Alpha']);
    const current = buildBoard(baselineSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baselineSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.added).toEqual([
      { name: null, org: 'Alpha', title: 'Alpha Extra' },
      { name: null, org: 'Alpha', title: 'Alpha Extra' },
      { name: null, org: 'Gamma', title: 'Gamma Lead' },
    ]);
    expect(rows.trimmed).toEqual([{ name: null, org: 'Beta', title: 'Beta Aide' }]);
    // Every position is vacant, so no member gains or loses a calling.
    expect(rows.callings).toEqual([]);
    expect(rows.releases).toEqual([]);
  });

  it('vacancies group by org in board order with distinct titles', () => {
    const spec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha First',
            assignments: [
              { title: 'Alpha Teacher', type: 'list', occupants: [null, null] },
              { title: 'Alpha Chair', type: 'single', occupants: ['Ann Alpha'] },
            ],
          },
          {
            name: 'Alpha Second',
            assignments: [{ title: 'Alpha Aide', type: 'list', occupants: [null] }],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [
          {
            name: 'Beta First',
            assignments: [{ title: 'Beta Leader', type: 'list', occupants: [null, 'Bob Beta'] }],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta']);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.vacancySections).toEqual([
      { org: 'Alpha', titles: ['Alpha Teacher', 'Alpha Aide'], count: 3, groups: 1 },
      { org: 'Beta', titles: ['Beta Leader'], count: 1, groups: 1 },
    ]);
  });

  it('six orgs with vacancies → first five explicit, sixth collapsed into Other groups', () => {
    const spec: OrgSpec[] = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(
      (name): OrgSpec => ({
        name,
        groups: [
          {
            name: `${name} Group`,
            assignments: [{ title: `${name} Seat`, type: 'list', occupants: [null] }],
          },
        ],
      }),
    );
    const ward = buildWard([]);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.vacancySections).toEqual([
      { org: 'One', titles: ['One Seat'], count: 1, groups: 1 },
      { org: 'Two', titles: ['Two Seat'], count: 1, groups: 1 },
      { org: 'Three', titles: ['Three Seat'], count: 1, groups: 1 },
      { org: 'Four', titles: ['Four Seat'], count: 1, groups: 1 },
      { org: 'Five', titles: ['Five Seat'], count: 1, groups: 1 },
      { org: 'Other groups', titles: [], count: 1, groups: 1 },
    ]);
  });

  it('divergence notes: occupied-in-proposal / vacant-in-proposal / not-in-proposal', () => {
    const baseSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', 'Bob Beta', null, null] },
              { title: 'Alpha Two', type: 'list', occupants: [null] },
            ],
          },
        ],
      },
    ];
    // Current: Alpha One keeps only the first slot, Alpha Two fills its slot,
    // and a brand-new Alpha Three slot (new lineage) is added.
    const currentSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha'] },
              { title: 'Alpha Two', type: 'list', occupants: ['Cid C'] },
              { title: 'Alpha Three', type: 'list', occupants: ['Dora D'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C', 'Dora D']);
    const current = buildBoard(currentSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baseSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(baseSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.divergence.added).toEqual([
      { org: 'Alpha', title: 'Alpha Three', note: 'Not in this proposal' },
    ]);
    expect(rows.divergence.removed).toEqual([
      { org: 'Alpha', title: 'Alpha One', note: 'Held in this proposal by Bob Beta' },
      { org: 'Alpha', title: 'Alpha One', note: 'Still vacant in this proposal' },
      { org: 'Alpha', title: 'Alpha One', note: 'Still vacant in this proposal' },
    ]);
    expect(rows.divergence.members).toEqual([]);
    expect(rows.divergence.total).toBe(4);
  });

  it('removed member with two placements → two lines, total counts the member once', () => {
    const spec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: ['Ann Alpha'] },
              { title: 'Alpha Aide', type: 'list', occupants: ['Ann Alpha', 'Bob Beta'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta']);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, wardWithRemovedMember(ward, 'Ann Alpha'));

    expect(rows.divergence.members).toEqual([
      {
        name: 'Ann Alpha',
        positions: [
          { org: 'Alpha', title: 'Alpha Chair' },
          { org: 'Alpha', title: 'Alpha Aide' },
        ],
      },
    ]);
    expect(rows.divergence.added).toEqual([]);
    expect(rows.divergence.removed).toEqual([]);
    expect(rows.divergence.total).toBe(1);
  });

  it('current equal to baseline → divergence total 0', () => {
    const spec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', null] },
              { title: 'Alpha Two', type: 'single', occupants: ['Bob Beta'] },
            ],
          },
        ],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', null] },
              { title: 'Alpha Two', type: 'single', occupants: ['Bob Beta'] },
              { title: 'Alpha Extra', type: 'single', occupants: [null] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta']);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    expect(rows.divergence.added).toEqual([]);
    expect(rows.divergence.removed).toEqual([]);
    expect(rows.divergence.members).toEqual([]);
    expect(rows.divergence.total).toBe(0);
  });

  it('proposal-added lineage never appears in divergence', () => {
    const baseSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [{ name: 'Alpha Group', assignments: [{ title: 'Alpha One', type: 'list', occupants: ['Ann Alpha'] }] }],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha'] },
              { title: 'Alpha Extra', type: 'single', occupants: ['Bob Beta'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta']);
    const current = buildBoard(baseSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baseSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    const rows = summaryRows(proposal, current, ward);

    // The proposal-side position change records the added lineage…
    expect(rows.added).toEqual([{ name: null, org: 'Alpha', title: 'Alpha Extra' }]);
    // …but Current is unchanged, so the divergence must not mention it.
    expect(rows.divergence.added).toEqual([]);
    expect(rows.divergence.removed).toEqual([]);
    expect(rows.divergence.members).toEqual([]);
    expect(rows.divergence.total).toBe(0);
  });
});
