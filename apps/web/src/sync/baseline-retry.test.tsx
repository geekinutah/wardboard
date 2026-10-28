import type { Board, Ward } from '@wardboard/core';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';
import { SyncProvider, useBaseline } from './react.tsx';

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

function board(id: string): Board {
  return { id, kind: 'baseline', version: 0 } as unknown as Board;
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

function getBoardIds(sockets: readonly FakeSocket[]): string[] {
  return typedFrames(sockets, 'getBoard').map((frame) => {
    if (typeof frame.boardId !== 'string') throw new Error('getBoard frame is missing boardId');
    return frame.boardId;
  });
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

function BaselineProbe(): ReactElement {
  const baseline = useBaseline();
  return <p>baseline {baseline === null ? 'none' : baseline.id}</p>;
}

describe('useBaseline retry', () => {
  it('null baseline fetch retries after reconnect with the same id', async () => {
    const { client, sockets, advance } = mount();
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
      socket.receive({
        type: 'snapshot',
        boardId: 'board-1',
        version: 1,
        board: { id: 'board-1', kind: 'proposal', version: 1 },
        ward: WARD,
        proposal: proposal('base-1'),
      });
    });

    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(getBoardIds(sockets)).toEqual(['base-1']);

    await act(async () => {
      requireSocket(sockets).close(1006);
      await Promise.resolve();
    });
    expect(screen.getByText('baseline none')).toBeInTheDocument();
    expect(getBoardIds(sockets)).toEqual(['base-1']);

    act(() => {
      advance(1000);
    });
    act(() => {
      requireSocket(sockets).open();
    });
    expect(getBoardIds(sockets)).toEqual(['base-1', 'base-1']);
    expect(screen.getByText('baseline none')).toBeInTheDocument();

    const retry = typedFrames(sockets, 'getBoard').at(-1);
    if (retry === undefined || typeof retry.requestId !== 'string') {
      throw new Error('missing retry getBoard');
    }
    await act(async () => {
      requireSocket(sockets).receive({
        type: 'board',
        requestId: retry.requestId,
        board: board('base-1'),
      });
      await Promise.resolve();
    });
    expect(screen.getByText('baseline base-1')).toBeInTheDocument();
    expect(getBoardIds(sockets)).toEqual(['base-1', 'base-1']);
  });
});
