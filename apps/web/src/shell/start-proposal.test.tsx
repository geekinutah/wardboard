import { boardId, proposalId, type Board, type Proposal } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { HealthClient, HealthResponse } from '../health.ts';
import { buildPreviewData } from '../preview/data.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider, useSyncClient } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const FALL_BOARD = 'board-fall';
const FALL_PROPOSAL = 'pr-fall';
const LATE_BOARD = 'board-late';
const LATE_PROPOSAL = 'pr-late';

const data = buildPreviewData();
const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(frame: string): void {
    this.sent.push(frame);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

type Harness = { client: SyncClient; sockets: FakeSocket[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const frame of socket.sent) {
      const parsed = JSON.parse(frame) as unknown;
      if (isRecord(parsed) && parsed.type === type) found.push(parsed);
    }
  }
  return found;
}

function mount(): Harness {
  const sockets: FakeSocket[] = [];
  let nextTimer = 1;
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout() {
        const id = nextTimer;
        nextTimer += 1;
        return id;
      },
      clearTimeout() {
        // Timers never fire in these tests.
      },
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function lastSocket(harness: Harness): FakeSocket {
  const socket = harness.sockets[harness.sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function renderShell(client: SyncClient): void {
  render(
    <SyncProvider client={client}>
      <BoardShell healthClient={pendingHealth} />
    </SyncProvider>,
  );
}

function goLive(harness: Harness): FakeSocket {
  act(() => {
    harness.client.start();
    lastSocket(harness).open();
  });
  return lastSocket(harness);
}

function currentInfo(board: Board = data.current): CurrentInfo {
  return {
    boardId: board.id,
    version: board.version,
    importVersion: 'fixture',
    importedAt: IMPORTED_AT,
  };
}

function proposalView(proposal: Proposal): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function proposalSummary(proposal: Proposal): ProposalSummary {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    tabOrder: proposal.tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

const springSummary = proposalSummary(data.proposal);

function showBoards(socket: FakeSocket, proposals: readonly ProposalSummary[]): void {
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals });
  });
}

function showSnapshot(socket: FakeSocket, board: Board, proposal: ProposalView | null): void {
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: board.id,
      version: board.version,
      board,
      ward: data.ward,
      proposal,
    });
  });
}

function openCurrent(): { harness: Harness; socket: FakeSocket } {
  const harness = mount();
  renderShell(harness.client);
  const socket = goLive(harness);
  showBoards(socket, [springSummary]);
  showSnapshot(socket, data.current, null);
  return { harness, socket };
}

