import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };

const LABELS = ['Organizations and callings', 'Members without callings', 'Out-of-unit callings'] as const;
const READ_FAILURE = "Those files couldn't be read as the three LCR reports.";

const PREVIEW = {
  decisions: [
    {
      name: 'Pineda, Otto',
      key: 'pineda, otto',
      category: 'adult',
      sources: ['organizations'],
      externalCallings: [],
      kind: 'ambiguous',
      reason: 'resembles',
      candidates: [{ memberId: 'm-otto', name: 'Otto Pineda' }],
    },
  ],
  absent: [],
  duplicates: [],
  inconsistentReports: false,
  returning: [],
  needsCategory: [],
  unfamiliar: [],
  keptPositions: 4,
  matchedPositions: 12,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lastRequestId(sent: readonly string[], type: string): string {
  let found: string | null = null;
  for (const raw of sent) {
    const frame = JSON.parse(raw) as unknown;
    if (isRecord(frame) && frame.type === type && typeof frame.requestId === 'string') found = frame.requestId;
  }
  if (found === null) throw new Error(`no ${type} frame`);
  return found;
}

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
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

async function renderSettings(me: Me, current: { version: number } | null = { version: 7 }): Promise<void> {
  const { client, sockets } = makeClient();
  client.start();
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  render(
    <SyncProvider client={client}>
      <SettingsRoute />
    </SyncProvider>,
  );
  act(() => {
    socket.open();
  });
  act(() => {
    socket.receive({ type: 'me', requestId: lastRequestId(socket.sent, 'whoami'), user: me });
  });
  act(() => {
    socket.receive({
      type: 'boards',
      current:
        current === null
          ? null
          : { boardId: 'b-current', version: current.version, importVersion: 'v1', importedAt: '2026-01-01T00:00:00.000Z' },
      proposals: [],
    });
  });
  await screen.findByRole('heading', { name: 'Settings', level: 1 });
}

type Call = { url: string; body: Record<string, unknown> };

type Reply = { status: number; body?: unknown } | 'throw';

function stubFetch(replies: { preview?: Reply; replace?: Reply }): Call[] {
  const calls: Call[] = [];
  const fake = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ url, body: isRecord(parsed) ? parsed : {} });
    const reply = url.endsWith('/preview') ? (replies.preview ?? { status: 200, body: PREVIEW }) : (replies.replace ?? { status: 200, body: { matched: 1, created: 0, removed: 2 } });
    if (reply === 'throw') return Promise.reject(new TypeError('network'));
    return Promise.resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status }));
  });
  vi.stubGlobal('fetch', fake);
  return calls;
}

const CONTENTS = ['one-orgs', 'two-without', 'three-out'] as const;
const NAMES = ['secret-orgs.pdf', 'secret-without.pdf', 'secret-out.pdf'] as const;

function pdf(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name, { type: 'application/pdf' });
  // jsdom's File may lack arrayBuffer; define it so reading is deterministic.
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  });
  return file;
}

async function chooseAll(user: ReturnType<typeof userEvent.setup>, count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const label = LABELS[index];
    const content = CONTENTS[index];
    const name = NAMES[index];
    if (label === undefined || content === undefined || name === undefined) continue;
    await user.upload(screen.getByLabelText(label), pdf(name, content));
  }
}

function previewButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Preview import' });
}

