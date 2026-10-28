import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneShell, type PhoneShellProps } from './PhoneShell.tsx';
import type { BoardEntry } from './summary.ts';

const fixtureBoards: BoardEntry[] = [
  {
    id: 'b-current',
    kind: 'current',
    name: 'Current',
    status: 'current',
    importedAt: '2026-10-24T12:00:00Z',
    changeCount: 0,
    removedCount: 0,
  },
  {
    id: 'b-spring',
    kind: 'proposal',
    name: 'Spring adjustments',
    status: 'draft',
    importedAt: null,
    changeCount: 7,
    removedCount: 2,
  },
  {
    id: 'b-youth',
    kind: 'proposal',
    name: 'Youth focus',
    status: 'accepted',
    importedAt: null,
    changeCount: 0,
    removedCount: 0,
  },
];

function renderShell(overrides: Partial<PhoneShellProps> = {}) {
  const props: PhoneShellProps = {
    boards: fixtureBoards,
    activeBoardId: 'b-spring',
    summary: '+4 callings · −3 releases · 20 vacant',
    activeTab: 'board',
    onTabChange: vi.fn(),
    dugoutCount: 14,
    onSelectBoard: vi.fn(),
    onStartProposal: vi.fn(),
    canStartProposal: true,
    children: <div>Active tab child content</div>,
    ...overrides,
  };
  const result = render(<PhoneShell {...props} />);
  return { ...result, props };
}

