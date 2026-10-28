import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { memberId, positionId, summaryAllText, summaryText, type SummaryGroup } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { AcceptedView, type AcceptedViewProps } from './AcceptedView.tsx';

function line(n: number, name: string, text: string) {
  return { memberId: memberId(`m-000${String(n)}`), name, positionId: positionId(`p-000${String(n)}`), text };
}

const GROUPS: SummaryGroup[] = [
  {
    key: 'bishop',
    heading: 'Bishop · D. Halvorsen',
    callings: [line(1, 'Kim Nguyen', 'Kim Nguyen as Relief Society Teacher')],
    releases: [],
  },
  {
    key: 'first_counselor',
    heading: '1st Counselor · J. Okafor',
    callings: [],
    releases: [line(2, 'Ravi Mendes', 'Ravi Mendes from Sunday School Teacher')],
  },
];

const OK = { ok: true } as RequestResult;

const HISTORY = [
  { id: 'old', name: 'Elders Quorum reorganization', acceptedAt: '2026-04-03T18:00:00Z' },
  { id: 'cur', name: 'Spring adjustments', acceptedAt: '2026-10-26T18:00:00Z' },
  { id: 'mid', name: 'Summer youth leaders', acceptedAt: '2026-07-12T18:00:00Z' },
];

function props(overrides: Partial<AcceptedViewProps> = {}): AcceptedViewProps {
  return {
    history: HISTORY,
    selectedId: 'cur',
    proposal: {
      name: 'Spring adjustments',
      status: 'accepted',
      accepted: { byLogin: 'mike.s', at: '2026-10-26T18:00:00Z', summary: GROUPS },
    },
    blockReasons: [],
    onSelect: vi.fn(),
    onSetStatus: vi.fn((): Promise<RequestResult> => Promise.resolve(OK)),
    copy: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(),
    ...overrides,
  };
}

function draft(overrides: Partial<AcceptedViewProps> = {}): AcceptedViewProps {
  return props({ proposal: { name: 'Spring adjustments', status: 'draft', accepted: null }, ...overrides });
}

