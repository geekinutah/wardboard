import { addToList, type BoardId } from '@wardboard/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  FIXED_TIME,
  Inbox,
  asRecord,
  assignmentTitled,
  cleanup,
  memberNamed,
  occupiedPosition,
  openSocket,
  opMessage,
  requireBoard,
  restart,
  seedAcceptedProposal,
  seedDraftProposals,
  startAdmin,
  subscribe,
  vacantPosition,
} from './helpers.ts';

afterEach(cleanup);

async function draftSession(): Promise<{
  session: Awaited<ReturnType<typeof startAdmin>>;
  boardId: BoardId;
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

describe('operation channel operations', () => {
  it('move commits, bumps version and persists', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const board = requireBoard(session.store, boardId);
    const ward = session.store.loadWard();
    const mover = memberNamed(ward, 'Liv Example');
    const chorister = vacantPosition(board, 'Chorister');

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'move-1',
        boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: mover.id, from: null, to: chorister.id },
      }),
    );
    const committed = asRecord(await pending);
    expect(committed.type).toBe('committed');
    expect(committed.version).toBe(1);
    expect(committed.requestId).toBe('move-1');
    expect(committed.by).toBe(ADMIN.login);
    const committedBoard = asRecord(committed.board);
    expect(committedBoard.version).toBe(1);
    expect(asRecord(committedBoard.placements)[chorister.id]).toBe(mover.id);

    ws.close();
    await inbox.closed();
    await restart(session);
    const again = await openSocket(session);
    const againInbox = new Inbox(again);
    const snapshot = await subscribe(again, againInbox, boardId);
    expect(snapshot.version).toBe(1);
    expect(snapshot.board).toEqual(committed.board);
    expect(session.store.loadBoard(boardId)).toEqual(committed.board);
  });

  it('core error passes through as rejected', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const board = requireBoard(session.store, boardId);
    const ward = session.store.loadWard();
    const quinn = memberNamed(ward, 'Quinn Mockup');
    const instructors = assignmentTitled(board, 'Elders Quorum Instructor');
    const request = { memberId: quinn.id, from: null, assignmentId: instructors.id };
    const direct = addToList(board, { ward, ids: () => 'unused' }, request);
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    const before = session.store.loadBoard(boardId);

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'dup-list',
        boardId,
        baseVersion: board.version,
        kind: 'addToList',
        request,
      }),
    );
    const rejected = asRecord(await pending);
    expect(rejected).toMatchObject({
      type: 'rejected',
      requestId: 'dup-list',
      code: direct.error.code,
      message: direct.error.message,
    });
    expect(session.store.loadBoard(boardId)).toEqual(before);
  });

  it('current and baselines are not_editable', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const proposal = session.store.loadProposal(summary.id);
    if (proposal === null) throw new Error('missing proposal');
    const current = session.store.loadCurrent();
    if (current === null) throw new Error('missing current');
    const ward = session.store.loadWard();
    const mover = memberNamed(ward, 'Liv Example');
    const request = {
      memberId: mover.id,
      from: null,
      to: vacantPosition(current.board, 'Chorister').id,
    };

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, current.board.id);
    const currentPending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'edit-current',
        boardId: current.board.id,
        baseVersion: current.board.version,
        kind: 'placeInPosition',
        request,
      }),
    );
    expect(asRecord(await currentPending).code).toBe('not_editable');

    await subscribe(ws, inbox, proposal.baseline.id);
    const baselinePending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'edit-baseline',
        boardId: proposal.baseline.id,
        baseVersion: proposal.baseline.version,
        kind: 'placeInPosition',
        request: {
          memberId: mover.id,
          from: null,
          to: vacantPosition(proposal.baseline, 'Chorister').id,
        },
      }),
    );
    const baselineRejected = asRecord(await baselinePending);
    expect(baselineRejected.type).toBe('rejected');
    expect(baselineRejected.code).toBe('not_editable');
    expect(session.store.loadCurrent()).toEqual(current);
    expect(session.store.loadBoard(proposal.baseline.id)).toEqual(proposal.baseline);
  });

  it('accepted proposal is not_editable', async () => {
    const session = await startAdmin(seedAcceptedProposal);
    const summary = session.store.listProposals().find((item) => item.status === 'accepted');
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    const board = requireBoard(session.store, summary.boardId);
    const mover = memberNamed(session.store.loadWard(), 'Liv Example');
    const before = session.store.loadBoard(summary.boardId);

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, summary.boardId);
    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'edit-accepted',
        boardId: summary.boardId,
        baseVersion: board.version,
        kind: 'placeInPosition',
        request: { memberId: mover.id, from: null, to: vacantPosition(board, 'Chorister').id },
      }),
    );
    const rejected = asRecord(await pending);
    expect(rejected.type).toBe('rejected');
    expect(rejected.code).toBe('not_editable');
    expect(session.store.loadBoard(summary.boardId)).toEqual(before);
    expect(session.store.loadProposal(summary.id)?.status).toBe('accepted');
  });

  it('swap is one committed operation', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const board = requireBoard(session.store, boardId);
    const clerk = occupiedPosition(board, 'Ward Clerk');
    const executive = occupiedPosition(board, 'Executive Secretary');

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'swap-1',
        boardId,
        baseVersion: board.version,
        kind: 'swap',
        request: { memberId: clerk.memberId, from: clerk.positionId, to: executive.positionId },
      }),
    );
    const committed = asRecord(await pending);
    expect(committed.type).toBe('committed');
    const placements = asRecord(asRecord(committed.board).placements);
    expect(placements[clerk.positionId]).toBe(executive.memberId);
    expect(placements[executive.positionId]).toBe(clerk.memberId);

    const follow = inbox.next();
    ws.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await follow).type).toBe('boards');
  });

  it('approvePlacement takes approver and time from the server', async () => {
    const { session, boardId, ws, inbox } = await draftSession();
    const ward = session.store.loadWard();
    const cy = memberNamed(ward, 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const board = requireBoard(session.store, boardId);
    const chorister = vacantPosition(board, 'Chorister');
    const actor = session.access.listUsers().find((user) => user.login === ADMIN.login);
    expect(actor).toBeDefined();
    if (actor === undefined) return;

    const placed = inbox.next();
    ws.send(
      opMessage({
        requestId: 'place-cy',
        boardId,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: cy.id, from: null, to: chorister.id },
      }),
    );
    expect(asRecord(await placed).type).toBe('committed');

    const forbiddenFields = [
      { approvedBy: 'attacker' },
      { approvedAt: FIXED_TIME },
      { baseline: { id: 'client-baseline' } },
    ];
    for (const extra of forbiddenFields) {
      const pending = inbox.next();
      ws.send(
        opMessage({
          requestId: `bad-${Object.keys(extra)[0] ?? 'field'}`,
          boardId,
          baseVersion: 1,
          kind: 'approvePlacement',
          request: { memberId: cy.id, positionId: chorister.id, ...extra },
        }),
      );
      const rejected = asRecord(await pending);
      expect(rejected.type).toBe('rejected');
      expect(rejected.code).toBe('bad_request');
    }
    expect(requireBoard(session.store, boardId).approvals).toEqual([]);
    expect(requireBoard(session.store, boardId).version).toBe(1);

    const pending = inbox.next();
    ws.send(
      opMessage({
        requestId: 'approve-cy',
        boardId,
        baseVersion: 1,
        kind: 'approvePlacement',
        request: { memberId: cy.id, positionId: chorister.id },
      }),
    );
    const committed = asRecord(await pending);
    expect(committed.type).toBe('committed');
    expect(committed.version).toBe(2);
    const approvals = asRecord(committed.board).approvals;
    expect(approvals).toEqual([
      {
        memberId: cy.id,
        positionId: chorister.id,
        approvedBy: actor.id,
        approvedAt: FIXED_TIME,
      },
    ]);
    expect(requireBoard(session.store, boardId).approvals).toEqual(approvals);
  });
});
