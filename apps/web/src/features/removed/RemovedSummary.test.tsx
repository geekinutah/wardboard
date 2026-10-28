import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { memberId, positionId } from '@wardboard/core';
import { RemovedSummary } from './RemovedSummary.tsx';
import type { RemovedRows } from './rows.ts';

const minus = '\u2212';

describe('<RemovedSummary />', () => {
  it('total 0 renders nothing', () => {
    const { container } = render(<RemovedSummary rows={{ members: [], positions: [], total: 0 }} />);

    expect(container.firstChild).toBeNull();
  });

  it('heading count, both subsections with counts, member line and position line texts', () => {
    const rows: RemovedRows = {
      members: [
        {
          memberId: memberId('m-0001'),
          name: 'Jo Testwell',
          removedDate: '2026-01-10',
          positions: [
            { positionId: positionId('p-0001'), title: 'Relief Society Teacher', groupName: 'Relief Society Teachers' },
            { positionId: positionId('p-0002'), title: 'Nursery Leader', groupName: 'Nursery' },
          ],
        },
      ],
      positions: [
        {
          positionId: positionId('p-0003'),
          title: 'Relief Society Teacher',
          groupName: 'Relief Society Teachers',
          occupantName: 'Kit Notreal',
        },
      ],
      total: 2,
    };

    render(<RemovedSummary rows={rows} />);

    // Heading carries the total (affected members + affected positions, not lines).
    expect(screen.getByRole('heading', { name: `Removed from Current since this baseline · ${String(2)}` })).toBeInTheDocument();

    // Member subsection: title, count, and one line per member-and-position
    // (Jo holds two placements, so her name appears on two lines).
    expect(screen.getByText('Ward member removed')).toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();
    expect(screen.getAllByText(`${minus} Jo Testwell`, { exact: true })).toHaveLength(2);
    expect(screen.getByText('proposed here as Relief Society Teacher')).toBeInTheDocument();
    expect(screen.getByText('proposed here as Nursery Leader')).toBeInTheDocument();

    // Position subsection: title, count, and the line with its occupant.
    expect(screen.getByText('Position removed')).toBeInTheDocument();
    expect(screen.getByText('1 position')).toBeInTheDocument();
    expect(screen.getByText(`${minus} Relief Society Teachers · Relief Society Teacher`, { exact: true })).toBeInTheDocument();
    expect(screen.getByText('held here by Kit Notreal')).toBeInTheDocument();
  });

  it('only positions → no member subsection', () => {
    const rows: RemovedRows = {
      members: [],
      positions: [
        { positionId: positionId('p-0001'), title: 'Music Coordinator', groupName: 'Music', occupantName: 'Flo Madeup' },
      ],
      total: 1,
    };

    render(<RemovedSummary rows={rows} />);

    expect(screen.getByRole('heading', { name: 'Removed from Current since this baseline · 1' })).toBeInTheDocument();
    expect(screen.queryByText('Ward member removed')).toBeNull();
    expect(screen.getByText('Position removed')).toBeInTheDocument();
    expect(screen.getByText(`${minus} Music · Music Coordinator`, { exact: true })).toBeInTheDocument();
    expect(screen.getByText('held here by Flo Madeup')).toBeInTheDocument();
  });

  it('vacant removed position line omits the held-by note', () => {
    const rows: RemovedRows = {
      members: [],
      positions: [
        { positionId: positionId('p-0001'), title: 'Second Counselor', groupName: 'Primary Presidency', occupantName: null },
      ],
      total: 1,
    };

    render(<RemovedSummary rows={rows} />);

    expect(screen.getByText(`${minus} Primary Presidency · Second Counselor`, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/held here by/u)).toBeNull();
  });
});
