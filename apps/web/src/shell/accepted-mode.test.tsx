import { memberId, positionId, type Board, type Proposal, type SummaryGroup, type Ward } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildPreviewData } from '../preview/data.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

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

type Harness = {
  client: SyncClient;
  sockets: FakeSocket[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function frames(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame) as unknown);
}

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const frame of frames(socket)) {
      if (isRecord(frame) && frame.type === type) found.push(frame);
    }
  }
  return found;
}

function mount(): Harness {
  const sockets: FakeSocket[] = [];
  let nextId = 1;
  let request = 0;
  const pending = new Map<number, () => void>();
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout(fn) {
        const id = nextId;
        nextId += 1;
        pending.set(id, fn);
        return id;
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') pending.delete(handle);
      },
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function requireSocket(sockets: readonly FakeSocket[]): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function renderShell(client: SyncClient): ReturnType<typeof render> {
  return render(
    <SyncProvider client={client}>
      <BoardShell healthClient={pendingHealth} />
    </SyncProvider>,
  );
}

function goLive(harness: Harness): FakeSocket {
  act(() => {
    harness.client.start();
    requireSocket(harness.sockets).open();
  });
  return requireSocket(harness.sockets);
}

function currentInfo(board: Board = data.current): CurrentInfo {
  return {
    boardId: board.id,
    version: board.version,
    importVersion: 'fixture',
    importedAt: IMPORTED_AT,
  };
}

function proposalView(proposal: Proposal, status: Proposal['status'] = proposal.status): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function proposalSummary(
  proposal: Proposal,
  status: Proposal['status'] = proposal.status,
  tabOrder = proposal.tabOrder,
): ProposalSummary {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

function showBoards(
  socket: FakeSocket,
  proposals: readonly ProposalSummary[],
  current: CurrentInfo | null = currentInfo(),
): void {
  act(() => {
    socket.receive({ type: 'boards', current, proposals });
  });
}

function showSnapshot(
  socket: FakeSocket,
  board: Board,
  proposal: ProposalView | null,
  version = board.version,
  ward: Ward = data.ward,
): void {
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: board.id,
      version,
      board,
      ward,
      proposal,
    });
  });
}

async function answerBoardRequest(harness: Harness, socket: FakeSocket, boardId: string, board: Board): Promise<void> {
  const frame = typedFrames(harness.sockets, 'getBoard').find((f) => f.boardId === boardId);
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`no getBoard request for ${boardId}`);
  const requestId = frame.requestId;
  await act(async () => {
    socket.receive({ type: 'board', requestId, board });
    await Promise.resolve();
  });
}


const ACCEPTED_AT = '2026-10-26T18:00:00.000Z';

const GROUP: SummaryGroup = {
  key: 'bishop',
  heading: 'Bishop · D. Halvorsen',
  callings: [
    { memberId: memberId('m-0035'), name: 'Ivy Notreal', positionId: positionId('p-0019'), text: 'Ivy Notreal as Relief Society Teacher' },
  ],
  releases: [],
};

function detail(proposal: Proposal, status: 'draft' | 'accepted', at: string | null = ACCEPTED_AT) {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    rationale: null,
    baselineBoardId: proposal.baseline.id,
    boardId: proposal.board.id,
    createdAt: IMPORTED_AT,
    updatedAt: IMPORTED_AT,
    accepted: status === 'accepted' ? { byLogin: 'mike.s', at: at ?? ACCEPTED_AT, summary: [GROUP] } : null,
  };
}

function summaryOf(proposal: Proposal, status: 'draft' | 'accepted', acceptedAt: string | null, version = 1): ProposalSummary {
  return { ...proposalSummary(proposal, status), version, acceptedAt };
}

/** Answers the oldest unanswered request frame of `type`. */
const answered = new WeakMap<FakeSocket[], Set<string>>();
async function answer(harness: Harness, type: string, reply: (frame: Record<string, unknown>) => unknown): Promise<Record<string, unknown>> {
  const done = answered.get(harness.sockets) ?? new Set<string>();
  answered.set(harness.sockets, done);
  const frame = typedFrames(harness.sockets, type).find((f) => typeof f.requestId === 'string' && !done.has(f.requestId));
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`no pending ${type} request`);
  done.add(frame.requestId);
  const requestId = frame.requestId;
  await act(async () => {
    requireSocket(harness.sockets).receive({ requestId, ...(reply(frame) as object) });
    await Promise.resolve();
  });
  return frame;
}

