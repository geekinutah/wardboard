import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { AccessInvitation, AccessUser, Me } from '../sync/protocol.ts';
import { SyncProvider, useSyncClient } from '../sync/react.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };

const USERS: AccessUser[] = [
  {
    id: 'u-ada',
    login: 'ada@example.test',
    displayName: 'Ada Admin',
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
  },
  {
    id: 'u-ben',
    login: 'ben@example.test',
    displayName: 'Ben Editor',
    role: 'editor',
    createdAt: '2026-01-02T00:00:00.000Z',
    revokedAt: null,
  },
];

const INVITE: AccessInvitation = {
  id: 'inv-cy',
  login: 'cy@example.test',
  invitedBy: 'u-ada',
  createdAt: '2026-02-01T00:00:00.000Z',
};

const SUMMARY = {
  createdAt: '2026-07-01T00:00:00.000Z',
  schemaVersion: 1,
  members: 41,
  proposals: 3,
  users: 2,
  photos: 12,
  hasCurrent: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFrames(sent: readonly string[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const raw of sent) {
    const frame = JSON.parse(raw) as unknown;
    if (isRecord(frame) && frame.type === type) found.push(frame);
  }
  return found;
}

function lastRequestId(sent: readonly string[], type: string): string {
  const frames = parseFrames(sent, type);
  const frame = frames[frames.length - 1];
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`no ${type} frame`);
  return frame.requestId;
}

// Fake socket for an injected SyncClient (the BoardShell.test.tsx pattern).
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

