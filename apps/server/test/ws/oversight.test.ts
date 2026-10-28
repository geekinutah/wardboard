import { diffBoards, overseerOf, setOversight, type Board, type BoardGroup, type CallingGroup } from '@wardboard/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Inbox,
  asRecord,
  cleanup,
  openSocket,
  opMessage,
  requireBoard,
  seedAcceptedProposal,
  seedDraftProposals,
  startAdmin,
  subscribe,
} from './helpers.ts';

afterEach(cleanup);

function groupByKey(board: Board, key: string): CallingGroup {
  const group = Object.values(board.callingGroups).find((item) => item.key === key);
  if (group === undefined) throw new Error(`missing calling group ${key}`);
  return group;
}

function boardGroupByKey(board: Board, key: string): BoardGroup {
  const group = Object.values(board.boardGroups).find((item) => item.key === key);
  if (group === undefined) throw new Error(`missing board group ${key}`);
  return group;
}

async function draftSession(): Promise<{
  session: Awaited<ReturnType<typeof startAdmin>>;
  boardId: Board['id'];
  ws: Awaited<ReturnType<typeof openSocket>>;
  inbox: Inbox;
}> {
  const session = await startAdmin(seedDraftProposals(1));
  const summary = session.store.listProposals()[0];
  if (summary === undefined) throw new Error('missing proposal');
  const ws = await openSocket(session);
  const inbox = new Inbox(ws);
  await subscribe(ws, inbox, summary.boardId);
  return { session, boardId: summary.boardId, ws, inbox };
}

