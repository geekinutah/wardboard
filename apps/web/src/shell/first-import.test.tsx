import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import type { HealthClient, HealthResponse } from '../health.ts';
import type { Me } from '../sync/protocol.ts';

const layoutMock = vi.hoisted((): { value: 'phone' | 'desktop' } => ({ value: 'phone' }));
vi.mock('./useLayout.ts', () => ({ useLayout: () => layoutMock.value }));

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };
const LABELS = ['Organizations and callings', 'Members without callings', 'Out-of-unit callings', 'Member list'] as const;
const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function frames(socket: FakeWebSocket, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const raw of socket.sent) {
    const frame: unknown = JSON.parse(raw);
    if (isRecord(frame) && frame.type === type) found.push(frame);
  }
  return found;
}

function liveSocket(): FakeWebSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function connect(me: Me | null): FakeWebSocket {
  const socket = liveSocket();
  act(() => {
    socket.open();
  });
  if (me !== null) {
    const requestId = frames(socket, 'whoami').at(-1)?.requestId;
    act(() => {
      socket.receive({ type: 'me', requestId, user: me });
    });
  }
  return socket;
}

function showBoards(socket: FakeWebSocket, hasCurrent: boolean): void {
  act(() => {
    socket.receive({
      type: 'boards',
      current: hasCurrent
        ? { boardId: 'b-current', version: 3, importVersion: 'v1', importedAt: '2026-01-01T00:00:00.000Z' }
        : null,
      proposals: [],
    });
  });
}

let fetchCalls: string[] = [];

beforeEach(() => {
  sockets.length = 0;
  fetchCalls = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      fetchCalls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }),
  );
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('first import', () => {
  it.each(['phone', 'desktop'] as const)('no Current opens the import workflow for an Admin (%s layout)', (layout) => {
    layoutMock.value = layout;
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(ADMIN), false);

    expect(screen.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeInTheDocument();
    expect(
      screen.getByText("There's no Current board yet. Import the ward's four LCR reports, or restore a backup."),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Restore a backup' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    for (const label of LABELS) expect(within(main).getByLabelText(label)).toBeInTheDocument();
  });

  it('an Editor sees the explanation and no import', () => {
    layoutMock.value = 'desktop';
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(EDITOR), false);

    expect(screen.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeInTheDocument();
    expect(
      screen.getByText("WardBoard has no Current board yet. Ask an Admin to import the ward's reports or restore a backup."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Restore a backup' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Backup file')).not.toBeInTheDocument();
    for (const label of LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(fetchCalls.filter((url) => url.includes('/api/import/'))).toEqual([]);
  });

  it('shows Loading until me arrives', () => {
    layoutMock.value = 'desktop';
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(null), false);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    for (const label of LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    act(() => {
      liveSocket().receive({ type: 'me', requestId: frames(liveSocket(), 'whoami').at(-1)?.requestId, user: ADMIN });
    });
    expect(screen.getByLabelText(LABELS[0])).toBeInTheDocument();
  });

  it.each(['phone', 'desktop'] as const)('the board appears when Current arrives (%s layout)', (layout) => {
    layoutMock.value = layout;
    render(<App healthClient={pendingHealth} />);
    const socket = connect(ADMIN);
    showBoards(socket, false);
    expect(screen.getByRole('heading', { name: 'Set up WardBoard' })).toBeInTheDocument();

    showBoards(socket, true);
    expect(screen.queryByRole('heading', { name: 'Set up WardBoard' })).not.toBeInTheDocument();
    if (layout === 'phone') expect(screen.getByRole('navigation', { name: 'Board sections' })).toBeInTheDocument();
    else expect(screen.getByRole('tablist', { name: 'Boards' })).toBeInTheDocument();
    expect(frames(socket, 'subscribe').map((frame) => frame.boardId)).toContain('b-current');
  });

  it('a loaded Current never shows the setup page', () => {
    layoutMock.value = 'phone';
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(ADMIN), true);

    expect(screen.queryByRole('heading', { name: 'Set up WardBoard' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Board sections' })).toBeInTheDocument();
  });

  it('an Admin can restore a backup when there is no Current', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/', assign } as unknown as Location);
    const summary = {
      createdAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: 1,
      members: 41,
      proposals: 3,
      users: 2,
      photos: 12,
      hasCurrent: true,
    };
    const fetchStub = vi.fn<typeof fetch>((input) => {
      const body =
        typeof input === 'string' && input.endsWith('mode=apply') ? { restored: true, summary } : { summary };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchStub);
    layoutMock.value = 'desktop';
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(ADMIN), false);

    expect(screen.getByRole('heading', { level: 2, name: 'Restore a backup' })).toBeInTheDocument();
    const file = new File(['fictional backup'], 'ward.backup', { type: 'application/octet-stream' });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('41 members')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Replace all data' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/');
    });
    expect(fetchStub.mock.calls.map((call) => call[0])).toEqual([
      '/api/admin/restore?mode=dry-run',
      '/api/admin/restore?mode=apply',
    ]);
    const apply = fetchStub.mock.calls[1]?.[1];
    expect(apply?.method).toBe('POST');
    expect(apply?.body).toBe(file);
    expect(apply?.credentials).toBe('same-origin');
  });

  it('Settings stays reachable without a Current', () => {
    layoutMock.value = 'desktop';
    window.history.replaceState(null, '', '/settings');
    render(<App healthClient={pendingHealth} />);
    showBoards(connect(ADMIN), false);

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up WardBoard' })).not.toBeInTheDocument();
  });
});
