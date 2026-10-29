import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildPreviewData } from '../../preview/data.ts';
import { PhoneBoard } from './PhoneBoard.tsx';

describe('PhoneBoard optional Add position', () => {
  it('organization screen hides Add position without onAddPosition', async () => {
    const user = userEvent.setup();
    const data = buildPreviewData();
    const primary = Object.values(data.proposal.board.boardGroups).find((group) => group.name === 'Primary');
    if (primary === undefined) throw new Error('missing Primary');
    const teachers = Object.values(data.proposal.board.callingGroups).find((group) => group.name === 'Primary Teachers');
    if (teachers === undefined) throw new Error('missing Primary Teachers');
    const common = {
      board: data.proposal.board,
      baseline: data.proposal.baseline,
      ward: data.ward,
      editable: true,
      onOpenPerson: vi.fn(),
      onOpenVacancy: vi.fn(),
      initialScreen: { kind: 'organization', boardGroupId: primary.id } as const,
    };

    const { rerender } = render(<PhoneBoard {...common} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    // Still editable: vacancies open, but there is no dead Add position control.
    expect(screen.getByRole('button', { name: 'Vacant, Secretary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add (a )?position/ })).not.toBeInTheDocument();

    const onAddPosition = vi.fn();
    rerender(<PhoneBoard {...common} onAddPosition={onAddPosition} />);
    await user.click(screen.getByRole('button', { name: 'Add a position to Primary Teachers' }));
    expect(onAddPosition).toHaveBeenCalledWith(teachers.id);
  });
});