describe('oversight operations', () => {
  it('setOversight on teachers quorum commits, broadcasts, and overseerOf changes', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const before = requireBoard(session.store, boardId);
    const teachers = groupByKey(before, 'teachers_quorum');
    const target = { kind: 'callingGroup' as const, id: teachers.id };
    expect(overseerOf(before, target)).toBe('first_counselor');

    const other = await openSocket(session);
    const otherInbox = new Inbox(other);
    await subscribe(other, otherInbox, boardId);

    const pending = inbox.next();
    const otherPending = otherInbox.next();
    ws.send(
      opMessage({
        requestId: 'set-teachers',
        boardId,
        baseVersion: before.version,
        kind: 'setOversight',
        request: { target, overseer: 'second_counselor' },
      }),
    );
    const committed = asRecord(await pending);
    const broadcast = asRecord(await otherPending);
    expect(broadcast).toEqual(committed);
    expect(committed).toMatchObject({
      type: 'committed',
      requestId: 'set-teachers',
      boardId,
      version: before.version + 1,
      by: 'admin@example.test',
    });

    const stored = requireBoard(session.store, boardId);
    expect(stored.version).toBe(before.version + 1);
    expect(overseerOf(stored, target)).toBe('second_counselor');
    expect(session.store.loadBoard(boardId)).toEqual(stored);
  });

  it('setOversight on the priests quorum → rejected fixed_oversight, version unchanged', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const before = requireBoard(session.store, boardId);
    const priests = groupByKey(before, 'priests_quorum');
    const ward = session.store.loadWard();
    const request = {
      target: { kind: 'callingGroup' as const, id: priests.id },
      overseer: 'second_counselor' as const,
    };
    const direct = setOversight(before, { ward, ids: () => 'unused' }, request);
    expect(direct.ok).toBe(false);
    if (direct.ok) return;

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'set-priests',
        boardId,
        baseVersion: before.version,
        kind: 'setOversight',
        request,
      }),
    );
    const rejected = asRecord(await pending);
    expect(rejected).toMatchObject({
      type: 'rejected',
      requestId: 'set-priests',
      code: direct.error.code,
      message: direct.error.message,
    });
    expect(direct.error.code).toBe('fixed_oversight');
    const stored = requireBoard(session.store, boardId);
    expect(stored.version).toBe(before.version);
    expect(stored).toEqual(before);
  });

  it('oversight change produces no suggested callings or releases (diff empty vs before)', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const before = requireBoard(session.store, boardId);
    const teachers = groupByKey(before, 'teachers_quorum');

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'set-diff',
        boardId,
        baseVersion: before.version,
        kind: 'setOversight',
        request: {
          target: { kind: 'callingGroup', id: teachers.id },
          overseer: 'bishop',
        },
      }),
    );
    expect(asRecord(await pending).type).toBe('committed');

    const after = requireBoard(session.store, boardId);
    expect(after.oversight).not.toEqual(before.oversight);
    expect(after.placements).toEqual(before.placements);
    expect(diffBoards(before, after)).toEqual({
      callings: [],
      releases: [],
      addedPositions: [],
      removedPositions: [],
    });
  });

  it('clearOversight reverts to the inherited overseer', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const before = requireBoard(session.store, boardId);
    const teachers = groupByKey(before, 'teachers_quorum');
    const aaronic = boardGroupByKey(before, 'aaronic_priesthood');
    const teachersTarget = { kind: 'callingGroup' as const, id: teachers.id };
    expect(overseerOf(before, teachersTarget)).toBe('first_counselor');

    const setPending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'set-aaronic',
        boardId,
        baseVersion: before.version,
        kind: 'setOversight',
        request: {
          target: { kind: 'boardGroup', id: aaronic.id },
          overseer: 'second_counselor',
        },
      }),
    );
    expect(asRecord(await setPending).type).toBe('committed');

    const clearPending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'clear-teachers',
        boardId,
        baseVersion: before.version + 1,
        kind: 'clearOversight',
        request: { target: teachersTarget },
      }),
    );
    const cleared = asRecord(await clearPending);
    expect(cleared.type).toBe('committed');
    expect(cleared.version).toBe(before.version + 2);

    const stored = requireBoard(session.store, boardId);
    expect(
      stored.oversight.some((entry) => entry.target.kind === 'callingGroup' && entry.target.id === teachers.id),
    ).toBe(false);
    expect(overseerOf(stored, teachersTarget)).toBe('second_counselor');
  });

  it('bad overseer value or extra keys → bad_request', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const before = requireBoard(session.store, boardId);
    const teachers = groupByKey(before, 'teachers_quorum');
    const target = { kind: 'callingGroup' as const, id: teachers.id };
    const cases = [
      {
        name: 'bad overseer',
        kind: 'setOversight',
        request: { target, overseer: 'stake_president' },
      },
      {
        name: 'extra key',
        kind: 'setOversight',
        request: { target, overseer: 'bishop', note: 'no' },
      },
      {
        name: 'clear extra key',
        kind: 'clearOversight',
        request: { target, overseer: 'bishop' },
      },
    ];

    for (const spec of cases) {
      const pending = inbox.next();
      ws.send(
        opMessage({
          requestId: spec.name,
          boardId,
          baseVersion: before.version,
          kind: spec.kind,
          request: spec.request,
        }),
      );
      const rejected = asRecord(await pending);
      expect(rejected.type, spec.name).toBe('rejected');
      expect(rejected.code, spec.name).toBe('bad_request');
    }

    expect(requireBoard(session.store, boardId)).toEqual(before);
  });

  it('setOversight on an Accepted proposal → not_editable', async () => {
    const session = await startAdmin(seedAcceptedProposal);
    const summary = session.store.listProposals().find((item) => item.status === 'accepted');
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    const before = requireBoard(session.store, summary.boardId);
    const teachers = groupByKey(before, 'teachers_quorum');

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, summary.boardId);
    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'set-accepted',
        boardId: summary.boardId,
        baseVersion: before.version,
        kind: 'setOversight',
        request: {
          target: { kind: 'callingGroup', id: teachers.id },
          overseer: 'second_counselor',
        },
      }),
    );
    const rejected = asRecord(await pending);
    expect(rejected.type).toBe('rejected');
    expect(rejected.code).toBe('not_editable');
    expect(session.store.loadBoard(summary.boardId)).toEqual(before);
    expect(session.store.loadProposal(summary.id)?.status).toBe('accepted');
  });
});
