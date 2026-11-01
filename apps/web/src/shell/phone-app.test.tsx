import { boardId as brandBoard, dugout, diffBoards, proposalId, vacancies, type Board } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
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

function memberIdNamed(name: string): string {
  const found = Object.values(data.ward.members).find((member) => member.name === name);
  if (found === undefined) throw new Error(`missing member ${name}`);
  return found.id;
}

function boardReads(sockets: readonly FakeSocket[]): { requestId: string; boardId: string }[] {
  return typedFrames(sockets, 'getBoard').flatMap((frame) => {
    if (typeof frame.requestId !== 'string' || typeof frame.boardId !== 'string') return [];
    return [{ requestId: frame.requestId, boardId: frame.boardId }];
  });
}

function opBodies(sockets: readonly FakeSocket[]): unknown[] {
  return typedFrames(sockets, 'op').map((frame) => frame.op);
}

function sections() {
  return within(screen.getByRole('navigation', { name: 'Board sections' }));
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

type Opened = { harness: { client: SyncClient; sockets: FakeSocket[] }; socket: FakeSocket; user: UserEvent };

/** Signs in and opens the Spring adjustments board at `status`. */
async function openProposal(status: 'draft' | 'accepted'): Promise<Opened> {
  const user = userEvent.setup();
  const harness = mount();
  renderApp(harness.client);
  const socket = goLive(harness);
  showBoards(socket, [summary(data.proposal.id, data.proposal.name, status, 1, data.proposal.board.id)]);
  showSnapshot(socket, data.current, null);
  await receiveMe(socket, harness.sockets);
  await user.click(screen.getByRole('button', { name: /Switch board/ }));
  await user.click(
    within(screen.getByRole('dialog', { name: 'Boards' })).getByRole('button', { name: new RegExp(data.proposal.name) }),
  );
  showSnapshot(socket, data.proposal.board, { ...springView(), status });
  await receiveBaseline(socket, harness.sockets);
  await flush();
  return { harness, socket, user };
}

async function searchFor(user: UserEvent, query: string): Promise<void> {
  await user.click(sections().getByRole('button', { name: /^Search$/ }));
  await user.type(screen.getByRole('searchbox', { name: 'Search' }), query);
}

function vacantSecondCounselor(): HTMLElement | undefined {
  return screen.getAllByRole('button').find((button) => {
    const text = button.textContent;
    return text.includes('Second Counselor') && text.includes('Vacant');
  });
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
    // The preview proposal has real edits, so a diff against the wrong board would show 0.
    expect(expected).toBeGreaterThan(0);
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
    expect(diff.callings.length).toBeGreaterThan(0);
    expect(diff.releases.length).toBeGreaterThan(0);
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
    const nav = within(screen.getByRole('navigation', { name: 'Board sections' }));

    await user.click(nav.getByRole('button', { name: /^Search$/ }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Type a name, calling, or tag, or choose a filter.')).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't on phones yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Use desktop layout' })).not.toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: /^Dugout · / }));
    expect(
      screen.getByText('No calling in this proposal, or placed here on purpose. Not a measure of availability.'),
    ).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't on phones yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Use desktop layout' })).not.toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: /^Changes/ }));
    expect(screen.getByText("This screen isn't on phones yet.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Use desktop layout' })).toHaveAttribute('href', '/?layout=desktop');
  });

  it('search before the snapshot says Loading board', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    await user.click(sections().getByRole('button', { name: /^Search$/ }));
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't on phones yet.")).not.toBeInTheDocument();
    await user.click(sections().getByRole('button', { name: /^Dugout · / }));
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't on phones yet.")).not.toBeInTheDocument();
    showSnapshot(socket, data.current, null);
    await user.click(sections().getByRole('button', { name: /^Search$/ }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Type a name, calling, or tag, or choose a filter.')).toBeInTheDocument();
  });

  it('a person result opens the person sheet over Search', async () => {
    const { harness, user } = await openProposal('draft');
    await searchFor(user, 'Bea');
    await user.click(screen.getByRole('button', { name: /^Bea Placeholder/ }));
    expect(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(opBodies(harness.sockets)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: /^Bea Placeholder/ })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  });

  it('Current person sheet is read-only', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await receiveMe(socket, harness.sockets);
    await searchFor(user, 'Bea');
    await user.click(screen.getByRole('button', { name: /^Bea Placeholder/ }));
    const sheet = screen.getByRole('dialog', { name: /^Bea Placeholder/ });
    expect(within(sheet).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: 'Callings in Current' })).toBeInTheDocument();
  });

  it('+ Dugout sends addToDugout and does not open the sheet', async () => {
    const { harness, socket, user } = await openProposal('draft');
    await searchFor(user, 'Bea');
    const add = screen.getByRole('button', { name: 'Add Bea Placeholder to dugout' });
    await user.click(add);
    expect(screen.queryByRole('dialog', { name: /^Bea Placeholder/ })).not.toBeInTheDocument();
    const memberId = memberIdNamed('Bea Placeholder');
    expect(opBodies(harness.sockets)).toEqual([{ kind: 'addToDugout', request: { memberId } }]);
    await user.click(add);
    expect(opBodies(harness.sockets)).toEqual([
      { kind: 'addToDugout', request: { memberId } },
      { kind: 'addToDugout', request: { memberId } },
    ]);

    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Boards' })).getByRole('button', { name: /^Current/ }));
    showSnapshot(socket, data.current, null);
    await flush();
    await searchFor(user, 'Bea');
    expect(screen.getByRole('button', { name: /^Bea Placeholder/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Bea Placeholder to dugout' })).not.toBeInTheDocument();
  });

  it('a calling result opens that organization', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    await searchFor(user, 'Primary Teacher');
    await user.click(screen.getByRole('button', { name: /^Primary Teacher(?!s)/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('a calling group result opens its organization', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    await searchFor(user, 'Nursery');
    await user.click(screen.getByRole('button', { name: /^Nursery[\s\S]*Group ·/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Nursery/ })).toBeInTheDocument();
    expect(screen.queryByText('Organization not found')).not.toBeInTheDocument();
  });

  it('a tag result stays on Search', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    await searchFor(user, 'Musical');
    await user.click(screen.getByRole('button', { name: /Musical[\s\S]*show them/ }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tag: Musical/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('All scope uses a fetched proposal and a rejected board adds no alert', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    const other = summary('pr-other', 'Autumn plan', 'draft', 2, 'pr-other-board');
    showBoards(socket, [springSummary, other]);
    showSnapshot(socket, data.current, null);
    await user.click(sections().getByRole('button', { name: /^Search$/ }));
    await flush();

    const reads = boardReads(harness.sockets);
    expect(reads.map((frame) => frame.boardId).sort()).toEqual([data.proposal.board.id, 'pr-other-board'].sort());
    expect(reads.some((frame) => frame.boardId === data.current.id)).toBe(false);
    const springRead = reads.find((frame) => frame.boardId === data.proposal.board.id);
    const otherRead = reads.find((frame) => frame.boardId === 'pr-other-board');
    if (springRead === undefined || otherRead === undefined) throw new Error('missing getBoard');

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'Second Counselor');
    expect(vacantSecondCounselor()).toBeUndefined();

    const beforeReply = boardReads(harness.sockets).length;
    await act(async () => {
      socket.receive({ type: 'board', requestId: springRead.requestId, board: data.proposal.board });
      socket.receive({
        type: 'rejected',
        requestId: otherRead.requestId,
        code: 'not_found',
        message: 'board missing does not exist',
      });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(boardReads(harness.sockets)).toHaveLength(beforeReply);
    for (const alert of screen.queryAllByRole('alert')) {
      expect(alert).not.toHaveTextContent('board missing does not exist');
    }
    const vacant = vacantSecondCounselor();
    if (vacant === undefined) throw new Error('missing vacant second counselor');
    await user.click(vacant);
    expect(openFrames(harness.sockets).at(-1)).toMatchObject({ boardId: data.proposal.board.id });
    showSnapshot(socket, data.proposal.board, springView());
    await flush();
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search' })).not.toBeInTheDocument();
    expect(boardReads(harness.sockets).filter((frame) => frame.boardId === data.proposal.board.id)).toHaveLength(1);
  });

  it('Place opens the person sheet and sends nothing', async () => {
    const { harness, user } = await openProposal('draft');
    await user.click(sections().getByRole('button', { name: /^Dugout · / }));
    await user.click(screen.getByRole('button', { name: 'Place Jay Storybook' }));
    expect(screen.getByRole('button', { name: 'Assign calling…' })).toBeInTheDocument();
    expect(opBodies(harness.sockets)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Place Jay Storybook' })).toBeInTheDocument();
  });

  it('switching tabs closes the sheet', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderApp(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);
    showSnapshot(socket, data.current, null);
    await searchFor(user, 'Bea');
    await user.click(screen.getByRole('button', { name: /^Bea Placeholder/ }));
    expect(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).toBeInTheDocument();
    await user.click(sections().getByRole('button', { name: /^Board$/ }));
    expect(screen.queryByRole('dialog', { name: /^Bea Placeholder/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Primary,/ })).toBeInTheDocument();
  });

  it('an accepted proposal has no Place or Add to dugout', async () => {
    const { user } = await openProposal('accepted');
    await searchFor(user, 'Bea');
    expect(screen.queryByRole('button', { name: 'Add Bea Placeholder to dugout' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Bea Placeholder/ }));
    const sheet = screen.getByRole('dialog', { name: /^Bea Placeholder/ });
    expect(within(sheet).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(sections().getByRole('button', { name: /^Dugout · / }));
    expect(screen.queryByRole('button', { name: /^Place / })).not.toBeInTheDocument();
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
