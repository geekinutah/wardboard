import type { Board, Ward } from '@wardboard/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';
import { RESYNCED_NOTICE_MS, SyncBanner, SyncProvider } from './react.tsx';

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

const RESYNCED = 'Reconnected. The board has been refreshed.';
const STALE =
  'Someone else changed this board first. Your change was not applied; the board has been refreshed.';

type Live = ReturnType<typeof goLive>;

function mountBanner(): Live & { unmount: () => void } {
  const live = goLive();
  const { unmount } = render(
    <SyncProvider client={live.client}>
      <SyncBanner />
    </SyncProvider>,
  );
  return { ...live, unmount };
}

function reconnect(live: Live): void {
  act(() => {
    requireSocket(live.sockets).close(1006);
    live.advance(1000);
  });
  const next = requireSocket(live.sockets);
  act(() => {
    next.open();
    next.receive({
      type: 'snapshot',
      boardId: 'board-1',
      version: 2,
      board: board(2),
      ward: WARD,
      proposal: null,
    });
  });
}

let requestCounter = 0;
async function rejectNext(live: Live, code: string, message: string): Promise<void> {
  const requestId = `req-${String(requestCounter + 1)}`;
  requestCounter += 1;
  const pending = live.client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
  act(() => {
    requireSocket(live.sockets).receive({ type: 'rejected', requestId, code, message });
  });
  await pending;
}

describe('SyncBanner auto-hide', () => {
  beforeEach(() => {
    requestCounter = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a five second delay', () => {
    expect(RESYNCED_NOTICE_MS).toBe(5000);
  });

  it('the reconnected notice hides after five seconds', () => {
    const live = mountBanner();
    reconnect(live);
    expect(screen.getByRole('alert')).toHaveTextContent(RESYNCED);
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RESYNCED);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(RESYNCED)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismissing early still works and leaves no timer behind', async () => {
    const live = mountBanner();
    reconnect(live);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(RESYNCED)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    await rejectNext(live, 'not_editable', 'accepted proposals cannot be edited');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Your change was not applied: accepted proposals cannot be edited')).toBeInTheDocument();
  });

  it('a not-applied notice stays until dismissed', async () => {
    const live = mountBanner();
    await rejectNext(live, 'stale', 'board board-1 version is 2, expected 1');
    expect(screen.getByRole('alert')).toHaveTextContent(STALE);
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(STALE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await rejectNext(live, 'not_editable', 'accepted proposals cannot be edited');
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText('Your change was not applied: accepted proposals cannot be edited')).toBeInTheDocument();
  });

  it('a second reconnect restarts the five seconds', () => {
    const live = mountBanner();
    reconnect(live);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    reconnect(live);
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(RESYNCED);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(RESYNCED)).not.toBeInTheDocument();
  });

  it('a rejection replacing the reconnected notice is kept', async () => {
    const live = mountBanner();
    reconnect(live);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await rejectNext(live, 'not_editable', 'accepted proposals cannot be edited');
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Your change was not applied: accepted proposals cannot be edited')).toBeInTheDocument();
    expect(screen.queryByText(RESYNCED)).not.toBeInTheDocument();
  });

  it('unmounting clears the timer', () => {
    const live = mountBanner();
    reconnect(live);
    expect(vi.getTimerCount()).toBe(1);
    live.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