describe('AcceptedView', () => {
  it('accepted header: badge, name, "Accepted {date} by {login} · read-only"', () => {
    render(<AcceptedView {...props()} />);
    expect(screen.getByText('ACCEPTED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeInTheDocument();
    expect(screen.getByText('Accepted Oct 26, 2026 by mike.s · read-only')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('accepted');
  });

  it('omits the date from the subtitle when accepted.at is unparseable', () => {
    render(
      <AcceptedView
        {...props({ proposal: { name: 'X', status: 'accepted', accepted: { byLogin: 'mike.s', at: 'junk', summary: GROUPS } } })}
      />,
    );
    expect(screen.getByText('Accepted by mike.s · read-only')).toBeInTheDocument();
  });

  it('one section per frozen group with the core summaryText and Copy {heading}', () => {
    render(<AcceptedView {...props()} />);
    for (const group of GROUPS) {
      const section = screen.getByRole('region', { name: group.heading });
      expect(within(section).getByRole('heading', { level: 3, name: group.heading })).toBeInTheDocument();
      const pre = section.querySelector('pre');
      expect(pre?.textContent).toBe(summaryText(group));
      const button = within(section).getByRole('button', { name: `Copy ${group.heading}` });
      expect(button).toHaveTextContent('Copy');
    }
    expect(screen.getByText('Callings & releases by bishopric member')).toBeInTheDocument();
    expect(screen.getByText('Grouped by who extends each calling.')).toBeInTheDocument();
  });

  it('Copy and Copy all pass the core texts to copy and show Copied', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<AcceptedView {...p} />);
    const first = screen.getByRole('button', { name: `Copy ${GROUPS[0]?.heading ?? ''}` });
    await user.click(first);
    expect(p.copy).toHaveBeenLastCalledWith(summaryText(GROUPS[0] as SummaryGroup));
    await waitFor(() => {
      expect(first).toHaveTextContent('Copied');
    });
    expect(screen.getByRole('status')).toHaveTextContent(`Copied ${GROUPS[0]?.heading ?? ''}`);

    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(p.copy).toHaveBeenLastCalledWith(summaryAllText(GROUPS));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Copied all');
    });
    // Another copy happened, so the first button is back to Copy.
    expect(first).toHaveTextContent(/^Copy$/u);
  });

  it('copy rejection shows the manual-copy alert', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(() => Promise.reject(new Error('denied')));
    render(<AcceptedView {...props({ copy })} />);
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't copy. Select the text and copy it manually.");
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it("choosing Draft calls onSetStatus('draft'); refusal shows alert and select reverts", async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn((): Promise<RequestResult> =>
      Promise.resolve({ ok: false, code: 'forbidden', message: 'Only an admin can reopen.' }),
    );
    render(<AcceptedView {...props({ onSetStatus })} />);
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    expect(onSetStatus).toHaveBeenCalledWith('draft');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can reopen.');
    expect(screen.getByLabelText('Status')).toHaveValue('accepted');
    expect(screen.getByLabelText('Status')).toBeEnabled();
  });

  it('disables the select while a status change is pending', async () => {
    const user = userEvent.setup();
    let resolve: (value: RequestResult) => void = () => undefined;
    const onSetStatus = vi.fn(
      () =>
        new Promise<RequestResult>((r) => {
          resolve = r;
        }),
    );
    render(<AcceptedView {...props({ onSetStatus })} />);
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    expect(screen.getByLabelText('Status')).toBeDisabled();
    resolve(OK);
    await waitFor(() => {
      expect(screen.getByLabelText('Status')).toBeEnabled();
    });
  });

  it("draft with reasons: Accepted option disabled and Can't accept yet lists reasons", () => {
    render(<AcceptedView {...draft({ blockReasons: ['Ann Alpha is no longer in the ward', 'Bob Beta needs approval as Alpha · Alpha Two'] })} />);
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Draft (editable)' })).toBeEnabled();
    const section = screen.getByRole('region', { name: "Can't accept yet" });
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Ann Alpha is no longer in the ward', 'Bob Beta needs approval as Alpha · Alpha Two']);
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('Draft · editable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy all' })).not.toBeInTheDocument();
  });

  it("draft without reasons: choosing Accepted calls onSetStatus('accepted')", async () => {
    const user = userEvent.setup();
    const p = draft();
    render(<AcceptedView {...p} />);
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).toBeEnabled();
    expect(screen.queryByText("Can't accept yet")).not.toBeInTheDocument();
    expect(screen.getByText('Accepting freezes a callings-and-releases summary for each bishopric member.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'accepted');
    expect(p.onSetStatus).toHaveBeenCalledWith('accepted');
  });

  it('sidebar: sorted history, aria-current on selected, click calls onSelect; empty text', async () => {
    const user = userEvent.setup();
    const p = props();
    const { unmount } = render(<AcceptedView {...p} />);
    const nav = screen.getByRole('navigation', { name: 'Accepted proposals' });
    expect(within(nav).getByRole('heading', { name: 'Accepted proposals' })).toBeInTheDocument();
    const entries = within(nav).getAllByRole('button').filter((b) => b.textContent !== '← Back to board');
    expect(entries.map((b) => b.textContent)).toEqual([
      'Spring adjustmentsAccepted Oct 26, 2026',
      'Summer youth leadersAccepted Jul 12, 2026',
      'Elders Quorum reorganizationAccepted Apr 3, 2026',
    ]);
    expect(entries[0]).toHaveAttribute('aria-current', 'page');
    expect(entries[1]).not.toHaveAttribute('aria-current');
    await user.click(entries[1] as HTMLElement);
    expect(p.onSelect).toHaveBeenCalledWith('mid');
    await user.click(within(nav).getByRole('button', { name: '← Back to board' }));
    expect(p.onExit).toHaveBeenCalledTimes(1);
    unmount();

    render(<AcceptedView {...props({ history: [], selectedId: null, proposal: null })} />);
    expect(screen.getByText('No accepted proposals yet.')).toBeInTheDocument();
    expect(screen.getByText('Select an accepted proposal.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  });

  it('empty frozen summary shows the core no-changes sentence', async () => {
    const user = userEvent.setup();
    const p = props({ proposal: { name: 'Quiet', status: 'accepted', accepted: { byLogin: 'mike.s', at: '2026-10-26T18:00:00Z', summary: [] } } });
    render(<AcceptedView {...p} />);
    expect(screen.getByText('No suggested callings or releases.')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(p.copy).toHaveBeenCalledWith('No suggested callings or releases.');
  });
});
