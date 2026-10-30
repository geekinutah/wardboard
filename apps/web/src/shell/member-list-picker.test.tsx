import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportReview } from '../features/import/ImportReview.tsx';
import type { ImportPreview } from '../features/import/plan.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };

const LABELS = ['Organizations and callings', 'Members without callings', 'Out-of-unit callings', 'Member list'] as const;
const CONTENTS = ['one-orgs', 'two-without', 'three-out', 'four-members'] as const;
const HINT =
  'In LCR: Reports → Member Directory → Print → Download PDF. The printed report is titled "Member List".';

const PREVIEW: ImportPreview = {
  decisions: [
    {
      name: 'Pineda, Otto',
      key: 'pineda, otto',
      category: 'adult',
      sources: ['organizations'],
      externalCallings: [],
      kind: 'new',
    },
  ],
  absent: [],
  duplicates: [],
  inconsistentReports: false,
  returning: [],
  needsCategory: [],
  unfamiliar: [],
  keptPositions: 0,
  matchedPositions: 0,
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

function stubFetch(): Call[] {
  const calls: Call[] = [];
  const fake = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ url, body: isRecord(parsed) ? parsed : {} });
    const reply = url.endsWith('/preview') ? PREVIEW : { matched: 0, created: 1, removed: 0 };
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
  });
  vi.stubGlobal('fetch', fake);
  return calls;
}

function pdf(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  });
  return file;
}

function previewButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Preview import' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Member list picker', () => {
  it('the fourth picker is required', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSettings(ADMIN);

    const picker = screen.getByLabelText('Member list');
    expect(picker).toHaveAttribute('type', 'file');
    expect(picker).toHaveAttribute('accept', 'application/pdf,.pdf');
    expect(picker).toHaveAccessibleDescription(HINT);
    // The fourth picker comes after Out-of-unit callings.
    const section = screen.getByRole('heading', { name: 'Import', level: 2 }).closest('section');
    if (section === null) throw new Error('expected a section');
    const order = Array.from(section.querySelectorAll('label')).map((label) => label.textContent);
    expect(order).toEqual([...LABELS]);

    for (let index = 0; index < 3; index += 1) {
      const label = LABELS[index];
      const content = CONTENTS[index];
      if (label === undefined || content === undefined) continue;
      await user.upload(screen.getByLabelText(label), pdf(`${content}.pdf`, content));
    }
    expect(previewButton()).toBeDisabled();
    await user.upload(picker, pdf('members.pdf', CONTENTS[3]));
    expect(within(section).getByText('members.pdf')).toBeInTheDocument();
    expect(previewButton()).toBeEnabled();

    await user.click(previewButton());
    await screen.findByRole('heading', { name: 'Review before replacing Current' });
    expect(calls[0]?.url).toBe('/api/import/preview');
    expect(calls[0]?.body).toEqual({
      organizations: btoa(CONTENTS[0]),
      withoutCallings: btoa(CONTENTS[1]),
      outOfUnit: btoa(CONTENTS[2]),
      memberList: btoa(CONTENTS[3]),
    });

    await user.click(screen.getByRole('button', { name: 'Replace Current' }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.url).toBe('/api/import/replace');
    expect(calls[1]?.body.memberList).toBe(btoa(CONTENTS[3]));
  });

  it('the review shows the member list source', () => {
    render(
      <ImportReview
        preview={PREVIEW}
        expectedVersion={3}
        onReplace={() => Promise.resolve({ ok: true, matched: 0, created: 1, removed: 0 })}
      />,
    );
    const card = screen.getByRole('article', { name: 'Member list, Validated' });
    expect(within(card).getByText('Member list')).toBeInTheDocument();
    expect(within(card).getByText('Validated')).toBeInTheDocument();
    const names = screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'));
    expect(names.indexOf('Member list, Validated')).toBe(names.indexOf('Out-of-Unit Callings, Validated') + 1);
  });
});
