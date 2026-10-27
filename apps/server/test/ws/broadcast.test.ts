import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Inbox,
  asRecord,
  cleanup,
  memberNamed,
  openSocket,
  opMessage,
  requireBoard,
  seedDraftProposals,
  startAdmin,
  subscribe,
  vacantPosition,
} from './helpers.ts';

afterEach(cleanup);

describe('operation channel broadcast', () => {
  it('commit reaches every subscriber of the board including the sender', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const board = requireBoard(session.store, summary.boardId);
    const group = Object.values(board.boardGroups)[0];
    if (group === undefined) throw new Error('missing board group');

    const sockets = await Promise.all([openSocket(session), openSocket(session), openSocket(session)]);
    const inboxes = sockets.map((socket) => new Inbox(socket));
    for (let index = 0; index < sockets.length; index += 1) {
      const socket = sockets[index];
      const inbox = inboxes[index];
      if (socket === undefined || inbox === undefined) throw new Error('missing client');
      await subscribe(socket, inbox, summary.boardId);
    }

    const pending = inboxes.map((inbox) => inbox.next());
    const sender = sockets[0];
    sender.send(
      opMessage({
        requestId: 'broadcast-1',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'renameGroup',
        request: { target: { kind: 'boardGroup', id: group.id }, name: 'Renamed once' },
      }),
    );
    const messages = await Promise.all(pending);
    const records = messages.map((message) => asRecord(message));
    expect(records).toHaveLength(3);
    expect(new Set(records.map((message) => JSON.stringify(message))).size).toBe(1);
    expect(records[0]).toMatchObject({
      type: 'committed',
      boardId: summary.boardId,
      version: 1,
      requestId: 'broadcast-1',
    });
  });

  it("other boards' subscribers receive nothing", async () => {
    const session = await startAdmin(seedDraftProposals(2));
    const summaries = session.store.listProposals();
    const boardA = summaries[0];
    const boardB = summaries[1];
    if (boardA === undefined || boardB === undefined) throw new Error('missing proposals');
    const group = Object.values(requireBoard(session.store, boardA.boardId).boardGroups)[0];
    if (group === undefined) throw new Error('missing board group');

    const socketA = await openSocket(session);
    const inboxA = new Inbox(socketA);
    const socketB = await openSocket(session);
    const inboxB = new Inbox(socketB);
    await subscribe(socketA, inboxA, boardA.boardId);
    await subscribe(socketB, inboxB, boardB.boardId);

    const committed = inboxA.next();
    socketA.send(
      opMessage({
        requestId: 'only-a',
        boardId: boardA.boardId,
        baseVersion: 0,
        kind: 'renameGroup',
        request: { target: { kind: 'boardGroup', id: group.id }, name: 'Only A' },
      }),
    );
    expect(asRecord(await committed).type).toBe('committed');

    const roundTrip = inboxB.next();
    socketB.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await roundTrip).type).toBe('boards');
    expect(requireBoard(session.store, boardB.boardId).version).toBe(0);
  });

  it('concurrent ops at the same base version: exactly one commits', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const board = requireBoard(session.store, summary.boardId);
    const ward = session.store.loadWard();
    const kai = memberNamed(ward, 'Kai Fictional');
    const liv = memberNamed(ward, 'Liv Example');
    const chorister = vacantPosition(board, 'Chorister');
    const members = { 'req-a': kai.id, 'req-b': liv.id };

    const socketA = await openSocket(session);
    const inboxA = new Inbox(socketA);
    const socketB = await openSocket(session);
    const inboxB = new Inbox(socketB);
    await subscribe(socketA, inboxA, summary.boardId);
    await subscribe(socketB, inboxB, summary.boardId);

    const firstA = inboxA.next();
    const firstB = inboxB.next();
    socketA.send(
      opMessage({
        requestId: 'req-a',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: kai.id, from: null, to: chorister.id },
      }),
    );
    socketB.send(
      opMessage({
        requestId: 'req-b',
        boardId: summary.boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: liv.id, from: null, to: chorister.id },
      }),
    );

    const messageA = asRecord(await firstA);
    const messageB = asRecord(await firstB);
    expect(messageA.type).toBe('committed');
    expect(messageB.type).toBe('committed');
    expect(messageA).toEqual(messageB);
    expect(messageA.version).toBe(1);
    const winnerRequest = messageA.requestId;
    expect(winnerRequest === 'req-a' || winnerRequest === 'req-b').toBe(true);
    if (winnerRequest !== 'req-a' && winnerRequest !== 'req-b') return;

    const loserInbox = winnerRequest === 'req-a' ? inboxB : inboxA;
    const winnerInbox = winnerRequest === 'req-a' ? inboxA : inboxB;
    const winnerSocket = winnerRequest === 'req-a' ? socketA : socketB;
    const rejected = asRecord(await loserInbox.next());
    expect(rejected).toMatchObject({
      type: 'rejected',
      code: 'stale',
      currentVersion: 1,
      requestId: winnerRequest === 'req-a' ? 'req-b' : 'req-a',
    });

    const follow = winnerInbox.next();
    winnerSocket.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await follow).type).toBe('boards');

    const stored = requireBoard(session.store, summary.boardId);
    expect(stored.version).toBe(1);
    expect(stored.placements[chorister.id]).toBe(members[winnerRequest]);
    const choristerHolders = Object.entries(stored.placements).filter(([positionId]) => positionId === chorister.id);
    expect(choristerHolders).toHaveLength(1);
  });

  it('versions are strictly increasing without gaps', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const group = Object.values(requireBoard(session.store, summary.boardId).boardGroups)[0];
    if (group === undefined) throw new Error('missing board group');

    const sender = await openSocket(session);
    const senderInbox = new Inbox(sender);
    const other = await openSocket(session);
    const otherInbox = new Inbox(other);
    await subscribe(sender, senderInbox, summary.boardId);
    await subscribe(other, otherInbox, summary.boardId);

    const senderVersions: number[] = [];
    const otherVersions: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const pendingSender = senderInbox.next();
      const pendingOther = otherInbox.next();
      sender.send(
        opMessage({
          requestId: `seq-${String(index)}`,
          boardId: summary.boardId,
          baseVersion: index,
          kind: 'renameGroup',
          request: { target: { kind: 'boardGroup', id: group.id }, name: `Name ${String(index)}` },
        }),
      );
      const committedSender = asRecord(await pendingSender);
      const committedOther = asRecord(await pendingOther);
      expect(committedOther).toEqual(committedSender);
      expect(committedSender.type).toBe('committed');
      senderVersions.push(Number(committedSender.version));
      otherVersions.push(Number(committedOther.version));
    }

    expect(senderVersions).toEqual([1, 2, 3, 4, 5]);
    expect(otherVersions).toEqual([1, 2, 3, 4, 5]);
    expect(requireBoard(session.store, summary.boardId).version).toBe(5);
  });

  it('resubscribe switches boards', async () => {
    const session = await startAdmin(seedDraftProposals(2));
    const summaries = session.store.listProposals();
    const boardA = summaries[0];
    const boardB = summaries[1];
    if (boardA === undefined || boardB === undefined) throw new Error('missing proposals');
    const groupA = Object.values(requireBoard(session.store, boardA.boardId).boardGroups)[0];
    const groupB = Object.values(requireBoard(session.store, boardB.boardId).boardGroups)[0];
    if (groupA === undefined || groupB === undefined) throw new Error('missing board group');

    const watcher = await openSocket(session);
    const watcherInbox = new Inbox(watcher);
    const editor = await openSocket(session);
    const editorInbox = new Inbox(editor);
    await subscribe(watcher, watcherInbox, boardA.boardId);
    await subscribe(editor, editorInbox, boardA.boardId);
    await subscribe(watcher, watcherInbox, boardB.boardId);

    const edited = editorInbox.next();
    editor.send(
      opMessage({
        requestId: 'still-a',
        boardId: boardA.boardId,
        baseVersion: 0,
        kind: 'renameGroup',
        request: { target: { kind: 'boardGroup', id: groupA.id }, name: 'A changed' },
      }),
    );
    expect(asRecord(await edited).type).toBe('committed');

    const absence = watcherInbox.next();
    watcher.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await absence).type).toBe('boards');

    await subscribe(editor, editorInbox, boardB.boardId);
    const onB = watcherInbox.next();
    editor.send(
      opMessage({
        requestId: 'now-b',
        boardId: boardB.boardId,
        baseVersion: 0,
        kind: 'renameGroup',
        request: { target: { kind: 'boardGroup', id: groupB.id }, name: 'B changed' },
      }),
    );
    const committed = asRecord(await onB);
    expect(committed).toMatchObject({ type: 'committed', boardId: boardB.boardId, version: 1, requestId: 'now-b' });
    expect(watcher.readyState).toBe(WebSocket.OPEN);
  });
});
