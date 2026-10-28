import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Board, Member, Proposal, Ward } from '@wardboard/core';
import { buildBoard, buildProposal, buildWard, type OrgSpec } from './fixtures.ts';
import { Summary, type SummaryProps } from './Summary.tsx';

function memberByName(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((m) => m.name === name);
  if (member === undefined) {
    throw new Error(`no member named ${name}`);
  }
  return member;
}

/** A structural ward copy with `name`'s member given a non-null `removedDate`. */
function wardWithRemovedMember(ward: Ward, name: string, removedDate = '2026-10-24'): Ward {
  const member = memberByName(ward, name);
  return {
    ...ward,
    members: { ...ward.members, [member.id]: { ...member, removedDate } },
  };
}

interface Scenario {
  readonly ward: Ward;
  readonly current: Board;
  readonly proposal: Proposal;
}

/** A ward, a Current, and a proposal with nothing changed and nothing removed. */
function quietScenario(): Scenario {
  const spec: OrgSpec[] = [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'single', occupants: ['Ann Alpha'] },
            { title: 'Alpha Two', type: 'list', occupants: ['Bob Beta', 'Cid C'] },
          ],
        },
      ],
    },
  ];
  const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C']);
  const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
  const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
  const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
  const proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });
  return { ward, current, proposal };
}

/**
 * Current re-imported since the baseline: three slots of Alpha One removed
 * (one held, two vacant in the proposal) and a new two-slot Alpha New added,
 * and Ann removed from the ward. Ann holds Alpha One and Alpha Extra on the
 * proposal board. Alpha Extra stays on Current (vacant) so it is a placement
 * change, not a position removal. Total: six differences.
 */
function divergedScenario(): Scenario {
  const baseSpec: OrgSpec[] = [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', 'Bob Beta', null, null] },
            { title: 'Alpha Extra', type: 'single', occupants: ['Ann Alpha'] },
          ],
        },
      ],
    },
    {
      name: 'Beta',
      groups: [
        {
          name: 'Beta Group',
          assignments: [{ title: 'Beta One', type: 'list', occupants: ['Cid C', null] }],
        },
      ],
    },
  ];
  // The new Alpha New slots live in their own org so their lineages cannot
  // collide with the baseline's Alpha Extra lineage.
  const currentSpec: OrgSpec[] = [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha'] },
            // Kept on Current so only the three Alpha One slots diverge.
            { title: 'Alpha Extra', type: 'single', occupants: [null] },
          ],
        },
      ],
    },
    {
      name: 'Beta',
      groups: [
        {
          name: 'Beta Group',
          assignments: [{ title: 'Beta One', type: 'list', occupants: ['Cid C', null] }],
        },
      ],
    },
    {
      name: 'Gamma',
      groups: [
        {
          name: 'Gamma Group',
          assignments: [{ title: 'Alpha New', type: 'list', occupants: ['Dora D', 'Eve E'] }],
        },
      ],
    },
  ];
  const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C', 'Dora D', 'Eve E']);
  const current = buildBoard(currentSpec, { kind: 'current', id: 'b-current' }, ward);
  const baseline = buildBoard(baseSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
  const board = buildBoard(baseSpec, { kind: 'proposal', id: 'b-board' }, ward);
  const proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });
  return { ward, current, proposal };
}

/**
 * One calling (Dann, a dugout member, into Beta One), one release (Ann, from
 * Alpha One), one added position, one trimmed position, two vacancies. Ann
 * appears only in the release so her name renders exactly once.
 */