async function openReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await chooseAll(user);
  await user.click(previewButton());
  await screen.findByRole('heading', { name: 'Review before replacing Current' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Import section in Settings', () => {
  it('Admins see the import section on Settings', async () => {
    stubFetch({});
    await renderSettings(ADMIN);
    expect(screen.getByRole('heading', { name: 'Import', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Replace Current with the three LCR reports. Nothing changes until you confirm.')).toBeInTheDocument();
    for (const label of LABELS) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('accept', 'application/pdf,.pdf');
    }
  });

  it("Editors don't see the import section", async () => {
    const calls = stubFetch({});
    await renderSettings(EDITOR);
    expect(screen.queryByRole('heading', { name: 'Import' })).not.toBeInTheDocument();
    for (const label of LABELS) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes('/api/import/'))).toHaveLength(0);
  });

  it('Preview stays disabled until all three reports are chosen', async () => {
    stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    expect(previewButton()).toBeDisabled();
    await user.upload(screen.getByLabelText(LABELS[0]), pdf(NAMES[0], CONTENTS[0]));
    expect(screen.getByText(NAMES[0])).toBeInTheDocument();
    expect(previewButton()).toBeDisabled();
    await user.upload(screen.getByLabelText(LABELS[1]), pdf(NAMES[1], CONTENTS[1]));
    expect(previewButton()).toBeDisabled();
    await user.upload(screen.getByLabelText(LABELS[2]), pdf(NAMES[2], CONTENTS[2]));
    expect(previewButton()).toBeEnabled();
  });

  it('Preview posts the three encoded reports', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('/api/import/preview');
    expect(call?.body).toEqual({
      organizations: btoa(CONTENTS[0]),
      withoutCallings: btoa(CONTENTS[1]),
      outOfUnit: btoa(CONTENTS[2]),
    });
  });

  it('a preview opens the review with the Current version', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN, { version: 12 });
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    await screen.findByText(/^Replaced Current/);
    const replace = calls.find((call) => call.url === '/api/import/replace');
    expect(replace?.body.expectedVersion).toBe(12);
  });

  it('replace sends the same reports and the resolutions', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.body).toEqual({
      organizations: btoa(CONTENTS[0]),
      withoutCallings: btoa(CONTENTS[1]),
      outOfUnit: btoa(CONTENTS[2]),
      expectedVersion: 7,
      resolutions: { 'pineda, otto': { action: 'new' } },
    });
  });

  it("replace success shows ImportReview's message", async () => {
    stubFetch({ replace: { status: 200, body: { matched: 5, created: 1, removed: 2 } } });
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    expect(await screen.findByText('Replaced Current. Matched 5, created 1, removed 2.')).toBeInTheDocument();
  });

  it('a stale replace shows the new version', async () => {
    stubFetch({ replace: { status: 409, body: { error: 'stale', currentVersion: 9 } } });
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    expect(await screen.findByText('Current changed. It is now version 9.')).toBeInTheDocument();
  });

  it.each([
    [{ status: 403 }, 'Only admins can import.'],
    [{ status: 413 }, 'Those files are too large to import.'],
    [{ status: 400 }, READ_FAILURE],
    ['throw' as const, "The import couldn't reach the server."],
  ])('each preview failure shows its message (%j)', async (reply, message) => {
    stubFetch({ preview: reply });
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await chooseAll(user);
    await user.click(previewButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    for (const label of LABELS) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(previewButton()).toBeEnabled();
  });

  it('an unreadable file shows the read failure', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await chooseAll(user, 2);
    const bad = pdf(NAMES[2], CONTENTS[2]);
    Object.defineProperty(bad, 'arrayBuffer', { configurable: true, value: () => Promise.reject(new Error('unreadable')) });
    await user.upload(screen.getByLabelText(LABELS[2]), bad);
    await user.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(READ_FAILURE);
    expect(calls).toHaveLength(0);
    expect(screen.getByLabelText(LABELS[0])).toBeInTheDocument();
  });

  it('Start over returns to the sources step', async () => {
    stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.queryByRole('heading', { name: 'Review before replacing Current' })).not.toBeInTheDocument();
    for (const label of LABELS) expect(screen.getByLabelText(label)).toHaveValue('');
    expect(screen.queryByText(NAMES[0])).not.toBeInTheDocument();
    expect(previewButton()).toBeDisabled();
  });

  it('no Current offers the first import with version 0', async () => {
    const calls = stubFetch({});
    const user = userEvent.setup();
    await renderSettings(ADMIN, null);
    const section = screen.getByRole('heading', { name: 'Import', level: 2 }).closest('section');
    if (section === null) throw new Error('expected a section');
    expect(within(section).queryByText('Import needs an existing Current board.')).not.toBeInTheDocument();
    for (const label of LABELS) expect(within(section).getByLabelText(label)).toBeInTheDocument();
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    await screen.findByText(/^Replaced Current/);
    const replace = calls.find((call) => call.url.endsWith('/replace'));
    expect(replace?.body.expectedVersion).toBe(0);
  });

  it('the reports never reach the console', async () => {
    stubFetch({});
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Treat as new person' }));
    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    await screen.findByText(/^Replaced Current/);
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String))));
    for (const secret of [...NAMES, ...CONTENTS.map((text) => btoa(text))]) expect(logged).not.toContain(secret);
  });
});
