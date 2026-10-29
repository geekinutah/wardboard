import { boardId as brandBoard, dugout, diffBoards, proposalId, vacancies, type Board } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { headerSummary } from '../features/phone-shell/summary.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { buildPreviewData } from '../preview/data.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { App } from '../App.tsx';
import { PhoneApp } from './PhoneApp.tsx';

const layoutMock = vi.hoisted((): { value: 'phone' | 'desktop' } => ({ value: 'phone' }));
vi.mock('./useLayout.ts', () => ({ useLayout: () => layoutMock.value }));

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const raw of socket.sent) {
      const frame: unknown = JSON.parse(raw);
      if (isRecord(frame) && frame.type === type) found.push(frame);
    }
  }
  return found;
}

function mount(): { client: SyncClient; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: { setTimeout: () => 1, clearTimeout: () => undefined },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function renderApp(client: SyncClient, element = <PhoneApp />): void {
  render(<SyncProvider client={client}>{element}</SyncProvider>);
}

function goLive(harness: { client: SyncClient; sockets: FakeSocket[] }): FakeSocket {
  act(() => {
    harness.client.start();
    harness.sockets[harness.sockets.length - 1]?.open();
  });
  const socket = harness.sockets[harness.sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function currentInfo(): CurrentInfo {
  return { boardId: data.current.id, version: data.current.version, importVersion: 'fixture', importedAt: IMPORTED_AT };
}

function summary(id: string, name: string, status: 'draft' | 'accepted', tabOrder: number, boardId: string): ProposalSummary {
  return { id: proposalId(id), name, status, tabOrder, boardId: brandBoard(boardId), version: 0, updatedAt: IMPORTED_AT };
}

const springSummary = summary(data.proposal.id, data.proposal.name, 'draft', 1, data.proposal.board.id);
const laterSummary = summary('pr-later', 'Later plan', 'draft', 5, 'pr-later-board');
const earlySummary = summary('pr-early', 'Early plan', 'accepted', 0, 'pr-early-board');

function showBoards(socket: FakeSocket, proposals: readonly ProposalSummary[]): void {
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals });
  });
}

function showSnapshot(socket: FakeSocket, board: Board, proposal: ProposalView | null): void {
  act(() => {
    socket.receive({ type: 'snapshot', boardId: board.id, version: board.version, board, ward: data.ward, proposal });
  });
}

function springView(): ProposalView {
  return {
    id: data.proposal.id,
    name: data.proposal.name,
    status: data.proposal.status,
    rationale: data.proposal.rationale,
    baselineBoardId: data.proposal.baseline.id,
  };
}

function lastRequestId(sockets: readonly FakeSocket[], type: string): string {
  const frame = typedFrames(sockets, type).at(-1);
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`missing ${type}`);
  return frame.requestId;
}

async function receiveBaseline(socket: FakeSocket, sockets: readonly FakeSocket[]): Promise<void> {
  // A proposal loads two boards on demand: its baseline and Current (for removed state).
  const byId = new Map<string, Board>([
    [data.proposal.baseline.id, data.proposal.baseline],
    [data.current.id, data.current],
  ]);
  await act(async () => {
    for (const frame of typedFrames(sockets, 'getBoard')) {
      const board = typeof frame.boardId === 'string' ? byId.get(frame.boardId) : undefined;
      if (board !== undefined) socket.receive({ type: 'board', requestId: frame.requestId, board });
    }
    await Promise.resolve();
  });
}

async function receiveMe(socket: FakeSocket, sockets: readonly FakeSocket[]): Promise<void> {
  await act(async () => {
    socket.receive({
      type: 'me',
      requestId: lastRequestId(sockets, 'whoami'),
      user: { login: 'ada@example.test', displayName: 'Ada Example', role: 'admin' },
    });
    await Promise.resolve();
  });
}

function openFrames(sockets: readonly FakeSocket[]): Record<string, unknown>[] {
  return typedFrames(sockets, 'subscribe');
}