function cardedScenario(): Scenario {
  const baseSpec: OrgSpec[] = [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'single', occupants: ['Ann Alpha'] },
            { title: 'Alpha Two', type: 'single', occupants: ['Bob Beta'] },
          ],
        },
      ],
    },
    {
      name: 'Beta',
      groups: [
        { name: 'Beta Group', assignments: [{ title: 'Beta One', type: 'list', occupants: ['Cid C', null] }] },
      ],
    },
    {
      name: 'Gamma',
      groups: [{ name: 'Gamma Group', assignments: [{ title: 'Gamma One', type: 'single', occupants: [null] }] }],
    },
  ];
  const proposalSpec: OrgSpec[] = [
    {
      name: 'Alpha',
      groups: [
        {
          name: 'Alpha Group',
          assignments: [
            { title: 'Alpha One', type: 'single', occupants: [null] },
            { title: 'Alpha Two', type: 'single', occupants: ['Bob Beta'] },
            { title: 'Alpha Three', type: 'single', occupants: [null] },
          ],
        },
      ],
    },
    {
      name: 'Beta',
      groups: [
        { name: 'Beta Group', assignments: [{ title: 'Beta One', type: 'list', occupants: ['Cid C', 'Dann Delta'] }] },
      ],
    },
  ];
  const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C', 'Dann Delta']);
  const current = buildBoard(baseSpec, { kind: 'current', id: 'b-current' }, ward);
  const baseline = buildBoard(baseSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
  const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
  const proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });
  return { ward, current, proposal };
}

function summaryProps(scenario: Scenario, overrides: Partial<SummaryProps> = {}): SummaryProps {
  return {
    proposal: scenario.proposal,
    current: scenario.current,
    ward: scenario.ward,
    importedAt: '2026-10-24T12:00:00Z',
    onExit: () => undefined,
    ...overrides,
  };
}

