import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { memberId, type Member, type Ward } from '@wardboard/core';
import { OutOfUnitTile } from './OutOfUnitTile.tsx';

describe('OutOfUnitTile', () => {
  it('tile counts and names the out-of-unit members', () => {
    const { ward } = buildFixtureWard();
    const onOpen = vi.fn();
    render(<OutOfUnitTile ward={ward} onOpen={onOpen} />);

    expect(screen.getByText('2 members serving outside the ward')).toBeInTheDocument();
    expect(screen.getByText('Hal Testwell')).toBeInTheDocument();
    expect(screen.getByText('Kai Fictional')).toBeInTheDocument();
    expect(screen.getByText('Outside the ward')).toBeInTheDocument();
  });

  it('tile pluralizes, truncates and handles none', () => {
    const { ward } = buildFixtureWard();
    const onOpen = vi.fn();

    // 1 member
    const oneWard: Ward = {
      ...ward,
      members: Object.fromEntries(
        Object.entries(ward.members).map(([id, m]) => [
          id,
          m.name === 'Hal Testwell' ? m : { ...m, externalCallings: [] },
        ]),
      ),
    };
    const { rerender } = render(<OutOfUnitTile ward={oneWard} onOpen={onOpen} />);
    expect(screen.getByText('1 member serving outside the ward')).toBeInTheDocument();

    // 5 members
    const fiveMembers: Record<string, Member> = {
      ...ward.members,
      [memberId('m-1')]: {
        id: memberId('m-1'),
        name: 'Alpha One',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [{ unit: 'Stake', title: 'Adviser 1' }],
      },
      [memberId('m-2')]: {
        id: memberId('m-2'),
        name: 'Beta Two',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [{ unit: 'Stake', title: 'Adviser 2' }],
      },
      [memberId('m-3')]: {
        id: memberId('m-3'),
        name: 'Delta Four',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [{ unit: 'Stake', title: 'Adviser 4' }],
      },
      [memberId('m-4')]: {
        id: memberId('m-4'),
        name: 'Epsilon Five',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [{ unit: 'Stake', title: 'Adviser 5' }],
      },
      [memberId('m-5')]: {
        id: memberId('m-5'),
        name: 'Gamma Three',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [{ unit: 'Stake', title: 'Adviser 3' }],
      },
    };
    // remove externalCallings from others so exactly these 5 exist
    const fiveWard: Ward = {
      ...ward,
      members: Object.fromEntries(
        Object.entries(fiveMembers).map(([id, m]) => [
          id,
          ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'].includes(id)
            ? m
            : { ...m, externalCallings: [] },
        ]),
      ),
    };
    rerender(<OutOfUnitTile ward={fiveWard} onOpen={onOpen} />);
    expect(screen.getByText('5 members serving outside the ward')).toBeInTheDocument();
    // 3 names shown, and +2 more
    expect(screen.getByText('Alpha One')).toBeInTheDocument();
    expect(screen.getByText('Beta Two')).toBeInTheDocument();
    expect(screen.getByText('Delta Four')).toBeInTheDocument();
    expect(screen.queryByText('Epsilon Five')).not.toBeInTheDocument();
    expect(screen.queryByText('Gamma Three')).not.toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();

    // 0 members
    const zeroWard: Ward = {
      ...ward,
      members: Object.fromEntries(
        Object.entries(ward.members).map(([id, m]) => [
          id,
          { ...m, externalCallings: [] },
        ]),
      ),
    };
    rerender(<OutOfUnitTile ward={zeroWard} onOpen={onOpen} />);
    expect(screen.getByText('No members serving outside the ward')).toBeInTheDocument();
  });

  it('tile opens by button and double-click', async () => {
    const user = userEvent.setup();
    const { ward } = buildFixtureWard();
    const onOpen = vi.fn();
    render(<OutOfUnitTile ward={ward} onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: 'Open Out-of-Unit' });
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const tile = screen.getByRole('article', { name: 'Out-of-Unit' });
    await user.dblClick(tile);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
