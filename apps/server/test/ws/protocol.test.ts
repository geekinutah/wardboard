import { afterEach, describe, expect, it } from 'vitest';
import { seedFixture } from '../../dev/index.ts';
import {
  Inbox,
  asRecord,
  cleanup,
  occupiedPosition,
  openSocket,
  opMessage,
  requireBoard,
  seedDraftProposals,
  startAdmin,
  subscribe,
  vacantPosition,
} from './helpers.ts';

afterEach(cleanup);

describe('operation channel protocol', () => {
  it('listBoards returns current and proposals', async () => {
    const empty = await startAdmin();
    const emptySocket = await openSocket(empty);
    const emptyInbox = new Inbox(emptySocket);
    const emptyPending = emptyInbox.next();
    emptySocket.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await emptyPending)).toEqual({ type: 'boards', current: null, proposals: [] });
    expect(empty.store.loadCurrent()).toBeNull();
    expect(empty.store.listProposals()).toEqual([]);

    const seeded = await startAdmin(seedFixture);
    const current = seeded.store.loadCurrent();
    expect(current).not.toBeNull();
    if (current === null) return;
    const socket = await openSocket(seeded);
    const inbox = new Inbox(socket);
    const pending = inbox.next();
    socket.send(JSON.stringify({ type: 'listBoards', extra: true }));
    expect(asRecord(await pending)).toEqual({ type: 'error', code: 'bad_request' });

    const listed = inbox.next();
    socket.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await listed)).toEqual({
      type: 'boards',
      current: {
        boardId: current.board.id,
        version: current.board.version,
        importVersion: current.importVersion,
        importedAt: current.importedAt,
      },
      proposals: seeded.store.listProposals(),
    });
  });

  it('subscribe returns a snapshot of board, ward and proposal meta', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    const proposal = session.store.loadProposal(summary.id);
    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    const current = session.store.loadCurrent();
    expect(current).not.toBeNull();
    if (current === null) return;

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const snapshot = await subscribe(ws, inbox, proposal.board.id);
    expect(snapshot).toEqual({
      type: 'snapshot',
      boardId: proposal.board.id,
      version: proposal.board.version,
      board: session.store.loadBoard(proposal.board.id),
      ward: session.store.loadWard(),
      proposal: {
        id: proposal.id,
        name: proposal.name,
        status: proposal.status,
        rationale: proposal.rationale,
        baselineBoardId: proposal.baseline.id,
      },
    });

    const currentSnapshot = await subscribe(ws, inbox, current.board.id);
    expect(currentSnapshot.proposal).toBeNull();
    expect(currentSnapshot.board).toEqual(session.store.loadBoard(current.board.id));
    expect(currentSnapshot.ward).toEqual(session.store.loadWard());

    const baselineSnapshot = await subscribe(ws, inbox, proposal.baseline.id);
    expect(baselineSnapshot.proposal).toBeNull();
    expect(baselineSnapshot.board).toEqual(session.store.loadBoard(proposal.baseline.id));
    expect(baselineSnapshot.version).toBe(proposal.baseline.version);
  });

  it('subscribe to unknown board is not_found', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    await subscribe(ws, inbox, summary.boardId);

    const pending = inbox.next();
    ws.send(JSON.stringify({ type: 'subscribe', boardId: 'missing-board' }));
    expect(asRecord(await pending)).toEqual({ type: 'error', code: 'not_found', boardId: 'missing-board' });

    const still = inbox.next();
    ws.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await still).type).toBe('boards');
    expect(ws.readyState).toBe(ws.OPEN);
  });

  it('op on an unsubscribed board is not_subscribed', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const proposal = session.store.loadProposal(summary.id);
    if (proposal === null) throw new Error('missing proposal');
    const board = requireBoard(session.store, proposal.board.id);
    const chorister = vacantPosition(board, 'Chorister');
    const clerk = occupiedPosition(board, 'Ward Clerk');
    const before = session.store.loadBoard(proposal.board.id);

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, proposal.baseline.id);

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'cross-board',
        boardId: proposal.board.id,
        baseVersion: proposal.board.version,
        kind: 'placeInPosition',
        request: { memberId: clerk.memberId, from: null, to: chorister.id },
      }),
    );
    const rejected = asRecord(await pending);
    expect(rejected.type).toBe('rejected');
    expect(rejected.code).toBe('not_subscribed');
    expect(typeof rejected.message).toBe('string');
    expect(session.store.loadBoard(proposal.board.id)).toEqual(before);
  });

  it('op shape validation', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const before = session.store.loadBoard(summary.boardId);
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const validRequest = { memberId: 'm-0001', from: null, to: 'p-0001' };
    const cases: { name: string; message: unknown; code: string }[] = [
      {
        name: 'missing requestId',
        message: {
          type: 'op',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'bad_request',
      },
      {
        name: 'empty requestId',
        message: {
          type: 'op',
          requestId: '',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'bad_request',
      },
      {
        name: 'requestId longer than 64',
        message: {
          type: 'op',
          requestId: 'x'.repeat(65),
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'bad_request',
      },
      {
        name: 'negative baseVersion',
        message: {
          type: 'op',
          requestId: 'neg',
          boardId: summary.boardId,
          baseVersion: -1,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'bad_request',
      },
      {
        name: 'fractional baseVersion',
        message: {
          type: 'op',
          requestId: 'frac',
          boardId: summary.boardId,
          baseVersion: 1.5,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'bad_request',
      },
      {
        name: 'unknown kind',
        message: {
          type: 'op',
          requestId: 'unknown',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'renameMember', request: {} },
        },
        code: 'unknown_operation',
      },
      {
        name: 'extra request key',
        message: {
          type: 'op',
          requestId: 'extra',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: { ...validRequest, extra: true } },
        },
        code: 'bad_request',
      },
      {
        name: 'extra envelope key',
        message: {
          type: 'op',
          requestId: 'envelope',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: validRequest },
          extra: true,
        },
        code: 'bad_request',
      },
      {
        name: 'non-string id',
        message: {
          type: 'op',
          requestId: 'number-id',
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: { memberId: 12, from: null, to: 'p-0001' } },
        },
        code: 'bad_request',
      },
      {
        name: 'requestId length 64 is in range',
        message: {
          type: 'op',
          requestId: 'y'.repeat(64),
          boardId: summary.boardId,
          baseVersion: 0,
          op: { kind: 'placeInPosition', request: validRequest },
        },
        code: 'not_subscribed',
      },
    ];

    for (const spec of cases) {
      const pending = inbox.next();
      ws.send(JSON.stringify(spec.message));
      const message = asRecord(await pending);
      expect(message.type, spec.name).toBe('rejected');
      expect(message.code, spec.name).toBe(spec.code);
      expect(typeof message.message, spec.name).toBe('string');
    }

    expect(session.store.loadBoard(summary.boardId)).toEqual(before);
  });
});