describe('Summary', () => {
  it('divergence hidden when total 0', () => {
    const scenario = quietScenario();
    render(<Summary {...summaryProps(scenario)} />);

    expect(screen.queryByRole('heading', { name: /Current changed since this baseline/u })).toBeNull();
    expect(screen.queryByText(/this proposal is unchanged/u)).toBeNull();
  });

  it('header: name, baseline-captured subtitle with formatted date, back button, Download CSV', () => {
    const scenario = quietScenario();
    render(<Summary {...summaryProps(scenario)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeInTheDocument();
    expect(screen.getByText('PROPOSAL SUMMARY')).toBeInTheDocument();
    expect(
      screen.getByText('Compared with baseline captured Oct 19, 2026 · net changes only'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to board/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('divergence heading count, three details groups with singular/plural counts, line notes', () => {
    const scenario = divergedScenario();
    const diverged = render(
      <Summary {...summaryProps(scenario, { ward: wardWithRemovedMember(scenario.ward, 'Ann Alpha') })} />,
    );

    const region = screen.getByRole('region', { name: 'Current changed since this baseline · 6 differences' });
    expect(within(region).getByText('Current changed since this baseline · 6 differences')).toBeInTheDocument();
    expect(within(region).getByText('Oct 24, 2026 · this proposal is unchanged')).toBeInTheDocument();

    const summaries = region.querySelectorAll('details > summary');
    expect(summaries).toHaveLength(3);
    expect(Array.from(summaries).map((s) => s.textContent)).toEqual([
      '+Positions added to Current2 positions',
      '−Positions removed from Current3 positions',
      '−Ward member removed1 person',
    ]);
    expect(screen.getAllByText('Not in this proposal')).toHaveLength(2);
    expect(screen.getAllByText('Still vacant in this proposal')).toHaveLength(2);
    expect(screen.getAllByText('Held in this proposal by Bob Beta')).toHaveLength(1);
    expect(screen.getAllByText('Proposed here as Alpha · Alpha One')).toHaveLength(1);
    expect(screen.getAllByText('Proposed here as Alpha · Alpha Extra')).toHaveLength(1);

    // Singular counts on a one-each divergence.
    const baseSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [{ title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', 'Bob Beta', null, null] }],
          },
        ],
      },
    ];
    const singularCurrentSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'list', occupants: ['Ann Alpha', 'Bob Beta', null] },
              { title: 'Alpha New', type: 'list', occupants: ['Dora D'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Dora D']);
    const current = buildBoard(singularCurrentSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baseSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(baseSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });

    // Unmount the first page: both pages share the summary's fixed element
    // ids, and a second mounted page would steal the first one's heading.
    diverged.unmount();
    render(
      <Summary
        {...summaryProps(
          { ward, current, proposal },
          { ward: wardWithRemovedMember(ward, 'Ann Alpha') },
        )}
      />,
    );

    const singularRegion = screen.getByRole('region', { name: 'Current changed since this baseline · 3 differences' });
    const singularSummaries = singularRegion.querySelectorAll('details > summary');
    expect(Array.from(singularSummaries).map((s) => s.textContent)).toEqual([
      '+Positions added to Current1 position',
      '−Positions removed from Current1 position',
      '−Ward member removed1 person',
    ]);
  });

  it('importedAt null omits the date fragment but the section still renders', () => {
    const scenario = divergedScenario();
    const ward = wardWithRemovedMember(scenario.ward, 'Ann Alpha');
    const { rerender } = render(<Summary {...summaryProps(scenario, { ward })} />);

    // With an importedAt the note carries the date.
    expect(screen.getByText('Oct 24, 2026 · this proposal is unchanged')).toBeInTheDocument();

    rerender(<Summary {...summaryProps(scenario, { ward, importedAt: null })} />);
    const region = screen.getByRole('region', { name: 'Current changed since this baseline · 6 differences' });
    expect(within(region).getByText('this proposal is unchanged')).toBeInTheDocument();
    expect(region.textContent).not.toContain('Oct 24, 2026');
  });

  it('rationale section only when present', () => {
    const scenario = quietScenario();
    const { rerender } = render(
      <Summary {...summaryProps(scenario, { proposal: { ...scenario.proposal, rationale: null } })} />,
    );
    expect(screen.queryByText('Rationale')).toBeNull();

    rerender(
      <Summary
        {...summaryProps(scenario, { proposal: { ...scenario.proposal, rationale: 'Fill the teaching gaps.' } })}
      />,
    );
    expect(screen.getByText('Rationale')).toBeInTheDocument();
    expect(screen.getByText('Fill the teaching gaps.')).toBeInTheDocument();

    rerender(
      <Summary {...summaryProps(scenario, { proposal: { ...scenario.proposal, rationale: '   ' } })} />,
    );
    expect(screen.queryByText('Rationale')).toBeNull();
  });

  it('four cards with counts; zero-count card renders the None line', () => {
    const scenario = cardedScenario();
    const { rerender } = render(<Summary {...summaryProps(scenario)} />);

    expect(screen.getByText('+ Suggested callings · 1')).toBeInTheDocument();
    expect(screen.getByText('− Suggested releases · 1')).toBeInTheDocument();
    expect(screen.getByText('Position changes · 2')).toBeInTheDocument();
    expect(screen.getByText('Remaining vacancies · 2')).toBeInTheDocument();
    expect(screen.getByText('Ann Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta · Beta One')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Alpha · Alpha Three')).toBeInTheDocument();
    expect(screen.getByText('Trimmed')).toBeInTheDocument();
    expect(screen.getByText('Gamma · Gamma One')).toBeInTheDocument();
    expect(screen.getByText('Alpha One, Alpha Three')).toBeInTheDocument();
    expect(screen.queryByText('None')).toBeNull();

    const quiet = quietScenario();
    rerender(<Summary {...summaryProps(quiet)} />);
    expect(screen.getByText('+ Suggested callings · 0')).toBeInTheDocument();
    expect(screen.getByText('− Suggested releases · 0')).toBeInTheDocument();
    expect(screen.getByText('Position changes · 0')).toBeInTheDocument();
    expect(screen.getByText('Remaining vacancies · 0')).toBeInTheDocument();
    expect(screen.getAllByText('None')).toHaveLength(4);
  });
});
