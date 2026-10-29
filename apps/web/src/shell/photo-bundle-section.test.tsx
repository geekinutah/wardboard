import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Ward } from '@wardboard/core';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { Me } from '../sync/protocol.ts';
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

function makeWard(members: Array<{ id: string; name: string; photoRef: string | null }>): Ward {
  const membersRecord: Record<string, any> = {};
  for (const m of members) {
    membersRecord[m.id] = {
      id: m.id,
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
      return `req-${request}`;
    },
  };
  const client = new SyncClient(deps);
  client.start();
  return { client, socket };
}

function parseFrames(sent: readonly string[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const raw of sent) {
    const frame = JSON.parse(raw) as unknown;
    if (typeof frame === 'object' && frame !== null && (frame as any).type === type) found.push(frame as any);
  }
  return found;
}

function lastRequestId(sent: readonly string[], type: string): string {
  const frames = parseFrames(sent, type);
  const frame = frames[frames.length - 1];
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`no ${type} frame`);
  return frame.requestId;
}

function deliverHello(socket: FakeSocket, me: Me, ward: Ward | null = null): void {
  act(() => {
    socket.open();
  });
  const whoamiFrames = parseFrames(socket.sent, 'whoami');
  if (whoamiFrames.length > 0) {
    const whoami = whoamiFrames[whoamiFrames.length - 1];
    act(() => {
      socket.receive({ type: 'me', requestId: String(whoami?.requestId ?? ''), user: me });
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
        <PhotoBundleSection fetchImpl={fakeFetch as any} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, ward);

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

    const updateMemberSpy = vi.spyOn(setup.client, 'updateMember').mockResolvedValue({ ok: true });

    render(
      <SyncProvider client={setup.client}>
        <PhotoBundleSection fetchImpl={fakeFetch as any} />
      </SyncProvider>,
    );
    deliverHello(setup.socket, EDITOR, ward);

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
    deliverHello(setup.socket, EDITOR, makeWard([]));

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
        <PhotoBundleSection fetchImpl={serverFails as any} />
      </SyncProvider>,
    );

    fileInput = screen.getByLabelText('Photo bundle files');
    await user.upload(fileInput, [manifestFile, soloPhoto]);
    await user.click(screen.getByRole('button', { name: 'Review photo bundle' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