async function receiveCreated(
  socket: FakeSocket,
  requestId: string,
  proposalId: string,
  boardId: string,
): Promise<void> {
  await act(async () => {
    socket.receive({ type: 'proposalCreated', requestId, proposalId, boardId });
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

function createdSummary(id: string, name: string, createdBoardId: string, tabOrder: number): ProposalSummary {
  return {
    id: proposalId(id),
    name,
    status: 'draft',
    tabOrder,
    boardId: boardId(createdBoardId),
    version: 0,
    updatedAt: IMPORTED_AT,
  };
}

describe('start proposal', () => {
  it("Current shows the read-only bar with its import date; proposals don't", async () => {
    const user = userEvent.setup();
    const { harness } = openCurrent();

    const bar = screen.getByRole('region', { name: 'Current is read-only' });
    expect(bar).toHaveTextContent('Read-only · imported Jul 1, 2026');
    expect(bar).toHaveTextContent("Current can't be edited. Start a proposal to plan changes.");
    expect(within(bar).getByRole('button', { name: /^Start proposal$/ })).toBeInTheDocument();

    const tablist = screen.getByRole('tablist', { name: 'Boards' });
    const start = within(tablist).getByRole('button', { name: '+ Start proposal' });
    expect(start).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
    const lastTab = within(tablist).getAllByRole('tab').at(-1);
    if (lastTab === undefined) throw new Error('expected a tab');
    expect(lastTab.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const canvas = document.querySelector('.shell-canvas');
    if (canvas === null) throw new Error('missing canvas');
    expect(bar.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await user.click(start);
    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Current' })).toBeChecked();
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(typedFrames(harness.sockets, 'createProposal')).toEqual([]);

    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    expect(screen.queryByRole('region', { name: 'Current is read-only' })).not.toBeInTheDocument();
    showSnapshot(lastSocket(harness), data.proposal.board, proposalView(data.proposal));
    expect(screen.getByText('PROPOSED')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current is read-only' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('tablist', { name: 'Boards' })).getByRole('button', { name: '+ Start proposal' }),
    ).toBeInTheDocument();
  });

  it('Start proposal from Current sends createProposal with source current', async () => {
    const user = userEvent.setup();
    const { harness } = openCurrent();
    const before = typedFrames(harness.sockets, 'subscribe');

    await user.click(
      within(screen.getByRole('region', { name: 'Current is read-only' })).getByRole('button', {
        name: /^Start proposal$/,
      }),
    );
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual(before);
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Current' })).toBeChecked();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Fall plan');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    expect(typedFrames(harness.sockets, 'createProposal')).toEqual([
      {
        type: 'createProposal',
        requestId: 'req-2',
        name: 'Fall plan',
        rationale: null,
        source: { kind: 'current' },
      },
    ]);
  });

  it('opening from a proposal tab preselects duplicating that proposal', async () => {
    const user = userEvent.setup();
    const { harness, socket } = openCurrent();
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));
    const before = typedFrames(harness.sockets, 'subscribe');

    await user.click(screen.getByRole('button', { name: '+ Start proposal' }));

    expect(typedFrames(harness.sockets, 'subscribe')).toEqual(before);
    expect(typedFrames(harness.sockets, 'createProposal')).toEqual([]);
    expect(screen.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Duplicate “Spring adjustments”' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Current' })).not.toBeChecked();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Copy plan');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));
    expect(typedFrames(harness.sockets, 'createProposal')).toEqual([
      {
        type: 'createProposal',
        requestId: 'req-4',
        name: 'Copy plan',
        rationale: null,
        source: { kind: 'proposal', proposalId: data.proposal.id },
      },
    ]);
  });

  it('success switches to the new tab once it appears', async () => {
    const user = userEvent.setup();
    const { harness, socket } = openCurrent();
    await user.click(
      within(screen.getByRole('region', { name: 'Current is read-only' })).getByRole('button', {
        name: /^Start proposal$/,
      }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Fall plan');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));
    await receiveCreated(socket, 'req-2', FALL_PROPOSAL, FALL_BOARD);

    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([
      { type: 'subscribe', boardId: data.current.id },
    ]);
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');

    await act(async () => {
      socket.receive({
        type: 'boards',
        current: currentInfo(),
        proposals: [springSummary, createdSummary(FALL_PROPOSAL, 'Fall plan', FALL_BOARD, 1)],
      });
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });

    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([
      { type: 'subscribe', boardId: data.current.id },
      { type: 'subscribe', boardId: FALL_BOARD },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Fall plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('proposalCreated precedes the boards push and does not switch until the tab exists', async () => {
    const user = userEvent.setup();
    const { harness, socket } = openCurrent();
    await user.click(screen.getByRole('button', { name: '+ Start proposal' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Late plan');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    await receiveCreated(socket, 'req-2', LATE_PROPOSAL, LATE_BOARD);
    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Late plan' })).not.toBeInTheDocument();
    expect(typedFrames(harness.sockets, 'subscribe').map((frame) => frame.boardId)).not.toContain(LATE_BOARD);
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');

    await act(async () => {
      socket.receive({
        type: 'boards',
        current: currentInfo(),
        proposals: [springSummary, createdSummary(LATE_PROPOSAL, 'Late plan', LATE_BOARD, 1)],
      });
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });

    expect(typedFrames(harness.sockets, 'subscribe').at(-1)).toEqual({
      type: 'subscribe',
      boardId: LATE_BOARD,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Late plan' })).toHaveAttribute('aria-selected', 'true');
  });

  it('failure shows the server message and keeps the dialog', async () => {
    const user = userEvent.setup();
    const { harness, socket } = openCurrent();
    await user.click(
      within(screen.getByRole('region', { name: 'Current is read-only' })).getByRole('button', {
        name: /^Start proposal$/,
      }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Fall plan');
    await user.click(screen.getByRole('button', { name: 'Create proposal' }));

    await act(async () => {
      socket.receive({
        type: 'rejected',
        requestId: 'req-2',
        code: 'bad_request',
        message: 'the ward is closed',
      });
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not create the proposal: the ward is closed');
    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Fall plan');
    expect(screen.getByRole('button', { name: 'Create proposal' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([
      { type: 'subscribe', boardId: data.current.id },
    ]);
  });
});

describe('useSyncClient', () => {
  it("useSyncClient returns the provider's client and throws outside SyncProvider", () => {
    const harness = mount();

    function Inside(): ReactElement {
      const seen = useSyncClient();
      return <p>{seen === harness.client ? 'same-client' : 'different-client'}</p>;
    }

    render(
      <SyncProvider client={harness.client}>
        <Inside />
      </SyncProvider>,
    );
    expect(screen.getByText('same-client')).toBeInTheDocument();
    cleanup();

    function Outside(): ReactElement {
      let message = 'no throw';
      try {
        useSyncClient();
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : 'unknown';
      }
      return <p>{message}</p>;
    }

    render(<Outside />);
    expect(screen.getByText('useSyncClient must be used within SyncProvider')).toBeInTheDocument();
  });
});