function pending(harness: Harness, type: string): number {
  const done = answered.get(harness.sockets) ?? new Set<string>();
  return typedFrames(harness.sockets, type).filter((f) => typeof f.requestId === 'string' && !done.has(f.requestId)).length;
}

interface Opened {
  harness: Harness;
  socket: FakeSocket;
  user: ReturnType<typeof userEvent.setup>;
}

/** Shell on Current with `data.proposal` in the given status (boards push only). */
function startOnCurrent(status: 'draft' | 'accepted'): Opened {
  const user = userEvent.setup();
  const harness = mount();
  renderShell(harness.client);
  const socket = goLive(harness);
  showBoards(socket, [summaryOf(data.proposal, status, status === 'accepted' ? ACCEPTED_AT : null)]);
  showSnapshot(socket, data.current, null);
  return { harness, socket, user };
}

async function openProposal(
  opened: Opened,
  status: 'draft' | 'accepted',
  ward: Ward = data.ward,
  currentAnswered = true,
): Promise<void> {
  const { harness, socket, user } = opened;
  await user.click(screen.getByRole('tab', { name: new RegExp(data.proposal.name) }));
  showSnapshot(socket, data.proposal.board, proposalView(data.proposal, status), data.proposal.board.version, ward);
  await answerBoardRequest(harness, socket, data.proposal.baseline.id, data.proposal.baseline);
  if (currentAnswered) await answerBoardRequest(harness, socket, data.current.id, data.current);
}

