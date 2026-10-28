import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  boardGroupId,
  diffBoards,
  vacancies,
  wardOverview,
  type Board,
  type Member,
  type MemberId,
  type OverviewLeader,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { Presentation, type PresentationProps } from './Presentation.tsx';

const MINUS = '\u2212';
const LONG_NOTE = `LONG ${'L'.repeat(275)}`;

const INTERACTIVE =
  'button, a, input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]';

function required<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function isFilled(leader: OverviewLeader): leader is OverviewLeader & { readonly memberId: MemberId } {
  return leader.memberId !== null;
}

function presentationProps(overrides: Partial<PresentationProps> = {}): PresentationProps {
  const data = buildPreviewData();
  return {
    board: data.proposal.board,
    ward: data.ward,
    baseline: data.proposal.baseline,
    title: data.proposal.name,
    status: 'draft',
    baselineCapturedAt: '2026-10-19T02:00:00Z',
    showNeedsApproval: false,
    onExit: () => undefined,
    ...overrides,
  };
}

function expectHeaderCounts(board: Board, baseline: Board): void {
  const diff = diffBoards(baseline, board);
  const vacant = vacancies(board).length;
  const header = within(screen.getByRole('banner'));
  expect(header.getByText(`+${String(diff.callings.length)} callings`)).toBeInTheDocument();
  expect(header.getByText(`${MINUS}${String(diff.releases.length)} releases`)).toBeInTheDocument();
  expect(header.getByText(`${String(vacant)} vacant`)).toBeInTheDocument();
}

function leaderVacantInBoth(board: Board, baseline: Board): OverviewLeader {
  const vacantNow = new Set(
    wardOverview(board, null)
      .flatMap((tile) => tile.leaders)
      .filter((leader) => leader.memberId === null)
      .map((leader) => leader.positionId),
  );
  const match = wardOverview(baseline, null)
    .flatMap((tile) => tile.leaders)
    .find((leader) => leader.memberId === null && vacantNow.has(leader.positionId));
  return required(match, 'expected a leader slot vacant in both the board and the baseline');
}

function withExtraCalling(board: Board, baseline: Board, ward: Ward): Board {
  const open = leaderVacantInBoth(board, baseline);
  const member = required(
    Object.values(ward.members).find((item) => item.name === 'Liv Example'),
    'missing Liv Example',
  );
  return {
    ...board,
    placements: { ...board.placements, [open.positionId]: member.id },
  };
}

