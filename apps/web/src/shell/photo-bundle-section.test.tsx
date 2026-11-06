import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Member, MemberId, Ward } from '@wardboard/core';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me, RequestResult } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { PhotoBundleSection } from './PhotoBundleSection.tsx';
import { SettingsRoute } from './SettingsRoute.tsx';

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

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };

const SIGN_IN =
  'Sign in on the computer running WardBoard, in the window that opens there. A phone does not show that window. WardBoard never asks for your password.';
const COLLECTION = '/api/admin/photo-collection';
const CONTINUE = '/api/admin/photo-collection/continue';
const CANCEL = '/api/admin/photo-collection/cancel';

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return { url, method: (init?.method ?? 'GET').toUpperCase() };
}

function callsTo(fetchImpl: ReturnType<typeof vi.fn>, method: string, url: string): number {
  return fetchImpl.mock.calls.filter((call) => {
    const parts = requestParts(call[0] as RequestInfo | URL, call[1] as RequestInit | undefined);
    return parts.method === method && parts.url === url;
  }).length;
}

type Schedule = (run: () => void, delayMs: number) => () => void;

function holdSchedule(): { schedule: Schedule; queued: Array<() => void> } {
  const queued: Array<() => void> = [];
  const schedule: Schedule = vi.fn((run: () => void, delayMs: number) => {
    expect(delayMs).toBe(1000);
    queued.push(run);
    return () => {
      const index = queued.indexOf(run);
      if (index >= 0) queued.splice(index, 1);
    };
  });
  return { schedule, queued };
}

function makeWard(members: Array<{ id: string; name: string; photoRef: string | null }>): Ward {
  const membersRecord: Record<string, Member> = {};
  for (const m of members) {
    membersRecord[m.id] = {
      id: m.id as MemberId,
      name: m.name,
      category: 'adult',
      photoRef: m.photoRef,
      note: null,
      tagIds: [],
      needsApproval: false,
      removedDate: null,
      externalCallings: [],
    };
  }
  return {
    members: membersRecord,
    tags: {},
  };
}