describe('PhoneShell', () => {
  it('header shows status text, board name and summary', () => {
    // 1. Draft proposal
    const { rerender } = renderShell({
      activeBoardId: 'b-spring',
      summary: '+4 callings · −3 releases · 20 vacant',
    });
    expect(screen.getByText('PROPOSED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeInTheDocument();
    expect(screen.getByText('+4 callings · −3 releases · 20 vacant')).toBeInTheDocument();

    // 2. Accepted proposal
    rerender(
      <PhoneShell
        boards={fixtureBoards}
        activeBoardId="b-youth"
        summary="+0 callings · −0 releases · 20 vacant"
        activeTab="board"
        onTabChange={vi.fn()}
        dugoutCount={14}
        onSelectBoard={vi.fn()}
        onStartProposal={vi.fn()}
        canStartProposal={true}
      >
        <div>Content</div>
      </PhoneShell>,
    );
    expect(screen.getByText('ACCEPTED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Youth focus' })).toBeInTheDocument();

    // 3. Current board
    rerender(
      <PhoneShell
        boards={fixtureBoards}
        activeBoardId="b-current"
        summary="20 vacant"
        activeTab="board"
        onTabChange={vi.fn()}
        dugoutCount={14}
        onSelectBoard={vi.fn()}
        onStartProposal={vi.fn()}
        canStartProposal={true}
      >
        <div>Content</div>
      </PhoneShell>,
    );
    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Current' })).toBeInTheDocument();
    expect(screen.getByText('20 vacant')).toBeInTheDocument();
  });

  it('tabs show counts and mark the active tab', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    // On proposal: Dugout · 14, Changes · 7
    const { rerender } = renderShell({
      activeBoardId: 'b-spring',
      activeTab: 'board',
      dugoutCount: 14,
      onTabChange,
    });

    const boardTab = screen.getByRole('button', { name: 'Board' });
    const searchTab = screen.getByRole('button', { name: 'Search' });
    const dugoutTab = screen.getByRole('button', { name: 'Dugout · 14' });
    const changesTab = screen.getByRole('button', { name: 'Changes · 7' });

    expect(boardTab).toHaveAttribute('aria-current', 'page');
    expect(searchTab).not.toHaveAttribute('aria-current');
    expect(dugoutTab).not.toHaveAttribute('aria-current');
    expect(changesTab).not.toHaveAttribute('aria-current');

    await user.click(searchTab);
    expect(onTabChange).toHaveBeenCalledWith('search');

    // On Current board: Changes has no count
    rerender(
      <PhoneShell
        boards={fixtureBoards}
        activeBoardId="b-current"
        summary="20 vacant"
        activeTab="changes"
        onTabChange={onTabChange}
        dugoutCount={14}
        onSelectBoard={vi.fn()}
        onStartProposal={vi.fn()}
        canStartProposal={true}
      >
        <div>Content</div>
      </PhoneShell>,
    );

    const changesCurrentTab = screen.getByRole('button', { name: 'Changes' });
    expect(changesCurrentTab).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /Changes ·/ })).not.toBeInTheDocument();
  });

  it('switcher lists Current and proposals and marks the viewed board', async () => {
    const user = userEvent.setup();
    renderShell({ activeBoardId: 'b-spring' });

    // Open via header button
    const headerBtn = screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    });
    await user.click(headerBtn);

    const dialog = screen.getByRole('dialog', { name: 'Boards' });
    expect(dialog).toBeInTheDocument();

    // Check Current option
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Read-only · imported Oct 24')).toBeInTheDocument();

    // Check heading Proposals
    expect(screen.getByRole('heading', { level: 3, name: 'Proposals' })).toBeInTheDocument();

    // Check proposals listed in given order
    const springOption = within(dialog).getByRole('button', { name: /Spring adjustments/ });
    const youthOption = within(dialog).getByRole('button', { name: /Youth focus/ });
    expect(springOption).toBeInTheDocument();
    expect(youthOption).toBeInTheDocument();

    // Spring adjustments is active -> aria-current="page" and visible "Viewing" text
    expect(springOption).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Viewing')).toBeInTheDocument();
    expect(youthOption).not.toHaveAttribute('aria-current');
  });

  it('choosing another board selects it once and closes', async () => {
    const user = userEvent.setup();
    const onSelectBoard = vi.fn();
    renderShell({ activeBoardId: 'b-spring', onSelectBoard });

    const headerBtn = screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    });
    await user.click(headerBtn);

    const dialog = screen.getByRole('dialog', { name: 'Boards' });
    const youthOption = within(dialog).getByRole('button', { name: /Youth focus/ });
    await user.click(youthOption);

    expect(onSelectBoard).toHaveBeenCalledTimes(1);
    expect(onSelectBoard).toHaveBeenCalledWith('b-youth');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(headerBtn).toHaveFocus();
  });

  it('choosing the viewed board just closes', async () => {
    const user = userEvent.setup();
    const onSelectBoard = vi.fn();
    renderShell({ activeBoardId: 'b-spring', onSelectBoard });

    const headerBtn = screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    });
    await user.click(headerBtn);

    const dialog = screen.getByRole('dialog', { name: 'Boards' });
    const springOption = within(dialog).getByRole('button', { name: /Spring adjustments/ });
    await user.click(springOption);

    expect(onSelectBoard).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(headerBtn).toHaveFocus();
  });

  it('Start proposal calls back and closes; hidden when not allowed', async () => {
    const user = userEvent.setup();
    const onStartProposal = vi.fn();

    // Allowed:
    const { rerender } = renderShell({
      canStartProposal: true,
      onStartProposal,
    });

    const headerBtn = screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    });
    await user.click(headerBtn);

    const startBtn = screen.getByRole('button', { name: 'Start proposal' });
    await user.click(startBtn);

    expect(onStartProposal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Not allowed:
    rerender(
      <PhoneShell
        boards={fixtureBoards}
        activeBoardId="b-spring"
        summary="+4 callings · −3 releases · 20 vacant"
        activeTab="board"
        onTabChange={vi.fn()}
        dugoutCount={14}
        onSelectBoard={vi.fn()}
        onStartProposal={onStartProposal}
        canStartProposal={false}
      >
        <div>Content</div>
      </PhoneShell>,
    );

    await user.click(screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    }));
    expect(screen.queryByRole('button', { name: 'Start proposal' })).not.toBeInTheDocument();
  });

  it('Close and Escape close without calling back', async () => {
    const user = userEvent.setup();
    const onSelectBoard = vi.fn();
    const onStartProposal = vi.fn();
    renderShell({ onSelectBoard, onStartProposal });

    const headerBtn = screen.getByRole('button', {
      name: 'Switch board, current board Spring adjustments',
    });

    // 1. Close button
    await user.click(headerBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await user.click(closeBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSelectBoard).not.toHaveBeenCalled();
    expect(onStartProposal).not.toHaveBeenCalled();
    expect(headerBtn).toHaveFocus();

    // 2. Escape key
    await user.click(headerBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSelectBoard).not.toHaveBeenCalled();
    expect(onStartProposal).not.toHaveBeenCalled();
    expect(headerBtn).toHaveFocus();
  });

  it('no proposals shows the empty text', async () => {
    const user = userEvent.setup();
    renderShell({
      boards: fixtureBoards.slice(0, 1), // only Current
      activeBoardId: 'b-current',
    });

    await user.click(screen.getByRole('button', {
      name: 'Switch board, current board Current',
    }));

    expect(screen.getByText('No proposals yet.')).toBeInTheDocument();
  });

  it('unknown active board id renders Unknown board without throwing', async () => {
    const user = userEvent.setup();
    renderShell({ activeBoardId: 'b-missing' });

    expect(screen.getByRole('heading', { level: 1, name: 'Unknown board' })).toBeInTheDocument();
    expect(screen.queryByText('PROPOSED')).not.toBeInTheDocument();
    expect(screen.queryByText('ACCEPTED')).not.toBeInTheDocument();
    expect(screen.queryByText('CURRENT')).not.toBeInTheDocument();

    // Clicking switcher trigger still works without throwing
    const switcherTrigger = screen.getByRole('button', {
      name: 'Switch board, current board Unknown board',
    });
    await user.click(switcherTrigger);
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument();
  });

  it('renders children for the active tab', () => {
    renderShell({ children: <div data-testid="test-child">Child tab body</div> });
    expect(screen.getByTestId('test-child')).toHaveTextContent('Child tab body');
  });
});
