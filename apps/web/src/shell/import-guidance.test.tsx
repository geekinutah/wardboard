import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };


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

const HINTS = [
  ['Organizations and callings', 'In LCR: Callings → Callings by Organization → Print → Download PDF. Choose Callings only, without Members or Ministering, if offered.'],
  ['Members without callings', 'In LCR: Reports → Members without Callings → Print → Download PDF.'],
  ['Out-of-unit callings', 'In LCR: Reports → Out-of-Unit Callings → Print → Download PDF.'],
] as const;

function pdf(name: string): File {
  return new File([new TextEncoder().encode('x')], name, { type: 'application/pdf' });
}

function sectionText(): string {
  return screen.getByRole('heading', { name: 'Import', level: 2 }).closest('section')?.textContent ?? '';
}

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Import sources guidance', () => {
  it('each picker shows its LCR path', async () => {
    await renderSettings(ADMIN);
    for (const [label, hint] of HINTS) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(hint);
    }
  });

  it('the how-to note is closed and gives the sign-in rule', async () => {
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    const summary = screen.getByText('How to get these reports');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    const steps = within(details as HTMLElement).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Sign in to LCR in your own browser. WardBoard never asks for your Church password or MFA code.',
      'Download the three reports above and keep them in a private folder.',
      'Choose each file here, then press Preview import. Nothing changes until you confirm.',
    ]);
    expect(details?.textContent).toContain('docs/import/guide.md');
  });

  it('first import says Create Current', async () => {
    await renderSettings(ADMIN, null);
    expect(screen.getByText('Create Current from the three LCR reports. Nothing changes until you confirm.')).toBeInTheDocument();
    expect(sectionText()).not.toContain('Replace Current');
  });

  it('with a Current the intro still says Replace Current', async () => {
    await renderSettings(ADMIN);
    expect(screen.getByText('Replace Current with the three LCR reports. Nothing changes until you confirm.')).toBeInTheDocument();
    expect(sectionText()).not.toContain('Create Current');
  });

  it('the copy never mentions a collector or scraper', async () => {
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await user.click(screen.getByText('How to get these reports'));
    const text = sectionText().toLowerCase();
    for (const word of ['collector', 'scrape', 'scraper']) expect(text).not.toContain(word);
  });

  it('a chosen file name shows once', async () => {
    const user = userEvent.setup();
    await renderSettings(ADMIN);
    await user.upload(screen.getByLabelText('Members without callings'), pdf('ward-members.pdf'));
    expect(screen.getAllByText('ward-members.pdf')).toHaveLength(1);
    expect(screen.getByLabelText('Members without callings').closest('div')?.textContent).toContain('ward-members.pdf');
  });
});
