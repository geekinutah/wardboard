import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteTag, type Ward } from '@wardboard/core';
import { describe, expect, it } from 'vitest';
import { tagsScenario } from '../features/tags/fixtures.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };

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


async function renderRoute(me: Me, ward: Ward | null): Promise<{ socket: FakeSocket }> {
  const { client, sockets } = makeClient();
  client.start();
  const socket = requireSocket(sockets);
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
  if (ward !== null) {
    act(() => {
      socket.receive({ type: 'ward', ward });
    });
  }
  await screen.findByRole('heading', { name: 'Settings', level: 1 });
  return { socket };
}

function pushWard(socket: FakeSocket, ward: Ward): void {
  act(() => {
    socket.receive({ type: 'ward', ward });
  });
}

function tagRowTexts(): string[] {
  const section = screen.getByRole('region', { name: 'Tags' });
  return within(section)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent);
}

describe('Settings Tags section', () => {
  it('Settings shows the Tags section with ward tags and member counts', async () => {
    const s = tagsScenario();
    await renderRoute(ADMIN, s.ward);
    expect(screen.getByRole('heading', { name: 'Tags', level: 2 })).toBeInTheDocument();
    expect(tagRowTexts()).toEqual([
      'Evenings only1Delete Evenings only',
      'Outdoors0Delete Outdoors',
      'Pianist1Delete Pianist',
      'Weekday2Delete Weekday',
    ]);
  });

  it('shows Loading tags… until the ward arrives', async () => {
    const s = tagsScenario();
    const { socket } = await renderRoute(ADMIN, null);
    expect(screen.getByText('Loading tags…')).toBeInTheDocument();
    pushWard(socket, s.ward);
    expect(screen.queryByText('Loading tags…')).not.toBeInTheDocument();
    expect(tagRowTexts()).toHaveLength(4);
  });

  it('a direct load subscribes to Current so the ward arrives', async () => {
    const s = tagsScenario();
    const { socket } = await renderRoute(ADMIN, null);
    expect(parseFrames(socket.sent, 'subscribe')).toHaveLength(0);
    act(() => {
      socket.receive({
        type: 'boards',
        current: { boardId: 'b-current', version: 1, importVersion: 'v1', importedAt: '2026-01-01T00:00:00.000Z' },
        proposals: [],
      });
    });
    const frames = parseFrames(socket.sent, 'subscribe');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.boardId).toBe('b-current');
    expect(screen.getByText('Loading tags…')).toBeInTheDocument();
    pushWard(socket, s.ward);
    expect(parseFrames(socket.sent, 'subscribe')).toHaveLength(1);
    expect(tagRowTexts()).toHaveLength(4);
  });

  it('opening delete sends getTagUsage; the tagUsage reply fills the counts and enables Delete', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    const frames = parseFrames(socket.sent, 'getTagUsage');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.tagId).toBe(s.tags.weekday);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent("Counting where it's used…");
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeDisabled();
    act(() => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 7,
        callingPreferences: 3,
        callingTags: 0,
      });
    });
    await waitFor(() => {
      expect(dialog).toHaveTextContent('Removes it from 7 people and from the preferences on 3 callings.');
    });
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeEnabled();
  });

  it('Delete tag sends deleteTag; tagDeleted plus ward push removes the row', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Pianist' }));
    act(() => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 1,
        callingPreferences: 1,
        callingTags: 0,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete tag' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Delete tag' }));
    const frames = parseFrames(socket.sent, 'deleteTag');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.tagId).toBe(s.tags.pianist);
    const deleted = deleteTag(s.ward, [s.current], s.tags.pianist);
    if (!deleted.ok) throw new Error(deleted.error.message);
    act(() => {
      socket.receive({ type: 'tagDeleted', requestId: lastRequestId(socket.sent, 'deleteTag') });
    });
    pushWard(socket, deleted.value.ward);
    expect(await screen.findByRole('button', { name: 'Delete Weekday' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Pianist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('usage refusal shows the alert and Delete stays disabled', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        code: 'not_found',
        message: 'No such tag.',
      });
    });
    const dialog = screen.getByRole('dialog');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't count where it's used: No such tag.");
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a ward push clears cached usage so the next open refetches', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    act(() => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 2,
        callingPreferences: 1,
        callingTags: 0,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('Removes it from 2 people');
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Same ward, no push: the cached counts are reused instantly (still one fetch per open).
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Removes it from 2 people');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(parseFrames(socket.sent, 'getTagUsage')).toHaveLength(2);
    // Round 2: at most one request per tag is outstanding, so answer the second before the push
    // (async act lets the reply settle first, as separate socket messages do in a browser).
    await act(async () => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 2,
        callingPreferences: 1,
        callingTags: 0,
      });
      await Promise.resolve();
    });

    pushWard(socket, { ...s.ward });
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    expect(screen.getByRole('dialog')).toHaveTextContent("Counting where it's used…");
    expect(parseFrames(socket.sent, 'getTagUsage')).toHaveLength(3);
  });

  it('a ward push while getTagUsage is in flight still ends with counts and Delete enabled', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    const requestId = lastRequestId(socket.sent, 'getTagUsage');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent("Counting where it's used…");

    // Another editor's change lands before the server's tagUsage reply.
    pushWard(socket, { ...s.ward });
    // At most one request per tag is outstanding.
    expect(parseFrames(socket.sent, 'getTagUsage')).toHaveLength(1);
    act(() => {
      socket.receive({ type: 'tagUsage', requestId, members: 2, callingPreferences: 1, callingTags: 0 });
    });
    await waitFor(() => {
      expect(dialog).toHaveTextContent('Removes it from 2 people and from the preferences on 1 calling.');
    });
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeEnabled();
  });

  it('a ward push while the dialog shows counts refetches the open tag', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(ADMIN, s.ward);
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    act(() => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 2,
        callingPreferences: 1,
        callingTags: 0,
      });
    });
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(dialog).toHaveTextContent('Removes it from 2 people');
    });

    pushWard(socket, { ...s.ward });
    const frames = parseFrames(socket.sent, 'getTagUsage');
    expect(frames).toHaveLength(2);
    expect(frames[1]?.tagId).toBe(s.tags.weekday);
    // While the refetch is out, the open dialog keeps its last counts and Delete stays usable.
    expect(dialog).toHaveTextContent('Removes it from 2 people');
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeEnabled();
    act(() => {
      socket.receive({
        type: 'tagUsage',
        requestId: lastRequestId(socket.sent, 'getTagUsage'),
        members: 3,
        callingPreferences: 1,
        callingTags: 0,
      });
    });
    await waitFor(() => {
      expect(dialog).toHaveTextContent('Removes it from 3 people');
    });
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeEnabled();
  });

  it('editor sees and can use the library', async () => {
    const s = tagsScenario();
    const user = userEvent.setup();
    const { socket } = await renderRoute(EDITOR, s.ward);
    expect(screen.getByRole('heading', { name: 'Tags', level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ New tag' }));
    await user.type(screen.getByRole('textbox', { name: 'New tag name' }), 'Gardening');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const frames = parseFrames(socket.sent, 'createTag');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.name).toBe('Gardening');
    await user.click(screen.getByRole('button', { name: 'Delete Weekday' }));
    expect(parseFrames(socket.sent, 'getTagUsage')).toHaveLength(1);
  });
});