describe('T-090 accepted view in app', () => {
  it('Status button on proposals only; Accepted proposals button on Current only when one is accepted', async () => {
    const none = startOnCurrent('draft');
    expect(screen.queryByRole('button', { name: 'Accepted proposals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    await openProposal(none, 'draft');
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accepted proposals' })).not.toBeInTheDocument();
  });

  it('Accepted proposals button shows on Current when one is accepted', () => {
    startOnCurrent('accepted');
    expect(screen.getByRole('button', { name: 'Accepted proposals' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('opening fetches getProposal for the open proposal and shows its status', async () => {
    const opened = startOnCurrent('draft');
    await openProposal(opened, 'draft');
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    const frame = await answer(opened.harness, 'getProposal', () => ({
      type: 'proposalDetail',
      proposal: detail(data.proposal, 'draft'),
    }));
    expect(frame.proposalId).toBe(data.proposal.id);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('draft');
  });

  it('opening from Current selects the newest accepted proposal', async () => {
    const opened = startOnCurrent('accepted');
    await opened.user.click(screen.getByRole('button', { name: 'Accepted proposals' }));
    const frame = await answer(opened.harness, 'getProposal', () => ({
      type: 'proposalDetail',
      proposal: detail(data.proposal, 'accepted'),
    }));
    expect(frame.proposalId).toBe(data.proposal.id);
    expect(screen.getByText(/Accepted Oct 26, 2026 by mike\.s/)).toBeInTheDocument();
    expect(screen.getByText('Ivy Notreal as Relief Society Teacher', { exact: false })).toBeInTheDocument();
  });

  it('accepting sends setProposalStatus accepted; the boards push refetches and shows the frozen summary', async () => {
    const opened = startOnCurrent('draft');
    const { harness, socket, user } = opened;
    await openProposal(opened, 'draft');
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'draft') }));
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).not.toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'accepted');
    const sent = typedFrames(harness.sockets, 'setProposalStatus');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ proposalId: data.proposal.id, status: 'accepted' });

    await answer(harness, 'setProposalStatus', () => ({
      type: 'statusChanged',
      proposalId: data.proposal.id,
      status: 'accepted',
    }));
    // Not refetched until the pushes arrive.
    expect(pending(harness, 'getProposal')).toBe(0);
    showBoards(socket, [summaryOf(data.proposal, 'accepted', ACCEPTED_AT, 2)]);
    expect(pending(harness, 'getProposal')).toBe(1);
    await answer(harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'accepted') }));
    expect(screen.getByText(/Accepted Oct 26, 2026 by mike\.s/)).toBeInTheDocument();
    expect(screen.getByText('Bishop · D. Halvorsen')).toBeInTheDocument();
  });

  it('draft with a removed member placed: Accepted option disabled with the reason', async () => {
    const ivy = data.ward.members[memberId('m-0035')];
    if (ivy === undefined) throw new Error('fixture member m-0035 missing');
    const ward: Ward = {
      ...data.ward,
      members: { ...data.ward.members, [ivy.id]: { ...ivy, removedDate: '2026-10-24' } },
    };
    const opened = startOnCurrent('draft');
    await openProposal(opened, 'draft', ward);
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(opened.harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'draft') }));
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).toBeDisabled();
    expect(screen.getByText('Ivy Notreal is no longer in the ward')).toBeInTheDocument();
  });

  it('while Current loads, Accept is disabled', async () => {
    const opened = startOnCurrent('draft');
    await openProposal(opened, 'draft', data.ward, false);
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(opened.harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'draft') }));
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).toBeDisabled();
    expect(screen.getByText('Loading Current…')).toBeInTheDocument();

    await answerBoardRequest(opened.harness, opened.socket, data.current.id, data.current);
    expect(screen.getByRole('option', { name: 'Accepted (read-only)' })).not.toBeDisabled();
    expect(screen.queryByText('Loading Current…')).not.toBeInTheDocument();
  });

  it('refusal from the server shows the alert', async () => {
    const opened = startOnCurrent('draft');
    await openProposal(opened, 'draft');
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(opened.harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'draft') }));
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'accepted');
    await answer(opened.harness, 'setProposalStatus', () => ({
      type: 'rejected',
      code: 'blocked',
      message: 'Ivy Notreal needs approval',
    }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ivy Notreal needs approval');
  });

  it('a getProposal refusal shows the alert', async () => {
    const opened = startOnCurrent('draft');
    await openProposal(opened, 'draft');
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(opened.harness, 'getProposal', () => ({ type: 'rejected', code: 'not_found', message: 'no such proposal' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no such proposal');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('Draft (editable) on an accepted proposal sends setProposalStatus draft', async () => {
    const opened = startOnCurrent('accepted');
    await openProposal(opened, 'accepted');
    await opened.user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(opened.harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'accepted') }));
    await opened.user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'draft');
    const sent = typedFrames(opened.harness.sockets, 'setProposalStatus');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ proposalId: data.proposal.id, status: 'draft' });
  });

  it('selecting another history entry fetches it without switching tabs', async () => {
    const other: Proposal = { ...data.proposal, id: 'pr-other' as Proposal['id'], name: 'Older adjustments' };
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [
      summaryOf(data.proposal, 'accepted', ACCEPTED_AT),
      { ...summaryOf(other, 'accepted', '2026-04-03T18:00:00.000Z'), boardId: 'board-other' as ProposalSummary['boardId'], tabOrder: 5 },
    ]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('button', { name: 'Accepted proposals' }));
    await answer(harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'accepted') }));

    await user.click(screen.getByRole('button', { name: /Older adjustments/ }));
    const frame = await answer(harness, 'getProposal', () => ({
      type: 'proposalDetail',
      proposal: { ...detail(other, 'accepted', '2026-04-03T18:00:00.000Z') },
    }));
    expect(frame.proposalId).toBe('pr-other');
    expect(screen.getByRole('heading', { level: 1, name: 'Older adjustments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('switching tabs closes the view; Summary and Status are exclusive', async () => {
    const opened = startOnCurrent('draft');
    const { harness, socket, user } = opened;
    await openProposal(opened, 'draft');
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await answer(harness, 'getProposal', () => ({ type: 'proposalDetail', proposal: detail(data.proposal, 'draft') }));
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    // The view replaces the canvas area, so Summary is not offered at the same time.
    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Current/ }));
    showSnapshot(socket, data.current, null);
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(document.querySelector('.wb-canvas-level')).toBeInTheDocument();

    // Back on the proposal: the board shows, not the view; Summary then excludes Status.
    await user.click(screen.getByRole('tab', { name: new RegExp(data.proposal.name) }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal, 'draft'));
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
  });
});