function setupClient(): { client: SyncClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  let nextId = 1;
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => socket,
    timers: {
      setTimeout: () => {
        const id = nextId;
        nextId += 1;
        return id;
      },
      clearTimeout: () => {},
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  const client = new SyncClient(deps);
  client.start();
  return { client, socket };
}

function parseFrames(sent: readonly string[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const raw of sent) {
    const frame: unknown = JSON.parse(raw);
    if (typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === type) {
      found.push(frame);
    }
  }
  return found;
}

function deliverHello(
  socket: FakeSocket,
  me: Me,
  ward: Ward | null = null,
  client: SyncClient | null = null,
): void {
  act(() => {
    socket.open();
  });
  // PhotoBundleSection reads `me` from the sync store. The shell requests it;
  // a section rendered alone has to ask once so the reply can land.
  if (client !== null && parseFrames(socket.sent, 'whoami').length === 0) {
    act(() => {
      void client.whoami();
    });
  }
  const whoamiFrames = parseFrames(socket.sent, 'whoami');
  if (whoamiFrames.length > 0) {
    const whoami = whoamiFrames[whoamiFrames.length - 1];
    const requestId = whoami && typeof whoami.requestId === 'string' ? whoami.requestId : '';
    act(() => {
      socket.receive({ type: 'me', requestId, user: me });
    });
  }
  act(() => {
    socket.receive({
      type: 'boards',
      current: { boardId: 'board-current', version: 1, importVersion: 'v1', importedAt: '2026-01-01T00:00:00.000Z' },
      proposals: [],
    });
  });
  if (ward !== null) {
    act(() => {
      socket.receive({ type: 'ward', ward });
    });
  }
}

describe('PhotoBundleSection', () => {
  it('renders Directory photos section in Settings for both Editor and Admin', async () => {
    const user = userEvent.setup();
    // 1. Editor
    const editorSetup = setupClient();
    const { unmount } = render(
      <SyncProvider client={editorSetup.client}>
        <SettingsRoute />
      </SyncProvider>,
    );
    deliverHello(editorSetup.socket, EDITOR);
    await screen.findByRole('heading', { name: 'Settings', level: 1 });

    expect(screen.getByRole('heading', { level: 2, name: 'Directory photos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import an existing bundle' }));
    expect(screen.getByLabelText('Photo bundle files')).toBeInTheDocument();
    unmount();

    // 2. Admin
    const adminSetup = setupClient();
    render(
      <SyncProvider client={adminSetup.client}>
        <SettingsRoute />
      </SyncProvider>,
    );
    deliverHello(adminSetup.socket, ADMIN);
    await screen.findByRole('heading', { name: 'Settings', level: 1 });

    expect(screen.getByRole('heading', { level: 2, name: 'Directory photos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import an existing bundle' }));
    expect(screen.getByLabelText('Photo bundle files')).toBeInTheDocument();
  });

  it('requires confirmation for a duplicateName portrait before importing', async () => {
    const user = userEvent.setup();
    const ward = makeWard([
      { id: 'm-jane', name: 'Jane Doe', photoRef: null },
    ]);
    const setup = setupClient();

    const manifest = {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [{ name: 'Jane Doe', file: 'jane.png', duplicateName: true }],
      missing: [],
      skippedHousehold: 0,
    };

    const manifestFile = new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' });
    const photoFile = new File([new Uint8Array([1, 2, 3])], 'jane.png', { type: 'image/png' });

    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          portraits: [{ name: 'Jane Doe', file: 'jane.png', photoRef: 'jane-ref.png', duplicateName: true }],
          missing: [],
          skippedHousehold: 0,
        }),
    });

    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fakeFetch} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, ward, setup.client);

    await user.click(screen.getByRole('button', { name: 'Import an existing bundle' }));
    const fileInput = screen.getByLabelText('Photo bundle files');
    await user.upload(fileInput, [manifestFile, photoFile]);

    const reviewButton = screen.getByRole('button', { name: 'Review photo bundle' });
    expect(reviewButton).toBeEnabled();
    await user.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'Review photo matches' })).toBeInTheDocument();
    });

    const importButton = screen.getByRole('button', { name: 'Import photos' });
    // Disabled before confirmation
    expect(importButton).toBeDisabled();

    // Click assign option
    const assignBtn = screen.getByRole('button', { name: 'Assign to Jane Doe' });
    expect(assignBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(assignBtn);

    expect(assignBtn).toHaveAttribute('aria-pressed', 'true');
    expect(importButton).toBeEnabled();
  });

  it('applies first photos immediately and steps through replacements with PhotoBatchReview', async () => {
    const user = userEvent.setup();
    const ward = makeWard([
      { id: 'm-first', name: 'Alice Young', photoRef: null },
      { id: 'm-replace', name: 'Bob Smith', photoRef: 'bob-current.jpg' },
    ]);
    const setup = setupClient();

    const manifest = {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [
        { name: 'Alice Young', file: 'alice.png', duplicateName: false },
        { name: 'Bob Smith', file: 'bob.jpg', duplicateName: false },
      ],
      missing: [],
      skippedHousehold: 2,
    };

    const manifestFile = new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' });
    const aliceFile = new File([new Uint8Array([1])], 'alice.png', { type: 'image/png' });
    const bobFile = new File([new Uint8Array([2])], 'bob.jpg', { type: 'image/jpeg' });

    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          portraits: [
            { name: 'Alice Young', file: 'alice.png', photoRef: 'alice-ref.png', duplicateName: false },
            { name: 'Bob Smith', file: 'bob.jpg', photoRef: 'bob-ref.jpg', duplicateName: false },
          ],
          missing: [],
          skippedHousehold: 2,
        }),
    });

    const updateMemberSpy = vi.spyOn(setup.client, 'updateMember').mockResolvedValue({ ok: true } as RequestResult);

    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fakeFetch} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, ward, setup.client);

    await user.click(screen.getByRole('button', { name: 'Import an existing bundle' }));
    const fileInput = screen.getByLabelText('Photo bundle files');
    await user.upload(fileInput, [manifestFile, aliceFile, bobFile]);
    await user.click(screen.getByRole('button', { name: 'Review photo bundle' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: 'Review photo matches' })).toBeInTheDocument();
    });

    const importButton = screen.getByRole('button', { name: 'Import photos' });
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    // First photo was applied immediately
    await waitFor(() => {
      expect(updateMemberSpy).toHaveBeenCalledWith('m-first', { photoRef: 'alice-ref.png' });
    });

    // Replacement comparison dialog is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText("Replace Bob Smith's photo?")).toBeInTheDocument();
    expect(screen.getByText('Directory import · 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('2 household images were skipped — they aren\'t offered as portraits.')).toBeInTheDocument();

    // Click "Use New Photo"
    await user.click(screen.getByRole('button', { name: 'Use New Photo' }));

    await waitFor(() => {
      expect(updateMemberSpy).toHaveBeenCalledWith('m-replace', { photoRef: 'bob-ref.jpg' });
    });

    // Cleanup command appears
    await waitFor(() => {
      expect(screen.getByText('Imported directory photos: 1 added, 1 replaced, 0 kept.')).toBeInTheDocument();
      expect(screen.getByText('Clean up the temporary collector staging folder on your computer:')).toBeInTheDocument();
      expect(
        screen.getByText('pnpm --filter @wardboard/collector run collect -- --staging <staging-dir> --cleanup'),
      ).toBeInTheDocument();
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(String(fakeFetch.mock.calls[0]?.[0])).toBe('/api/photos/bundle');
  });

  it('shows an alert when the bundle files are incomplete or the server rejects the bundle', async () => {
    const user = userEvent.setup();
    const setup = setupClient();

    // Incomplete files: missing manifest.json
    const lonePhoto = new File([new Uint8Array([1])], 'lone.png', { type: 'image/png' });

    const { rerender } = render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, makeWard([]), setup.client);

    await user.click(screen.getByRole('button', { name: 'Import an existing bundle' }));
    let fileInput = screen.getByLabelText('Photo bundle files');
    await user.upload(fileInput, [lonePhoto]);
    await user.click(screen.getByRole('button', { name: 'Review photo bundle' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Select manifest.json and every portrait image from the collector's bundle folder.",
      );
    });

    // Server rejects bundle with invalid_bundle
    const manifest = {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [{ name: 'Solo', file: 'solo.png', duplicateName: false }],
      missing: [],
      skippedHousehold: 0,
    };
    const manifestFile = new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' });
    const soloPhoto = new File([new Uint8Array([1])], 'solo.png', { type: 'image/png' });

    const serverFails = vi.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_bundle' }),
    });

    rerender(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={serverFails} />
      </SyncProvider>,
    );

    fileInput = screen.getByLabelText('Photo bundle files');
    await user.upload(fileInput, [manifestFile, soloPhoto]);
    await user.click(screen.getByRole('button', { name: 'Review photo bundle' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('an editor does not see Collect and does not call the admin route', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const fetchImpl = vi.fn();
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, null, setup.client);

    const disclosure = screen.getByRole('button', { name: 'Import an existing bundle' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Collect from the directory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByText(SIGN_IN)).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(screen.getByLabelText('Photo bundle files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review photo bundle' })).toBeInTheDocument();
    expect(callsTo(fetchImpl, 'GET', COLLECTION)).toBe(0);
    expect(callsTo(fetchImpl, 'POST', COLLECTION)).toBe(0);
    expect(callsTo(fetchImpl, 'POST', CONTINUE)).toBe(0);
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(0);
  });

  it('an admin sees Collect and the sign-in sentence', async () => {
    const setup = setupClient();
    const { schedule } = holdSchedule();
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      expect(init?.credentials).toBe('same-origin');
      expect(parts).toEqual({ method: 'GET', url: COLLECTION });
      return jsonResponse(200, { status: 'idle', progress: '' });
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    expect(await screen.findByRole('button', { name: 'Collect from the directory' })).toBeInTheDocument();
    expect(screen.getByText(SIGN_IN)).toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: 'Import an existing bundle' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Photo bundle files')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review photo bundle' })).not.toBeInTheDocument();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('Collect posts and shows the progress line from GET', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const { schedule } = holdSchedule();
    let gets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      expect(init?.credentials).toBe('same-origin');
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        gets += 1;
        if (gets === 1) return jsonResponse(200, { status: 'idle', progress: '' });
        return jsonResponse(200, { status: 'running', progress: 'Households 1 of 2' });
      }
      if (parts.method === 'POST' && parts.url === COLLECTION) {
        return jsonResponse(200, { status: 'running' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Collect from the directory' }));
    expect(await screen.findByText('Households 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Households 1 of 2').closest('[aria-live="polite"]')).not.toBeNull();
    expect(callsTo(fetchImpl, 'POST', COLLECTION)).toBe(1);
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText(SIGN_IN)).toBeInTheDocument();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('needs-sign-in shows Continue and posts continue once', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const { schedule } = holdSchedule();
    let gets = 0;
    let releaseSecondGet = (): void => {};
    const secondGet = new Promise<void>((resolve) => {
      releaseSecondGet = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        gets += 1;
        if (gets === 1) {
          return jsonResponse(200, { status: 'needs-sign-in', progress: 'Waiting for you to sign in.' });
        }
        await secondGet;
        return jsonResponse(200, { status: 'running', progress: 'Households 2 of 2' });
      }
      if (parts.method === 'POST' && parts.url === CONTINUE) {
        return jsonResponse(200, { status: 'running' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    const continueButton = await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByText('Waiting for you to sign in.')).toBeInTheDocument();
    expect(screen.getByText(SIGN_IN)).toBeInTheDocument();
    expect(continueButton).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Collect from the directory' })).not.toBeInTheDocument();

    await user.click(continueButton);
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(callsTo(fetchImpl, 'POST', CONTINUE)).toBe(1);

    releaseSecondGet();
    expect(await screen.findByText('Households 2 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CONTINUE)).toBe(1);
  });

  it('a review payload opens the match screen without files', async () => {
    const setup = setupClient();
    const ward = makeWard([{ id: 'm-helen', name: 'Helen Fixture', photoRef: null }]);
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      expect(parts).toEqual({ method: 'GET', url: COLLECTION });
      return jsonResponse(200, {
        status: 'review',
        progress: '',
        bundle: {
          portraits: [
            { name: 'Helen Fixture', file: 'helen.png', photoRef: 'helen-ref.png', duplicateName: false },
          ],
          missing: [],
          skippedHousehold: 0,
        },
      });
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, ward, setup.client);

    expect(await screen.findByRole('heading', { level: 3, name: 'Review photo matches' })).toBeInTheDocument();
    expect(screen.getByText('Helen Fixture')).toBeInTheDocument();
    expect(screen.queryByLabelText('Photo bundle files')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review photo bundle' })).not.toBeInTheDocument();
  });

  it('a review payload waits for the ward before it matches', async () => {
    const setup = setupClient();
    const ward = makeWard([{ id: 'm-helen', name: 'Helen Fixture', photoRef: null }]);
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        return jsonResponse(200, {
          status: 'review',
          progress: '',
          bundle: {
            portraits: [
              { name: 'Helen Fixture', file: 'helen.png', photoRef: 'helen-ref.png', duplicateName: false },
            ],
            missing: [],
            skippedHousehold: 0,
          },
        });
      }
      if (parts.method === 'POST' && parts.url === CANCEL) {
        return jsonResponse(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    expect(await screen.findByRole('heading', { level: 3, name: 'Review photo matches' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import photos' })).toBeDisabled();
    expect(screen.queryByText('Not in ward — skipped')).not.toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(0);

    act(() => {
      setup.socket.receive({ type: 'ward', ward });
    });

    expect(await screen.findByText('First photo')).toBeInTheDocument();
    expect(screen.getByText('Helen Fixture')).toBeInTheDocument();
    expect(screen.queryByText('Not in ward — skipped')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import photos' })).toBeEnabled();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(0);
  });

  it('importing a collected bundle cancels the job and skips the cleanup command', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const ward = makeWard([{ id: 'm-helen', name: 'Helen Fixture', photoRef: null }]);
    vi.spyOn(setup.client, 'updateMember').mockResolvedValue({ ok: true } as RequestResult);
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        return jsonResponse(200, {
          status: 'review',
          progress: '',
          bundle: {
            portraits: [
              { name: 'Helen Fixture', file: 'helen.png', photoRef: 'helen-ref.png', duplicateName: false },
            ],
            missing: [],
            skippedHousehold: 0,
          },
        });
      }
      if (parts.method === 'POST' && parts.url === CANCEL) {
        return jsonResponse(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, ward, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Import photos' }));
    await waitFor(() => {
      expect(screen.getByText('Temporary collection files on this computer were removed.')).toBeInTheDocument();
    });
    expect(screen.getByText('Imported directory photos: 1 added, 0 replaced, 0 kept.')).toBeInTheDocument();
    expect(screen.queryByText(/--cleanup/)).not.toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(1);
  });

  it('cancel during sign-in posts cancel and returns to Collect', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const { schedule } = holdSchedule();
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        return jsonResponse(200, { status: 'needs-sign-in', progress: 'Sign in to continue.' });
      }
      if (parts.method === 'POST' && parts.url === CANCEL) {
        return jsonResponse(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Collect from the directory' })).toBeInTheDocument();
    expect(screen.getByText(SIGN_IN)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(1);
  });

  it('a failed collection shows the message and cancels once', async () => {
    const setup = setupClient();
    const { schedule, queued } = holdSchedule();
    let gets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        gets += 1;
        if (gets === 1) return jsonResponse(200, { status: 'running', progress: 'Working' });
        return jsonResponse(200, {
          status: 'failed',
          progress: '',
          message: 'Choose a staging folder outside any Git repository.',
        });
      }
      if (parts.method === 'POST' && parts.url === CANCEL) {
        return jsonResponse(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    expect(await screen.findByText('Working')).toBeInTheDocument();
    expect(schedule).toHaveBeenCalledTimes(1);
    const poll = queued[0];
    expect(poll).toBeDefined();
    act(() => {
      poll?.();
    });

    expect(
      await screen.findByText('Choose a staging folder outside any Git repository.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a staging folder outside any Git repository.');
    await waitFor(() => {
      expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(1);
    });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Collect from the directory' })).toBeInTheDocument();
  });

  it('an unavailable collector is a fixed alert', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const { schedule } = holdSchedule();
    let gets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        gets += 1;
        return jsonResponse(200, { status: 'idle', progress: '' });
      }
      if (parts.method === 'POST' && parts.url === COLLECTION) {
        return jsonResponse(503, { error: 'collector_unavailable' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Collect from the directory' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Directory collection is not available on this server.',
    );
    expect(gets).toBe(1);
    expect(callsTo(fetchImpl, 'POST', COLLECTION)).toBe(1);
    expect(schedule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Collect from the directory' })).toBeInTheDocument();
  });

  it('the file disclosure still reviews a chosen bundle', async () => {
    const user = userEvent.setup();
    const ward = makeWard([{ id: 'm-helen', name: 'Helen Fixture', photoRef: null }]);
    const setup = setupClient();
    const manifest = {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [{ name: 'Helen Fixture', file: 'helen.png', duplicateName: false }],
      missing: [],
      skippedHousehold: 0,
    };
    const manifestFile = new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' });
    const photoFile = new File([new Uint8Array([1, 2, 3])], 'helen.png', { type: 'image/png' });
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      expect(parts).toEqual({ method: 'POST', url: '/api/photos/bundle' });
      return jsonResponse(200, {
        portraits: [
          { name: 'Helen Fixture', file: 'helen.png', photoRef: 'helen-ref.png', duplicateName: false },
        ],
        missing: [],
        skippedHousehold: 0,
      });
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, ward, setup.client);

    const disclosure = screen.getByRole('button', { name: 'Import an existing bundle' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await user.upload(screen.getByLabelText('Photo bundle files'), [manifestFile, photoFile]);
    await user.click(screen.getByRole('button', { name: 'Review photo bundle' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Review photo matches' })).toBeInTheDocument();
    expect(screen.getByText('Helen Fixture')).toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(0);
    expect(callsTo(fetchImpl, 'GET', COLLECTION)).toBe(0);
  });

  it('starting over from collected matches posts cancel and returns to Collect', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const ward = makeWard([{ id: 'm-helen', name: 'Helen Fixture', photoRef: null }]);
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        return jsonResponse(200, {
          status: 'review',
          progress: '',
          bundle: {
            portraits: [
              { name: 'Helen Fixture', file: 'helen.png', photoRef: 'helen-ref.png', duplicateName: false },
            ],
            missing: [],
            skippedHousehold: 0,
          },
        });
      }
      if (parts.method === 'POST' && parts.url === CANCEL) {
        return jsonResponse(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, ward, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(await screen.findByRole('button', { name: 'Collect from the directory' })).toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', CANCEL)).toBe(1);
    expect(screen.queryByRole('heading', { level: 3, name: 'Review photo matches' })).not.toBeInTheDocument();
  });

  it('already running follows GET and does not alert', async () => {
    const user = userEvent.setup();
    const setup = setupClient();
    const { schedule } = holdSchedule();
    let gets = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parts = requestParts(input, init);
      if (parts.method === 'GET' && parts.url === COLLECTION) {
        gets += 1;
        if (gets === 1) return jsonResponse(200, { status: 'idle', progress: '' });
        return jsonResponse(200, { status: 'running', progress: 'Households 1 of 2' });
      }
      if (parts.method === 'POST' && parts.url === COLLECTION) {
        return jsonResponse(409, { error: 'already_running' });
      }
      throw new Error(`unexpected ${parts.method} ${parts.url}`);
    });
    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fetchImpl} schedule={schedule} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, ADMIN, null, setup.client);

    await user.click(await screen.findByRole('button', { name: 'Collect from the directory' }));
    expect(await screen.findByText('Households 1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(callsTo(fetchImpl, 'POST', COLLECTION)).toBe(1);
    expect(gets).toBe(2);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1000);
  });
});
