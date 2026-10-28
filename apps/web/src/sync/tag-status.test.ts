import { describe, expect, it } from 'vitest';
import { REPLY_MS, SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';

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

  last(): Record<string, unknown> {
    const frame = this.sent[this.sent.length - 1];
    if (frame === undefined) throw new Error('nothing sent');
    return JSON.parse(frame) as Record<string, unknown>;
  }
}

function harness(): { socket: FakeSocket; client: SyncClient; advance: (ms: number) => void } {
  const socket = new FakeSocket();
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => socket,
    timers: {
      setTimeout(fn, ms) {
        const id = nextTimer;
        nextTimer += 1;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') timers.delete(handle);
      },
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  const client = new SyncClient(deps);
  return {
    socket,
    client,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

function live(): ReturnType<typeof harness> {
  const h = harness();
  h.client.start();
  h.socket.open();
  return h;
}

const DETAIL = {
  id: 'pr-1',
  name: 'Spring plan',
  status: 'accepted',
  rationale: null,
  baselineBoardId: 'base-1',
  boardId: 'board-1',
  createdAt: '2026-07-01T15:04:05.000Z',
  updatedAt: '2026-07-02T15:04:05.000Z',
  accepted: {
    byLogin: 'admin@example.test',
    at: '2026-07-02T15:04:05.000Z',
    summary: [
      {
        key: 'bishop',
        heading: 'Bishop',
        callings: [{ memberId: 'm-1', name: 'Ann Example', positionId: 'p-1', text: 'Ann Example as Bishop' }],
        releases: [],
      },
    ],
  },
};

type Case = {
  name: string;
  call: (client: SyncClient) => Promise<unknown>;
  sent: Record<string, unknown>;
  reply: Record<string, unknown>;
  wrongReply: Record<string, unknown>;
  expected: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    name: 'createTag',
    call: (c) => c.createTag('Musical'),
    sent: { type: 'createTag', name: 'Musical' },
    reply: { type: 'tagCreated', tagId: 't-9' },
    wrongReply: { type: 'memberUpdated' },
    expected: { ok: true, tagId: 't-9' },
  },
  {
    name: 'renameTag',
    call: (c) => c.renameTag('t-1', 'Choir'),
    sent: { type: 'renameTag', tagId: 't-1', name: 'Choir' },
    reply: { type: 'memberUpdated' },
    wrongReply: { type: 'tagDeleted', tagId: 't-1' },
    expected: { ok: true },
  },
  {
    name: 'deleteTag',
    call: (c) => c.deleteTag('t-1'),
    sent: { type: 'deleteTag', tagId: 't-1' },
    reply: { type: 'tagDeleted', tagId: 't-1' },
    wrongReply: { type: 'memberUpdated' },
    expected: { ok: true },
  },
  {
    name: 'getTagUsage',
    call: (c) => c.getTagUsage('t-1'),
    sent: { type: 'getTagUsage', tagId: 't-1' },
    reply: { type: 'tagUsage', tagId: 't-1', members: 3, callingPreferences: 0, callingTags: 2 },
    wrongReply: { type: 'tagDeleted', tagId: 't-1' },
    expected: { ok: true, members: 3, callingPreferences: 0, callingTags: 2 },
  },
  {
    name: 'setNeedsApproval',
    call: (c) => c.setNeedsApproval('m-1', true),
    sent: { type: 'setNeedsApproval', memberId: 'm-1', value: true },
    reply: { type: 'memberUpdated' },
    wrongReply: { type: 'statusChanged', proposalId: 'pr-1', status: 'draft' },
    expected: { ok: true },
  },
  {
    name: 'setProposalStatus',
    call: (c) => c.setProposalStatus('pr-1', 'accepted'),
    sent: { type: 'setProposalStatus', proposalId: 'pr-1', status: 'accepted' },
    reply: { type: 'statusChanged', proposalId: 'pr-1', status: 'accepted' },
    wrongReply: { type: 'memberUpdated' },
    expected: { ok: true, status: 'accepted' },
  },
  {
    name: 'getProposal',
    call: (c) => c.getProposal('pr-1'),
    sent: { type: 'getProposal', proposalId: 'pr-1' },
    reply: { type: 'proposalDetail', proposal: DETAIL },
    wrongReply: { type: 'statusChanged', proposalId: 'pr-1', status: 'draft' },
    expected: { ok: true, proposal: DETAIL },
  },
];

describe('tag and proposal-status sync methods', () => {
  it.each(CASES)('$name sends the exact message shape', ({ call, sent }) => {
    const { client, socket } = live();
    void call(client);
    expect(socket.last()).toEqual({ ...sent, requestId: 'req-1' });
  });

  it.each(CASES)('$name resolves ok on its reply type and ignores other types for the same requestId', async (c) => {
    const { client, socket } = live();
    let settled = false;
    const promise = c.call(client).then((result) => {
      settled = true;
      return result;
    });
    socket.receive({ ...c.wrongReply, requestId: 'req-1' });
    socket.receive({ ...c.reply, requestId: 'other-request' });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.receive({ ...c.reply, requestId: 'req-1' });
    await expect(promise).resolves.toEqual(c.expected);
  });

  it.each(CASES)('$name resolves a rejected reply as { ok:false, code, message }', async (c) => {
    const { client, socket } = live();
    const promise = c.call(client);
    socket.receive({ type: 'rejected', requestId: 'req-1', code: 'forbidden', message: 'only an admin' });
    await expect(promise).resolves.toEqual({ ok: false, code: 'forbidden', message: 'only an admin' });
  });

  it.each(CASES)('$name resolves offline when not live and on reply timeout', async (c) => {
    const offline = harness();
    await expect(c.call(offline.client)).resolves.toEqual({ ok: false, code: 'offline', message: 'offline' });
    expect(offline.socket.sent).toEqual([]);

    const { client, advance } = live();
    const promise = c.call(client);
    advance(REPLY_MS);
    await expect(promise).resolves.toEqual({ ok: false, code: 'offline', message: 'offline' });
  });

  it('getTagUsage with negative or non-integer counts resolves bad_reply', async () => {
    const bad = [
      { members: -1, callingPreferences: 0, callingTags: 0 },
      { members: 1.5, callingPreferences: 0, callingTags: 0 },
      { members: 0, callingPreferences: '2', callingTags: 0 },
      { members: 0, callingPreferences: 0 },
    ];
    for (const counts of bad) {
      const { client, socket } = live();
      const promise = client.getTagUsage('t-1');
      socket.receive({ type: 'tagUsage', requestId: 'req-1', tagId: 't-1', ...counts });
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('bad_reply');
    }
  });

  it('getProposal with a malformed detail or accepted block resolves bad_reply', async () => {
    const malformed = [
      { ...DETAIL, accepted: { byLogin: 'x', at: 5, summary: [] } },
      { ...DETAIL, accepted: { byLogin: 'x', at: 'now', summary: 'nope' } },
      { ...DETAIL, accepted: { byLogin: 'x', at: 'now', summary: [{ key: 'bishop' }] } },
      { ...DETAIL, accepted: 'yes' },
      { ...DETAIL, status: 'archived' },
      { ...DETAIL, createdAt: undefined },
    ];
    for (const proposal of malformed) {
      const { client, socket } = live();
      const promise = client.getProposal('pr-1');
      socket.receive({ type: 'proposalDetail', requestId: 'req-1', proposal });
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('bad_reply');
    }
  });

  it('getProposal accepts a Draft detail with accepted null', async () => {
    const { client, socket } = live();
    const promise = client.getProposal('pr-1');
    const draft = { ...DETAIL, status: 'draft', accepted: null };
    socket.receive({ type: 'proposalDetail', requestId: 'req-1', proposal: draft });
    await expect(promise).resolves.toEqual({ ok: true, proposal: draft });
  });

  it('boards entries keep acceptedAt; absent becomes null; an entry with acceptedAt 5 is dropped', () => {
    const { client, socket } = live();
    const entry = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({
      id,
      name: id,
      status: 'draft',
      tabOrder: 0,
      boardId: `b-${id}`,
      version: 1,
      updatedAt: '2026-07-01T15:04:05.000Z',
      ...extra,
    });
    socket.receive({
      type: 'boards',
      current: null,
      proposals: [
        entry('kept', { status: 'accepted', acceptedAt: '2026-07-02T15:04:05.000Z' }),
        entry('explicit-null', { acceptedAt: null }),
        entry('legacy', {}),
        entry('junk', { acceptedAt: 5 }),
      ],
    });
    const proposals = client.getState().boards?.proposals ?? [];
    expect(proposals.map((p) => [p.id, p.acceptedAt])).toEqual([
      ['kept', '2026-07-02T15:04:05.000Z'],
      ['explicit-null', null],
      ['legacy', null],
    ]);
  });
});
