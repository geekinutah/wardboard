import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CurrentReadOnlyBar } from './CurrentReadOnlyBar.tsx';

describe('CurrentReadOnlyBar', () => {
  it('shows Read-only with the UTC import date', () => {
    render(
      <CurrentReadOnlyBar importedAt="2026-10-24T23:30:00-07:00" onStartProposal={() => undefined} />,
    );

    const bar = screen.getByRole('region', { name: 'Current is read-only' });
    expect(bar).toHaveTextContent('Current');
    expect(bar).toHaveTextContent('Read-only · imported Oct 25, 2026');
    expect(bar).toHaveTextContent("Current can't be edited. Start a proposal to plan changes.");
    expect(bar).not.toHaveTextContent('Oct 24, 2026');
  });

  it('an invalid import date says import date unknown', () => {
    render(<CurrentReadOnlyBar importedAt="not a date" onStartProposal={() => undefined} />);

    const bar = screen.getByRole('region', { name: 'Current is read-only' });
    expect(bar).toHaveTextContent('Read-only · import date unknown');
    expect(bar).not.toHaveTextContent('Invalid Date');
  });

  it('Start proposal calls back once', async () => {
    const user = userEvent.setup();
    const onStartProposal = vi.fn();
    render(<CurrentReadOnlyBar importedAt="2026-10-24T15:00:00.000Z" onStartProposal={onStartProposal} />);

    await user.click(screen.getByRole('button', { name: 'Start proposal' }));
    await user.click(screen.getByRole('button', { name: 'Start proposal' }));

    expect(onStartProposal).toHaveBeenCalledTimes(2);
  });
});