describe('PhoneApp', () => {
  it('phone app opens Current and lists boards', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [laterSummary, springSummary, earlySummary]);
    showSnapshot(socket, data.current, null);

    expect(screen.getByRole('heading', { level: 1, name: 'Current' })).toBeInTheDocument();
    const opens = openFrames(harness.sockets);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ boardId: data.current.id });

    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    const sheet = screen.getByRole('dialog', { name: 'Boards' });
    const names = within(sheet)
      .getAllByRole('button', { name: /Current|plan|adjustments/ })
      .map((b) => b.querySelector('.wb-phone-board-option-name')?.textContent)
      .filter((n): n is string => typeof n === 'string');
    expect(names).toEqual(['Current', 'Early plan', data.proposal.name, 'Later plan']);
  });

  it('subscribed proposal shows its counts; others show status only', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary, laterSummary]);
    showSnapshot(socket, data.current, null);
    act(() => {
      harness.client.open(data.proposal.board.id);
    });
    showSnapshot(socket, data.proposal.board, springView());
    await receiveBaseline(socket, harness.sockets);

    const diff = diffBoards(data.proposal.baseline, data.proposal.board);
    const expected = diff.callings.length + diff.releases.length + diff.addedPositions.length + diff.removedPositions.length;
    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    const sheet = screen.getByRole('dialog', { name: 'Boards' });
    const spring = within(sheet).getByRole('button', { name: new RegExp(data.proposal.name) });
    expect(spring).toHaveTextContent(new RegExp(`${String(expected)} change`));
    const later = within(sheet).getByRole('button', { name: /Later plan/ });
    expect(later).toHaveTextContent('Draft');
    expect(later).not.toHaveTextContent(/change/);
  });

  it('header summary uses the diff on a proposal', async () => {
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    expect(screen.getByText(`${String(vacancies(data.current).length)} vacant`)).toBeInTheDocument();
    act(() => {
      harness.client.open(data.proposal.board.id);
    });
    showSnapshot(socket, data.proposal.board, springView());
    await receiveBaseline(socket, harness.sockets);
    const diff = diffBoards(data.proposal.baseline, data.proposal.board);
    expect(
      screen.getByText(
        headerSummary({
          kind: 'proposal',
          callings: diff.callings.length,
          releases: diff.releases.length,
          vacant: vacancies(data.proposal.board).length,
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Dugout · / })).toHaveTextContent(
      `Dugout · ${String(dugout(data.proposal.board, data.ward).length)}`,
    );
  });

  it('board tab renders the organization list read-only', () => {
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    expect(screen.getByRole('button', { name: /^Primary,/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add position/ })).not.toBeInTheDocument();
  });

  it('selecting a board opens it and returns to the list', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('button', { name: /^Primary,/ }));
    expect(screen.queryByRole('button', { name: /^Primary,/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Boards' })).getByRole('button', { name: new RegExp(data.proposal.name) }));
    expect(openFrames(harness.sockets).at(-1)).toMatchObject({ boardId: data.proposal.board.id });
    showSnapshot(socket, data.proposal.board, springView());
    expect(screen.getByRole('button', { name: /^Primary,/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();
  });

  it('start proposal opens the dialog', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    const sheet = screen.getByRole('dialog', { name: 'Boards' });
    expect(within(sheet).queryByRole('button', { name: /^Start proposal$/ })).not.toBeInTheDocument();
    await receiveMe(socket, harness.sockets);
    await user.click(within(sheet).getByRole('button', { name: /^Start proposal$/ }));
    expect(screen.getByRole('dialog', { name: 'Start a proposal' })).toBeInTheDocument();
  });

  it('placeholder tabs link to the desktop layout', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    for (const tab of [/^Search$/, /^Dugout · /, /^Changes/]) {
      await user.click(within(screen.getByRole('navigation', { name: 'Board sections' })).getByRole('button', { name: tab }));
      expect(screen.getByText("This screen isn't on phones yet.")).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Use desktop layout' })).toHaveAttribute('href', '/?layout=desktop');
    }
  });

  it('app chooses PhoneApp or BoardShell', () => {
    layoutMock.value = 'phone';
    const phone = render(<App healthClient={pendingHealth} />);
    expect(screen.getByRole('navigation', { name: 'Board sections' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Boards' })).not.toBeInTheDocument();
    phone.unmount();
    layoutMock.value = 'desktop';
    render(<App healthClient={pendingHealth} />);
    expect(screen.getByRole('tablist', { name: 'Boards' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Board sections' })).not.toBeInTheDocument();
  });
});