function makeClient(): { client: SyncClient; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  let nextId = 1;
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
        const id = nextId;
        nextId += 1;
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

function requireSocket(sockets: readonly FakeSocket[]): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

async function renderRoute(me: Me): Promise<{ client: SyncClient; socket: FakeSocket; unmount: () => void }> {
  const { client, sockets } = makeClient();
  client.start();
  const socket = requireSocket(sockets);
  const { unmount } = render(
    <SyncProvider client={client}>
      <SettingsRoute />
    </SyncProvider>,
  );
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  act(() => {
    socket.open();
  });
  act(() => {
    socket.receive({ type: 'me', requestId: lastRequestId(socket.sent, 'whoami'), user: me });
  });
  await screen.findByRole('heading', { name: 'Settings', level: 1 });
  return { client, socket, unmount };
}

// Fake browser WebSocket so App's own SyncProvider (browserClient) can be driven.
class FakeBrowserSocket {
  static instances: FakeBrowserSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeBrowserSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function requireBrowserSocket(): FakeBrowserSocket {
  const socket = FakeBrowserSocket.instances[FakeBrowserSocket.instances.length - 1];
  if (socket === undefined) throw new Error('expected a browser socket');
  return socket;
}

async function renderAppSignedIn(): Promise<FakeBrowserSocket> {
  render(<App healthClient={pendingHealth} />);
  const socket = requireBrowserSocket();
  act(() => {
    socket.open();
  });
  await waitFor(() => {
    expect(parseFrames(socket.sent, 'whoami').length).toBeGreaterThan(0);
  });
  act(() => {
    socket.receive({ type: 'me', requestId: lastRequestId(socket.sent, 'whoami'), user: ADMIN });
  });
  return socket;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  FakeBrowserSocket.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Settings route', () => {
  it('useSyncClient returns the provider\'s client and throws outside SyncProvider', () => {
    const { client } = makeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SyncProvider client={client}>{children}</SyncProvider>
    );
    const { result } = renderHook(() => useSyncClient(), { wrapper });
    expect(result.current).toBe(client);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSyncClient())).toThrow('useSyncClient must be used within SyncProvider');
  });

  it('Settings link opens /settings without reloading; Back returns', async () => {
    vi.stubGlobal('WebSocket', FakeBrowserSocket);
    const pushState = vi.spyOn(window.history, 'pushState');
    const user = userEvent.setup();
    const socket = await renderAppSignedIn();

    const banner = screen.getByRole('banner');
    const link = await within(banner).findByRole('link', { name: 'Settings' });
    expect(link).toHaveAttribute('href', '/settings');
    await user.click(link);

    expect(window.location.pathname).toBe('/settings');
    expect(pushState).toHaveBeenCalledWith(expect.anything(), '', '/settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    // Same socket, still open: the sync client was not restarted.
    expect(FakeBrowserSocket.instances).toHaveLength(1);
    expect(socket.closed).toBe(false);

    await user.click(screen.getByRole('button', { name: '← Back to board' }));
    expect(window.location.pathname).toBe('/');
    expect(pushState).toHaveBeenLastCalledWith(expect.anything(), '', '/');
    expect(within(screen.getByRole('banner')).getByText('WardBoard')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings', level: 1 })).not.toBeInTheDocument();
    expect(FakeBrowserSocket.instances).toHaveLength(1);
    expect(socket.closed).toBe(false);
  });

  it('browser back from /settings shows the board', async () => {
    vi.stubGlobal('WebSocket', FakeBrowserSocket);
    const user = userEvent.setup();
    await renderAppSignedIn();

    await user.click(await within(screen.getByRole('banner')).findByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(within(screen.getByRole('banner')).getByText('WardBoard')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings', level: 1 })).not.toBeInTheDocument();
    expect(FakeBrowserSocket.instances).toHaveLength(1);
  });

  it('admin sees the access list from listAccess and its pushes', async () => {
    const { socket } = await renderRoute(ADMIN);
    expect(parseFrames(socket.sent, 'listAccess')).toHaveLength(1);

    act(() => {
      socket.receive({
        type: 'access',
        requestId: lastRequestId(socket.sent, 'listAccess'),
        users: USERS,
        invitations: [],
      });
    });
    expect(await screen.findByText('Ben Editor')).toBeInTheDocument();
    expect(screen.queryByText('cy@example.test')).not.toBeInTheDocument();

    act(() => {
      socket.receive({ type: 'access', requestId: '', users: USERS, invitations: [INVITE] });
    });
    expect(await screen.findByText('cy@example.test')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
  });

  it('invite sends invite and shows the mapped error on refusal', async () => {
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN);
    act(() => {
      socket.receive({
        type: 'access',
        requestId: lastRequestId(socket.sent, 'listAccess'),
        users: USERS,
        invitations: [INVITE],
      });
    });

    await user.type(screen.getByLabelText('Login to invite'), 'cy@example.test');
    await user.click(screen.getByRole('button', { name: 'Invite editor' }));

    const invites = parseFrames(socket.sent, 'invite');
    expect(invites).toHaveLength(1);
    expect(invites[0]?.login).toBe('cy@example.test');

    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: lastRequestId(socket.sent, 'invite'),
        code: 'already_invited',
        message: 'already invited',
      });
    });
    expect(await screen.findByText('That login is already invited.')).toBeInTheDocument();
    expect(screen.queryByText(/already_invited/)).not.toBeInTheDocument();
  });

  it('maps an unknown refusal code to forbidden', async () => {
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN);
    act(() => {
      socket.receive({
        type: 'access',
        requestId: lastRequestId(socket.sent, 'listAccess'),
        users: USERS,
        invitations: [INVITE],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    const revokes = parseFrames(socket.sent, 'revokeInvitation');
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.invitationId).toBe('inv-cy');
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: lastRequestId(socket.sent, 'revokeInvitation'),
        code: 'something_new',
        message: 'unknown',
      });
    });
    expect(await screen.findByText('Only an Admin can do that.')).toBeInTheDocument();
  });

  it('editor never calls listAccess', async () => {
    const { socket } = await renderRoute(EDITOR);
    expect(screen.getByText('Only an Admin can manage access.')).toBeInTheDocument();
    expect(parseFrames(socket.sent, 'listAccess')).toHaveLength(0);
  });

  it('restore dry-run maps 200, 422, 413, 403 and network errors', async () => {
    const jsonResponse = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const cases: { name: string; reply: () => Promise<Response>; expectText: string; dialog: boolean }[] = [
      {
        name: '200',
        reply: () => Promise.resolve(jsonResponse(200, { summary: SUMMARY })),
        expectText: '41 members',
        dialog: true,
      },
      {
        name: '422',
        reply: () => Promise.resolve(jsonResponse(422, { error: 'corrupt_database' })),
        expectText: "The backup's database is damaged.",
        dialog: false,
      },
      {
        name: '413',
        reply: () => Promise.resolve(jsonResponse(413, { error: 'too_large' })),
        expectText: 'The file is too large to be a WardBoard backup.',
        dialog: false,
      },
      {
        name: '403',
        reply: () => Promise.resolve(jsonResponse(403, { error: 'forbidden' })),
        expectText: 'Only an Admin can restore backups.',
        dialog: false,
      },
      {
        name: 'network error',
        reply: () => Promise.reject(new TypeError('Failed to fetch')),
        expectText: 'Not connected. Try again when the connection is back.',
        dialog: false,
      },
    ];

    for (const testCase of cases) {
      const fetchStub = vi.fn<typeof fetch>(() => testCase.reply());
      vi.stubGlobal('fetch', fetchStub);
      const { client, unmount } = await renderRoute(ADMIN);

      const file = new File(['fictional backup'], 'ward.backup', { type: 'application/octet-stream' });
      fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });

      expect(await screen.findByText(testCase.expectText), testCase.name).toBeInTheDocument();
      if (testCase.dialog) {
        expect(screen.getByRole('dialog'), testCase.name).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('dialog'), testCase.name).not.toBeInTheDocument();
        expect(screen.getByRole('alert'), testCase.name).toHaveTextContent(testCase.expectText);
      }
      expect(fetchStub, testCase.name).toHaveBeenCalledTimes(1);
      const [url, init] = fetchStub.mock.calls[0] ?? [];
      expect(url, testCase.name).toBe('/api/admin/restore?mode=dry-run');
      expect(init?.method, testCase.name).toBe('POST');
      expect(init?.body, testCase.name).toBe(file);
      expect(init?.credentials, testCase.name).toBe('same-origin');

      act(() => {
        client.stop();
      });
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('apply success navigates to /', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const fakeLocation = { pathname: '/settings', assign } as unknown as Location;
    vi.spyOn(window, 'location', 'get').mockReturnValue(fakeLocation);
    const fetchStub = vi.fn<typeof fetch>((input) => {
      const body = typeof input === 'string' && input.endsWith('mode=apply') ? { restored: true, summary: SUMMARY } : { summary: SUMMARY };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchStub);
    await renderRoute(ADMIN);

    const file = new File(['fictional backup'], 'ward.backup', { type: 'application/octet-stream' });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog');
    expect(assign).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Replace all data' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/');
    });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    const [url, init] = fetchStub.mock.calls[1] ?? [];
    expect(url).toBe('/api/admin/restore?mode=apply');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(file);
    expect(init?.credentials).toBe('same-origin');
  });
});
