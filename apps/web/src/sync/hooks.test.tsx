import type { Board, Ward } from '@wardboard/core';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';
import { SyncProvider, useBaseline, useMe, useSettings } from './react.tsx';

const WARD = { id: 'ward-1' } as unknown as Ward;

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
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

function board(id: string, kind: 'current' | 'proposal' | 'baseline', version: number): Board {
  return { id, kind, version } as unknown as Board;
}

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

function mount(): {
  client: SyncClient;
  sockets: FakeSocket[];
  advance: (ms: number) => void;
} {
  const sockets: FakeSocket[] = [];
  let now = 0;
  let nextId = 1;
  let request = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout(fn, ms) {
        const id = nextId;
        nextId += 1;
        pending.set(id, { at: now + ms, fn });
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
  return {
    client: new SyncClient(deps),
    sockets,
    advance(ms) {
      now += ms;
      for (let guard = 0; guard < 100; guard += 1) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
        const next = due[0];
        if (next === undefined) return;
        pending.delete(next[0]);
        next[1].fn();
      }
      throw new Error('timer loop did not settle');
    },
  };
}

function requireSocket(sockets: readonly FakeSocket[]): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function proposal(baselineBoardId: string): ProposalView {
  return {
    id: 'pr-1' as ProposalView['id'],
    name: 'Spring plan',
    status: 'draft',
    rationale: null,
    baselineBoardId: baselineBoardId as ProposalView['baselineBoardId'],
  };
}

function snapshot(proposalView: ProposalView | null, version = 1): unknown {
  return {
    type: 'snapshot',
    boardId: 'board-1',
    version,
    board: board('board-1', proposalView === null ? 'current' : 'proposal', version),
    ward: WARD,
    proposal: proposalView,
  };
}

function BaselineProbe(): ReactElement {
  const baseline = useBaseline();
  return <p>baseline {baseline === null ? 'none' : baseline.id}</p>;
}

function SessionProbe(): ReactElement {
  const me = useMe();
  const settings = useSettings();
  return (
    <>
      <p>me {me === null ? 'none' : `${me.login}:${me.role}`}</p>
      <p>settings {settings === null ? 'none' : String(settings.showNeedsApproval)}</p>
    </>
  );
}

describe('session hooks', () => {
  it('useBaseline returns null on Current, fetches once for a proposal, refetches when baselineBoardId changes', async () => {
    const { client, sockets } = mount();
    render(
      <SyncProvider client={client}>
        <BaselineProbe />
      </SyncProvider>,
    );
    act(() => {
      client.start();
      const socket = requireSocket(sockets);
      socket.open();
      client.open('board-1');
      socket.receive(snapshot(null));
    });

    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(typedFrames(sockets, 'getBoard')).toEqual([]);

    act(() => {
      requireSocket(sockets).receive(snapshot(proposal('base-1'), 2));
    });
    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(typedFrames(sockets, 'getBoard')).toEqual([
      { type: 'getBoard', requestId: 'req-1', boardId: 'base-1' },
    ]);

    await act(async () => {
      requireSocket(sockets).receive({
        type: 'board',
        requestId: 'req-1',
        board: board('base-1', 'baseline', 0),
      });
      await Promise.resolve();
    });
    expect(screen.getByText('baseline base-1')).toBeInTheDocument();

    act(() => {
      requireSocket(sockets).receive({ type: 'boards', current: null, proposals: [] });
    });
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(1);
    expect(screen.getByText('baseline base-1')).toBeInTheDocument();

    act(() => {
      requireSocket(sockets).receive(snapshot(proposal('base-2'), 3));
    });
    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(typedFrames(sockets, 'getBoard')).toEqual([
      { type: 'getBoard', requestId: 'req-1', boardId: 'base-1' },
      { type: 'getBoard', requestId: 'req-2', boardId: 'base-2' },
    ]);

    await act(async () => {
      requireSocket(sockets).receive({
        type: 'board',
        requestId: 'req-2',
        board: board('base-2', 'baseline', 0),
      });
      await Promise.resolve();
    });
    expect(screen.getByText('baseline base-2')).toBeInTheDocument();
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(2);

    act(() => {
      requireSocket(sockets).receive(snapshot(null, 4));
    });
    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(2);
  });

  it('useMe and useSettings request once per live connection and again after reconnect', async () => {
    const { client, sockets, advance } = mount();
    render(
      <SyncProvider client={client}>
        <SessionProbe />
      </SyncProvider>,
    );
    expect(screen.getByText('me none')).toBeInTheDocument();
    expect(screen.getByText('settings none')).toBeInTheDocument();
    expect(typedFrames(sockets, 'whoami')).toEqual([]);
    expect(typedFrames(sockets, 'getSettings')).toEqual([]);

    act(() => {
      client.start();
      requireSocket(sockets).open();
    });
    expect(typedFrames(sockets, 'whoami')).toEqual([{ type: 'whoami', requestId: 'req-1' }]);
    expect(typedFrames(sockets, 'getSettings')).toEqual([{ type: 'getSettings', requestId: 'req-2' }]);
    expect(typedFrames(sockets, 'listBoards')).toEqual([{ type: 'listBoards' }]);

    await act(async () => {
      const socket = requireSocket(sockets);
      socket.receive({
        type: 'me',
        requestId: 'req-1',
        user: { login: 'ada@example.test', displayName: 'Ada Example', role: 'admin' },
      });
      socket.receive({ type: 'settings', requestId: 'req-2', showNeedsApproval: true });
      await Promise.resolve();
    });
    expect(screen.getByText('me ada@example.test:admin')).toBeInTheDocument();
    expect(screen.getByText('settings true')).toBeInTheDocument();
    expect(typedFrames(sockets, 'whoami')).toHaveLength(1);
    expect(typedFrames(sockets, 'getSettings')).toHaveLength(1);

    act(() => {
      requireSocket(sockets).receive({ type: 'boards', current: null, proposals: [] });
    });
    expect(typedFrames(sockets, 'whoami')).toHaveLength(1);
    expect(typedFrames(sockets, 'getSettings')).toHaveLength(1);

    act(() => {
      requireSocket(sockets).close(1006);
    });
    act(() => {
      advance(1000);
    });
    act(() => {
      requireSocket(sockets).open();
    });
    expect(typedFrames(sockets, 'whoami')).toEqual([
      { type: 'whoami', requestId: 'req-1' },
      { type: 'whoami', requestId: 'req-3' },
    ]);
    expect(typedFrames(sockets, 'getSettings')).toEqual([
      { type: 'getSettings', requestId: 'req-2' },
      { type: 'getSettings', requestId: 'req-4' },
    ]);

    await act(async () => {
      requireSocket(sockets).receive({
        type: 'me',
        requestId: 'req-3',
        user: { login: 'ada@example.test', displayName: 'Ada Example', role: 'editor' },
      });
      requireSocket(sockets).receive({ type: 'settings', requestId: 'req-4', showNeedsApproval: false });
      await Promise.resolve();
    });
    expect(screen.getByText('me ada@example.test:editor')).toBeInTheDocument();
    expect(screen.getByText('settings false')).toBeInTheDocument();
    expect(typedFrames(sockets, 'whoami')).toHaveLength(2);
    expect(typedFrames(sockets, 'getSettings')).toHaveLength(2);
  });
});