describe('Presentation', () => {
  it('header shows PROPOSED, title and +callings/−releases/vacant from core', () => {
    const data = buildPreviewData();
    const props = presentationProps({
      board: data.proposal.board,
      ward: data.ward,
      baseline: data.proposal.baseline,
      title: data.proposal.name,
    });
    const { rerender } = render(<Presentation {...props} />);

    const header = screen.getByRole('banner');
    expect(within(header).getByText('PROPOSED')).toBeInTheDocument();
    expect(within(header).getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();
    expectHeaderCounts(data.proposal.board, data.proposal.baseline);
    expect(screen.getByText('Baseline Oct 19, 2026')).toBeInTheDocument();
    expect(screen.getByText('Ring = proposed change')).toBeInTheDocument();

    const extra = withExtraCalling(data.proposal.board, data.proposal.baseline, data.ward);
    rerender(<Presentation {...props} board={extra} />);
    expectHeaderCounts(extra, data.proposal.baseline);
    expect(diffBoards(data.proposal.baseline, extra).callings.length).not.toBe(
      diffBoards(data.proposal.baseline, data.proposal.board).callings.length,
    );

    rerender(<Presentation {...props} status="accepted" />);
    expect(screen.getByText('ACCEPTED')).toBeInTheDocument();
    expect(screen.queryByText('PROPOSED')).toBeNull();
  });

  it('Current (baseline null) hides callings/releases and shows CURRENT', () => {
    const data = buildPreviewData();
    const board = data.current;
    const vacant = vacancies(board).length;
    expect(vacant).toBeGreaterThan(0);
    const { container } = render(
      <Presentation
        {...presentationProps({
          board,
          baseline: null,
          title: 'Current',
          status: 'current',
          baselineCapturedAt: null,
        })}
      />,
    );

    const header = screen.getByRole('banner');
    expect(within(header).getByText('CURRENT')).toBeInTheDocument();
    expect(within(header).getByRole('heading', { level: 1, name: 'Current' })).toBeInTheDocument();
    expect(within(header).getByText(`${String(vacant)} vacant`)).toBeInTheDocument();
    expect(header.textContent).not.toMatch(/\d+ callings/u);
    expect(header.textContent).not.toMatch(/\d+ releases/u);
    expect(container.textContent).not.toContain('NaN');
    expect(screen.queryByText(/Baseline /u)).toBeNull();
    expect(screen.getByText('Ring = proposed change')).toBeInTheDocument();
  });

  it('edge: no vacancies renders 0 vacant', () => {
    const data = buildPreviewData();
    const groupId = boardGroupId('bg-full');
    const board: Board = {
      ...data.current,
      boardGroups: {
        [groupId]: {
          id: groupId,
          name: 'Full Organization',
          order: 1,
          visible: true,
          key: null,
        },
      },
      callingGroups: {},
      assignments: {},
      positions: {},
      placements: {},
    };
    expect(vacancies(board)).toHaveLength(0);

    render(
      <Presentation
        {...presentationProps({
          board,
          baseline: null,
          title: 'Current',
          status: 'current',
          baselineCapturedAt: null,
        })}
      />,
    );

    const labels = screen.getAllByText('0 vacant');
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('banner')).toHaveTextContent('0 vacant');
    expect(screen.getByRole('heading', { name: 'Full Organization' })).toBeInTheDocument();
  });

  it('note text of every member never appears in the DOM', () => {
    const data = buildPreviewData();
    const members: Record<MemberId, Member> = { ...data.ward.members };
    const notes: string[] = [];
    for (const member of Object.values(data.ward.members)) {
      const note = member.note ?? `fixture-note-${member.id}`;
      notes.push(note);
      members[member.id] = { ...member, note };
    }
    const filled = wardOverview(data.proposal.board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .filter(isFilled);
    const leader = required(filled[0], 'expected a filled leader');
    const leaderMember = required(members[leader.memberId], 'missing leader member');
    expect(LONG_NOTE).toHaveLength(280);
    members[leader.memberId] = { ...leaderMember, note: LONG_NOTE };
    notes.push(LONG_NOTE);

    const { container } = render(
      <Presentation
        {...presentationProps({
          ward: { ...data.ward, members },
        })}
      />,
    );

    expect(screen.getByText(leaderMember.name)).toBeInTheDocument();
    const text = container.textContent;
    for (const note of notes) {
      expect(note.length).toBeGreaterThan(0);
      expect(text).not.toContain(note);
      expect(container.innerHTML).not.toContain(note);
    }
  });

  it('edge: a long note on a visible leader never appears', () => {
    const data = buildPreviewData();
    const filled = wardOverview(data.proposal.board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .filter(isFilled);
    const leader = required(filled[0], 'expected a filled leader');
    const member = required(data.ward.members[leader.memberId], 'missing leader member');
    expect(LONG_NOTE).toHaveLength(280);
    const ward: Ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [member.id]: { ...member, note: LONG_NOTE },
      },
    };

    const { container } = render(<Presentation {...presentationProps({ ward })} />);

    expect(screen.getByText(member.name)).toBeInTheDocument();
    expect(container.textContent).not.toContain(LONG_NOTE);
    expect(container.innerHTML).not.toContain(LONG_NOTE);
  });

  it('needs approval text absent (not hidden) when setting off; present when on', () => {
    const data = buildPreviewData();
    const filled = wardOverview(data.proposal.board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .filter(isFilled);
    const leader = required(filled[0], 'expected a filled leader');
    const member = required(data.ward.members[leader.memberId], 'missing leader member');
    const ward: Ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [member.id]: { ...member, needsApproval: true },
      },
    };
    const flagged = wardOverview(data.proposal.board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .filter(isFilled)
      .filter((item) => ward.members[item.memberId]?.needsApproval === true);
    expect(flagged.length).toBeGreaterThan(0);

    const props = presentationProps({ ward, showNeedsApproval: false });
    const { container, rerender } = render(<Presentation {...props} />);
    expect(container.innerHTML.toLowerCase()).not.toContain('needs approval');
    expect(screen.getByText(member.name)).toBeInTheDocument();

    rerender(<Presentation {...props} showNeedsApproval />);
    const marks = screen.getAllByText('Needs approval');
    expect(marks).toHaveLength(flagged.length);
    for (const mark of marks) {
      expect(mark).toBeVisible();
    }
  });

  it('proposed leader shows the Proposed text; vacant leader shows Vacant', () => {
    const data = buildPreviewData();
    const open = leaderVacantInBoth(data.proposal.board, data.proposal.baseline);
    const member = required(
      Object.values(data.ward.members).find((item) => item.name === 'Liv Example'),
      'missing Liv Example',
    );
    const board: Board = {
      ...data.proposal.board,
      placements: { ...data.proposal.board.placements, [open.positionId]: member.id },
    };
    const stillVacant = wardOverview(board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .some((leader) => leader.memberId === null);
    expect(stillVacant).toBe(true);
    const proposed = wardOverview(board, data.proposal.baseline)
      .flatMap((tile) => tile.leaders)
      .some((leader) => leader.proposed && leader.memberId === member.id);
    expect(proposed).toBe(true);

    render(
      <Presentation
        {...presentationProps({
          board,
          baseline: data.proposal.baseline,
        })}
      />,
    );

    expect(screen.getAllByText('Proposed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vacant').length).toBeGreaterThan(0);
    expect(screen.getByText('Liv Example')).toBeInTheDocument();
  });

  it('tags of leaders are shown', () => {
    const data = buildPreviewData();
    const tagNames = new Set<string>();
    for (const leader of wardOverview(data.proposal.board, data.proposal.baseline).flatMap((tile) => tile.leaders)) {
      if (leader.memberId === null) continue;
      const member = data.ward.members[leader.memberId];
      if (member === undefined) continue;
      for (const tagId of member.tagIds) {
        const tag = data.ward.tags[tagId];
        if (tag !== undefined) tagNames.add(tag.name);
      }
    }
    expect(tagNames.size).toBeGreaterThan(0);

    render(<Presentation {...presentationProps()} />);

    for (const name of tagNames) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it('only Exit is interactive; Exit and Escape call onExit', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const { container } = render(<Presentation {...presentationProps({ onExit })} />);

    const interactive = container.querySelectorAll(INTERACTIVE);
    expect(interactive).toHaveLength(1);
    expect(interactive[0]).toHaveAccessibleName('Exit presentation');

    await user.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(onExit).toHaveBeenCalledTimes(2);

    await user.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(3);
  });

  it('hidden board groups are not shown', () => {
    const data = buildPreviewData();
    const bishopric = required(
      Object.values(data.proposal.board.boardGroups).find((group) => group.name === 'Bishopric'),
      'missing Bishopric',
    );
    const board: Board = {
      ...data.proposal.board,
      boardGroups: {
        ...data.proposal.board.boardGroups,
        [bishopric.id]: { ...bishopric, visible: false },
      },
    };
    const hiddenNames = wardOverview(data.proposal.board, data.proposal.baseline)
      .filter((tile) => tile.boardGroupId === bishopric.id)
      .flatMap((tile) => tile.leaders)
      .filter(isFilled)
      .map((leader) => required(data.ward.members[leader.memberId], 'missing member').name);
    expect(hiddenNames).toContain('Ada Fictional');

    render(<Presentation {...presentationProps({ board })} />);

    expect(screen.queryByRole('heading', { name: 'Bishopric' })).toBeNull();
    for (const name of hiddenNames) {
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(screen.getByRole('heading', { name: 'Relief Society' })).toBeInTheDocument();
    expect(screen.getByText('Hana Madeup')).toBeInTheDocument();
  });
});
