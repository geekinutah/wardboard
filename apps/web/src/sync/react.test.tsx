import type { Board, Ward } from '@wardboard/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';
import { ConnectionIndicator, SyncBanner, SyncProvider, useSync } from './react.tsx';

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

function board(version: number, placements: Record<string, string> = { 'p-1': 'm-1' }): Board {
  return { id: 'board-1', version, placements } as unknown as Board;
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
  const client = new SyncClient(deps);
  return {
    client,
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

function goLive(): ReturnType<typeof mount> & { socket: FakeSocket } {
  const mounted = mount();
  act(() => {
    mounted.client.start();
    const socket = requireSocket(mounted.sockets);
    socket.open();
    mounted.client.open('board-1');
    socket.receive({
      type: 'snapshot',
      boardId: 'board-1',
      version: 1,
      board: board(1),
      ward: WARD,
      proposal: {
        id: 'pr-1',
        name: 'Spring plan',
        status: 'draft',
        rationale: null,
        baselineBoardId: 'base-1',
      } as ProposalView,
    });
  });
  return { ...mounted, socket: requireSocket(mounted.sockets) };
}

describe('sync react binding', () => {
  it('indicator shows each status as text', () => {
    const { client, sockets } = mount();
    render(
      <SyncProvider client={client}>
        <ConnectionIndicator />
      </SyncProvider>,
    );
    act(() => {
      client.start();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    const socket = requireSocket(sockets);
    act(() => {
      socket.open();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Live');

    act(() => {
      socket.close(1006);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Offline — reconnecting');

    const denied = mount();
    render(
      <SyncProvider client={denied.client}>
        <ConnectionIndicator />
      </SyncProvider>,
    );
    act(() => {
      denied.client.start();
      requireSocket(denied.sockets).open();
      requireSocket(denied.sockets).receive({ type: 'error', code: 'forbidden' });
    });
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('banner shows stale, rejected and resynced messages and dismisses', async () => {
    const { client, socket, sockets, advance } = goLive();
    render(
      <SyncProvider client={client}>
        <SyncBanner />
      </SyncProvider>,
    );

    const stale = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: 'req-1',
        code: 'stale',
        message: 'board board-1 version is 2, expected 1',
      });
    });
    await stale;
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Someone else changed this board first. Your change was not applied; the board has been refreshed.',
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
    fireEvent.click(dismiss);
    expect(
      screen.queryByText(
        'Someone else changed this board first. Your change was not applied; the board has been refreshed.',
      ),
    ).not.toBeInTheDocument();

    const rejected = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: 'req-2',
        code: 'not_editable',
        message: 'accepted proposals cannot be edited',
      });
    });
    await rejected;
    expect(screen.getByText('Your change was not applied: accepted proposals cannot be edited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByText('Your change was not applied: accepted proposals cannot be edited'),
    ).not.toBeInTheDocument();

    act(() => {
      socket.close(1006);
      advance(1000);
    });
    const next = requireSocket(sockets);
    act(() => {
      next.open();
      next.receive({
        type: 'snapshot',
        boardId: 'board-1',
        version: 2,
        board: board(2, { 'p-2': 'm-2' }),
        ward: WARD,
        proposal: null,
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnected. The board has been refreshed.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Reconnected. The board has been refreshed.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offline line is shown while offline and not dismissible', async () => {
    const { client, socket } = goLive();
    render(
      <SyncProvider client={client}>
        <SyncBanner />
      </SyncProvider>,
    );

    const rejected = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: 'req-1',
        code: 'not_editable',
        message: 'nope',
      });
    });
    await rejected;
    act(() => {
      socket.close(1006);
    });

    expect(screen.getByText("Offline. Changes can't be saved until the connection returns.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Your change was not applied: nope')).not.toBeInTheDocument();
    expect(screen.getByText("Offline. Changes can't be saved until the connection returns.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('a committed update does not reset local component state', () => {
    function CameraStandIn(): ReactElement {
      const sync = useSync();
      const [zoom, setZoom] = useState(2);
      return (
        <>
          <p>zoom {zoom}</p>
          <p>board {sync.board?.version ?? 'none'}</p>
          <button
            type="button"
            onClick={() => {
              setZoom((value) => value + 1);
            }}
          >
            Zoom in
          </button>
        </>
      );
    }

    const { client, socket } = goLive();
    render(
      <SyncProvider client={client}>
        <CameraStandIn />
      </SyncProvider>,
    );
    expect(screen.getByText('board 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('zoom 3')).toBeInTheDocument();

    act(() => {
      socket.receive({
        type: 'committed',
        boardId: 'board-1',
        version: 2,
        board: board(2, { 'p-2': 'm-2' }),
        requestId: 'someone-else',
        by: 'ada@example.test',
      });
    });

    expect(screen.getByText('zoom 3')).toBeInTheDocument();
    expect(screen.getByText('board 2')).toBeInTheDocument();
  });

  it('no Current or proposals renders without error', () => {
    const { client, sockets } = mount();
    render(
      <SyncProvider client={client}>
        <ConnectionIndicator />
        <SyncBanner />
      </SyncProvider>,
    );
    act(() => {
      client.start();
      const socket = requireSocket(sockets);
      socket.open();
      socket.receive({ type: 'boards', current: null, proposals: [] });
    });

    expect(client.getState().boards).toEqual({ current: null, proposals: [] });
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
